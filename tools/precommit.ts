import { runSync } from './lib/run.js';

/**
 * Local pre-commit gate.
 *
 * Runs the checks that must pass before code leaves a laptop: TypeScript,
 * ESLint (including the Playwright spec standards and the Kitsch rules), the
 * offline reviewer with its bugbot triage, and the unit suite. Every one is
 * offline — no browser, no network, no storefront — so it stays fast enough
 * that nobody is tempted to skip it.
 *
 * What it deliberately does NOT run: anything that needs a browser or the live
 * store. A pre-commit hook that takes four minutes and needs the internet gets
 * bypassed with --no-verify within a week, and a gate people bypass is worse
 * than no gate, because everyone believes it ran.
 *
 * Install:  npm run hooks:install
 * Run:      npm run precommit
 * Bypass:   git commit --no-verify   (visible, deliberate, and rare)
 */

type Gate = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Why this gate exists, printed when it fails. */
  readonly why: string;
};

const GATES: readonly Gate[] = [
  {
    name: 'typescript',
    command: 'npm',
    args: ['run', '--silent', 'typecheck'],
    why: 'strict mode plus noUncheckedIndexedAccess — a type error here is a runtime error in CI',
  },
  {
    name: 'eslint',
    command: 'npm',
    args: ['run', '--silent', 'lint'],
    why:
      'includes the Playwright spec standards and the four Kitsch rules: no production ' +
      'target, no hardcoded price, no write operation in a collector, spec rationale required',
  },
  {
    name: 'reviewer + bugbot',
    command: 'npm',
    args: ['run', '--silent', 'review', '--', '--gate'],
    why: 'triages every finding by severity and route; harness findings never block, defects do',
  },
  {
    name: 'unit tests',
    command: 'npm',
    args: ['run', '--silent', 'test:unit'],
    why: 'every comparator is tested against known-bad input, offline',
  },
];

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

write('');
write('Pre-commit gate — offline checks only');
write('');

const failures: { readonly gate: Gate; readonly output: string }[] = [];
/**
 * Gates that never started. Kept apart from `failures` on purpose: a gate that
 * could not run has said nothing about the code, and printing it as FAIL tells
 * a contributor their work is broken when it has not been examined.
 */
const notRun: { readonly gate: Gate; readonly reason: string }[] = [];
const started = Date.now();

for (const gate of GATES) {
  const label = gate.name.padEnd(20);
  process.stdout.write(`  ${label} ... `);
  // The output is captured so a passing gate prints one line rather than a page
  // of noise, and a failing one prints its detail in full.
  const result = runSync(gate.command, gate.args);

  if (result.notRun !== undefined) {
    write('COULD NOT RUN');
    notRun.push({ gate, reason: result.notRun });
  } else if (result.status === 0) {
    write('pass');
  } else {
    write('FAIL');
    failures.push({ gate, output: result.output });
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
write('');

if (failures.length === 0 && notRun.length === 0) {
  write(`  pre-commit: PASS in ${seconds}s`);
  write('');
  process.exit(0);
}

// The gates that did not run come first. If npm itself could not be launched
// then every "FAIL" below is suspect too, and a person reading top-down should
// learn that before they start reading a stack trace as if it were about them.
if (notRun.length > 0) {
  write('── could not run ─────────────────────────────────────────────');
  for (const { gate, reason } of notRun) {
    write(`  ${gate.name}: ${reason}`);
  }
  write('');
  write('  These gates did not run, so this commit is unchecked — not clean and');
  write('  not broken. Nothing here is a statement about your code.');
  write('');
}

for (const { gate, output } of failures) {
  write(`── ${gate.name} ──────────────────────────────────────────────`);
  write(`  why this gate exists: ${gate.why}`);
  write('');
  // A gate that failed silently still has to say something, or the report reads
  // as a blank accusation.
  write(output.trim() === '' ? '  (the gate failed but printed nothing)' : output.trim());
  write('');
}

if (failures.length > 0) {
  write(`  pre-commit: FAILED — ${String(failures.length)} of ${String(GATES.length)} gate(s) in ${seconds}s`);
  write('');
  write('  Fix the above, or commit with --no-verify if you have a reason and will');
  write('  say what it was. CI runs the same gates, so bypassing only moves the');
  write('  failure to somewhere with an audience.');
  write('');
}

if (notRun.length > 0) {
  write(
    `  pre-commit: COULD NOT RUN — ${String(notRun.length)} of ${String(GATES.length)} gate(s) never started (${seconds}s)`,
  );
  write('');
  write('  This is not a failing gate. It is an unanswered question, and it exits 2');
  write('  rather than 1 so nothing downstream mistakes it for a verdict.');
  write('');
  process.exit(2);
}

process.exit(1);
