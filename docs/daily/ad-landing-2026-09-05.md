# Ad-landing daily QA — 2026-09-05

- target: https://www.mykitsch.com
- pages: 29 | BYOB: 9 | redirects: 3 | OOS pairs: 2

| severity | count |
|---|---|
| critical | 24 |
| major | 10 |
| minor | 2 |
| harness (our gaps, not store defects) | 14 |

## critical — 24

- **spring-welcome-kit-rosemary** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **spring-welcome-kit-castor-oil** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **spring-welcome-kit-coconut-oil** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **spring-welcome-kit-rice-water** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **summer-welcome-kit-rosemary** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **summer-welcome-kit-rice-water** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **summer-welcome-kit-rosemary-bar** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **summer-welcome-kit-rice-water-bar** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **summer-welcome-kit-with-shampoo-conditioner** — _Compare-at / strikethrough_ — HTTP 404 — an ad is sending paid traffic to this page.
- **summer-welcome-kit-with-shampoo-conditioner-bars** — _Compare-at / strikethrough_ — HTTP 404 — an ad is sending paid traffic to this page.
- **winter-welcome-kit-rosemary-biotin-volumizing-shampoo-conditioner-bar-combo** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **winter-welcome-kit-castor-oil-nourishing-shampoo-conditioner-bar-combo** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **winter-welcome-kit-coconut-oil-shampoo-conditioner-bar-combo-for-dry-damaged-hair** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **winter-welcome-kit-rice-water-shampoo-conditioner-bar-combo-for-hair-growth** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **hair-by-chrissy-x-kitsch-ceramic-thermal-rollers-8pc-set** — _Compare-at / strikethrough_ — sold out while carrying ad traffic
- **build-your-own-hair-routine-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-hair-perfume-duo** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-free-bottle-free-beauty-travel-case** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-soap-dish-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-shampoo-conditioner-caddy-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-shampoo-conditioner-free-caddy-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **haircare-to-go-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-bar-scent-bundle** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.
- **build-your-own-free-wet-dry-brush** — _BYOB flows_ — the builder offers 0 option(s), under the 2 minimum — the page renders but nothing can be built. Either the builder is genuinely empty, or byob_option in config/ad-landing.yaml does not match this theme; both block the daily QA and both need someone to look.

## major — 10

- **Kitsch x Hair by Chrissy Bundle** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked.  Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Travel Case Bundle** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. build-your-own-travel-case-bundle exists but is DRAFT; likely a different page. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Kojic Acid Face and Body Bar + FREE Eco-Friendly Dermaplaner** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. The plain bar and the dermaplaner exist separately; this bundle does not appear. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Top 10 Best Sellers** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. A collection page, not a product. Needs its URL. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **hair-by-chrissy-x-kitsch-ceramic-thermal-rollers-8pc-set** — _Compare-at / strikethrough_ — struck-through price $18.00 is not above the selling price $18.00, so the page shows a saving that does not exist.
- **hair-by-chrissy-x-kitsch-ceramic-thermal-rollers-8pc-set** — _Out-of-stock redirect_ — sold out and still serving its own page. Ad traffic lands somewhere it cannot buy; it should redirect to /products/ceramic-thermal-roller-variety-pack.
- **ceramic-thermal-roller-variety-pack** — _Compare-at / strikethrough_ — struck-through price $14.00 is not above the selling price $14.00, so the page shows a saving that does not exist.
- **/discount/WELCOMEKIT** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/shampoo-conditioner-bundle-with-free-welcome-kit.
- **/discount/6reasons** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/build-your-own-soap-dish-bundle.
- **/discount/FREECADDY** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/build-your-own-shampoo-conditioner-caddy-bundle.

## minor — 2

- **(config)** — _Discount non-stacking_ — fixed codes are configured but no site-wide code is, so there was nothing to attempt stacking with and non-stacking was NOT verified. Add a currently-live site-wide code to non_stacking.site_wide_codes.
- **(config)** — _Auto-ship pricing_ — no expected auto-ship discount percentage configured, so only "cheaper than one-time" was checked, not the advertised rate. Set autoship.expected_discount_percent.

## harness — 14

- **spring-welcome-kit-rosemary** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-castor-oil** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-coconut-oil** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-rice-water** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rosemary** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rice-water** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rosemary-bar** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rice-water-bar** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-rosemary-biotin-volumizing-shampoo-conditioner-bar-combo** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-castor-oil-nourishing-shampoo-conditioner-bar-combo** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-coconut-oil-shampoo-conditioner-bar-combo-for-dry-damaged-hair** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-rice-water-shampoo-conditioner-bar-combo-for-hair-growth** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **(run)** — _BYOB flows_ — byob_flow failed on 9 of 9 target(s) — every one it looked at, with the same result each time.

Read the 9 finding(s) above as ONE question rather than 9 answers. A check that fails everywhere has two explanations and this run cannot tell them apart:

  the store   something used on every one of these pages is genuinely broken, in which case this is the most urgent thing in the report;
  the harness the selector behind "byob_flow" no longer matches this theme, in which case nothing has been checked and nothing is known.

Settle it before acting on the individual findings: open one of these pages by hand and try it. One minute there decides whether this is an outage or a config edit, and every minute spent on the list above before that is spent on the wrong one.

`npm run preflight` resolves the configured selectors against the live store and reports which of them match nothing, which answers the harness half directly.
- **(run)** — _Discount redirect flows_ — discount_redirect failed on 3 of 3 target(s) — every one it looked at, with the same result each time.

Read the 3 finding(s) above as ONE question rather than 3 answers. A check that fails everywhere has two explanations and this run cannot tell them apart:

  the store   something used on every one of these pages is genuinely broken, in which case this is the most urgent thing in the report;
  the harness the selector behind "discount_redirect" no longer matches this theme, in which case nothing has been checked and nothing is known.

Settle it before acting on the individual findings: open one of these pages by hand and try it. One minute there decides whether this is an outage or a config edit, and every minute spent on the list above before that is spent on the wrong one.

`npm run preflight` resolves the configured selectors against the live store and reports which of them match nothing, which answers the harness half directly.
