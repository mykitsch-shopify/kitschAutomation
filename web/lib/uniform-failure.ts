/**
 * "Every one of them failed" is one finding, not N.
 *
 * A check that fails on ten products out of ten is almost never ten defects.
 * It is one cause — a selector that stopped matching the theme, a flow that
 * changed shape, a site-wide outage — and a report that lists it ten times
 * spends the reader's attention ten times on the same question while saying
 * nothing about which of those causes it is.
 *
 * The 2026-09-04 runs are the case. The top-10 check reported ten criticals,
 * "clicking add-to-cart did not put a line in the cart", one per product, on
 * all ten. The ad-landing check reported nine criticals, "the builder offers 0
 * options", on all nine builders. Both read as a catastrophic morning. Both are
 * a single question: does the selector still match, or did the store break?
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 *
 * It does not demote the individual findings. Ten products with a broken
 * add-to-cart button IS possible, it IS critical, and a rule that quietly
 * downgraded it the moment it affected everything would hide the worst outage
 * this suite can see — precisely when the suite matters most.
 *
 * So the per-target findings stay exactly as they are, and this adds one more
 * saying what the shape of the run means. Same treatment the translation audit
 * gives a throttled run: each per-task note is individually true and
 * collectively misleading, and no per-task note can see the run it belongs to.
 */

export type UniformCandidate = {
  /** Which check produced it, e.g. "add_to_cart". */
  readonly check: string;
  /** The specific failure, e.g. "no_cart_line". */
  readonly kind: string;
  /** What it was about — a handle, a page, a product. */
  readonly target: string;
};

export type UniformFailure = {
  readonly check: string;
  readonly kind: string;
  readonly affected: number;
  readonly total: number;
  readonly detail: string;
};

/**
 * How much of the run has to fail before "all of it" is the finding.
 *
 * Not 100%: a run where 19 of 20 fail says the same thing as 20 of 20, and
 * insisting on unanimity means one lucky pass hides the pattern. Not a
 * majority either — half a run failing has plenty of ordinary explanations.
 */
const UNIFORM_AT = 0.9;

/**
 * And a floor, because 2 of 2 is not evidence of anything. Three is the
 * smallest run where "all of them" is more likely a cause than a coincidence.
 */
const MIN_TARGETS = 3;

/**
 * Finds checks that failed on effectively everything they touched.
 *
 * `totalFor` gives how many targets each check actually visited — not the size
 * of the whole run. A check that only applies to the nine BYOB pages must be
 * judged against nine, or it never looks uniform in a run of twenty-nine.
 */
export const detectUniformFailures = (
  candidates: readonly UniformCandidate[],
  totalFor: (check: string) => number,
): readonly UniformFailure[] => {
  const groups = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.check, candidate.kind]);
    const targets = groups.get(key) ?? new Set<string>();
    targets.add(candidate.target);
    groups.set(key, targets);
  }

  const out: UniformFailure[] = [];
  for (const [key, targets] of groups) {
    const [check = '', kind = ''] = JSON.parse(key) as [string, string];
    const total = totalFor(check);
    const affected = targets.size;
    if (total < MIN_TARGETS || affected < total * UNIFORM_AT) continue;

    out.push({
      check,
      kind,
      affected,
      total,
      detail:
        `${check} failed on ${String(affected)} of ${String(total)} target(s) — every one it ` +
        `looked at, with the same result each time.\n\n` +
        `Read the ${String(affected)} finding(s) above as ONE question rather than ` +
        `${String(affected)} answers. A check that fails everywhere has two explanations and ` +
        `this run cannot tell them apart:\n\n` +
        `  the store   something used on every one of these pages is genuinely broken, in ` +
        `which case this is the most urgent thing in the report;\n` +
        `  the harness the selector behind "${check}" no longer matches this theme, in which ` +
        `case nothing has been checked and nothing is known.\n\n` +
        `Settle it before acting on the individual findings: open one of these pages by hand ` +
        `and try it. One minute there decides whether this is an outage or a config edit, and ` +
        `every minute spent on the list above before that is spent on the wrong one.\n\n` +
        `\`npm run preflight\` resolves the configured selectors against the live store and ` +
        `reports which of them match nothing, which answers the harness half directly.`,
    });
  }

  return out.sort((a, b) => b.affected - a.affected);
};
