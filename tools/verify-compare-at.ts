import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { assertPortFree, killTree, spawnFixture, waitForFixture } from './lib/fixture-process.js';

import { SEEDED } from '../fixtures/compare-at/seeded.js';

/**
 * Negative control for the compare-at audit.
 *
 * Runs the audit twice against the fixture — once where the removal applied
 * correctly, once where it half-failed — and asserts that the clean profile
 * reports nothing while every planted defect is caught by name.
 *
 * Both directions are needed. A check that only ever passes proves nothing,
 * and a check that only ever fails proves nothing either; the pair is what
 * makes a green run mean something.
 *
 *   npm run test:compare-at-detection
 */

const REPORT = 'compare-at-report/verify';

/**
 * A port per profile. Reusing one port let a fixture that had not died yet
 * answer for the next profile: kill() signals `npx`, which does not always
 * pass the signal to the `tsx` grandchild, so the old server kept the port,
 * the new one failed to bind, and the poll below happily talked to the
 * survivor. The whole seeded run then measured the clean fixture and reported
 * every planted defect as missed.
 */
const portFor = (profile: string): number => (profile === 'seeded' ? 4187 : 4186);

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits for the fixture and then confirms which profile answered. Distinct
 * ports make the collision above unlikely; this makes it detectable. Trusting
 * "something responded" is what let the bug hide in the first place.
 */
const startFixture = async (profile: string): Promise<{ child: ChildProcess; base: string }> => {
  const base = `http://127.0.0.1:${String(portFor(profile))}`;
  await assertPortFree(base, '/');
  const child = spawnFixture('fixtures/compare-at/server.ts', {
    KITSCH_COMPARE_AT_PROFILE: profile,
    KITSCH_COMPARE_AT_PORT: String(portFor(profile)),
  });
  await waitForFixture(base, '/', `(${profile})`, child);
  return { child, base };
};

type Report = {
  readonly findings: readonly { readonly kind: string; readonly handle: string }[];
  readonly counts: Readonly<Record<string, number>>;
};

const runAudit = async (profile: string): Promise<Report> => {
  const { child: fixture, base } = await startFixture(profile);
  try {
    await new Promise<void>((resolve) => {
      const child = spawn(
        'npx',
        [
          'tsx',
          'tools/compare-at-audit.ts',
          '--import',
          'data/compare-at/removal-import.csv',
          '--rollback',
          'data/compare-at/rollback-values.csv',
          '--base-url',
          base,
          '--out',
          `${REPORT}/${profile}`,
        ],
        { stdio: 'ignore', env: process.env },
      );
      child.on('exit', () => {
        resolve();
      });
    });
  } finally {
    // The whole process group: SIGKILL to npx leaves the tsx grandchild
    // holding the port. See tools/lib/fixture-process.ts.
    killTree(fixture);
    await wait(300);
  }
  return JSON.parse(readFileSync(`${REPORT}/${profile}/report.json`, 'utf8')) as Report;
};

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
let failures = 0;

write('');
write('Compare-at audit — detection check');
write('');

// ── 1. clean profile: the storefront agrees with the sheets ──────────────
const clean = await runAudit('clean');
// Sheet-level findings are a property of the CSVs, not the storefront, so they
// are present in both runs and are not defects the fixture planted.
const cleanStore = clean.findings.filter(
  (finding) =>
    finding.kind === 'compare_at_still_rendered' ||
    finding.kind === 'price_mismatch' ||
    finding.kind === 'price_not_observed',
);
if (cleanStore.length === 0) {
  write('  clean profile   no storefront findings                      OK');
} else {
  failures += 1;
  write(`  clean profile   ${String(cleanStore.length)} unexpected finding(s)   FAILED`);
  for (const finding of cleanStore.slice(0, 5)) {
    write(`                    ${finding.kind} on ${finding.handle}`);
  }
}

// ── 2. seeded profile: every planted defect is caught ────────────────────
const seeded = await runAudit('seeded');
write('');
for (const planted of SEEDED) {
  const caught = seeded.findings.some(
    (finding) => finding.handle === planted.handle && finding.kind === planted.kind,
  );
  if (caught) write(`  caught          ${planted.kind.padEnd(28)} ${planted.handle}`);
  else {
    failures += 1;
    write(`  MISSED          ${planted.kind.padEnd(28)} ${planted.handle}`);
    write(`                    planted: ${planted.note}`);
  }
}

write('');
write(
  `  planted ${String(SEEDED.length)} | caught ${String(SEEDED.length - failures)} | ` +
    `clean-run findings ${String(cleanStore.length)}`,
);

if (failures > 0) {
  write('');
  write(`  detection: FAILED — ${String(failures)} problem(s)`);
  write('  A defect the audit cannot see is a defect it will report as clean.');
  process.exit(1);
}
write('');
write('  detection: verified — the audit passes a clean store and fails a broken one.');
