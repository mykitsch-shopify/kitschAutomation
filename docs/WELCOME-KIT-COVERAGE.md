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

### Why this is built as a comparison, not a checklist

"Should be exactly like the live winter kit" is a *differential* requirement.
Nothing in the automation declares how a free item ought to behave — the live
winter kit defines that, and the seasonal kits are measured against whatever
it does.

That matters for maintenance: when marketing changes the winter kit, the
reference moves and the comparison moves with it. A checklist of expected
values would go stale on that same day and start reporting the *reference* as
the defect.

### The ten dimensions of "handled the same way"

Each is drawn from the test plan and maps to at least one written test case.

| Dimension | Test plan | Cases |
|---|---|---|
| `free_item_count` | §8 | WK-TC-017, 021 |
| `free_item_price_label` | §12 — "no MSRP leakage: free items never show a non-zero price" | WK-TC-018, 022 |
| `free_item_badge` | §7 | — |
| `auto_added_to_cart` | §8 — "Free Welcome Kit is included in order at $0" | WK-TC-017, 021 |
| `counted_in_subtotal` | §8 — "never charged at any point" | WK-TC-018, 022 |
| `independently_removable` | §7 — "free gift cannot be removed or charged separately" | — |
| `removed_with_qualifying_product` | §8 negative cases | WK-TC-025, 026 |
| `free_at_checkout` | §10 — "free items remain at $0 in order summary" | WK-TC-019, 023, 050 |
| `free_gift_option_count` | §7 — four gift options | WK-TC-020, 024 |
| `free_gift_single_select` | §7 — "only one free gift can be selected at a time" | — |

---

## 2. Automated

15 of 57 cases, in `web/specs/welcome-kit-parity.spec.ts`. These are the cases
the requirement is actually about.

| Case | What it asks | Covered by |
|---|---|---|
| WK-TC-002 | Winter kit page loads, title and price visible | `welcome kit pages` |
| WK-TC-005 | Correct product title on each page | `welcome kit pages` |
| WK-TC-008 | Price visible *(and matches Shopify admin — see partial)* | `welcome kit pages` — asserts a real sale price with a higher struck-through original |
| WK-TC-009 | Add to Cart button visible | `welcome kit pages` |
| WK-TC-017 | Free Welcome Kit auto-adds as $0 line item (SKU 3) | `auto_added_to_cart` + `free_item_price_label` |
| WK-TC-018 | Free Welcome Kit shows $0 in cart | `free_item_price_label` + `counted_in_subtotal` |
| WK-TC-019 | Free Welcome Kit at $0 in order summary | `free_at_checkout` |
| WK-TC-020 | All 4 free gift options selectable | `free_gift_option_count` + `free_gift_single_select` |
| WK-TC-021 | Free Welcome Kit auto-adds as $0 (SKU 4) | `auto_added_to_cart` + `free_item_price_label` |
| WK-TC-022 | Free Welcome Kit shows $0 in cart | `free_item_price_label` + `counted_in_subtotal` |
| WK-TC-023 | Free Welcome Kit at $0 in order summary | `free_at_checkout` |
| WK-TC-024 | All 4 free gift options selectable | `free_gift_option_count` + `free_gift_single_select` |
| WK-TC-025 | Remove qualifying product → free kit also removed | `removed_with_qualifying_product` |
| WK-TC-026 | Same, SKU 4 | `removed_with_qualifying_product` |
| WK-TC-050 | Free items remain $0 in order summary | `free_at_checkout` |

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
npm run test:kits          # parity + page load, all four kits
npm run verify             # the whole gate, kits included
```

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
been run against mykitsch.com.** The store is unreachable from this
environment (egress policy returns 403 for the domain), and the standing rule
in this repo is that the harness never points at production. Pointing it at a
dev store with the four real kits is a one-line change:
`KITSCH_BASE_URL=… npm run test:kits`.

Until that run happens, **this document cannot tell you whether the summer and
spring kits currently match winter.** It tells you the check exists, covers ten
dimensions of free-item handling, and has been watched to catch a divergence in
all eight of the dimensions the seeded fixture varies.

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
