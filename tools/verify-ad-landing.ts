import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

  // Refuse to run if something already holds the port. A leftover fixture from
  // an earlier run answers with the right profile name while serving stale
  // code, so the profile check below cannot see it — and the whole control run
  // then measures the old build and reports defects that were already fixed.
  const existing = await fetch(`${base}/`)
    .then(() => true)
    .catch(() => false);
  if (existing) {
    throw new Error(
      `${base} is already serving. A previous fixture did not exit, and its code may ` +
        'be stale, so nothing measured against it would mean anything. Stop it first: ' +
        "pkill -f 'fixtures/ad-landing/server.ts'",
    );
  }

  const child = spawn('npx', ['tsx', 'fixtures/ad-landing/server.ts'], {
    env: {
      ...process.env,
      KITSCH_AD_LANDING_PROFILE: profile,
      KITSCH_AD_LANDING_PORT: String(portFor(profile)),
    },
    stdio: 'ignore',
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(250);
    try {
      const response = await fetch(`${base}/`);
      if (!response.ok) continue;
      const body = await response.text();
      // Confirm which profile answered rather than trusting that something did.
      if (body.includes(`(${profile})`)) return { child, base };
      child.kill('SIGKILL');
      throw new Error(`${base} is serving a different profile than "${profile}"`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('different profile')) throw error;
    }
  }
  child.kill('SIGKILL');
  throw new Error(`fixture (${profile}) did not come up on ${base}`);
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
      const child = spawn(
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
    // SIGKILL: the tsx grandchild survives a SIGTERM sent to npx.
    fixture.kill('SIGKILL');
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
