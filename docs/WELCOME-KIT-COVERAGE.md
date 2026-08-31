# Welcome Kit — requirement and test-case coverage

Sources: `testcaseswelcomekit.xlsx` (57 cases, 13 scenarios) and
`Welcome_Kit_Pages.docx` (the Welcome Kit test plan).

---

## 1. The requirement

> Make sure both summer welcome kits — and the spring welcome kit — match the
> winter welcome kit, that the free items are handled the same way. Should be
> exactly like the live winter kit.

| Role | Product | Handle |
|---|---|---|
| **Reference** | Winter Welcome Kit Combos | `winter-welcome-kit-combos` |
| Candidate | Summer Welcome Kit with Shampoo & Conditioner | `summer-welcome-kit-liquid-combos` |
| Candidate | Summer Welcome Kit with Shampoo & Conditioner Bars | `summer-welcome-kit-bar-combos` |
| Candidate | Spring Welcome Kit Combo | `shampoo-conditioner-bar-bundle-with-free-spring-welcome-kit-combo` |

Declared in [`config/kits.yaml`](../config/kits.yaml).

> **Two of these four are not called what the brief calls them.** A handle
> returning HTTP 200 was being treated as proof of identity, so nothing
> noticed. `config/kits.yaml` now records a `canonical_title` per kit, read off
> the live store by `npm run preflight` on 2026-08-31, and both preflight and
> the spec assert it — the same backstop that caught four wrong products in
> `config/top-products.yaml`.
>
> | Handle | Brief calls it | Storefront serves |
> |---|---|---|
> | `winter-welcome-kit-combos` | Winter Welcome Kit Combos | **Shampoo & Conditioner Bundle with Free Welcome Kit** |
> | `summer-welcome-kit-liquid-combos` | Summer Welcome Kit with Shampoo & Conditioner | *(same)* |
> | `summer-welcome-kit-bar-combos` | Summer Welcome Kit with Shampoo & Conditioner Bars | *(same)* |
> | `shampoo-conditioner-bar-bundle-with-free-spring-welcome-kit-combo` | Spring Welcome Kit Combo | **Spring Welcome Kit** |
>
> The winter one matters most: it is the reference every other kit is measured
> against, and the handle was kept while the product was renamed. Worth putting
> to marketing — is this still the kit the comparison should be anchored to?
> If it is not, all three seasonal kits are wrong in the same direction and the
> check will not say so.

### Why this is built as a comparison, not a checklist

"Should be exactly like the live winter kit" is a *differential* requirement.
Nothing in the automation declares how a free item ought to behave — the live
winter kit defines that, and the seasonal kits are measured against whatever
it does.

That matters for maintenance: when marketing changes the winter kit, the
reference moves and the comparison moves with it. A checklist of expected
values would go stale on that same day and start reporting the *reference* as
the defect.

### The seven dimensions of "handled the same way"

Each is drawn from the test plan and maps to at least one written test case.
All seven are read from the **cart** and the **order summary** — see the note
below on why none are read from the product page.

| Dimension | Test plan | Cases |
|---|---|---|
| `free_line_count` | §8 — "Free Welcome Kit is included in order at $0"; zero is the auto-add failing | WK-TC-017, 021 |
| `paid_line_count` | Read beside the above: free down and paid up means the gift is being charged, not missing | WK-TC-018, 022 |
| `free_line_price_label` | §12 — "no MSRP leakage: free items never show a non-zero price" | WK-TC-018, 022 |
| `counted_in_subtotal` | §8 — "never charged at any point" | WK-TC-018, 022 |
| `independently_removable` | §7 — "free gift cannot be removed or charged separately" | — |
| `removed_with_qualifying_product` | §8 negative cases | WK-TC-025, 026 |
| `free_at_checkout` | §10 — "free items remain at $0 in order summary" | WK-TC-019, 023, 050 |

### Why nothing is read from the product page

There used to be ten dimensions. Four read the PDP — a kit-contents list with
per-item prices and badges, and a free-gift selector — and they are gone,
because **mykitsch.com does not render any of it**. A discovery run against
`/products/winter-welcome-kit-combos` found that every repeating structure
inside `.main-product` is the image gallery: 32 zoom buttons, 16 icons, 8
slides, 8 media wrappers. There is no contents list and no gift selector, and
no selector anybody could write would change that.

The temptation is to leave the dimensions in place and let them find nothing.
That is the worst available outcome: an unobservable dimension does not fail,
it falls to the same default on both kits, they agree, and the run reports
parity having examined nothing. So they were removed.

**Given up with them**, stated plainly rather than quietly dropped:

| Lost | Was |
|---|---|
| §12 MSRP leakage *on the PDP* | `free_item_price_label` — still checked in the **cart**, which is where a leaked price actually takes money |
| §7 free-item badge | `free_item_badge` — no equivalent markup exists |
| §7 gift-selector count and single-select | `free_gift_option_count`, `free_gift_single_select` — **WK-TC-020 and 024 are no longer automated** |

Everything about money survives, because the cart and the order summary do
render.

---

## 2. Automated

13 of 57 cases, in `web/specs/welcome-kit-parity.spec.ts`. These are the cases
the requirement is actually about.

| Case | What it asks | Covered by |
|---|---|---|
| WK-TC-002 | Winter kit page loads, title and price visible | `welcome kit pages` |
| WK-TC-005 | Correct product title on each page | `welcome kit pages` — asserted against `canonical_title`, not merely "an `<h1>` is visible" |
| WK-TC-008 | Price visible *(and matches Shopify admin — see partial)* | `welcome kit pages` — asserts a real sale price with a higher struck-through original |
| WK-TC-009 | Add to Cart button visible | `welcome kit pages` |
| WK-TC-017 | Free Welcome Kit auto-adds as $0 line item (SKU 3) | `free_line_count` + `free_line_price_label` |
| WK-TC-018 | Free Welcome Kit shows $0 in cart | `free_line_price_label` + `paid_line_count` + `counted_in_subtotal` |
| WK-TC-019 | Free Welcome Kit at $0 in order summary | `free_at_checkout` |
| WK-TC-021 | Free Welcome Kit auto-adds as $0 (SKU 4) | `free_line_count` + `free_line_price_label` |
| WK-TC-022 | Free Welcome Kit shows $0 in cart | `free_line_price_label` + `paid_line_count` + `counted_in_subtotal` |
| WK-TC-023 | Free Welcome Kit at $0 in order summary | `free_at_checkout` |
| WK-TC-025 | Remove qualifying product → free kit also removed | `removed_with_qualifying_product` |
| WK-TC-026 | Same, SKU 4 | `removed_with_qualifying_product` |
| WK-TC-050 | Free items remain $0 in order summary | `free_at_checkout` |

WK-TC-020 and 024 (four gift options, one selectable at a time) **were** here
and are not any more — the theme has no gift selector to read. See "Why
nothing is read from the product page" above.

**A note on case-to-product mapping.** The written cases predate the seasonal
kits and name SKU 3 / SKU 4 (`shampoo-conditioner-combo-with-free-welcome-kit`
and `…-bundle-…`). The automation asserts the same *behaviours* against the
four kits the requirement names. If you also want the original SKU 3 and 4
covered, add them to `config/kits.yaml` as candidates — no code change.

---

## 3. Partial

| Case | Automated part | Not automated |
|---|---|---|
| WK-TC-008 | Sale price is present and lower than the struck-through original | "matches Shopify admin" — needs the Admin API, and the collector for it is not built |
| WK-TC-010 | Layout stability is covered for locale pages by the 390px overflow spec | Not yet applied to the kit PDPs |

---

## 4. Not automated, with reasons

**Needs a discount engine and a real checkout** — WK-TC-030, 031, 032 (Spring20),
WK-TC-051, 054, 057 (promo interaction). The fixture models cart and order
summary but not discount codes. WK-TC-057 in particular ("promo code does not
remove the free kit") is squarely about free-item handling and is the first
thing worth adding once a dev store with the real promo is available.

**Needs cart-threshold logic** — WK-TC-033, 034, 035 (the $35 Rosemary &
Biotin sampler), WK-TC-039, 040 (free shipping at $35), WK-TC-055, 056. Note
WK-TC-056 — "free kit $0 value does not count toward the $35 sampler
threshold" — is a genuine free-item interaction and belongs in this suite when
the threshold behaviour can be exercised.

**Needs real variant data** — WK-TC-011 to 016 (variant selection, out-of-stock
blocking, default variants). Asserting these against a fixture would test the
fixture. They need the dev store.

**Needs a subscription app** — WK-TC-041, 042, 043 (auto-ship toggle and the
$22.40 price).

**Broader cart behaviour, beyond this requirement** — WK-TC-044 to 049, 052.
Automatable, and reasonable Phase 1 web-spec work; not built here because the
requirement is specifically free-item parity.

**Manual by nature** — WK-TC-053 (complete a test order), Afterpay display
(test plan §11), and order-confirmation email. No test writes an order against
production; these belong on the dev store with a human.

**Not in scope per the plan itself** — BYOB bundle builder, subscription
management, unrelated PDPs.

---

## 5. How to run

```bash
npm run test:kits            # parity + page load, all four kits
npm run test:kits-detection  # the control — proves the comparison can fail
npm run verify               # the whole gate, both of the above included
```

`test:kits-detection` seeds **one** defect at a time and asserts the run fails
and names the dimension that defect moves. One at a time matters: stacked
defects mask each other — a leaked price stops the gift line being a free
line, and both dimensions read off free lines then go silent behind it. A
control that only checked "the suite went red" would call that a pass while
two dimensions were dead.

Against a real store:

```bash
export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com
npm run test:kits
```

The spec fails loudly if a handle does not resolve, rather than skipping — a
kit that 404s is a bigger problem than a kit that differs.

---

## 6. Status against the requirement

**The automation is built, tested and passing against a fixture. It has not
been run against mykitsch.com.** The live run attempt recorded in
[`LIVE-RUN.md`](LIVE-RUN.md) failed inside the sandboxed authoring
environment, which denies general web browsing by policy. That is not a
constraint on the machine this suite runs on: mykitsch.com is a public
storefront and an ordinary computer reaches it without a VPN, an allowlist or
any other grant.

`npm run preflight` against mykitsch.com is **clean**: four handles resolve,
four titles confirmed against `canonical_title`, and `pdp_title`,
`pdp_compare_at` and `add_to_cart` each match exactly one element. The page-load
half of the suite (WK-TC-002, 005, 008, 009) passes against the live store.

One prerequisite remains: **the cart selectors are unmapped.** `cart_line`,
`cart_line_price`, `cart_line_remove` and `cart_subtotal` in `config/kits.yaml`
still carry guesses, and every compared dimension now reads through them, so
they are the load-bearing ones. Map them with:

```bash
node scratch-report/discover.mjs --add https://www.mykitsch.com/products/winter-welcome-kit-combos
```

Until they are mapped the spec fails on the reference kit naming the selector,
rather than reporting parity. That is the intended behaviour — it will not
report agreement it did not observe.

### The add-to-cart click may not add anything

`add_to_cart` on a kit PDP is `.bundle-buy-button`, a DIV. Pressed against
mykitsch.com on 2026-08-31 it **opened a drawer**, and `/cart` was empty
afterwards.

Stated precisely, because the distinction matters: what was observed is that
the cart page rendered no lines. That is consistent with nothing having been
added, and also with the cart selectors not fitting — the two are
indistinguishable from the DOM alone, which is the whole failure this suite
exists to avoid. `scratch-report/discover.mjs` now reads `/cart.js`, the
store's own JSON cart, so the next run says which it is:

| `/cart.js` | DOM lines | Verdict |
|---|---|---|
| `item_count: 0` | — | Nothing was added. A product or flow problem; no selector fixes it. |
| `item_count: >0` | none found | Everything was added and the cart selectors do not fit. A mapping problem. |

If it is the first, the parity spec's model — press add, read the cart — does
not hold for these products, and the suite needs the builder flow driven
before a cart exists to compare. That is a design change, not a config edit,
and it is the next decision to make about this suite.

Until that run happens, **this document cannot tell you whether the summer and
spring kits currently match winter.** It tells you the check exists, covers
seven dimensions of free-item handling, and — through
`npm run test:kits-detection` — has been watched to catch every one of the
five defects the fixture can seed, each seeded alone so none could hide behind
another.

### For the marketing follow-up

When the check runs against the store, a divergence is reported per dimension
in a form that can be forwarded as-is, for example:

```
free_at_checkout: Winter Welcome Kit Combos shows "true",
Summer Welcome Kit with Shampoo & Conditioner Bars shows "false" —
The free item is $0 in one kit and not the other by the time the customer
reaches the order summary — the last place anyone looks and the only one that
takes money. Test plan §10.
```

Two questions worth putting to marketing regardless of the result:

1. **Is Winter Welcome Kit Combos the intended reference?** Everything is
   measured against it, so if it is wrong, all three seasonal kits are wrong in
   the same direction and the check will not say so.
2. **Are any differences intentional?** A deliberate seasonal variation
   belongs in `config/kits.yaml` as a narrowed `compare` list with a written
   reason — not as a silently ignored failure.
