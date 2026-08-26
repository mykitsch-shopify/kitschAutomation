import { existsSync } from 'node:fs';

import { runInherit } from './lib/run.js';

/**
 * The whole daily run, against one target, into one Allure report.
 *
 *   npm run daily -- --base-url https://www.mykitsch.com
 *   npm run daily -- --base-url https://www.mykitsch.com --skip a11y
 *
 * Exists because chaining the audits with `&&` gets the failure semantics
 * exactly backwards. An audit exits 1 when it finds something, so `&&` stops
 * the run at the first real defect and never builds the report — the one
 * morning the report matters most is the morning it does not get made. Every
 * stage here runs regardless, and the worst exit code is carried to the end.
 *
 * Exit codes follow the repo's contract:
 *   0  every stage clean
 *   1  findings to act on
 *   2  at least one stage could not check — never a pass
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

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const baseURL = (flags.get('base-url') ?? process.env.KITSCH_BASE_URL ?? '').replace(/\/$/u, '');
if (baseURL === '') {
  write('');
  write('  No storefront to check. Pass --base-url or set KITSCH_BASE_URL.');
  write('  Refusing to default to a fixture: a green fixture run reported as a daily');
  write('  result about the live store is the failure this whole repo is built to avoid.');
  process.exit(2);
}

const resultsDir = flags.get('allure') ?? 'allure-results';
const date = flags.get('date') ?? new Date().toISOString().slice(0, 10);
const browser = flags.get('browser') ?? 'chromium';
const skip = new Set((flags.get('skip') ?? '').split(',').filter((name) => name !== ''));

type Stage = {
  readonly id: string;
  readonly label: string;
  readonly command: readonly string[];
  /** Inputs that must exist. A stage is skipped, loudly, when one is missing. */
  readonly needs: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

const STAGES: readonly Stage[] = [
  {
    id: 'ad-landing',
    label: 'Ad-traffic landing pages',
    command: [
      'tsx',
      'tools/ad-landing-audit.ts',
      '--base-url',
      baseURL,
      '--allure',
      resultsDir,
      '--date',
      date,
      '--browser',
      browser,
    ],
    needs: ['config/ad-landing.yaml'],
  },
  {
    id: 'top-products',
    label: 'Top 10 selling products',
    command: [
      'tsx',
      'tools/top-products-audit.ts',
      '--base-url',
      baseURL,
      '--allure',
      resultsDir,
      '--date',
      date,
      '--browser',
      browser,
    ],
    needs: ['config/top-products.yaml'],
  },
  {
    id: 'compare-at',
    label: 'Compare-at price removal',
    command: [
      'tsx',
      'tools/compare-at-audit.ts',
      '--import',
      'data/compare-at/removal-import.csv',
      '--rollback',
      'data/compare-at/rollback-values.csv',
      '--base-url',
      baseURL,
      '--allure',
      resultsDir,
      '--browser',
      browser,
    ],
    needs: ['data/compare-at/removal-import.csv', 'data/compare-at/rollback-values.csv'],
  },
  {
    id: 'translations',
    label: 'Translation backlog',
    command: [
      'tsx',
      'tools/translation-backlog-audit.ts',
      '--base-url',
      baseURL,
      '--tasks',
      'data/asana/translation-tasks.json',
      '--allure',
      resultsDir,
      '--browser',
      browser,
    ],
    needs: ['data/asana/translation-tasks.json'],
  },
  {
    id: 'a11y',
    label: 'Accessibility by market',
    command: [
      'tsx',
      'tools/a11y-audit.ts',
      '--base-url',
      baseURL,
      '--allure',
      resultsDir,
      '--browser',
      browser,
    ],
    needs: ['config/a11y.yaml'],
  },
  {
    id: 'render',
    label: 'Locale render specs',
    command: ['playwright', 'test', '--project=mobile-chrome'],
    needs: ['playwright.config.ts'],
    env: { KITSCH_ALLURE: resultsDir, KITSCH_BASE_URL: baseURL },
  },
];

write('');
write(`Kitsch daily run — ${date}`);
write('');
write(`  target   ${baseURL}`);
write(`  browser  ${browser}`);
write(`  results  ${resultsDir}`);
write('');

type Outcome = { readonly stage: Stage; readonly code: number | 'skipped' | 'missing' };
const outcomes: Outcome[] = [];

for (const stage of STAGES) {
  if (skip.has(stage.id)) {
    write(`  skip     ${stage.label} (--skip ${stage.id})`);
    outcomes.push({ stage, code: 'skipped' });
    continue;
  }
  const missing = stage.needs.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    // Not a pass and not a failure of the store: an input we do not have.
    // Named explicitly, because a stage that silently does not run is a hole
    // in the report that reads as coverage.
    write(`  MISSING  ${stage.label} — no ${missing.join(', ')}`);
    outcomes.push({ stage, code: 'missing' });
    continue;
  }

  write('');
  write(`  ── ${stage.label} ${'─'.repeat(Math.max(0, 56 - stage.label.length))}`);
  const run = runInherit('npx', stage.command, stage.env === undefined ? {} : { env: stage.env });
  if (run.notRun !== undefined) {
    // Scored 2 — could not check — not 1. The stage said nothing about the
    // store, and a "findings" reading here would be an invented result.
    write(`  COULD NOT RUN ${run.notRun}`);
    outcomes.push({ stage, code: 2 });
    continue;
  }
  outcomes.push({ stage, code: run.status });
}

// ── report ───────────────────────────────────────────────────────────────
write('');
write(`  ── Report ${'─'.repeat(48)}`);
const report = runInherit('npx', [
  'tsx',
  'tools/allure-report.ts',
  '--results',
  resultsDir,
  '--date',
  date,
]);

// ── summary ──────────────────────────────────────────────────────────────
write('');
write('  Stage summary');
write('');
const WORD: Readonly<Record<string, string>> = {
  '0': 'clean',
  '1': 'findings',
  '2': 'COULD NOT CHECK',
};
for (const outcome of outcomes) {
  const word =
    typeof outcome.code === 'string' ? outcome.code : (WORD[String(outcome.code)] ?? 'failed');
  write(`    ${word.padEnd(17)} ${outcome.stage.label}`);
}

const ran = outcomes.filter((outcome) => typeof outcome.code === 'number');
const notRun = outcomes.filter((outcome) => typeof outcome.code !== 'number');

// A stage that never ran leaves the run unable to speak for that area, so it
// carries the same weight as a stage that could not check.
const worst = ran.reduce<number>(
  (acc, outcome) => Math.max(acc, typeof outcome.code === 'number' ? outcome.code : 2),
  notRun.length > 0 ? 2 : 0,
);

write('');
if (report.notRun !== undefined) {
  write(`  The report could not be built: ${report.notRun}`);
  process.exit(2);
}
if (report.status !== 0) {
  write('  The report did not build. See above.');
  process.exit(2);
}
if (worst === 0) write('  All stages clean.');
else if (worst === 1) write('  Findings to act on — open the report.');
else write('  At least one area was not checked. This run is not a pass.');

process.exit(worst);
