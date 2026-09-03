import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { type Page } from '@playwright/test';

import { allureDir, buildMatrix, writeAllureCases, writeEnvironment } from './lib/allure.js';
import { launchFromArgs } from './lib/browser.js';
import {
  auditSheets,
  buildExpectations,
  clientFindings,
  judge,
  readImportCsv,
  readRollbackCsv,
  tally,
  type Expectation,
  type Finding,
  type Observation,
} from '../web/lib/compare-at.js';
import { loadKitConfig } from '../web/lib/kit-parity.js';

/**
 * Compare-at removal audit.
 *
 * Validates a Shopify compare-at clearing import against the live storefront:
 * the struck-through price must be gone, and the real price must be unchanged.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:compare-at -- \
 *     --import data/compare-at/removal-import.csv \
 *     --rollback data/compare-at/rollback-values.csv
 *
 * Exit codes: 0 clean, 1 findings to act on, 2 could not run.
 */

const USAGE = `
Usage:
  npm run audit:compare-at -- --import <csv> --rollback <csv> [options]

Required:
  --import <path>      Shopify import sheet (Handle, Variant Price, Variant Compare At Price)
  --rollback <path>    recorded pre-change values (handle, status, live_price, live_compare_at)

Options:
  --base-url <url>     storefront to check; defaults to $KITSCH_BASE_URL
  --sheets-only        run the sheet audit and skip the browser entirely
  --only-visible       check only products whose strikethrough was actually visible
  --limit <n>          check at most n products (a smoke run)
  --concurrency <n>    parallel page loads, default 4
  --out <dir>          report directory, default compare-at-report
  --browser <name>     chromium (default), firefox, webkit, chrome, edge
  --headed             show the browser; default is headless
  --slow-mo <ms>       slow each action down, for watching a flow
  --viewport <WxH>     desktop viewport, default 1440x900
`;

type Args = {
  readonly importPath: string;
  readonly rollbackPath: string;
  readonly baseURL: string;
  readonly sheetsOnly: boolean;
  readonly onlyVisible: boolean;
  readonly limit: number | undefined;
  readonly concurrency: number;
  readonly out: string;
  /** Kept so the browser launcher can read --browser / --headed from the same parse. */
  readonly flags: ReadonlyMap<string, string>;
  readonly bare: ReadonlySet<string>;
};

const die = (message: string): never => {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(2);
};

const parseArgs = (argv: readonly string[]): Args => {
  const flags = new Map<string, string>();
  const bare = new Set<string>();
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

  const importPath = flags.get('import');
  const rollbackPath = flags.get('rollback');
  if (importPath === undefined) die('Missing --import <csv>.');
  if (rollbackPath === undefined) die('Missing --rollback <csv>.');

  const sheetsOnly = bare.has('sheets-only');
  const baseURL = flags.get('base-url') ?? process.env.KITSCH_BASE_URL ?? '';
  if (!sheetsOnly && baseURL === '') {
    die(
      'No storefront to check. Pass --base-url or set KITSCH_BASE_URL.\n' +
        'Refusing to default to a fixture: a green run against a mock says nothing\n' +
        'about the store. Use --sheets-only to audit the CSVs with no browser.',
    );
  }

  const number = (name: string): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) die(`--${name} must be a positive integer.`);
    return value;
  };

  return {
    importPath: importPath as string,
    rollbackPath: rollbackPath as string,
    baseURL: baseURL.replace(/\/$/u, ''),
    sheetsOnly,
    onlyVisible: bare.has('only-visible'),
    limit: number('limit'),
    concurrency: number('concurrency') ?? 4,
    out: flags.get('out') ?? 'compare-at-report',
    flags,
    bare,
  };
};

// ── observing one product ────────────────────────────────────────────────

/**
 * Reads the first match for each selector. `textOf` returns undefined when
 * nothing matched, which is what keeps an unmapped theme from reading as a
 * clean pass — judge() turns that into a harness finding rather than silence.
 */
const observe = async (
  page: Page,
  baseURL: string,
  handle: string,
  selectors: { readonly price: string; readonly compareAt: string },
): Promise<Observation> => {
  const url = `${baseURL}/products/${handle}`;
  // Status 0 means "no response at all" — a DNS, TLS or connection failure —
  // which judge() treats the same as a 404 for a published product.
  const status = await page
    .goto(url, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);
  if (status !== 200) return { handle, status, priceText: undefined, compareAtText: undefined };

  const textOf = async (selector: string): Promise<string | undefined> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return undefined;
    return (await locator.textContent()) ?? undefined;
  };

  return {
    handle,
    status,
    priceText: await textOf(selectors.price),
    compareAtText: await textOf(selectors.compareAt),
  };
};

/**
 * Fixed-size worker pool, one dedicated resource per worker. Keeps the request
 * rate to something a real store would not notice.
 *
 * The resource is passed in per worker rather than looked up by item index.
 * Indexing a page array by item index looks equivalent and is not: workers do
 * not consume items in stride, so two of them land on the same Page, their
 * navigations interleave, and a price gets read off whichever product loaded
 * last. That produced mismatches on innocent products and hid every planted
 * defect — silently, because each read still returned a plausible price.
 */
const runPool = async <T, R>(
  items: readonly T[],
  resources: readonly R[],
  worker: (item: T, resource: R) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const take = async (resource: R): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, resource);
    }
  };
  await Promise.all(resources.map(take));
};

// ── reporting ────────────────────────────────────────────────────────────

const KIND_TITLES: Readonly<Record<string, string>> = {
  compare_at_still_rendered: 'Struck-through price still shown',
  price_mismatch: 'Live price does not match the sheet',
  rollback_record_missing: 'No recorded value to revert to',
  product_unreachable: 'Published product did not load',
  sheet_disagreement: 'The two sheets disagree',
  import_carries_compare_at: 'Import does not actually clear compare-at',
  duplicate_handle: 'Handle appears twice',
  missing_sku: 'Import row has no SKU',
  price_not_observed: 'Price could not be read (harness)',
};

const writeReport = (
  args: Args,
  findings: readonly Finding[],
  stats: Readonly<Record<string, number>>,
): void => {
  mkdirSync(args.out, { recursive: true });

  const counts = tally(findings);
  const byKind = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byKind.get(finding.kind) ?? [];
    list.push(finding);
    byKind.set(finding.kind, list);
  }

  const lines: string[] = [
    '# Compare-at removal audit',
    '',
    `- target: ${args.sheetsOnly ? 'sheets only, no storefront checked' : args.baseURL}`,
    `- import: \`${args.importPath}\``,
    `- rollback: \`${args.rollbackPath}\``,
    '',
    '| | |',
    '|---|---|',
    ...Object.entries(stats).map(([key, value]) => `| ${key} | ${String(value)} |`),
    `| critical / major / minor / harness | ${counts.critical} / ${counts.major} / ${counts.minor} / ${counts.harness} |`,
    '',
  ];

  if (findings.length === 0) {
    lines.push('No findings.', '');
  } else {
    const order: readonly string[] = ['critical', 'major', 'minor', 'harness'];
    const sorted = [...byKind.entries()].sort(
      (a, b) =>
        order.indexOf(a[1][0]?.severity ?? 'minor') - order.indexOf(b[1][0]?.severity ?? 'minor'),
    );
    for (const [kind, list] of sorted) {
      const severity = list[0]?.severity ?? 'minor';
      lines.push(`## ${severity}: ${KIND_TITLES[kind] ?? kind} — ${String(list.length)}`, '');
      for (const finding of list.slice(0, 40)) {
        lines.push(`- \`${finding.handle}\` — ${finding.detail}`);
      }
      if (list.length > 40) lines.push(`- …and ${String(list.length - 40)} more (see report.json)`);
      lines.push('');
    }
  }

  writeFileSync(`${args.out}/report.md`, lines.join('\n'), 'utf8');
  writeFileSync(
    `${args.out}/report.json`,
    `${JSON.stringify({ target: args.baseURL, stats, counts, findings }, null, 2)}\n`,
    'utf8',
  );
};

// ── main ─────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const imports = readImportCsv(readFileSync(args.importPath, 'utf8'), args.importPath);
const rollbacks = readRollbackCsv(readFileSync(args.rollbackPath, 'utf8'), args.rollbackPath);

if (imports.length === 0) {
  // An empty sheet would sail through every check below and report success.
  process.stderr.write(`${args.importPath}: no data rows. Refusing to report a vacuous pass.\n`);
  process.exit(2);
}

const findings: Finding[] = [...auditSheets(imports, rollbacks)];
const allExpectations = buildExpectations(imports, rollbacks);
const visible = allExpectations.filter((entry) => entry.visiblyChanged);

write('');
write('Compare-at removal audit');
write('');
write(`  import sheet          ${String(imports.length)} rows`);
write(`  rollback sheet        ${String(rollbacks.length)} rows`);
write(`  published (checkable) ${String(allExpectations.filter((e) => e.published).length)}`);
write(`  drafts (not public)   ${String(allExpectations.filter((e) => !e.published).length)}`);
write(`  visible strikethrough ${String(visible.length)}  <- only these can confirm the removal`);
write('');

let selected: readonly Expectation[] = args.onlyVisible ? visible : allExpectations;
// Drafts are not on the storefront, so loading them only produces 404s that
// judge() then discards. Skipping them saves the requests.
selected = selected.filter((entry) => entry.published);
if (args.limit !== undefined) selected = selected.slice(0, args.limit);

const stats: Record<string, number> = {
  'import rows': imports.length,
  'rollback rows': rollbacks.length,
  'visible strikethrough before': visible.length,
  'products checked': 0,
};

if (args.sheetsOnly) {
  write('  --sheets-only: no storefront was checked.');
} else {
  const { browser, context } = await launchFromArgs(args.flags, args.bare, write, 'browser       ');

  const selectors = (() => {
    const config = loadKitConfig();
    return { price: config.selectors.pdp_price, compareAt: config.selectors.pdp_compare_at };
  })();

  write(`  checking ${String(selected.length)} product page(s) against ${args.baseURL}`);
  write(`  price      ${selectors.price}`);
  write(`  compare-at ${selectors.compareAt}`);
  write('');

  const pages = await Promise.all(
    Array.from({ length: Math.min(args.concurrency, Math.max(selected.length, 1)) }, async () =>
      context.newPage(),
    ),
  );
  let done = 0;
  let reachedAny = false;

  await runPool(selected, pages, async (expectation, page) => {
    const observation = await observe(page, args.baseURL, expectation.handle, selectors);
    if (observation.status === 200) reachedAny = true;
    findings.push(...judge(expectation, observation));
    done += 1;
    if (done % 25 === 0 || done === selected.length) {
      write(`    ${String(done)}/${String(selected.length)}`);
    }
  });

  await browser.close();
  stats['products checked'] = done;

  // Vacuity guard at the run level. If not one page loaded, every product
  // "had no strikethrough" — which is also what a total outage looks like.
  //
  // The per-product unreachable findings are dropped here rather than kept
  // alongside. One dead network is one problem; leaving them in reported it
  // once per product as a major finding against the store, so a run that
  // verified nothing announced "10 findings to act on" and pointed the reader
  // at products that are probably fine. Collapsing to a single harness
  // finding says what actually happened: we could not look.
  if (selected.length > 0 && !reachedAny) {
    const perProduct = findings.filter(
      (finding) => finding.kind === 'product_unreachable' && finding.handle !== '(run)',
    ).length;
    findings.splice(
      0,
      findings.length,
      ...findings.filter((finding) => finding.kind !== 'product_unreachable'),
      {
        severity: 'harness',
        kind: 'product_unreachable',
        handle: '(run)',
        detail:
          `not one of ${String(selected.length)} pages loaded from ${args.baseURL}, so ` +
          'nothing about the storefront was verified. The sheet findings above still ' +
          `stand; the ${String(perProduct)} per-product failures were folded into this ` +
          'one line because they share a single cause. Check the URL and the network.',
      },
    );
  }
}

writeReport(args, findings, stats);

// ── allure ───────────────────────────────────────────────────────────────
// Two checks per product page, plus the sheet-level findings as their own
// group. A sheet disagreement is not a defect on any one product page and
// filing it against one would point the fix at the wrong place.
const allureOut = allureDir(args.flags, args.bare);
if (allureOut !== undefined) {
  const STORE_CHECK: Partial<Record<string, string>> = {
    compare_at_still_rendered: 'struck-through price removed',
    price_mismatch: 'selling price matches the sheet',
    price_not_observed: 'struck-through price removed',
    product_unreachable: 'struck-through price removed',
  };
  const storeKinds = new Set(Object.keys(STORE_CHECK));

  writeAllureCases(
    {
      suite: 'Compare-at price removal',
      description:
        'Checks that the struck-through prices the import was meant to clear are actually ' +
        'gone from the live page, and that the selling price was left alone.',
      target: args.sheetsOnly ? '(sheets only — no storefront checked)' : args.baseURL,
      resultsDir: allureOut,
    },
    [
      ...buildMatrix({
        items: selected.map((entry) => entry.handle),
        checks: ['struck-through price removed', 'selling price matches the sheet'],
        findings: findings.filter((finding) => storeKinds.has(finding.kind)),
        itemOf: (finding) => finding.handle,
        checkOf: (finding) => STORE_CHECK[finding.kind] ?? finding.kind,
        severityOf: (finding) => finding.severity,
        detailOf: (finding) => `${finding.kind}: ${finding.detail}`,
      }),
      // Sheet findings carry no product page, so they are emitted directly
      // rather than through a matrix: there is no "all clear" case to pair
      // them with.
      ...findings
        .filter((finding) => !storeKinds.has(finding.kind))
        .map((finding) => ({
          name: finding.kind,
          item: 'import + rollback sheets',
          status: finding.severity === 'harness' ? ('broken' as const) : ('failed' as const),
          severity: finding.severity,
          detail: `${finding.handle}: ${finding.detail}`,
        })),
    ],
  );
  writeEnvironment(allureOut, {
    ...(args.sheetsOnly ? {} : { Target: args.baseURL }),
    'Ran — compare-at': `${String(selected.length)} product pages`,
  });
  write(`  allure: ${allureOut}`);
}

const counts = tally(findings);
const actionable = clientFindings(findings);

write('');
write(
  `  critical ${String(counts.critical)} | major ${String(counts.major)} | ` +
    `minor ${String(counts.minor)} | harness ${String(counts.harness)}`,
);
write(`  report: ${args.out}/report.md, ${args.out}/report.json`);

if (counts.harness > 0) {
  write('');
  write('  Some checks could not be performed (harness). Those are our failures,');
  write('  not the store\'s, and are excluded from the findings routed to the business.');
}

if (actionable.length > 0) {
  write('');
  write(`  audit: FINDINGS — ${String(actionable.length)} to act on`);
  process.exit(1);
}
if (counts.harness > 0) {
  write('');
  write('  audit: INCOMPLETE — no defects found, but not everything was checked');
  process.exit(2);
}
write('');
write('  audit: CLEAN');
