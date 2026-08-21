# Daily top-10 product check

Checks the ten best-selling products every morning for the things that stop a
sale: can it be bought, does it price correctly, does the page describe the
right product, do the variants work, and does the cart charge what it displays.

Contract: [`config/top-products.yaml`](../config/top-products.yaml).
Runs daily in CI via [`.github/workflows/daily-top-products.yml`](../.github/workflows/daily-top-products.yml).

---

## 1. Run it

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:top-products
```

Reports to `top-products-report/report.md` and `.json`, and appends one line per
run to `history.jsonl` so the trend is greppable. Exit codes: `0` clean, `1`
findings to act on, `2` could not check.

Other invocations:

```bash
npm run resolve:handles                  # map the list's titles to URLs (see §2)
npm run audit:top-products -- --no-cart  # skip add-to-cart and the cart checks
npm run test:top-products-detection      # prove the check still catches things
```

---

## 2. The list is 10 titles and 2 handles — read this first

**Eight of the ten products are not being checked yet**, and this is deliberate
rather than an oversight.

The list arrives as marketing titles; the check needs URL handles. Those are not
derivable from each other, and getting it wrong is not a failure that announces
itself — a wrong handle loads a *different* product and reports it healthy.
Measured on our own catalogue:

```
0.667   "Rice Water Shampoo Bar for Hair Growth" vs "Rice Water Shampoo Bar"
        — the same product, suffix dropped
0.833   "Rice Water Shampoo Bar for Hair Growth" vs "Rice Water Conditioner
        Bar for Hair Growth" — a DIFFERENT product
```

The wrong product scores higher than the right one, because these titles share
their boilerplate and differ by the single word that matters. No similarity
threshold separates them, so the audit does not guess: a product with no handle
is reported as `handle_unresolved` and skipped.

| # | Title | Status |
|---|---|---|
| 1 | Rice Water Shampoo & Conditioner Combo for Hair Growth | unresolved — a bundle, absent from our catalogue extract |
| 2 | Rice Water Shampoo Bar for Hair Growth | unresolved — "bar" vs "bar bag" are different products |
| 3 | Self-Draining Soap Dish | **`self-draining-soap-dish`** |
| 4 | Shea Butter Exfoliating Body Wash | unresolved — nearest is "moisturizing", not "exfoliating" |
| 5 | Kojic Acid Hyperpigmentation Face and Body Bar | **`kojic-acid-face-and-body-bar`** |
| 6 | Bottle Free Beauty Travel Case | unresolved — nearest are bar *bags*, not a case |
| 7 | Rosemary Scalp & Hair Strengthening Oil With Biotin | unresolved — likely the "pre-wash" oil; confirm |
| 8 | Shampoo Bar Bag | unresolved — four products match equally |
| 9 | Rice Water Conditioner Bar for Hair Growth | unresolved — liquid vs bar |
| 10 | Rosemary & Biotin Volumizing Shampoo & Conditioner Combo | unresolved — a bundle; the singles exist separately |

### Closing the gap

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run resolve:handles
```

Queries the storefront's own search, prints each match with its confidence and
runners-up, and **writes nothing** without `--write`. Only exact matches are
written automatically; the ambiguous ones need a person, because a near-miss
here is a neighbouring product rather than a typo.

Whatever it writes includes `canonical_title` — the title the storefront itself
uses. That is what the daily check compares against **exactly**, so a rename or
a swapped product fails loudly instead of quietly passing. Until a
`canonical_title` is recorded, the check reports `canonical_title_unrecorded`
(minor) rather than implying that row's identity was confirmed.

---

## 3. What is checked

| Requirement from the brief | Check | Finding if it fails | Severity |
|---|---|---|---|
| Stock availability | `availability` | `sold_out` | critical |
| "Add to Cart" functionality | `add_to_cart` | `add_to_cart_failed` | critical |
| Product title | `title` | `title_mismatch` | critical |
| Descriptions | `description` | `description_missing` | major |
| Images | `images` | `images_missing`, `image_broken` | major |
| Videos | `videos` | `video_missing` | minor |
| Pricing | `pricing` | `price_missing`, `price_zero` | critical |
| Specifications | `specifications` | `specifications_missing` | minor |
| Variations function correctly | `variations` | `variant_broken` | major |
| Discounts stack correctly in cart | `discount_stacking` | `cart_math_wrong`, `discount_not_applied`, `discount_stacking_wrong` | critical |

Notes on three of them:

- **Images** are checked for more than presence. An `<img>` that is in the
  markup but never loaded (`naturalWidth === 0`) is reported as `image_broken`
  — the customer sees a gap where a product photo should be, and an element
  count alone misses it entirely.
- **Videos** are only required where a product's config says `expect_video:
  true`. Most of these ten have none, and a blanket requirement would put nine
  false failures in the report every morning — which is how a daily report
  teaches people to ignore it.
- **Variations** require a *usable* price after selecting each option, not
  merely a price element. Clearing a price leaves the element in place with
  empty text, so a check testing only for absence passes an option that cannot
  be bought. That exact defect survived the unit tests and was caught by the
  fixture control.

---

## 4. Discount stacking needs rules from merchandising

This is the one requirement that cannot be fully verified from the storefront,
because "stacked correctly" is a business rule rather than a page property.

**Checked with no rules supplied:** the cart's arithmetic. Whatever discount the
cart displays must actually come off the total, and a submitted code must be
accepted. A cart that shows a saving and charges full price is the common real
failure, and that alone catches it.

**Needs rules:** which codes may combine, and what the result should be. Add
them to `config/top-products.yaml`:

```yaml
discounts:
  codes:
    - { code: WELCOME10, kind: percentage, value: 10 }
    - { code: FREESHIP, kind: shipping }
  expected_stacking:
    - codes: [WELCOME10, FREESHIP]
      applies: both          # both | first_only | neither
      note: 'Confirmed with merchandising 2026-08-21.'
```

Until then the audit reports `discount_rules_absent` as a minor finding rather
than passing quietly — a stacking check with no rules has verified arithmetic
and nothing about stacking, and should say so.

**This is the open question for you:** which promo codes are currently live, and
which are meant to combine? One line per rule and each becomes an assertion.

---

## 5. Why the check is trusted

```
npm run test:top-products-detection
```

Runs the audit against a healthy fixture and a broken one. The healthy run must
report nothing; the broken one must catch all nine planted defects by name —
one per requirement in the brief, so no requirement is claimed without having
been watched to fail:

```
  clean profile   no findings                                  OK

  caught          sold_out                   seed-sold-out
  caught          add_to_cart_failed         seed-cart-broken
  caught          price_zero                 seed-price-zero
  caught          description_missing        seed-no-description
  caught          image_broken               seed-broken-image
  caught          specifications_missing     seed-no-specs
  caught          variant_broken             seed-variant-broken
  caught          title_mismatch             seed-wrong-product
  caught          cart_math_wrong            (cart)

  planted 9 | caught 9 | clean-run findings 0
```

CI runs this **before** the daily check and stops the job if it fails. A daily
result from a check that has quietly stopped working is worse than no result.

### Vacuity guards

Three ways this check could go green having verified nothing, all closed:

- **An unmatched selector is never a pass.** Every observed field is optional,
  and an absent one produces a `harness` finding naming what was not seen.
  Harness findings are excluded from what is routed to the business — they are
  our failures, not store defects — but they still fail the run with exit 2.
- **Without a title, nothing else is judged.** If the product's identity cannot
  be confirmed, any other finding would describe an unknown page.
- **A dead network is one problem, not ten.** When no page loads, the
  per-product failures collapse into a single harness line, so a run that
  verified nothing cannot be read as a list of store defects.

---

## 6. Has it run against mykitsch.com?

**No.** Both the resolver and the audit were attempted and both failed at the
network:

```
resolver:  HTTP 403 from https://www.mykitsch.com/search/suggest.json?q=...
audit:     FAIL 0  Self-Draining Soap Dish
           harness: not one of 2 product pages loaded
```

That is this sandbox's egress policy, not a property of an ordinary machine —
see [`LIVE-RUN.md`](LIVE-RUN.md). From a normal computer, or from the CI job in
`daily-top-products.yml`, both will reach the site.

Expect selector mapping to be the first real hurdle. The `selectors:` block in
`config/top-products.yaml` leads with `data-testid` attributes the live theme
almost certainly does not carry, followed by plausible theme classes. Anything
that misses reports as `not_observed` (harness) — never as a product defect,
and never as a pass.

---

## 7. Getting the daily run started

1. **Resolve the eight handles** — `npm run resolve:handles`, then confirm the
   ambiguous ones by hand. Until then the daily report covers 2 of 10.
2. **Map the selectors** to the live theme, guided by the `not_observed`
   findings from the first run.
3. **Supply the discount rules** (§4), or accept that stacking is unverified
   and the report will keep saying so.
4. **Enable the workflow.** It is scheduled for 06:15 UTC daily and needs
   `contents: write` to commit each morning's report to `docs/daily/`.

Steps 1 and 2 are what stand between "the check exists" and "the daily report
means something".
