import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { chromium, type Browser, type Page } from '@playwright/test';

import { toCents } from '../web/lib/compare-at.js';
import {
  auditConfig,
  clientFindings,
  judgeByob,
  judgeOosRedirect,
  judgePage,
  judgeRedirect,
  judgeStacking,
  loadAdLandingConfig,
  tally,
  type AdLandingConfig,
  type ByobObservation,
  type Finding,
  type PageObservation,
  type RedirectObservation,
  type StackObservation,
} from '../web/lib/ad-landing.js';

/**
 * Daily QA for ad-traffic landing pages.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:ad-landing
 *
 * Checks the six things in the daily brief: discount non-stacking, auto-ship
 * pricing, discount redirect flows, BYOB builder flows, out-of-stock redirect
 * behaviour, and compare-at accuracy.
 *
 * Exit codes: 0 clean, 1 findings to act on, 2 could not run.
 */

const flags = new Map<string, string>();
const bare = new Set<string>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) bare.add(name);
    else {
      flags.set(name, next);
      i += 1;
    }
  }
}

const baseURL = (flags.get('base-url') ?? process.env.KITSCH_BASE_URL ?? '').replace(/\/$/u, '');
if (baseURL === '') {
  process.stderr.write(
    'No storefront to check. Pass --base-url or set KITSCH_BASE_URL.\n' +
      'Refusing to default to a fixture: a green run against a mock would be reported\n' +
      'as a daily result about live ad landing pages.\n',
  );
  process.exit(2);
}

const configPath = flags.get('config') ?? 'config/ad-landing.yaml';
const outDir = flags.get('out') ?? 'ad-landing-report';
const date = flags.get('date') ?? new Date().toISOString().slice(0, 10);
const config: AdLandingConfig = loadAdLandingConfig(configPath);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const sel = (name: string): string => config.selectors[name] ?? `[data-testid="${name}"]`;

const handleFromUrl = (url: string): string | undefined =>
  /\/products\/([^/?#]+)/u.exec(url)?.[1];

const textOf = async (page: Page, css: string): Promise<string | undefined> => {
  const locator = page.locator(css).first();
  if ((await locator.count()) === 0) return undefined;
  return (await locator.textContent()) ?? undefined;
};

const byobHandles = new Set(config.byob.map((entry) => entry.handle));
const oosHandles = new Map(config.oosRedirects.map((entry) => [entry.handle, entry]));

// ── observers ────────────────────────────────────────────────────────────

/**
 * Asks what the product URL does WITHOUT following it. Stock state is not
 * observable once a storefront redirects — the page never renders — so reading
 * it from the destination describes the substitute, not the product that went
 * out of stock. This probe is what makes the OOS check mean anything.
 */
const probeRedirect = async (handle: string): Promise<string | undefined> => {
  try {
    const response = await fetch(`${baseURL}/products/${handle}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'kitsch-automation daily QA' },
    });
    if (response.status < 300 || response.status >= 400) return undefined;
    const location = response.headers.get('location');
    return location === null ? undefined : handleFromUrl(location);
  } catch {
    return undefined;
  }
};

const observePage = async (page: Page, handle: string): Promise<PageObservation> => {
  const status = await page
    .goto(`${baseURL}/products/${handle}`, {
      timeout: config.maxLoadMs + 5000,
      waitUntil: 'domcontentloaded',
    })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);

  const blank: PageObservation = {
    handle,
    status,
    finalHandle: undefined,
    redirectedTo: undefined,
    soldOut: undefined,
    priceText: undefined,
    compareAtText: undefined,
    autoshipOffered: undefined,
    autoshipPriceText: undefined,
  };
  if (status !== 200) return blank;

  const finalHandle = handleFromUrl(page.url());
  const autoshipOffered = (await page.locator(sel('autoship_toggle')).count()) > 0;

  return {
    ...blank,
    finalHandle,
    redirectedTo: oosHandles.has(handle) ? await probeRedirect(handle) : undefined,
    soldOut: (await page.locator(sel('sold_out')).count()) > 0,
    priceText: await textOf(page, sel('price')),
    compareAtText: await textOf(page, sel('compare_at')),
    autoshipOffered,
    autoshipPriceText: autoshipOffered ? await textOf(page, sel('autoship_price')) : undefined,
  };
};

/**
 * Exercises a builder: read the price, choose up to two options, read it again.
 * A price that does not move is the failure — the page renders, the customer
 * builds a bundle, and nothing is priced until checkout.
 */
const observeByob = async (page: Page, handle: string): Promise<ByobObservation> => {
  const status = await page
    .goto(`${baseURL}/products/${handle}`, {
      timeout: config.maxLoadMs + 5000,
      waitUntil: 'domcontentloaded',
    })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);

  if (status !== 200) {
    return {
      handle,
      status,
      optionCount: undefined,
      priceBeforeText: undefined,
      priceAfterText: undefined,
      selectedCount: undefined,
    };
  }

  const options = page.locator(sel('byob_option'));
  const optionCount = await options.count();
  const priceBeforeText = await textOf(page, sel('byob_price'));

  let selected = 0;
  for (let i = 0; i < Math.min(optionCount, 2); i += 1) {
    try {
      await options.nth(i).click({ timeout: 5000 });
      await page.waitForTimeout(600);
      selected += 1;
    } catch {
      // Not clickable; the option count and static price carry the signal.
    }
  }

  return {
    handle,
    status,
    // Zero is a real observation, not "not observed". Mapping it to undefined
    // turned an empty builder into a harness finding, so a BYOB page offering
    // nothing to build reported as our gap rather than as broken. The dual
    // cause — empty builder or unmapped selector — is named in the finding.
    optionCount,
    priceBeforeText,
    priceAfterText: await textOf(page, sel('byob_price')),
    selectedCount: selected,
  };
};

const observeRedirect = async (page: Page, code: string): Promise<RedirectObservation> => {
  const status = await page
    .goto(`${baseURL}/discount/${code}`, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);
  const final = page.url();
  return {
    code,
    status,
    finalHandle: handleFromUrl(final),
    finalPath: (() => {
      try {
        return new URL(final).pathname;
      } catch {
        return undefined;
      }
    })(),
  };
};

/**
 * Applies the fixed code, then attempts a site-wide one, and reports which the
 * cart says it accepted. Requires something in the cart first, or every code is
 * refused for reasons unrelated to stacking.
 */
const observeStacking = async (
  page: Page,
  productHandle: string,
  fixedCode: string,
  siteWideCode: string,
): Promise<StackObservation> => {
  await page.goto(`${baseURL}/products/${productHandle}`, {
    timeout: config.maxLoadMs + 5000,
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator(sel('add_to_cart'))
    .first()
    .click({ timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.goto(`${baseURL}/cart`, { timeout: 30_000, waitUntil: 'domcontentloaded' });

  const applied: string[] = [];
  for (const code of [fixedCode, siteWideCode]) {
    const input = page.locator(sel('discount_input')).first();
    if ((await input.count()) === 0) break;
    await input.fill(code, { timeout: 5000 }).catch(() => undefined);
    await page
      .locator(sel('discount_apply'))
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(1500);
    if ((await page.getByText(code, { exact: false }).count()) > 0) applied.push(code);
  }

  const cents = async (name: string): Promise<number | undefined> =>
    toCents((await textOf(page, sel(name))) ?? '');

  return {
    fixedCode,
    siteWideCode,
    appliedCodes: applied,
    subtotalCents: await cents('cart_subtotal'),
    discountCents: (await cents('cart_discount')) ?? 0,
    totalCents: await cents('cart_total'),
  };
};

// ── run ──────────────────────────────────────────────────────────────────

write('');
write(`Ad-landing daily QA — ${date}`);
write('');
write(`  target       ${baseURL}`);
write(`  pages        ${String(config.pages.length)}`);
write(`  byob flows   ${String(config.byob.length)}`);
write(`  redirects    ${String(config.discountRedirects.length)}`);
write(`  oos pairs    ${String(config.oosRedirects.length)}`);
write(`  unresolved   ${String(config.unresolved.length)} (named in the brief, no URL known)`);
write('');

const findings: Finding[] = [...auditConfig(config)];

let browser: Browser;
try {
  browser = await chromium.launch({
    ...(process.env.KITSCH_CHROMIUM_PATH === undefined
      ? {}
      : { executablePath: process.env.KITSCH_CHROMIUM_PATH }),
  });
} catch (error) {
  process.stderr.write(
    `\n  NO BROWSER     ${(error as Error).message.split('\n')[0] ?? ''}\n\n` +
      '    1. npx playwright install chromium\n' +
      '    2. or KITSCH_CHROMIUM_PATH=/path/to/chrome\n\n',
  );
  process.exit(2);
}
const page = await browser.newPage();

let reachedAny = false;

// ── pages: compare-at, availability, auto-ship, and OOS redirect ──
for (const spec of config.pages) {
  // BYOB pages are exercised as flows below; checking them twice would double
  // every finding on them.
  if (byobHandles.has(spec.handle)) continue;
  const observation = await observePage(page, spec.handle);
  if (observation.status === 200) reachedAny = true;
  findings.push(...judgePage(spec, config, observation));

  const oos = oosHandles.get(spec.handle);
  if (oos !== undefined) findings.push(...judgeOosRedirect(oos, observation));

  write(`  ${observation.status === 200 ? 'ok  ' : 'FAIL'} ${String(observation.status).padEnd(4)} ${spec.handle}`);
}

// ── BYOB flows ──
write('');
for (const spec of config.byob) {
  const observation = await observeByob(page, spec.handle);
  if (observation.status === 200) reachedAny = true;
  findings.push(...judgeByob(config, observation));
  write(
    `  byob ${String(observation.status).padEnd(4)} ` +
      `${String(observation.optionCount ?? 0).padStart(3)} option(s)  ${spec.handle}`,
  );
}

// ── discount redirects ──
write('');
for (const spec of config.discountRedirects) {
  const observation = await observeRedirect(page, spec.code);
  if (observation.status === 200) reachedAny = true;
  findings.push(...judgeRedirect(spec, observation));
  write(
    `  code ${String(observation.status).padEnd(4)} /discount/${spec.code} -> ` +
      `${observation.finalPath ?? '(unknown)'}`,
  );
}

// ── non-stacking ──
// One pairing per fixed code, on the product that carries it. Every code
// against every site-wide offer would be a large cart exercise for little
// extra signal; the rule is per-code, so one pairing per code tests it.
if (config.siteWideCodes.length > 0) {
  write('');
  for (const fixedCode of config.fixedCodes) {
    const carrier = config.pages.find((entry) => entry.fixedDiscountCode === fixedCode);
    if (carrier === undefined) continue;
    for (const siteWideCode of config.siteWideCodes) {
      const observation = await observeStacking(page, carrier.handle, fixedCode, siteWideCode);
      findings.push(...judgeStacking(observation));
      write(
        `  stack ${fixedCode} + ${siteWideCode} -> applied: ` +
          `${observation.appliedCodes.join(', ') || 'none'}`,
      );
    }
  }
}

await browser.close();

// Run-level vacuity guard: if nothing loaded, every page "had no defects",
// which is also what a total outage looks like. Collapse the per-page failures
// so a run that verified nothing cannot be read as a list of store defects.
const checkedCount = config.pages.length + config.discountRedirects.length;
if (checkedCount > 0 && !reachedAny) {
  const kept = findings.filter((f) => f.kind !== 'page_unreachable' && f.kind !== 'redirect_broken');
  findings.splice(0, findings.length, ...kept, {
    severity: 'harness',
    kind: 'page_unreachable',
    check: 'compare_at',
    target: '(run)',
    detail:
      `nothing loaded from ${baseURL}, so no ad landing page was verified. Config ` +
      'findings above still stand.',
  });
}

// ── report ───────────────────────────────────────────────────────────────

const counts = tally(findings);
const actionable = clientFindings(findings);
mkdirSync(outDir, { recursive: true });

const CHECK_TITLES: Readonly<Record<string, string>> = {
  discount_non_stacking: 'Discount non-stacking',
  autoship_pricing: 'Auto-ship pricing',
  discount_redirect: 'Discount redirect flows',
  byob_flow: 'BYOB flows',
  oos_redirect: 'Out-of-stock redirect',
  compare_at: 'Compare-at / strikethrough',
  config: 'Scope and configuration',
};

const byCheck = (['critical', 'major', 'minor', 'harness'] as const).flatMap((severity) => {
  const list = findings.filter((f) => f.severity === severity);
  if (list.length === 0) return [];
  return [
    `## ${severity} — ${String(list.length)}`,
    '',
    ...list.map(
      (f) => `- **${f.target}** — _${CHECK_TITLES[f.check] ?? f.check}_ — ${f.detail}`,
    ),
    '',
  ];
});

writeFileSync(
  `${outDir}/report.md`,
  [
    `# Ad-landing daily QA — ${date}`,
    '',
    `- target: ${baseURL}`,
    `- pages: ${String(config.pages.length)} | BYOB: ${String(config.byob.length)} | ` +
      `redirects: ${String(config.discountRedirects.length)} | OOS pairs: ${String(config.oosRedirects.length)}`,
    '',
    '| severity | count |',
    '|---|---|',
    `| critical | ${String(counts.critical)} |`,
    `| major | ${String(counts.major)} |`,
    `| minor | ${String(counts.minor)} |`,
    `| harness (our gaps, not store defects) | ${String(counts.harness)} |`,
    '',
    ...(findings.length === 0 ? ['No findings.', ''] : byCheck),
  ].join('\n'),
  'utf8',
);

writeFileSync(
  `${outDir}/report.json`,
  `${JSON.stringify({ date, target: baseURL, counts, findings }, null, 2)}\n`,
  'utf8',
);
appendFileSync(
  `${outDir}/history.jsonl`,
  `${JSON.stringify({ date, target: baseURL, counts })}\n`,
  'utf8',
);

write('');
write(
  `  critical ${String(counts.critical)} | major ${String(counts.major)} | ` +
    `minor ${String(counts.minor)} | harness ${String(counts.harness)}`,
);
write(`  report: ${outDir}/report.md`);

if (actionable.length > 0) {
  write('');
  write(`  ad-landing QA: FINDINGS — ${String(actionable.length)} to act on`);
  process.exit(1);
}
if (counts.harness > 0) {
  write('');
  write('  ad-landing QA: INCOMPLETE — no defects found, but not everything was checked');
  process.exit(2);
}
write('');
write('  ad-landing QA: CLEAN');
