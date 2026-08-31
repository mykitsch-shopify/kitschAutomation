import { DIVERGENCE_KINDS } from '../fixtures/storefront/kits.js';
import type { DivergenceKind } from '../fixtures/storefront/kits.js';
import { runSync } from './lib/run.js';

/**
 * Negative control for welcome-kit parity.
 *
 * The parity spec's whole claim is "these kits are handled the same way". A
 * comparison that cannot fail supports that claim about any two kits at all,
 * and this one had no control until the comparison was rewritten to read from
 * the cart — at which point nothing in the repo could say whether the new
 * dimensions still detected anything.
 *
 * **One defect at a time.** Running the full seeded profile and watching the
 * suite go red proves almost nothing, because stacked defects mask each other:
 * a leaked price stops the gift line being a free line, and both
 * `independently_removable` and `removed_with_qualifying_product` are read off
 * free lines, so they fall silent behind it. The suite still fails — on the
 * leak — and a control asserting "it failed" would call that a pass while two
 * dimensions were dead.
 *
 * So each defect is seeded alone, and the control asserts not just that the
 * run failed but that the failure names the dimension that defect is supposed
 * to move. A dimension that goes quiet turns this red with its own name in
 * the output.
 *
 *   npm run test:kits-detection
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * What each seeded defect must make the comparison say.
 *
 * The dimension named here is the one the difference is reported under, and it
 * is asserted against the spec's own failure text — so this stays honest if a
 * dimension is renamed, rather than matching some looser signal that survives
 * the rename and proves nothing.
 */
const EXPECTED: Readonly<Record<DivergenceKind, { readonly dimension: string; readonly what: string }>> = {
  leakedPrice: {
    dimension: 'free_line_price_label',
    what: 'the free kit shows $12.00 in the cart instead of Free (§12 MSRP leakage)',
  },
  notAutoAdded: {
    dimension: 'free_line_count',
    what: 'the free kit never reaches the cart (§8 auto-add)',
  },
  separatelyRemovable: {
    dimension: 'independently_removable',
    what: 'the free kit carries its own Remove control (§7)',
  },
  strandedOnRemoval: {
    dimension: 'removed_with_qualifying_product',
    what: 'the free kit is left in the cart after the qualifying product goes (§8)',
  },
  chargedAtCheckout: {
    dimension: 'free_at_checkout',
    what: 'the free kit is priced in the order summary (§10)',
  },
};

/**
 * A port per case, so a webServer left listening from the previous case cannot
 * be reused by the next one. `reuseExistingServer` is on outside CI, and a
 * reused fixture would serve the *previous* defect — every case after the
 * first would then be measuring the wrong thing while looking green.
 */
const portFor = (index: number): string => String(4180 + index);

const runKits = (
  port: string,
  extra: Readonly<Record<string, string>>,
): { readonly status: number | null; readonly output: string; readonly notRun: string | undefined } => {
  const result = runSync(
    'npx',
    ['playwright', 'test', '--project=mobile-chrome', '--grep', '@kits', '--reporter=line'],
    {
      env: {
        KITSCH_FIXTURE_PORT: port,
        KITSCH_BASE_URL: `http://127.0.0.1:${port}`,
        ...extra,
      },
    },
  );
  return { status: result.status, output: result.output, notRun: result.notRun };
};

write('');
write('Welcome-kit parity — detection control');
write('');
write('  Each defect is seeded on its own, because stacked defects hide behind');
write('  one another. A run must fail AND name the dimension that moved.');
write('');

let broken = 0;

DIVERGENCE_KINDS.forEach((kind, index) => {
  const expected = EXPECTED[kind];
  const result = runKits(portFor(index), {
    KITSCH_FIXTURE_PROFILE: 'seeded',
    KITSCH_KIT_DIVERGENCE: kind,
  });

  if (result.notRun !== undefined) {
    // The suite never started. "The spec did not fail" would be a verdict on
    // evidence nobody collected — the exact collapse this repo exists to stop.
    broken += 1;
    write(`  COULD NOT RUN  ${kind}`);
    write(`                 ${result.notRun}`);
    return;
  }

  if (result.status === 0) {
    broken += 1;
    write(`  MISSED   ${kind.padEnd(21)} suite passed against a kit where ${expected.what}`);
    return;
  }

  if (!result.output.includes(expected.dimension)) {
    // It failed, but not for this reason. Counting that as detection is how a
    // dead dimension hides behind a live one.
    broken += 1;
    write(`  WRONG    ${kind.padEnd(21)} failed, but never mentioned ${expected.dimension}`);
    write(`                                 expected: ${expected.what}`);
    return;
  }

  write(`  caught   ${kind.padEnd(21)} reported as ${expected.dimension}`);
});

write('');

// ── the matching kit: nothing may be reported ────────────────────────────
//
// Without this the control is satisfied by a spec that fails on everything.
const clean = runKits(portFor(DIVERGENCE_KINDS.length), { KITSCH_FIXTURE_PROFILE: 'clean' });
const falsePositive = clean.notRun === undefined && clean.status !== 0;

if (clean.notRun !== undefined) {
  broken += 1;
  write(`  COULD NOT RUN  clean profile — ${clean.notRun}`);
} else {
  write(
    falsePositive
      ? '  clean profile   kits that match each other were reported as differing  FAIL'
      : '  clean profile   matching kits produce no differences                   OK',
  );
}
write('');

if (broken > 0 || falsePositive) {
  write('  detection: FAILED');
  write('');
  if (broken > 0) {
    write(`  ${String(broken)} case(s) did not behave. A parity check that cannot fail says the`);
    write('  seasonal kits match the winter kit no matter what they do — which is');
    write('  worse than not running it, because somebody will believe it.');
  }
  if (falsePositive) {
    write('  Identical kits were reported as different. Every difference this spec');
    write('  reports is suspect until that is fixed.');
  }
  write('');
  process.exit(1);
}

write('  detection: verified — every compared dimension moves when the kit');
write('  behind it misbehaves, and matching kits report nothing.');
write('');
