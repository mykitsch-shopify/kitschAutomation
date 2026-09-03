---
name: kitsch-top-sellers
description: Daily validation of the top-10 selling products on mykitsch.com — availability, add-to-cart, title, description, images, video, pricing, specifications, variant behaviour and cart discount arithmetic. Use for "top 10", "best sellers check", "product page validation", or the product half of the daily site QA.
---

# Top-10 best sellers

The product-page half of the daily pass. Scope is `config/top-products.yaml` —
ten handles, each with the checks it must satisfy.

## Run

```bash
set "KITSCH_BASE_URL=https://www.mykitsch.com"
npm run preflight                 REM ALWAYS FIRST — see below
npm run audit:top-products
set "KITSCH_BASE_URL="
```

## Preflight first, every time

`preflight` reports, per product and per selector, how many elements matched
and what the first one reads. **A count is not a reading**, and preflight learnt
that the hard way: it printed `price 1 match(es)` and passed, while the suite
read `""` from that same element because the selector named the SALE price on a
product that was not discounted. It now reports an empty first match as a
problem in its own right.

Read its output before spending an audit. A selector that matches nothing, or
matches something blank, reports a defect that is not there.

## Known threshold issue

Two products — Self-Draining Soap Dish and Shampoo Bar Bag — have an 11-character
`specifications` block against a 40-character floor, so they report as missing
even though the selector fits. Either point `specifications` at the fuller block
or lower `min_specification_chars`. **Do not** report those two as defects
without checking the page by eye first.

## Rules

**Every selector alternative must be scoped.** A comma-separated CSS selector
is a UNION, not a fallback chain. `.price-item--regular` unscoped matched 13 and
21 elements on two PDPs by pulling in recommendation cards; a selector that
matches twenty-one things reports twenty-one defects that are not there.

**Sold out is not broken.** A sold-out product has no add-to-cart button; the
config records that with `excusedBy`.

**Handles drift between configs.** When you correct one, grep for the old value
before moving on:

```bash
grep -rn "<old-handle>" config/ fixtures/ docs/
```

## Reporting

Follow `kitsch-qa-report`.
