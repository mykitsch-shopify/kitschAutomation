import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { type Page } from '@playwright/test';

import { allureDir, buildMatrix, writeAllureCases, writeEnvironment } from './lib/allure.js';
import { launchFromArgs } from './lib/browser.js';
import { toCents } from '../web/lib/compare-at.js';
import {
  ALL_CHECKS,
  auditConfig,
  clientFindings,
  judgeCart,
  judgeProduct,
  loadTopProductsConfig,
  tally,
  type CartObservation,
  type Finding,
  type Observation,
  type ProductSpec,
  type TopProductsConfig,
  type VariantObservation,
} from '../web/lib/top-products.js';

/**
 * Daily top-10 product check.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:top-products
 *
 * Checks the products in config/top-products.yaml for availability,
 * add-to-cart, title, description, images, videos, pricing, specifications,
 * variant behaviour and cart discount arithmetic.
 *
 * Exit codes: 0 clean, 1 findings to act on, 2 could not run.
 */

const USAGE = `
Usage:
  npm run audit:top-products [-- options]

Options:
  --base-url <url>   storefront to check; defaults to $KITSCH_BASE_URL
  --config <path>    default config/top-products.yaml
  --out <dir>        report directory, default top-products-report
  --date <YYYY-MM-DD>  label for the report; defaults to today (UTC)
  --no-cart          skip add-to-cart and the cart/discount checks
  --browser <name>     chromium (default), firefox, webkit, chrome, edge
  --headed             show the browser; default is headless
  --slow-mo <ms>       slow each action down, for watching a flow
  --viewport <WxH>     desktop viewport, default 1440x900
`;

const die = (message: string): never => {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(2);
};

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
  die(
    'No storefront to check. Pass --base-url or set KITSCH_BASE_URL.\n' +
      'Refusing to default to a fixture: a green run against a mock would be\n' +
      'reported as a daily result about the live store.',
  );
}

const configPath = flags.get('config') ?? 'config/top-products.yaml';
const outDir = flags.get('out') ?? 'top-products-report';
const withCart = !bare.has('no-cart');
// Taken as an argument rather than read from the clock so a re-run can label a
// report for the day it describes.
const date = flags.get('date') ?? new Date().toISOString().slice(0, 10);

const config: TopProductsConfig = loadTopProductsConfig(configPath);
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const selector = (name: string): string => config.selectors[name] ?? `[data-testid="${name}"]`;

// ── observing one product ────────────────────────────────────────────────

const textOf = async (page: Page, css: string): Promise<string | undefined> => {
  const locator = page.locator(css).first();
  if ((await locator.count()) === 0) return undefined;
  return (await locator.textContent()) ?? undefined;
};

/**
 * Counts images and, separately, how many are in the markup but did not load.
 * `naturalWidth === 0` on a complete image is a broken one — the customer sees
 * a gap where a product photo should be, which a plain element count misses
 * entirely.
 */
const observeImages = async (
  page: Page,
  css: string,
): Promise<{ count: number | undefined; broken: number | undefined }> => {
  const images = page.locator(css);
  const count = await images.count();
  if (count === 0) return { count: undefined, broken: undefined };
  const broken = await images.evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        const img = node as HTMLImageElement;
        return img.complete && img.naturalWidth === 0;
      }).length,
  );
  return { count, broken };
};

/**
 * Selects each variant in turn and records whether the page still shows a
 * price. A variant picker that silently leaves the price blank is the failure
 * this catches; it looks fine until someone tries to buy that size.
 */
const observeVariants = async (
  page: Page,
): Promise<readonly VariantObservation[] | undefined> => {
  const options = page.locator(selector('variant_option'));
  const total = await options.count();
  if (total === 0) return undefined;

  const out: VariantObservation[] = [];
  // Cap the work: a colour × size product can carry dozens, and a daily run
  // over ten products should stay quick. Ten is enough to catch a broken
  // picker; the cap is reported so nobody reads this as exhaustive.
  const limit = Math.min(total, 10);
  for (let i = 0; i < limit; i += 1) {
    const option = options.nth(i);
    const label = ((await option.getAttribute('value')) ?? (await option.textContent()) ?? `#${String(i)}`).trim();
    let selectable = true;
    try {
      await option.click({ timeout: 4000 });
      await page.waitForTimeout(250);
    } catch {
      selectable = false;
    }
    const priceText = selectable ? await textOf(page, selector('price')) : undefined;
    const soldOut = (await page.locator(selector('sold_out')).count()) > 0;
    out.push({ label, selectable, priceText, soldOut });
  }
  return out;
};

const observeProduct = async (
  page: Page,
  spec: ProductSpec & { readonly handle: string },
): Promise<Observation> => {
  const started = Date.now();
  const status = await page
    .goto(`${baseURL}/products/${spec.handle}`, {
      timeout: config.thresholds.maxLoadMs + 5000,
      waitUntil: 'domcontentloaded',
    })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);
  const loadMs = Date.now() - started;

  const blank: Observation = {
    product: spec.title,
    handle: spec.handle,
    status,
    loadMs,
    titleText: undefined,
    priceText: undefined,
    descriptionText: undefined,
    specificationsText: undefined,
    imageCount: undefined,
    brokenImageCount: undefined,
    videoCount: undefined,
    soldOut: undefined,
    addToCartWorked: undefined,
    variants: undefined,
  };
  if (status !== 200) return blank;

  const images = await observeImages(page, selector('image'));
  const soldOut = (await page.locator(selector('sold_out')).count()) > 0;

  // Add-to-cart is exercised before variant selection, so it acts on the
  // default variant rather than whichever option the variant loop left chosen.
  let addToCartWorked: boolean | undefined;
  if (withCart && config.checks.includes('add_to_cart')) {
    const button = page.locator(selector('add_to_cart')).first();
    if ((await button.count()) === 0) addToCartWorked = undefined;
    else if (soldOut) addToCartWorked = false;
    else {
      try {
        const before = await cartLineCount(page);
        await button.click({ timeout: 8000 });
        await page.waitForTimeout(1200);
        addToCartWorked = (await cartLineCount(page)) > before;
      } catch {
        addToCartWorked = false;
      }
    }
  }

  return {
    ...blank,
    titleText: await textOf(page, selector('title')),
    priceText: await textOf(page, selector('price')),
    descriptionText: await textOf(page, selector('description')),
    specificationsText: await textOf(page, selector('specifications')),
    imageCount: images.count,
    brokenImageCount: images.broken,
    videoCount: await page.locator(selector('video')).count(),
    soldOut,
    addToCartWorked,
    variants: config.checks.includes('variations') ? await observeVariants(page) : undefined,
  };
};

// ── cart ─────────────────────────────────────────────────────────────────

const cartLineCount = async (page: Page): Promise<number> => {
  const current = page.url();
  await page.goto(`${baseURL}/cart`, { timeout: 20_000, waitUntil: 'domcontentloaded' });
  const count = await page.locator(selector('cart_line')).count();
  await page.goto(current, { timeout: 20_000, waitUntil: 'domcontentloaded' });
  return count;
};

const observeCart = async (page: Page): Promise<CartObservation> => {
  await page.goto(`${baseURL}/cart`, { timeout: 20_000, waitUntil: 'domcontentloaded' });

  const applied: string[] = [];
  for (const { code } of config.codes) {
    const input = page.locator(selector('discount_input')).first();
    if ((await input.count()) === 0) break;
    try {
      await input.fill(code, { timeout: 4000 });
      await page.locator(selector('discount_apply')).first().click({ timeout: 4000 });
      await page.waitForTimeout(1500);
      // Accepted means the cart says so somewhere, not that we typed it.
      if ((await page.getByText(code, { exact: false }).count()) > 0) applied.push(code);
    } catch {
      // Not applied; judgeCart reports the absence.
    }
  }

  const cents = async (name: string): Promise<number | undefined> =>
    toCents((await textOf(page, selector(name))) ?? '');

  return {
    subtotalCents: await cents('cart_subtotal'),
    discountCents: (await cents('cart_discount')) ?? 0,
    totalCents: await cents('cart_total'),
    appliedCodes: applied,
  };
};

// ── run ──────────────────────────────────────────────────────────────────

write('');
write(`Top-10 daily check — ${date}`);
write('');
write(`  target    ${baseURL}`);
write(`  products  ${String(config.products.length)} listed`);

const resolved = config.products.filter(
  (product): product is ProductSpec & { handle: string } => product.handle !== undefined,
);
write(`  resolved  ${String(resolved.length)} have a handle and will be checked`);
write(`  checks    ${config.checks.join(', ')}`);
write('');

const findings: Finding[] = [...auditConfig(config)];

const { browser, context } = await launchFromArgs(flags, bare, write, 'browser  ');
write('');
const page = await context.newPage();
const observations: Observation[] = [];
let reachedAny = false;

for (const spec of resolved) {
  const observation = await observeProduct(page, spec);
  observations.push(observation);
  if (observation.status === 200) reachedAny = true;
  findings.push(...judgeProduct(spec, config, observation));
  const mark = observation.status === 200 ? 'ok  ' : 'FAIL';
  write(`  ${mark} ${String(observation.status).padEnd(4)} ${spec.title}`);
}

let cart: CartObservation | undefined;
if (withCart && reachedAny && config.checks.includes('discount_stacking')) {
  cart = await observeCart(page);
  findings.push(...judgeCart(config, cart));
}
await browser.close();

// Run-level vacuity guard. If nothing loaded, every product "had no defects" —
// which is also what a total outage looks like. Per-product failures collapse
// into one harness line so a run that verified nothing cannot be read as a
// list of store defects.
if (resolved.length > 0 && !reachedAny) {
  const collapsed = findings.filter((f) => f.kind !== 'page_unreachable');
  findings.splice(0, findings.length, ...collapsed, {
    severity: 'harness',
    kind: 'page_unreachable',
    check: 'title',
    product: '(run)',
    detail:
      `not one of ${String(resolved.length)} product pages loaded from ${baseURL}, so ` +
      'nothing about the storefront was verified. Config findings above still stand.',
  });
}

// ── report ───────────────────────────────────────────────────────────────

const counts = tally(findings);
const actionable = clientFindings(findings);
mkdirSync(outDir, { recursive: true });

const bySeverity = (['critical', 'major', 'minor', 'harness'] as const).flatMap((severity) => {
  const list = findings.filter((f) => f.severity === severity);
  if (list.length === 0) return [];
  return [
    `## ${severity} — ${String(list.length)}`,
    '',
    ...list.map((f) => `- **${f.product}** (${f.check}) — ${f.detail}`),
    '',
  ];
});

writeFileSync(
  `${outDir}/report.md`,
  [
    `# Top-10 daily check — ${date}`,
    '',
    `- target: ${baseURL}`,
    `- listed: ${String(config.products.length)} products`,
    `- checked: ${String(resolved.length)} (the rest have no handle in ${configPath})`,
    `- checks: ${config.checks.join(', ')}`,
    '',
    '| severity | count |',
    '|---|---|',
    `| critical | ${String(counts.critical)} |`,
    `| major | ${String(counts.major)} |`,
    `| minor | ${String(counts.minor)} |`,
    `| harness (our own gaps, not store defects) | ${String(counts.harness)} |`,
    '',
    '## Products checked',
    '',
    '| product | HTTP | price | images | variants |',
    '|---|---|---|---|---|',
    ...observations.map(
      (o) =>
        `| ${o.product} | ${String(o.status)} | ${o.priceText?.trim() ?? '—'} | ` +
        `${o.imageCount === undefined ? '—' : String(o.imageCount)} | ` +
        `${o.variants === undefined ? '—' : String(o.variants.length)} |`,
    ),
    '',
    ...(cart === undefined
      ? []
      : [
          '## Cart',
          '',
          `- subtotal: ${cart.subtotalCents ?? 'not read'}c`,
          `- discounts: ${cart.discountCents ?? 'not read'}c`,
          `- total: ${cart.totalCents ?? 'not read'}c`,
          `- codes applied: ${cart.appliedCodes.join(', ') || 'none'}`,
          '',
        ]),
    ...(findings.length === 0 ? ['No findings.', ''] : bySeverity),
  ].join('\n'),
  'utf8',
);

writeFileSync(
  `${outDir}/report.json`,
  `${JSON.stringify({ date, target: baseURL, counts, observations, cart, findings }, null, 2)}\n`,
  'utf8',
);

// One line per run, so the trend is greppable without diffing reports.
appendFileSync(
  `${outDir}/history.jsonl`,
  `${JSON.stringify({ date, target: baseURL, checked: resolved.length, counts })}\n`,
  'utf8',
);

// ── allure ───────────────────────────────────────────────────────────────
// The matrix is every resolved product crossed with every check, so the report
// shows what passed as well as what failed. Checks the config switched off are
// skipped rather than passed: we did not verify them.
const allure = allureDir(flags, bare);
if (allure !== undefined) {
  writeAllureCases(
    {
      suite: 'Daily — top 10 selling products',
      description:
        'The ten best-selling products, checked every morning for stock, add-to-cart, ' +
        'pricing, copy, imagery, variants and cart discount arithmetic.',
      target: baseURL,
      resultsDir: allure,
    },
    buildMatrix({
      items: resolved.map((product) => product.title),
      checks: [...ALL_CHECKS],
      findings,
      itemOf: (finding) => finding.product,
      checkOf: (finding) => finding.check,
      severityOf: (finding) => finding.severity,
      detailOf: (finding) => `${finding.kind}: ${finding.detail}`,
      skipped: ALL_CHECKS.filter((check) => !config.checks.includes(check)),
    }),
  );
  writeEnvironment(allure, {
    Target: baseURL,
    'Ran — top 10 products': `${date} (${String(resolved.length)} products)`,
  });
  write(`  allure: ${allure}`);
}

write('');
write(
  `  critical ${String(counts.critical)} | major ${String(counts.major)} | ` +
    `minor ${String(counts.minor)} | harness ${String(counts.harness)}`,
);
write(`  report: ${outDir}/report.md`);

if (actionable.length > 0) {
  write('');
  write(`  daily check: FINDINGS — ${String(actionable.length)} to act on`);
  process.exit(1);
}
if (counts.harness > 0) {
  write('');
  write('  daily check: INCOMPLETE — no defects found, but not everything was checked');
  process.exit(2);
}
write('');
write('  daily check: CLEAN');
