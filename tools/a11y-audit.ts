import { mkdirSync, writeFileSync } from 'node:fs';

import { AxeBuilder } from '@axe-core/playwright';
import { type Page } from '@playwright/test';

import { launchFromArgs } from './lib/browser.js';
import {
  byMarket,
  compareAcrossLocales,
  judgePage,
  loadA11yConfig,
  tally,
  withinBudget,
  type A11yConfig,
  type AxeViolation,
  type Finding,
  type PageScan,
} from '../web/lib/a11y.js';

/**
 * Accessibility across every market.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:a11y
 *
 * WCAG scanning with axe on every route in every locale, plus the two
 * locale-specific rules axe cannot express: a page declaring the wrong
 * language, and image or control labels left in the source language.
 *
 * Options: --locales fr,de  --routes /  --locale-prefix '/{locale}'
 *          --out <dir>  plus the shared browser flags.
 *
 * Exit codes: 0 within budget, 1 over budget, 2 could not scan.
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
    'No site to scan. Pass --base-url or set KITSCH_BASE_URL.\n' +
      'Refusing to default to a fixture: an accessibility pass against a mock says\n' +
      'nothing about whether customers can use the store.\n',
  );
  process.exit(2);
}

const config: A11yConfig = loadA11yConfig(flags.get('config') ?? 'config/a11y.yaml');
const outDir = flags.get('out') ?? 'a11y-report';
const localePrefix = flags.get('locale-prefix') ?? '/{locale}';

const only = (name: string): readonly string[] | undefined => {
  const raw = flags.get(name);
  return raw === undefined ? undefined : raw.split(',').map((entry) => entry.trim());
};
const localeFilter = only('locales');
const routeFilter = only('routes');

const locales = config.locales.filter(
  (locale) => localeFilter === undefined || localeFilter.includes(locale.code),
);
const routes = config.routes.filter(
  (route) => routeFilter === undefined || routeFilter.includes(route.path),
);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

write('');
write('Accessibility across markets');
write('');
write(`  target    ${baseURL}`);
write(`  markets   ${locales.map((locale) => locale.market).join(', ')}`);
write(`  routes    ${String(routes.length)}`);
write(`  standard  ${config.wcagTags.join(', ')}`);
write(`  scans     ${String(locales.length * routes.length)}`);

const { browser, context } = await launchFromArgs(flags, bare, write, 'browser   ');
const page = await context.newPage();

/**
 * Reads the labelling the locale rules compare. Collected here rather than via
 * axe because axe reports rule failures, not content — an image with perfectly
 * valid alt text in the wrong language passes every rule it has.
 */
const readLabels = async (target: Page): Promise<{ alts: string[]; ariaLabels: string[] }> =>
  target.evaluate(() => ({
    alts: [...document.querySelectorAll('img[alt]')]
      .map((node) => (node.getAttribute('alt') ?? '').trim())
      .filter((alt) => alt !== ''),
    ariaLabels: [...document.querySelectorAll('[aria-label]')]
      .map((node) => (node.getAttribute('aria-label') ?? '').trim())
      .filter((label) => label !== ''),
  }));

const scanOne = async (
  locale: { code: string; market: string; isSource: boolean },
  route: { path: string; name: string },
): Promise<PageScan> => {
  const prefix = locale.isSource ? '' : localePrefix.replace('{locale}', locale.code);
  const url = `${baseURL}${prefix}${route.path}`;

  const status = await page
    .goto(url, { timeout: 40_000, waitUntil: 'domcontentloaded' })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);

  const blank: PageScan = {
    locale: locale.code,
    market: locale.market,
    route: route.path,
    routeName: route.name,
    status,
    violations: undefined,
    htmlLang: undefined,
    labels: undefined,
  };
  if (status !== 200) return blank;

  const htmlLang = (await page.locator('html').first().getAttribute('lang')) ?? undefined;
  const labels = await readLabels(page);

  // A failure to run axe stays undefined rather than becoming an empty array.
  // The distinction is the whole point: [] means "scanned, clean".
  let violations: readonly AxeViolation[] | undefined;
  try {
    const results = await new AxeBuilder({ page }).withTags([...config.wcagTags]).analyze();
    violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target.map((selector) => String(selector)),
        html: node.html,
      })),
    }));
  } catch {
    violations = undefined;
  }

  return { ...blank, violations, htmlLang, labels };
};

write('');
const scans: PageScan[] = [];
for (const route of routes) {
  for (const locale of locales) {
    const scan = await scanOne(locale, route);
    scans.push(scan);
    const count = scan.violations === undefined ? '—' : String(scan.violations.length);
    write(
      `  ${scan.status === 200 ? 'ok  ' : 'FAIL'} ${locale.market.padEnd(3)} ` +
        `${String(scan.status).padEnd(4)} ${count.padStart(3)} violation(s)  ${route.path}`,
    );
  }
}
await browser.close();

// Source-locale scans are the comparison basis for the label rules, keyed by
// route so each localized page is compared against the same page in English.
const sourceCode = config.locales.find((locale) => locale.isSource)?.code;
const sourceByRoute = new Map(
  scans.filter((scan) => scan.locale === sourceCode).map((scan) => [scan.route, scan]),
);

const findings: Finding[] = [];
for (const scan of scans) {
  findings.push(...judgePage(config, scan, sourceByRoute.get(scan.route)));
}
findings.push(...compareAcrossLocales(config, scans));

const reachedAny = scans.some((scan) => scan.status === 200);
if (scans.length > 0 && !reachedAny) {
  findings.splice(0, findings.length, {
    severity: 'harness',
    kind: 'not_scanned',
    rule: 'run',
    locale: '(run)',
    market: '(run)',
    route: '(run)',
    detail: `nothing loaded from ${baseURL}, so no market's accessibility was assessed`,
    evidence: baseURL,
  });
}

// ── report ───────────────────────────────────────────────────────────────

const counts = tally(findings);
const markets = byMarket(findings);
mkdirSync(outDir, { recursive: true });

const bySeverity = (['critical', 'major', 'minor', 'harness'] as const).flatMap((severity) => {
  const list = findings.filter((finding) => finding.severity === severity);
  if (list.length === 0) return [];
  return [
    `## ${severity} — ${String(list.length)}`,
    '',
    ...list.map(
      (finding) =>
        `- **${finding.market}** \`${finding.route}\` — \`${finding.rule}\` — ${finding.detail}` +
        (finding.evidence === '' ? '' : `\n  - \`${finding.evidence}\``),
    ),
    '',
  ];
});

writeFileSync(
  `${outDir}/report.md`,
  [
    '# Accessibility across markets',
    '',
    `- target: ${baseURL}`,
    `- standard: ${config.wcagTags.join(', ')}`,
    `- scanned: ${String(scans.filter((scan) => scan.status === 200).length)} of ${String(scans.length)} page(s)`,
    '',
    '| severity | count | budget |',
    '|---|---|---|',
    `| critical | ${String(counts.critical)} | ${String(config.maxCritical)} |`,
    `| major | ${String(counts.major)} | ${String(config.maxMajor)} |`,
    `| minor | ${String(counts.minor)} | ${String(config.maxMinor)} |`,
    `| harness (not scanned) | ${String(counts.harness)} | — |`,
    '',
    '## By market',
    '',
    '| market | findings |',
    '|---|---|',
    ...Object.entries(markets)
      .sort((a, b) => b[1] - a[1])
      .map(([market, count]) => `| ${market} | ${String(count)} |`),
    '',
    ...(findings.length === 0 ? ['No findings.', ''] : bySeverity),
  ].join('\n'),
  'utf8',
);

writeFileSync(
  `${outDir}/report.json`,
  `${JSON.stringify({ target: baseURL, counts, markets, findings, scans }, null, 2)}\n`,
  'utf8',
);

write('');
write(
  `  critical ${String(counts.critical)} | major ${String(counts.major)} | ` +
    `minor ${String(counts.minor)} | harness ${String(counts.harness)}`,
);
if (Object.keys(markets).length > 0) {
  write(
    `  by market: ${Object.entries(markets)
      .sort((a, b) => b[1] - a[1])
      .map(([market, count]) => `${market} ${String(count)}`)
      .join('  ')}`,
  );
}
write(`  report: ${outDir}/report.md`);

if (counts.harness > 0) {
  write('');
  write('  a11y: INCOMPLETE — some pages were not scanned, so their markets are unassessed');
  process.exit(2);
}
if (!withinBudget(config, counts)) {
  write('');
  write('  a11y: OVER BUDGET');
  process.exit(1);
}
write('');
write('  a11y: within budget');
