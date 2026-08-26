import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import { parseProperties, readEnvironmentSidecar, serialiseProperties } from './lib/allure.js';
import { runInherit } from './lib/run.js';

/**
 * Assembles the Allure report from everything the suite produced.
 *
 *   npm run report
 *   npm run report -- --open
 *
 * The Playwright specs and the six audit CLIs all write into one results
 * directory; this reads what is there, labels it, and renders it.
 *
 * The report's title is derived from the target, not chosen. A report that
 * says "Kitsch QA — 2026-08-26" and is actually a run against a mock on
 * localhost is the single most expensive mistake this repo can make: it is
 * indistinguishable from evidence at a glance, it survives being pasted into a
 * deck, and by the time anyone checks, a decision has been taken on it. So a
 * fixture run is titled as one, in the report name, on the front page, and in
 * this tool's own output.
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

const resultsDir = flags.get('results') ?? 'allure-results';
const outDir = flags.get('out') ?? 'allure-report';
const date = flags.get('date') ?? new Date().toISOString().slice(0, 10);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

write('');
write('Allure report');
write('');

// ── 1. is there anything to report on? ───────────────────────────────────
// An empty report renders perfectly and says nothing, which is worse than an
// error: it looks like a clean run. Exit 2 — the "could not check" code — so a
// pipeline never reads this as a pass.
if (!existsSync(resultsDir)) {
  write(`  no results at ${resultsDir}.`);
  write('  Run a suite with --allure (audits) or KITSCH_ALLURE (Playwright) first.');
  write('  See docs/REPORTING.md.');
  process.exit(2);
}

const files = readdirSync(resultsDir);
const resultCount = files.filter((name) => name.endsWith('-result.json')).length;
if (resultCount === 0) {
  write(`  ${resultsDir} exists but holds no test results.`);
  write('  An empty Allure report is indistinguishable from a clean one. Refusing to build it.');
  process.exit(2);
}

// ── 2. what was this run pointed at? ─────────────────────────────────────
const envPath = `${resultsDir}/environment.properties`;

// Two sources, folded together. `allure-playwright` writes (and overwrites)
// environment.properties; the audits write the sidecar precisely because it
// does. Neither alone describes a full run.
const fromPlaywright = existsSync(envPath)
  ? parseProperties(readFileSync(envPath, 'utf8'))
  : new Map<string, string>();
const fromAudits = readEnvironmentSidecar(resultsDir);

const environment = new Map<string, string>(fromPlaywright);
for (const [key, value] of fromAudits) {
  const prior = environment.get(key);
  environment.set(
    key,
    prior === undefined || prior === value ? value : `${prior} + ${value} (MIXED)`,
  );
}

const target = environment.get('Target') ?? '(not recorded)';
const isFixture =
  target.includes('127.0.0.1') || target.includes('localhost') || target === '(not recorded)';
const isMixed = target.includes('(MIXED)');

/**
 * A run that mixed a fixture and a live store cannot be summarised in one
 * headline, and picking either one would be a false statement about half the
 * results. Stop rather than publish it.
 */
if (isMixed) {
  write(`  Target reads "${target}".`);
  write('');
  write('  This results directory holds a fixture run and a live run together. A single');
  write('  report cannot honestly describe both. Delete the directory and re-run one of');
  write('  them:  rm -rf allure-results');
  process.exit(2);
}

const title = isFixture
  ? `Kitsch QA — SELF-TEST against a local fixture, NOT the live store — ${date}`
  : `Kitsch QA — ${target.replace(/^https?:\/\//u, '')} — ${date}`;

// ── 3. label the run ─────────────────────────────────────────────────────
mkdirSync(resultsDir, { recursive: true });

writeFileSync(
  `${resultsDir}/executor.json`,
  `${JSON.stringify(
    {
      name: 'Kitsch QA automation',
      type: process.env.CI === undefined || process.env.CI === '' ? 'local' : 'github',
      buildName: title,
      reportName: title,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// Re-stated in the environment block so the caveat survives the report being
// screenshotted without its title bar.
const verdict = isFixture
  ? 'SELF-TEST — proves the suite works. NOT evidence about mykitsch.com.'
  : 'LIVE — these results describe the real storefront.';
writeFileSync(
  envPath,
  serialiseProperties(
    new Map([...environment, ['What this run is', verdict], ['Report built', date]]),
  ),
  'utf8',
);

write(`  results   ${String(resultCount)} test case(s) in ${resultsDir}`);
write(`  target    ${target}`);
write(`  reading   ${verdict}`);
write('');

// ── 4. render ────────────────────────────────────────────────────────────
const args = [
  'allure',
  'generate',
  resultsDir,
  '--output',
  outDir,
  '--name',
  title,
  ...(bare.has('open') ? ['--open'] : []),
];

const generated = runInherit('npx', args);

if (generated.notRun !== undefined) {
  write('');
  write(`  allure generate could not be started: ${generated.notRun}`);
  process.exit(2);
}

if (generated.status !== 0) {
  write('');
  write(`  allure generate failed (exit ${String(generated.status)}).`);
  process.exit(2);
}

write('');
write(`  report:  ${outDir}/index.html`);
write(`  open it: npx allure open ${outDir}`);
if (isFixture) {
  write('');
  write('  Reminder: this report is a self-test. Before quoting a number from it,');
  write('  check the target line on its front page.');
}
