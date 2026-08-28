import type { ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { assertPortFree, killTree, spawnFixture, waitForFixture } from './lib/fixture-process.js';
import { spawnDetached } from './lib/run.js';

/**
 * Negative control for the health-check re-verification.
 *
 * The audit's job is to say whether a reported issue is still present. A check
 * that cannot fail proves nothing, and this one is unusually easy to get wrong
 * in the direction that looks good: report every issue as "not reproduced" and
 * the daily run is green, fast, and says the storefront is fixed.
 *
 * So the audit is run twice against a fixture whose state is known.
 *
 *   seeded  both 2026-04-28 defects present, in the places they were found.
 *           Both issues must come back confirmed, with two tickets drafted.
 *   clean   both repaired. Both must come back not reproduced, no tickets.
 *
 * The seeded profile puts ISSUE 1 in an aria-label and ISSUE 2 in sr-only
 * text, because that is where they were. A scanner reading only innerText
 * passes the first and catches the second — so the control would be green
 * against a scanner that is half blind if it seeded only one. It seeds both,
 * and asserts on each individually rather than on the count.
 */

const PORT = 4210;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const REPORT = 'health-check-report/verify';
const CONFIG = `${REPORT}/config.yaml`;

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A config pointing at the fixture, written rather than committed.
 *
 * The shipped config/health-check.yaml names real environments through
 * environment variables. Reusing it here would either check nothing (variables
 * unset) or fire this control at a real storefront, and a control that depends
 * on somebody's shell is not a control.
 */
const CONFIG_YAML = `environments:
  - name: fixture
    base_url: ${BASE}
sitewide_sample:
  - /
  - /collections/best-sellers
  - /products/coastal-cottage-hair-perfume-duo
  - /cart
issues:
  - id: HC-2026-04-28-1
    title: Quick-view close button missing translation key
    priority: P2
    source: Kitsch Top 20 PDP Health Check
    reported: 2026-04-28
    paths: []
    needle: en.products.product.quick_view.close
  - id: HC-2026-04-28-2
    title: Quick-view sr-only div — product title not substituted
    priority: P2
    source: Kitsch Top 20 PDP Health Check
    reported: 2026-04-28
    paths: []
    needle: '{{ product_title }}'
features:
  issue_recheck: Report validation
explanations:
  issue_recheck: An issue from a previous QA report, re-checked today.
`;

type Ticket = { readonly issueId: string; readonly title: string; readonly body: string };

const startFixture = async (profile: string): Promise<ChildProcess> => {
  await assertPortFree(BASE, '/');
  const child = spawnFixture('fixtures/health-check/server.ts', {
    KITSCH_HEALTH_CHECK_PORT: String(PORT),
    KITSCH_HEALTH_CHECK_PROFILE: profile,
  });
  await waitForFixture(BASE, '/', `health-check fixture (${profile})`, child);
  return child;
};

const runAudit = async (profile: string): Promise<{ readonly tickets: readonly Ticket[] }> => {
  const fixture = await startFixture(profile);
  try {
    await new Promise<void>((resolve) => {
      const child = spawnDetached(
        'npx',
        [
          'tsx',
          'tools/health-check-audit.ts',
          '--config',
          CONFIG,
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
    killTree(fixture);
    await wait(300);
  }
  return {
    tickets: JSON.parse(
      readFileSync(`${REPORT}/${profile}/tickets.json`, 'utf8'),
    ) as readonly Ticket[],
  };
};

mkdirSync(REPORT, { recursive: true });
writeFileSync(CONFIG, CONFIG_YAML, 'utf8');

write('');
write('Health-check re-verification — detection control');
write('');

// ── the broken theme: every reported issue must come back confirmed ───────
const seeded = await runAudit('seeded');

const EXPECTED = [
  {
    id: 'HC-2026-04-28-1',
    what: 'Translation missing in an aria-label',
    // The one a visible-text scan cannot see.
    evidence: 'aria-label',
  },
  {
    id: 'HC-2026-04-28-2',
    what: 'unsubstituted {{ product_title }} in sr-only text',
    evidence: 'product_title',
  },
] as const;

let missed = 0;
for (const expected of EXPECTED) {
  const ticket = seeded.tickets.find((entry) => entry.issueId === expected.id);
  const caught = ticket !== undefined && ticket.body.includes(expected.evidence);
  if (!caught) missed += 1;
  write(`  ${caught ? 'caught ' : 'MISSED '} ${expected.id}  ${expected.what}`);
}

write('');
write(
  `  planted ${String(EXPECTED.length)} | confirmed ${String(EXPECTED.length - missed)} | tickets drafted ${String(seeded.tickets.length)}`,
);
write('');

// ── the repaired theme: nothing may be reported ──────────────────────────
const clean = await runAudit('clean');
const falsePositives = clean.tickets.length;
write(
  falsePositives === 0
    ? '  clean profile   no issues reproduced, no tickets                OK'
    : `  clean profile   ${String(falsePositives)} ticket(s) drafted against a repaired theme  FAIL`,
);
write('');

if (missed > 0 || falsePositives > 0) {
  write('  detection: FAILED');
  write('');
  if (missed > 0) {
    write(`  ${String(missed)} planted issue(s) were not reproduced. The re-verification would`);
    write('  report a live defect as fixed, which is the one outcome worse than');
    write('  not running it at all.');
  }
  if (falsePositives > 0) {
    write('  A repaired theme drafted tickets. Every verdict this audit gives is');
    write('  suspect until that is fixed.');
  }
  write('');
  process.exit(1);
}

write('  detection: verified — reported issues are reproduced when present,');
write('  and a repaired theme produces no tickets.');
write('');
