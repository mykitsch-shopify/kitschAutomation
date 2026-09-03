import { mkdirSync, writeFileSync } from 'node:fs';

import { createFixtureTranslationCollector } from '../collectors/fixture-translations.js';
import { loadI18nConfig, targetLocales } from './lib/config.js';
import { auditSource, compareCatalog, evaluateGate, summarize } from './lib/locale-parity.js';
import type { Finding, ParitySummary, TranslationEntry } from './lib/locale-parity.js';

/**
 * Content-layer locale parity run — the manual translation pass, mechanised.
 *
 *   npm run i18n:parity                        # every target locale
 *   npm run i18n:parity -- --locale de         # one locale
 *   npm run i18n:parity -- --gate              # non-zero exit on gate failure
 *   npm run i18n:parity -- --catalog f.json    # offline catalogue
 *
 * Reads only: the Shopify collector issues Admin GraphQL `translatableResources`
 * queries and Storefront `@inContext` queries, both read-only, both paginated.
 */

export type TranslationCollector = {
  readonly fetchCatalog: (
    locale: string,
    resourceTypes: readonly string[],
  ) => Promise<readonly TranslationEntry[]>;
};

type Args = {
  readonly locale: string | undefined;
  readonly gate: boolean;
  readonly outDir: string;
  readonly catalog: string | undefined;
};

const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const parseArgs = (argv: readonly string[]): Args => ({
  locale: flagValue(argv, '--locale'),
  gate: argv.includes('--gate'),
  outDir: flagValue(argv, '--out') ?? 'i18n-report',
  catalog: flagValue(argv, '--catalog') ?? process.env.KITSCH_CATALOG,
});

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Raised when the run has no source to read and refuses to invent one. */
class NoTranslationSourceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NoTranslationSourceError';
  }
}

/**
 * The source is chosen explicitly, never guessed.
 *
 *   --catalog <file>  → that catalogue snapshot
 *   credentials set   → the live store
 *   neither           → refuse
 *
 * The refusal is the point. Falling back to fixture data when a real store
 * was asked about would print "gate: PASS" over a catalogue nobody checked —
 * the same false all-clear that makes the collector distinguish "fetch
 * failed" from "value absent". Failing to reach the store is not the same as
 * the store being clean, and neither is failing to be told which store.
 */
const resolveCollector = async (catalog: string | undefined): Promise<{
  readonly collector: TranslationCollector;
  readonly label: string;
}> => {
  if (catalog !== undefined) {
    return { collector: createFixtureTranslationCollector(catalog), label: `fixture:${catalog}` };
  }

  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (domain === undefined || domain === '' || token === undefined || token === '') {
    throw new NoTranslationSourceError(
      'No translation source given.\n' +
        '  • against a catalogue snapshot: --catalog fixtures/catalog/catalog-clean.json\n' +
        '  • against a real store:         set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN\n' +
        'This does not quietly fall back to fixture data — a green run over a catalogue ' +
        'nobody asked about is worse than no run.',
    );
  }

  const { createShopifyTranslationCollector } = await import('../collectors/shopify-translations.js');
  return { collector: createShopifyTranslationCollector(), label: `shopify:${domain}` };
};

const groupCount = (findings: readonly Finding[], pick: (finding: Finding) => string): string => {
  const counts = new Map<string, number>();
  for (const item of findings) {
    counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `${name}=${String(count)}`)
    .join(' ');
};

const markdownReport = (
  findings: readonly Finding[],
  summary: ParitySummary,
  verdict: { readonly passed: boolean; readonly reasons: readonly string[] },
  label: string,
): string => {
  const lines: string[] = [
    '# Locale parity — content layer',
    '',
    `- Source: \`${label}\``,
    `- Keys compared: ${String(summary.comparedKeys)}`,
    `- Verdict: **${verdict.passed ? 'PASS' : 'FAIL'}**${verdict.passed ? '' : ` — ${verdict.reasons.join('; ')}`}`,
    `- critical ${String(summary.critical)} · major ${String(summary.major)} · minor ${String(summary.minor)} · harness ${String(summary.harness)}`,
    '',
  ];

  const locales = [...new Set(findings.map((item) => item.locale))].sort();
  for (const locale of locales) {
    const forLocale = findings.filter((item) => item.locale === locale);
    lines.push(`## ${locale} — ${String(forLocale.length)} finding(s)`, '');
    lines.push('| severity | kind | key | English | target |');
    lines.push('|---|---|---|---|---|');
    for (const item of forLocale) {
      const cell = (value: string | undefined): string =>
        value === undefined ? '—' : `\`${value.replace(/\|/gu, '\\|').slice(0, 60)}\``;
      lines.push(
        `| ${item.severity} | ${item.kind} | \`${item.key}\` | ${cell(item.sourceValue)} | ${cell(item.targetValue)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));
  const config = loadI18nConfig();

  const requested =
    args.locale === undefined
      ? targetLocales(config)
      : targetLocales(config).filter((locale) => locale.code === args.locale);

  if (requested.length === 0) {
    write(`No target locale matched "${args.locale ?? ''}". Check config/i18n.yaml.`);
    return 2;
  }

  const { collector, label } = await resolveCollector(args.catalog);
  write(`source: ${label}`);
  write(`locales: ${requested.map((locale) => locale.code).join(' ')}`);
  write('');

  const source = await collector.fetchCatalog(config.sourceLocale, config.resources);

  // Test plan §4 — the English baseline is checked in its own right, not
  // assumed correct because it is the reference.
  const findings: Finding[] = [...auditSource(source, config)];
  write(`${config.sourceLocale} (baseline): ${String(source.length)} keys, ${String(findings.length)} finding(s)`);

  for (const locale of requested) {
    const target = await collector.fetchCatalog(locale.code, config.resources);
    const localeFindings = compareCatalog(source, target, config);
    findings.push(...localeFindings);
    write(
      `${locale.code}: ${String(target.length)} keys compared, ${String(localeFindings.length)} finding(s)` +
        (localeFindings.length > 0 ? `  [${groupCount(localeFindings, (item) => item.kind)}]` : ''),
    );
  }

  const summary = summarize(findings, source.length * requested.length);
  const verdict = evaluateGate(summary, config);

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(
    `${args.outDir}/parity.json`,
    JSON.stringify({ summary, verdict, findings }, null, 2),
    'utf8',
  );
  writeFileSync(
    `${args.outDir}/parity.md`,
    markdownReport(findings, summary, verdict, label),
    'utf8',
  );

  write('');
  write(
    `critical ${String(summary.critical)} | major ${String(summary.major)} | minor ${String(summary.minor)} | harness ${String(summary.harness)}`,
  );
  write(`report: ${args.outDir}/parity.json, ${args.outDir}/parity.md`);

  if (!verdict.passed) {
    // Loud, with the reason attached — an alert that says "translation
    // problem, please investigate" has not met the escalation SLA.
    console.error(`Locale parity gate failed: ${verdict.reasons.join('; ')}`);
    return args.gate ? 1 : 0;
  }

  write('gate: PASS');
  return 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof NoTranslationSourceError) {
    // A usage error, not a crash. A stack trace here just buries the fix.
    console.error(error.message);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
