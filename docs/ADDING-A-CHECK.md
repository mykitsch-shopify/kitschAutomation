# Turning an Asana task into an automated check

Every check in this repo was built the same way, and the shape is deliberate.
Follow it and a new task becomes a check in about half a day; skip a step and
you get a check that goes green having examined nothing.

---

## The shape

```
config/<name>.yaml            the contract — what to check, in data not code
web/lib/<name>.ts             pure judging: observation in, findings out
web/lib/<name>.test.ts        unit tests, every rule against known-bad input
tools/<name>-audit.ts         the runner: browses, observes, judges, reports
fixtures/<name>/server.ts     a fixture with a clean and a seeded profile
fixtures/<name>/seeded.ts     the planted defects, one per rule
tools/verify-<name>.ts        the control: clean passes, seeded fails by name
docs/<NAME>.md                what it checks, what it cannot, what it needs
```

The split matters: **judging is pure and browsing is not.** Every rule can then
be tested against known-bad input in milliseconds without a storefront, and the
runner has no logic worth testing.

---

## The seven steps

**1. Read the task and write down what would falsify it.** A task like "the
summer kit should handle free items like winter" becomes a list of comparable
dimensions. If you cannot state what observation would prove it wrong, it is
not yet a check.

**2. Put the scope in a config file, not in code.** Handles, locales, codes,
thresholds. Adding a product or a market should be a config edit. Every
threshold gets a comment saying what it was measured against — a number with no
provenance gets tuned until the check is silent.

**3. Write the pure judge.** Take an `Observation` type where **every field is
optional**, and treat `undefined` as `harness`, never as a pass. This is the
single most important rule in the repo. An unmapped selector observes nothing,
and "no defects found" is exactly what a blind run also reports.

**4. Write the unit tests first against known-bad input.** Not just the happy
path. Every finding kind needs a test that produces it, and the vacuity cases
need tests that prove `undefined` does not pass.

**5. Build a fixture with two profiles.** `clean` must produce zero findings.
`seeded` plants one defect per rule. Use distinct ports per profile and assert
which profile answered — a leftover fixture serving stale code will otherwise
invalidate an entire control run silently.

**6. Write the detection control.** It runs the audit against both profiles and
asserts the clean one is silent and every planted defect is caught by name. **A
check that has never been watched to fail is not evidence.** Every control in
this repo caught at least one real bug that review and unit tests both passed.

**7. Wire it in.** Add scripts to `package.json`, the control to `verify` and to
the `controls` job in `.github/workflows/pipeline.yml`, the live run to the
`nightly` matrix, and the stage to `tools/release-gate.ts` with a one-line
statement of what shipping without it would risk.

---

## The rules that are not negotiable

- **Never let "not observed" read as "fine".** Harness findings are our failures,
  are excluded from what is routed to the business, and still fail the run.
- **Collapse a dead network into one finding.** When nothing loads, per-item
  failures must not read as N store defects. Every audit here does this because
  the first version of one of them announced "10 findings to act on" having
  verified nothing.
- **A check with nothing to check says so.** Non-stacking with no site-wide code
  configured, or an auto-ship rate with no expected percentage, reports that it
  could not verify rather than passing.
- **Never guess an identifier.** A wrong handle does not fail — it checks a
  different product and reports it healthy. Resolve it or report it unresolved.
- **Exit codes carry meaning.** `0` clean, `1` findings, `2` could not check.
  A `2` is never a pass.

---

## Worked example: the last five checks

| Task | Config | What the control caught that review did not |
|---|---|---|
| Welcome-kit parity | `config/kits.yaml` | 7 specs passing against a cart the run never opened |
| Compare-at removal | `config/kits.yaml` | Page pool indexed by item, so workers shared a browser page |
| Top-10 daily | `config/top-products.yaml` | An emptied price is `""`, not `undefined` — an unbuyable variant passed |
| Ad-landing daily | `config/ad-landing.yaml` | Stock is unobservable after a redirect; zero BYOB options read as harness |
| Accessibility | `config/a11y.yaml` | (fixture was wrong, not the rule — alt text a German page should translate) |

Five for five. Budget the control as part of the work, not as an extra.
