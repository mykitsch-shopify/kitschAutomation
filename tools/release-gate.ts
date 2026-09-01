import { mkdirSync, writeFileSync } from 'node:fs';

import { runSync } from './lib/run.js';

/**
 * Release gate — the regression suite a launch is signed off against.
 *
 * One command, one answer: is it safe to ship? The team's stated need is to
 * rely on the automation for launches and releases, and that needs a single
 * decision rather than nine reports somebody has to reconcile under time
 * pressure.
 *
 *   npm run gate:release                                   # offline only
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run gate:release -- --live
 *
 * Two tiers, and the distinction is the point:
 *
 *   offline  proves the harness itself is sound — types, lint, review, units,
 *            and every detection control. Needs no network and no store.
 *   live     asks the storefront the questions the business cares about.
 *
 * The offline tier runs first and a failure there stops the run. A live result
 * from a harness that is not itself green is not evidence; it is a number of
 * unknown provenance, and under launch pressure it will be read as a pass.
 */

type Stage = {
  readonly name: string;
  readonly script: string;
  readonly args?: readonly string[];
  readonly tier: 'offline' | 'live';
  /** What shipping without this check would risk. */
  readonly risk: string;
  /**
   * Exit 2 means "could not check". For live stages that is normal when a
   * target or credential is missing, and must not read as a pass — it is
   * reported as INCOMPLETE and fails the gate, but it is not a store defect.
   */
  readonly blocking: boolean;
};

const STAGES: readonly Stage[] = [
  {
    name: 'typescript',
    script: 'typecheck',
    tier: 'offline',
    risk: 'a type error is a runtime failure in the middle of a launch check',
    blocking: true,
  },
  {
    name: 'eslint + kitsch rules',
    script: 'lint',
    tier: 'offline',
    risk: 'the rules that stop a spec targeting production or writing to a store',
    blocking: true,
  },
  {
    name: 'reviewer + bugbot',
    script: 'review',
    args: ['--gate'],
    tier: 'offline',
    risk: 'findings would ship untriaged and unrouted',
    blocking: true,
  },
  {
    name: 'unit tests',
    script: 'test:unit',
    tier: 'offline',
    risk: 'every comparator in the suite is unverified',
    blocking: true,
  },
  {
    name: 'locale parity (content)',
    script: 'parity:clean',
    tier: 'offline',
    risk: 'the translation engine reports false positives on a clean catalogue',
    blocking: true,
  },
  {
    name: 'locale parity (render)',
    script: 'test:i18n',
    tier: 'offline',
    risk: '350 locale render checks unproven',
    blocking: true,
  },
  {
    name: 'welcome-kit parity',
    script: 'test:kits',
    tier: 'offline',
    risk: 'free-item handling across seasonal kits unproven',
    blocking: true,
  },
  {
    name: 'visual regression',
    script: 'visual',
    tier: 'offline',
    risk: 'a layout break that no DOM assertion can see would ship unnoticed',
    blocking: true,
  },
  // The controls. A suite that cannot fail is not evidence, so these decide
  // whether any green above means anything at all.
  {
    name: 'control: visual regression',
    script: 'visual:detection',
    tier: 'offline',
    risk: 'a screenshot suite that cannot fail would report a green picture of a broken page',
    blocking: true,
  },
  {
    name: 'control: welcome-kit parity',
    script: 'test:kits-detection',
    tier: 'offline',
    risk: 'the parity comparison could report every seasonal kit as matching whatever it does',
    blocking: true,
  },
  {
    name: 'control: locale detection',
    script: 'test:detection',
    tier: 'offline',
    risk: '19 planted defects would go uncaught and every locale would read as clean',
    blocking: true,
  },
  {
    name: 'control: compare-at',
    script: 'test:compare-at-detection',
    tier: 'offline',
    risk: 'a leftover strikethrough would report as a clean price',
    blocking: true,
  },
  {
    name: 'control: top products',
    script: 'test:top-products-detection',
    tier: 'offline',
    risk: 'a sold-out top seller would report as available',
    blocking: true,
  },
  {
    name: 'control: ad landing',
    script: 'test:ad-landing-detection',
    tier: 'offline',
    risk: 'stacked discounts and broken BYOB flows would report as healthy',
    blocking: true,
  },
  {
    name: 'control: translation backlog',
    script: 'test:translation-backlog-detection',
    tier: 'offline',
    risk: 'a task would be reported closeable on translation work never done',
    blocking: true,
  },
  {
    name: 'control: health-check',
    script: 'test:health-check-detection',
    tier: 'offline',
    risk: 'an issue from a QA report would be reported as fixed without being re-checked',
    blocking: true,
  },
  {
    name: 'control: accessibility',
    script: 'test:a11y-detection',
    tier: 'offline',
    risk: 'every market would report as accessible in markets where the law says otherwise',
    blocking: true,
  },

  // ── live ──
  {
    name: 'preflight',
    script: 'preflight',
    tier: 'live',
    risk: 'selectors may not match the theme, making every result below meaningless',
    blocking: true,
  },
  {
    name: 'ad-landing QA',
    script: 'audit:ad-landing',
    tier: 'live',
    risk: 'paid traffic lands on broken pages',
    blocking: true,
  },
  {
    name: 'top-10 sellers',
    script: 'audit:top-products',
    tier: 'live',
    risk: 'a best seller cannot be bought',
    blocking: true,
  },
  {
    name: 'accessibility across markets',
    script: 'audit:a11y',
    tier: 'live',
    risk: 'a market becomes unusable for customers relying on assistive technology',
    blocking: true,
  },
];

const live = process.argv.includes('--live');
const outDir = 'release-gate-report';
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

if (live && (process.env.KITSCH_BASE_URL ?? '') === '') {
  process.stderr.write(
    '--live needs KITSCH_BASE_URL. Refusing to run the live tier against nothing:\n' +
      'an empty target produces a green gate that examined no storefront.\n',
  );
  process.exit(2);
}

const stages = STAGES.filter((stage) => stage.tier === 'offline' || live);

/**
 * The offline tier is pinned to the fixture rather than left to inherit
 * KITSCH_BASE_URL.
 *
 * Observed, not theorised: a `npm run gate:release` in a shell that still had
 * KITSCH_BASE_URL exported from an earlier live run announced "Live checks
 * skipped. This proves the harness is sound; it says nothing about the
 * storefront", then spent an hour interrogating production and reported what
 * it found there as a harness defect, under the heading "350 locale render
 * checks unproven". Every word of that was wrong: the checks ran, they ran
 * against the store, and the store is exactly what the tier promised not to
 * touch.
 *
 * The two tiers exist to keep "is the harness sound?" apart from "is the store
 * sound?". A tier that answers the second question while labelled the first is
 * worse than no tier. So the target is stated here rather than inherited —
 * `--live` still gets the real one, because those stages are meant to have it.
 */
const offlineTarget = `http://127.0.0.1:${process.env.KITSCH_FIXTURE_PORT ?? '4173'}`;
const ambientTarget = process.env.KITSCH_BASE_URL;

write('');
write(`Release gate — ${live ? 'offline + live' : 'offline only'}`);
write('');
if (!live) {
  write('  Live checks skipped. This proves the harness is sound; it says nothing');
  write('  about the storefront. Pass --live with KITSCH_BASE_URL for that.');
  write('');
}
write(`  offline stages run against ${offlineTarget} (the fixture), always.`);
if (ambientTarget !== undefined && ambientTarget !== offlineTarget) {
  write(`  KITSCH_BASE_URL is set to ${ambientTarget}; the offline tier ignores it.`);
  write(`  ${live ? 'The live tier uses it.' : 'Nothing below touches that store.'}`);
}
write('');

type Result = {
  readonly stage: Stage;
  readonly status: 'pass' | 'fail' | 'incomplete';
  readonly code: number;
  readonly output: string;
};

const results: Result[] = [];
const started = Date.now();
let stopped = false;

for (const stage of stages) {
  if (stopped) break;
  process.stdout.write(`  ${stage.tier.padEnd(7)} ${stage.name.padEnd(30)} ... `);
  const run = runSync(
    'npm',
    ['run', '--silent', stage.script, ...(stage.args ? ['--', ...stage.args] : [])],
    // Stages that manage their own fixtures pass an explicit --base-url or set
    // their own KITSCH_BASE_URL, and those still win: this only replaces what
    // a stage would otherwise inherit from the shell.
    stage.tier === 'offline' ? { env: { KITSCH_BASE_URL: offlineTarget } } : {},
  );
  // A stage that never started is "could not check", the same as exit 2. It is
  // emphatically not a defect: calling it one would blame the store for a
  // missing launcher.
  const code = run.notRun === undefined ? run.status : 2;
  const status = code === 0 ? 'pass' : code === 2 ? 'incomplete' : 'fail';
  write(status === 'pass' ? 'pass' : status === 'incomplete' ? 'INCOMPLETE' : 'FAIL');
  results.push({
    stage,
    status,
    code,
    output: run.notRun === undefined ? run.output : `${run.notRun}\n${run.output}`,
  });

  // A live tier run on a harness that is not green is not evidence. Stop here
  // rather than produce numbers whose provenance nobody can defend.
  if (status !== 'pass' && stage.tier === 'offline') {
    stopped = true;
    write('');
    write('  Offline tier failed — stopping before the live tier.');
    write('  Live results from an unproven harness are not evidence.');
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(0);
const failed = results.filter((result) => result.status === 'fail');
const incomplete = results.filter((result) => result.status === 'incomplete');
const skipped = stages.length - results.length;

mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}/report.md`,
  [
    '# Release gate',
    '',
    `- tier: ${live ? 'offline + live' : 'offline only'}`,
    `- target: ${live ? (process.env.KITSCH_BASE_URL ?? '') : 'n/a — offline tier only'}`,
    `- duration: ${seconds}s`,
    '',
    '| stage | tier | result |',
    '|---|---|---|',
    ...results.map(
      (result) => `| ${result.stage.name} | ${result.stage.tier} | ${result.status} |`,
    ),
    ...(skipped > 0 ? [`| _${String(skipped)} stage(s) not run_ | — | skipped |`] : []),
    '',
    ...(failed.length === 0 && incomplete.length === 0
      ? ['All stages passed.', '']
      : [
          '## What failed, and what shipping without it risks',
          '',
          ...[...failed, ...incomplete].flatMap((result) => [
            `### ${result.stage.name} — ${result.status}`,
            '',
            `Risk: ${result.stage.risk}`,
            '',
            '```',
            result.output.trim().split('\n').slice(-25).join('\n'),
            '```',
            '',
          ]),
        ]),
  ].join('\n'),
  'utf8',
);

write('');
write(
  `  ${String(results.filter((r) => r.status === 'pass').length)} passed | ` +
    `${String(failed.length)} failed | ${String(incomplete.length)} incomplete` +
    (skipped > 0 ? ` | ${String(skipped)} not run` : ''),
);
write(`  report: ${outDir}/report.md  (${seconds}s)`);

for (const result of [...failed, ...incomplete]) {
  write('');
  write(`── ${result.stage.name} (${result.status}) ───────────────────────`);
  write(`  risk if shipped: ${result.stage.risk}`);
  write(result.output.trim().split('\n').slice(-12).join('\n'));
}

write('');
if (failed.length > 0) {
  write('  RELEASE GATE: BLOCKED — defects found');
  process.exit(1);
}
if (incomplete.length > 0 || skipped > 0) {
  write('  RELEASE GATE: INCOMPLETE — some checks could not run.');
  write('  Not a pass. Shipping on this means shipping on an unanswered question.');
  process.exit(2);
}
write(`  RELEASE GATE: CLEAR${live ? '' : ' (offline tier only — the store is unverified)'}`);
