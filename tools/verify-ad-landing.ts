import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { assertPortFree, killTree, spawnFixture, waitForFixture } from './lib/fixture-process.js';
import { spawnDetached } from './lib/run.js';

import { SEEDED } from '../fixtures/ad-landing/seeded.js';

/**
 * Negative control for the ad-landing daily QA.
 *
 * Runs the audit against a healthy fixture and a broken one, asserting the
 * healthy run reports no store defects and every planted defect is caught by
 * name — one per check in the daily brief, so no check is claimed without
 * having been watched to fail.
 *
 *   npm run test:ad-landing-detection
 */

const CONFIG = 'fixtures/ad-landing/config.yaml';
const REPORT = 'ad-landing-report/verify';

/** A port per profile: a fixture that has not died yet must not answer for the next. */
const portFor = (profile: string): number => (profile === 'seeded' ? 4197 : 4196);

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const startFixture = async (profile: string): Promise<{ child: ChildProcess; base: string }> => {
  const base = `http://127.0.0.1:${String(portFor(profile))}`;
  await assertPortFree(base, '/');
  const child = spawnFixture('fixtures/ad-landing/server.ts', {
    KITSCH_AD_LANDING_PROFILE: profile,
    KITSCH_AD_LANDING_PORT: String(portFor(profile)),
  });
  await waitForFixture(base, '/', `(${profile})`, child);
  return { child, base };
};

type Report = {
  readonly findings: readonly {
    readonly kind: string;
    readonly target: string;
    readonly severity: string;
  }[];
};

const runAudit = async (profile: string): Promise<Report> => {
  const { child: fixture, base } = await startFixture(profile);
  try {
    await fetch(`${base}/cart/reset`).catch(() => undefined);
    await new Promise<void>((resolve) => {
      const child = spawnDetached(
        'npx',
        [
          'tsx',
          'tools/ad-landing-audit.ts',
          '--base-url',
          base,
          '--config',
          CONFIG,
          '--out',
          `${REPORT}/${profile}`,
          '--date',
          '1970-01-01',
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
write('Ad-landing daily QA — detection control');
write('');

// ── 1. healthy fixture ───────────────────────────────────────────────────
// The fixture config deliberately carries one unresolved scope item, so the
// clean run is expected to report exactly that and nothing about the store.
const clean = await runAudit('clean');
const cleanStore = clean.findings.filter(
  (finding) => finding.kind !== 'handle_unresolved' && finding.severity !== 'harness',
);
if (cleanStore.length === 0) {
  write('  clean profile   no store findings                            OK');
} else {
  failures += 1;
  write(`  clean profile   ${String(cleanStore.length)} unexpected finding(s)      FAILED`);
  for (const finding of cleanStore.slice(0, 8)) {
    write(`                    ${finding.kind} on ${finding.target}`);
  }
}

// ── 2. broken fixture ────────────────────────────────────────────────────
const seeded = await runAudit('seeded');
write('');
for (const planted of SEEDED) {
  const caught = seeded.findings.some((finding) => finding.kind === planted.kind);
  if (caught) write(`  caught          ${planted.kind.padEnd(24)} ${planted.where}`);
  else {
    failures += 1;
    write(`  MISSED          ${planted.kind.padEnd(24)} ${planted.where}`);
    write(`                    planted: ${planted.note}`);
  }
}

write('');
write(
  `  planted ${String(SEEDED.length)} | caught ${String(SEEDED.length - failures)} | ` +
    `clean-run store findings ${String(cleanStore.length)}`,
);

if (failures > 0) {
  write('');
  write(`  detection: FAILED — ${String(failures)} problem(s)`);
  write('  A defect this check cannot see is one it reports as clean every morning,');
  write('  on pages that are actively spending ad budget.');
  process.exit(1);
}
write('');
write('  detection: verified — the daily QA passes healthy pages and fails broken ones.');
