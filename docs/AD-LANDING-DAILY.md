# Daily QA — ad-traffic landing pages

These are the pages paid traffic lands on, so a broken one spends budget to show
a customer something wrong. Runs at 05:45 UTC daily, ahead of the working day.

Contract: [`config/ad-landing.yaml`](../config/ad-landing.yaml).
Schedule: [`.github/workflows/daily-ad-landing.yml`](../.github/workflows/daily-ad-landing.yml).

---

## 1. Run it

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:ad-landing
npm run test:ad-landing-detection    # prove the check still catches things
```

Reports to `ad-landing-report/report.md` and `.json`, plus a line per run in
`history.jsonl`. Exit codes: `0` clean, `1` findings to act on, `2` could not
check.

---

## 2. Scope

Handles came from the BYOB/Welcome-Kit mapping document supplied 2026-08-21.
**That document is not in this repository** — it carries Shopify admin URLs,
internal IDs and campaign metadata the check does not need. Only handles and
codes were taken from it.

| Group | Count | Notes |
|---|---|---|
| Spring Welcome Kits | 5 | base kit + rosemary, castor oil, coconut oil, rice water |
| Summer Welcome Kits | 6 | rosemary, rice water, both bars, with S&C, with S&C bars |
| Winter Welcome Kits | 5 | combos + the four bar combos |
| Free-kit bundles | 2 | S&C combo and S&C bundle, the latter on `WELCOMEKIT` |
| BYOB flows | 9 | every one in the brief |
| Traffic products | 2 | the two thermal roller pages |
| **Unresolved** | **4** | named in the brief, no URL known — see §5 |

Summer castor-oil and coconut-oil kits exist but are `UNLISTED` and the brief
does not name them; including them would report 404s every morning.

### Status conflicts in the source document

Four handles are listed twice with different statuses. These are decisions for
someone, not something config can resolve:

| Handle | Listed as |
|---|---|
| `winter-welcome-kit` | ACTIVE **and** ARCHIVED |
| `welcome-kit` | ACTIVE **and** DRAFT |
| `build-your-own-bar-scent-bundle` | ACTIVE **and** UNLISTED |
| `build-your-own-hair-perfume-duo` | ACTIVE **and** UNLISTED |

The two BYOBs are in scope because the brief names them. The two bare welcome
kits are excluded because the brief names the *combos*, not them.

---

## 3. What is checked

| Requirement from the brief | Finding | Severity |
|---|---|---|
| Discount logic and non-stacking behaviour | `discount_stacked`, `fixed_code_rejected`, `cart_math_wrong` | critical |
| Auto-ship pricing | `autoship_not_cheaper`, `autoship_rate_wrong` | major |
| Discount redirect flows | `redirect_broken` (critical), `redirect_wrong_target` (major) | — |
| BYOB flows loading and working | `byob_no_options` (critical), `byob_price_static` (major) | — |
| Thermal roller OOS redirect | `oos_no_redirect`, `oos_wrong_target` | major |
| Compare-at / strikethrough accuracy | `compare_at_invalid` | major |

Three of these need explaining.

**Non-stacking** is the brief's standing rule: `WELCOMEKIT`, `6reasons` and
`FREECADDY` must not combine with site-wide offers. Verified by adding the
carrier product to the cart, applying the fixed code, then attempting a
site-wide code — which must be refused. Separately, the cart's arithmetic is
checked: whatever discount it displays must come off the total, which catches
the common failure of showing a saving and charging full price.

**BYOB** is exercised, not just loaded: read the bundle price, click two
options, read it again. A price that does not move means the builder is not
wired up — the page looks fine and nothing is priced until checkout.

**Compare-at** is judged as a claim, not a value: a struck-through price that
is not *above* the selling price is a saving that does not exist.

---

## 4. Two limits worth knowing before reading a report

### Out-of-stock redirects are judged on destination only

Stock state is not observable once a storefront redirects — the product page
never renders, so there is nothing to read. The audit therefore probes the
product URL **without following the redirect**, and:

- redirected → must land on the configured substitute, else `oos_wrong_target`
- not redirected, sold out → `oos_no_redirect`
- not redirected, in stock → correct

The case this cannot catch is "in stock but redirected away". A redirect to the
configured substitute is accepted whether or not the product was actually out
of stock, because distinguishing them needs inventory from the Admin API. This
is recorded in the fixture's seeded set as a deliberate absence so it is not
mistaken later for a gap nobody noticed.

Getting an earlier version of this wrong is instructive: the audit followed the
302 and read stock from the *destination*, so a misrouted out-of-stock product
looked identical to an in-stock one that redirected, and the planted defect went
uncaught.

### Two checks are waiting on information from you

Both report as findings rather than passing quietly, because a check with
nothing to check asserts nothing:

- **`non_stacking_unverifiable`** — no currently-live site-wide code is
  configured, so there is nothing to attempt stacking with. **Send one live
  site-wide code** and the brief's standing rule becomes a daily assertion.
  Add it to `non_stacking.site_wide_codes`.
- **`autoship_rate_unverified`** — with no expected percentage set, only
  "cheaper than one-time" is checked, not the advertised rate. **Confirm the
  current auto-ship discount** and set `autoship.expected_discount_percent`.

---

## 5. Unresolved scope — 4 of the brief's items are not checked

Named in the brief with no URL in the mapping document and no match in the
catalogue extract. Reported daily as `handle_unresolved` rather than guessed,
because a guessed handle checks a different page and reports it healthy:

| Item | Why not resolved |
|---|---|
| Kitsch x Hair by Chrissy Bundle | no match anywhere in the supplied data |
| Travel Case Bundle | `build-your-own-travel-case-bundle` exists but is DRAFT; likely a different page |
| Kojic Acid Face and Body Bar + FREE Eco-Friendly Dermaplaner | the bar and the dermaplaner exist separately; this bundle does not appear |
| Top 10 Best Sellers | a collection page, not a product — needs its URL |

Four URLs is the whole fix.

---

## 6. Why the check is trusted

```
npm run test:ad-landing-detection
```

Runs the audit against a healthy fixture and a broken one. Ten planted defects,
one per check in the brief:

```
  clean profile   no store findings                            OK

  caught          compare_at_invalid       seed-bad-compare-at
  caught          autoship_not_cheaper     seed-autoship-flat
  caught          autoship_rate_wrong      seed-autoship-offrate
  caught          byob_no_options          seed-byob-empty
  caught          byob_price_static        seed-byob-static
  caught          oos_no_redirect          seed-oos-stranded
  caught          oos_wrong_target         seed-oos-misrouted
  caught          redirect_wrong_target    /discount/SEEDWRONG
  caught          redirect_broken          /discount/SEEDDEAD
  caught          discount_stacked         SEEDFIXED + SEEDWIDE

  planted 10 | caught 10 | clean-run store findings 0
```

CI runs this before the daily QA and stops the job if it fails.

The control earned its place immediately — it caught three defects in the
check itself that review and unit tests both passed:

1. **Zero BYOB options was reported as "not observed"**, so an empty builder
   read as our own gap rather than a critical defect. Zero is now a real
   observation, and the finding names both possible causes.
2. **The OOS observation followed redirects**, described in §4.
3. **The control could talk to a stale fixture.** A leftover process answers
   with the right profile name while serving old code, so the profile check
   could not see it and a whole run measured the previous build. It now refuses
   to start when the port is already held.

---

## 7. Has it run against mykitsch.com?

**No.** Attempted; every page failed at the network:

```
critical 0 | major 4 | minor 2 | harness 1
harness: nothing loaded from https://www.mykitsch.com, so no ad landing page
         was verified. Config findings above still stand.
```

That is this sandbox's egress policy — see [`LIVE-RUN.md`](LIVE-RUN.md) — not a
property of an ordinary machine or of the CI runner.

Note what the report did **not** do: 29 page failures and 3 redirect failures
collapsed into that single harness line, so a run which verified nothing cannot
be read as 32 store defects. The 6 findings it does report are all facts about
scope and configuration, and they hold regardless of the network.

---

## 8. To get the first real daily run

1. **Enable the workflow** — it needs `contents: write` to commit each
   morning's report to `docs/daily/`.
2. **Map the selectors.** The `selectors:` block leads with `data-testid`
   attributes the live theme almost certainly lacks. Everything unmatched
   reports as `not_observed` (harness) — never as a page defect, never as a
   pass. The first run's harness findings are the mapping list.
3. **Send one live site-wide code** (§4) so non-stacking is actually verified.
4. **Confirm the auto-ship rate** (§4).
5. **Supply the four missing URLs** (§5).

Step 2 is the blocker; steps 3–5 are the difference between a report that
covers the brief and one that covers most of it and says so.
