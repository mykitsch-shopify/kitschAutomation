# Compare-at price removal — audit

Validates the compare-at clearing import against the live storefront: the
struck-through "was" price must be gone, and the real price must be untouched.

Inputs, both in `data/compare-at/`:

| File | What it is |
|---|---|
| `removal-import.csv` | The Shopify import. 570 rows, `Variant Compare At Price` blank on every one |
| `rollback-values.csv` | The pre-change snapshot. 563 rows of `handle, status, sku, live_price, live_compare_at` |

---

## 1. Run it

```bash
# Sheet integrity only — no browser, no network, instant
npm run audit:compare-at -- \
  --import data/compare-at/removal-import.csv \
  --rollback data/compare-at/rollback-values.csv \
  --sheets-only

# Against the live storefront
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:compare-at -- \
  --import data/compare-at/removal-import.csv \
  --rollback data/compare-at/rollback-values.csv

# Just the three products whose strikethrough was actually visible
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:compare-at -- \
  --import data/compare-at/removal-import.csv \
  --rollback data/compare-at/rollback-values.csv \
  --only-visible
```

Reports land in `compare-at-report/report.md` and `.json`. Exit codes: `0`
clean, `1` findings to act on, `2` could not run.

---

## 2. The thing to understand before reading a report

**Shopify only renders a compare-at price when it is strictly greater than the
price.** Of the 563 rows with a recorded value, **554 have compare-at equal to
the price**. Those show no strikethrough today, so clearing them changes
nothing a customer can see — and a green result on them cannot confirm the
import worked, because they looked the same before it ran.

Nine rows had `compare_at > price`, and **six of those are DRAFT** — not on the
public storefront at all. So the removal is observable on the live site for
exactly **three products**:

| Handle | Price | Was |
|---|---|---|
| `recycled-plastic-medium-rhinestone-cloud-claw-clip-camel` | $7.00 | $10.00 |
| `volumizing-thermal-round-brush` | $49.99 | $79.99 |
| `kitsch-large-thermal-round-brush-haze-blue` | $49.99 | $79.99 |

`--only-visible` checks just these. They are the evidence; the other 509
published rows are a regression sweep confirming nothing *else* moved.

The remaining 554 are still worth checking, for one reason: if the theme ever
renders a compare-at equal to the price, that is a real defect showing
customers a £0 discount. The audit would catch it.

---

## 3. What it checks

**Sheet integrity** — no network needed, runs on every invocation:

| Finding | Severity | Meaning |
|---|---|---|
| `rollback_record_missing` | major | Being changed with no recorded old value. Not revertible |
| `sheet_disagreement` | major | The two sheets disagree on price or SKU for the same handle |
| `import_carries_compare_at` | major | A "removal" row that still sets a value removes nothing |
| `duplicate_handle` | major | Same handle twice; which row wins is undefined |
| `missing_sku` | minor | Shopify falls back to matching on handle plus option values |

**Storefront** — per product:

| Finding | Severity | Meaning |
|---|---|---|
| `compare_at_still_rendered` | critical | Strikethrough still on the page. The removal did not take, and customers see a discount claim that no longer exists |
| `price_mismatch` | critical | Live price is not the sheet's price. The import was meant to leave price alone; this is worse than the bug it fixed |
| `product_unreachable` | major | A published product did not load |
| `price_not_observed` | **harness** | The page loaded but no price could be read. Our failure, not the store's |

---

## 4. Findings on the sheets as supplied

`--sheets-only` reports **7 major, 1 minor**, and these are facts about the
CSVs, independent of the storefront:

**Seven products are being changed with no rollback record** — they are in the
import and absent from the rollback sheet, so their previous compare-at values
exist nowhere and those rows cannot be put back:

```
satin-pillowcase-blush
satin-pillowcase-champagne-butterfly
satin-pillowcase-ivory
satin-pillowcase-leopard
satin-pillowcase-silver
wonder-woman-x-kitsch-satin-pillowcase-believe-in-wonder
wonder-woman-x-kitsch-satin-pillowcase-comic-print
```

That is the finding worth acting on before the import runs, not after. All
seven are ACTIVE pillowcases at $29 or $24. Capturing their current compare-at
values into the rollback sheet is a two-minute job beforehand and an
unrecoverable gap afterwards.

**One import row has no SKU** — `coconut-oil-deep-moisturizing-solid-conditioner-bar`.
Shopify will match it on handle plus option values, which works here because
the row is `Title / Default Title`, but it is worth a glance.

Where the sheets *do* overlap they agree completely: **0 price disagreements
and 0 SKU disagreements across all 563 shared handles.**

---

## 5. Has it run against mykitsch.com?

**No.** Attempted, and it failed at the network:

```
critical 0 | major 7 | minor 1 | harness 1
harness: not one of 3 pages loaded from https://www.mykitsch.com, so nothing
about the storefront was verified.
```

That is the sandbox this repository was authored in, which denies general web
access by policy — not a property of an ordinary machine. See
[`LIVE-RUN.md`](LIVE-RUN.md). Run the same command from a normal computer and
it will reach the site.

Two things to expect on that first live run:

1. **Selector mapping.** The audit reads prices using `pdp_price` and
   `pdp_compare_at` from `config/kits.yaml`. Those lead with `data-testid`
   attributes the live theme almost certainly does not carry, followed by
   plausible theme classes. If they miss, every product reports
   `price_not_observed` — harness, not a store defect, and deliberately not
   counted as a pass. Map them and re-run.
2. **A near-instant sanity check.** `--only-visible` hits three pages. If those
   three come back clean, the visible part of the removal worked.

---

## 6. Why the check is trusted

`npm run test:compare-at-detection` runs the audit twice against a local
fixture — once with the removal applied correctly, once with it half-failed —
and asserts the clean profile reports nothing while each of five planted
defects is caught by name:

```
  clean profile   no storefront findings                      OK
  caught          compare_at_still_rendered    volumizing-thermal-round-brush
  caught          compare_at_still_rendered    kitsch-large-thermal-round-brush-haze-blue
  caught          price_mismatch               recycled-plastic-medium-rhinestone-cloud-claw-clip-camel
  caught          compare_at_still_rendered    black-flat-cloud-clip-large
  caught          price_not_observed           satin-pillowcase-ivory
  planted 5 | caught 5 | clean-run findings 0
```

Both directions are needed. A check that only ever passes proves nothing, and
"no strikethrough found" is exactly what a broken check reports too.

Three false-green traps are closed by construction, each of which was
observed before it was fixed:

- **An empty compare-at element is not a strikethrough.** Themes leave the
  element in the DOM as a placeholder; treating its presence as a finding
  would make every clean product a critical.
- **An unreadable price is never a pass.** If the selector matches nothing the
  audit says so as a harness finding, because silence is indistinguishable
  from success.
- **A dead network is one problem, not N.** When no page loads at all the
  per-product failures collapse into a single harness line. Before that, a
  run which verified nothing announced "10 findings to act on" and pointed at
  three products that were probably fine.

---

## 7. After a rollback

The rollback sheet restores `live_compare_at`. Re-running the audit then
reports `compare_at_still_rendered` on the three visible products — correctly,
because the strikethrough is back by design. The audit tests one direction:
that compare-at is gone. It is not a general price-parity check, and a green
run after a deliberate rollback would mean the rollback failed.
