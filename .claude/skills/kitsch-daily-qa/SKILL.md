---
name: kitsch-daily-qa
description: Run the daily QA pass on mykitsch.com — top-10 sellers, ad-traffic landing pages, discount redirects, promo-code validation, auto-ship pricing, BYOB/Welcome Kit flows, and the Playwright locale, visual and accessibility suites in this repository. Use when asked for the daily QA, daily site check, LP QA, a promo/discount audit, or when triaging a failing run of this suite.
---

# Kitsch Daily QA

Runs the recurring storefront QA for mykitsch.com and produces a dated report.

This is the repository-local copy and it takes precedence over the synced skill
of the same name when working in `kitschAutomation`. It carries everything that
one did, plus the automation suite that lives here — which the synced copy
predates.

## How to run

### The Python storefront pass

```bash
python3 scripts/daily_qa.py
```

Takes ~3 minutes. Writes `daily-qa-YYYY-MM-DD.md` alongside a console summary.

### The automation suite in this repository

```bash
npm run daily -- --base-url https://www.mykitsch.com
```

One command, one Allure report, every stage run regardless of what fails.
Exit codes: `0` clean, `1` findings to act on, **`2` at least one stage could
not check — which is never a pass.**

Then read the output, add the manual-only checks (below), and write the report
in the house format: **issues first with severity, then evidence, then a
closing comment.**

## Order of work

1. **Pull first.** More than one triage session has been spent diagnosing
   failures that were already fixed on a branch nobody had checked out. Before
   reading a single failure, confirm the working copy is current — see
   *Before triaging any run* below.
2. **Run the script.** It records the live sitewide discount % first — every
   expected price derives from it, so never assert a fixed figure.
3. **Read `reference/checks.md`** for what each check means and its known-good
   state.
4. **Triage failures against `reference/known-issues.md`** before reporting.
   Several findings recur daily and are already logged; re-raising them daily
   is noise.
5. **Separate "could not check" from "is broken"** before counting anything.
   See *Reading a failing run* — in the last three live runs of the locale
   suite, roughly 95% of the red was the harness, not the store.
6. **Do the manual checks** the script prints at the end. It cannot do them;
   say so plainly rather than implying coverage.
7. **Write the report.** Anything the script couldn't reach goes in a "Not
   verified" section.

---

## Before triaging any run

**Confirm the code that produced the failures is the current code.** This has
now cost three separate sessions, each spent re-diagnosing failures that were
already fixed on a branch the runner had not checked out.

```bash
git fetch origin
git status -sb                      # is this branch behind?
git log --oneline -1                # does this SHA match what was reported?
git branch -r --contains HEAD       # is HEAD actually on the branch you think?
```

The tell is in the failure text itself. A run against stale code quotes source
lines and selector strings that no longer exist. Before believing a failure,
grep the error output for a string the current code introduced:

```bash
grep -c "cart-required\|COULD NOT COMPARE\|rendered almost no text" Error.txt
```

Zero hits on a run that should have them means the branch is behind, and every
failure in that file is about code somebody already changed.

**Fixes merged into a feature branch are not on `develop`.** `git pull` on
`develop` does not bring them. Check `git log --oneline origin/develop..origin/<branch>`.

---

## Reading a failing run

The suite reports three different things and they need opposite responses.
Getting this wrong is the single most expensive mistake in triage.

| Reads as | Actually means | What to do |
|---|---|---|
| `COULD NOT CHECK — …` | Nothing was examined | Fix the harness. Never report as a store defect, never count it as a pass |
| `COULD NOT COMPARE — …` | Two screenshots of different sizes | Not a visual regression. See below |
| A plain assertion failure | The store may genuinely be wrong | Verify by hand before reporting |

**A count of failures is not a count of defects.** A live locale run reported
136 failures; 129 were the harness. Bucket by root cause before quoting any
number to anybody.

### The signatures, and what each one is

**`element(s) not found` / `matched nothing`.** An unmapped or wrong selector.
The copy was never read, so nothing about it is known. Map it in
`config/i18n.yaml` or `config/kits.yaml`, or leave it unmapped and honest —
never guess a theme class to make red go away. A selector that matches the
*wrong* element reports a defect that is not there, which is strictly worse
than reporting that we could not look.

**`HTTP 429`, all on one route.** Not our request volume. When every other
route in the same run answers 200, it is that route refusing — Shopify will
not open `/checkout` with an empty cart. `/checkout` is tagged
`@cart-required` and excluded from live runs for this reason.

**`is missing its {locale} copy`.** Almost always a baseline that describes a
different store. **Check the English row first**: English cannot be missing its
own translation, so if `en` fails too, the whole block is comparing two
catalogues rather than examining the store. The fixture catalogue is stamped
`describes: fixture` and the positive-copy specs decline off-fixture.

**`price "" does not match the … pattern`.** A selector that matched but
rendered no text — typically a sale price on a product that is not on sale.
The empty string is not the page's answer.

**`Expected an image 390px by 6044px, received 390px by 5626px`.** A different
*size*, not a repaint. Ignore the pixel ratio in that message: everything past
the first change counts as different because it moved. On a grid it means the
page has a different amount of content than when the baseline was taken —
merchandising, not layout. Use `clip_height_px`.

**`Failed to take two consecutive stable screenshots`.** The page never held
still. No `max_diff_ratio` fixes this; it is a separate gate demanding exact
equality. Mask what animates, with a reason, or drop the page.

---

## Hard-won rules — these prevent false alarms

**Resolve handles by testing the URL, never against a product list.**
`/collections/all` excludes UNLISTED products, so most Welcome Kit children
look dead when they aren't. This produced two false escalations.

**A redirect out of the locale is usually the PRODUCT, not the locale.** When
`/fr/products/x` lands on `/products/x`, check whether the other `/fr/` routes
in the same run passed. If they did, that product is not published to that
market — a merchandising fact, not a translation defect, and it goes to a
different team. All four target locales did exactly this on the launch handle
while `/fr/`, `/fr/collections/all`, `/fr/cart` and `/fr/pages/about` all
passed. It also means the PDP row is uncovered in those markets until
`KITSCH_LAUNCH_HANDLE` names a product sold there.

**A selector learned in one config is stale in the others.** `config/a11y.yaml`
scanned `/products/self-draining-soap-dish` for weeks after
`config/top-products.yaml` recorded that the live handle carries a trailing
`-1`. Same for `/collections/hair-tools`. When you fix a handle:

```bash
grep -rn "<old-handle>" config/ fixtures/ docs/
```

The same happened to the PDP price selector: `config/top-products.yaml`
learned two alternatives from a live discovery run and `config/i18n.yaml` kept
the narrower pair it shipped with. Both drifts are now pinned by unit tests —
markets between `a11y.yaml` and `i18n.yaml`, price selector between
`i18n.yaml` and `top-products.yaml`. **When you resolve a selector or a handle
against the live store, grep every config for the old value before moving on.**

**A price selector that names only the SALE price reads empty on anything not
discounted.** `span.text-red-700`, `.price-item--sale` and
`.product__price--sale` are all sale prices; on a full-price product they
match an element that renders nothing. That is a COULD NOT CHECK, not a
malformed price. The regular-price element on this theme is still unmapped —
`.price-item--regular` was tried and removed, because unscoped it matched 13
and 21 elements on two PDPs by pulling in recommendation cards.

**A 404 route is not coverage.** The audits report it honestly — a non-200 page
becomes a `not_scanned` harness finding, never a pass — but it sits in the
section nobody reads first, so a route can be dead for weeks while the report
technically says so.

**`.js` does not follow redirects.** A legacy handle can 404 on
`/products/x.js` while `/products/x` 301s and serves fine. Test the page, not
just the endpoint.

**BYOB parent containers are deliberately unpurchasable.** A parent
add-to-cart always returns 422. That is the guard working, not a fault. Test
the builder via child products.

**The Welcome Kit buy button adds nothing.** `.bundle-buy-button` is a DIV that
opens a bundle builder; pressing it leaves `/cart.js` at `item_count: 0`. Ask
the store what is in the cart rather than inferring it from the DOM.

**Container products show 0% off.** Welcome Kit parents display their own
price; the real price comes from the child selection. $58/$58 on a container is
expected.

**Compare-at on BYOBs is a configuration ceiling, not a discount base.** Never
derive a percentage from `price ÷ compare_at` on a bundle with free-choice
components — it is meaningless. Validate component prices in the cart instead.

**Check every subscription frequency.** The 1-Month plan often carries two
price adjustments (e.g. 30% then 20% after the first order). Testing only the
default hides it.

**Screenshots age fast.** The sitewide promo changes every few days. If a
screenshot's prices don't match today's, check its announcement bar before
calling it a defect.

**A bless immediately followed by a compare proves nothing.** It shows the
store held still for three minutes. The number worth watching is the next
morning's run against untouched baselines.

**CSS comma-separated selectors are a UNION, not a fallback chain.** One
unscoped alternative drags in the whole page. Scope every alternative.

---

## What the automation cannot do

- **Promo-code application.** `/discount/CODE` plus the AJAX cart does not
  apply codes — proven against six codes including a native Shopify one, all
  returning `applicable: false`. Only real checkout entry is conclusive.
- **BYOB builder flows.** Needs a browser driving the builder, which is not
  built.
- **Live checkout, any locale.** Not browsable with an empty cart.
- **Positive translation copy against the live store.** No collector emits a
  live-store catalogue, so "does the French footer say the right thing?" is
  **unverified**, not passing. The negative scan ("is English showing?") does
  run live and is where the real findings come from.
- **Anything read through `site_header`.** Unmapped on this theme.
- **Cross-browser and device testing** beyond the configured matrix.
- **`/pages/build-a-bundle-bars` sequence** against the Loom recordings.
- **Visual checks beyond the configured baselines** — anything requiring eyes.

Say these plainly in the report rather than letting a green run imply them.

## Files

| File | Contents |
|---|---|
| `scripts/daily_qa.py` | The Python storefront pass (synced skill) |
| `reference/checks.md` | What each check verifies and its known-good state |
| `reference/known-issues.md` | Recurring findings already logged — triage against this first |
| `docs/LIVE-RUN.md` | What the live runs found, what was harness, and the named coverage gaps |
| `docs/ADDING-A-CHECK.md` | How to add a check, and why each needs a detection control |
| `docs/VISUAL-REGRESSION.md` | Baselines, masks, and reading a screenshot failure |
