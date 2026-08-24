import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { assertPortFree, killTree, spawnFixture, waitForFixture } from './lib/fixture-process.js';

import { SEEDED, SEEDED_CART } from '../fixtures/top-products/seeded.js';

/**
 * Negative control for the daily top-10 check.
 *
 * Runs the audit against a healthy fixture and then a broken one, asserting
 * the healthy run reports nothing and every planted defect is caught by name.
 *
 * One planted defect per requirement in the brief — availability,
 * add-to-cart, pricing, description, images, specifications, variants,
 * product identity, and cart arithmetic — so no requirement is claimed
 * without having been watched to fail.
 *
 *   npm run test:top-products-detection
 */

const CONFIG = 'fixtures/top-products/config.yaml';
const REPORT = 'top-products-report/verify';

/** A port per profile: a fixture that has not died yet must not answer for the next one. */
const portFor = (profile: string): number => (profile === 'seeded' ? 4192 : 4191);

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const startFixture = async (profile: string): Promise<{ child: ChildProcess; base: string }> => {
  const base = `http://127.0.0.1:${String(portFor(profile))}`;
  await assertPortFree(base, '/');
  const child = spawnFixture('fixtures/top-products/server.ts', {
    KITSCH_TOP_PRODUCTS_PROFILE: profile,
    KITSCH_TOP_PRODUCTS_PORT: String(portFor(profile)),
  });
  await waitForFixture(base, '/', `(${profile})`, child);
  return { child, base };
};

type Report = {
  readonly findings: readonly {
    readonly kind: string;
    readonly product: string;
    readonly severity: string;
  }[];
};

const runAudit = async (profile: string): Promise<Report> => {
  const { child: fixture, base } = await startFixture(profile);
  try {
    await fetch(`${base}/cart/reset`, { method: 'POST' }).catch(() => undefined);
    await new Promise<void>((resolve) => {
      const child = spawn(
        'npx',
        [
          'tsx',
          'tools/top-products-audit.ts',
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
write('Top-10 daily check — detection control');
write('');

// ── 1. healthy fixture: the audit must report nothing ────────────────────
const clean = await runAudit('clean');
if (clean.findings.length === 0) {
  write('  clean profile   no findings                                  OK');
} else {
  failures += 1;
  write(`  clean profile   ${String(clean.findings.length)} unexpected finding(s)      FAILED`);
  for (const finding of clean.findings.slice(0, 8)) {
    write(`                    ${finding.kind} on ${finding.product}`);
  }
}

// ── 2. broken fixture: every planted defect caught ───────────────────────
const seeded = await runAudit('seeded');
write('');
for (const planted of SEEDED) {
  const caught = seeded.findings.some((finding) => finding.kind === planted.kind);
  if (caught) write(`  caught          ${planted.kind.padEnd(26)} ${planted.handle}`);
  else {
    failures += 1;
    write(`  MISSED          ${planted.kind.padEnd(26)} ${planted.handle}`);
    write(`                    planted: ${planted.note}`);
  }
}

const cartCaught = seeded.findings.some((finding) => finding.kind === SEEDED_CART.kind);
if (cartCaught) write(`  caught          ${SEEDED_CART.kind.padEnd(26)} (cart)`);
else {
  failures += 1;
  write(`  MISSED          ${SEEDED_CART.kind.padEnd(26)} (cart)`);
  write(`                    planted: ${SEEDED_CART.note}`);
}

write('');
write(
  `  planted ${String(SEEDED.length + 1)} | caught ` +
    `${String(SEEDED.length + 1 - failures)} | clean-run findings ${String(clean.findings.length)}`,
);

if (failures > 0) {
  write('');
  write(`  detection: FAILED — ${String(failures)} problem(s)`);
  write('  A defect this check cannot see is one it will report as clean every morning.');
  process.exit(1);
}
write('');
write('  detection: verified — the daily check passes a healthy store and fails a broken one.');
