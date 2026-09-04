# Ad-landing daily QA — 2026-09-04

- target: https://www.mykitsch.com
- pages: 29 | BYOB: 9 | redirects: 3 | OOS pairs: 2

| severity | count |
|---|---|
| critical | 24 |
| major | 8 |
| minor | 2 |
| harness (our gaps, not store defects) | 30 |

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

## major — 8

- **Kitsch x Hair by Chrissy Bundle** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked.  Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Travel Case Bundle** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. build-your-own-travel-case-bundle exists but is DRAFT; likely a different page. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Kojic Acid Face and Body Bar + FREE Eco-Friendly Dermaplaner** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. The plain bar and the dermaplaner exist separately; this bundle does not appear. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **Top 10 Best Sellers** — _Scope and configuration_ — named in the daily brief but no URL is known, so it is not checked. A collection page, not a product. Needs its URL. Supply the URL — a guessed handle checks a different page and reports it healthy.
- **hair-by-chrissy-x-kitsch-ceramic-thermal-rollers-8pc-set** — _Out-of-stock redirect_ — sold out and still serving its own page. Ad traffic lands somewhere it cannot buy; it should redirect to /products/ceramic-thermal-roller-variety-pack.
- **/discount/WELCOMEKIT** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/shampoo-conditioner-bundle-with-free-welcome-kit.
- **/discount/6reasons** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/build-your-own-soap-dish-bundle.
- **/discount/FREECADDY** — _Discount redirect flows_ — landed on / rather than a product page. Expected /products/build-your-own-shampoo-conditioner-caddy-bundle.

## minor — 2

- **(config)** — _Discount non-stacking_ — fixed codes are configured but no site-wide code is, so there was nothing to attempt stacking with and non-stacking was NOT verified. Add a currently-live site-wide code to non_stacking.site_wide_codes.
- **(config)** — _Auto-ship pricing_ — no expected auto-ship discount percentage configured, so only "cheaper than one-time" was checked, not the advertised rate. Set autoship.expected_discount_percent.

## harness — 30

- **spring-welcome-kit** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **spring-welcome-kit-rosemary** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **spring-welcome-kit-rosemary** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-castor-oil** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **spring-welcome-kit-castor-oil** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-coconut-oil** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **spring-welcome-kit-coconut-oil** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **spring-welcome-kit-rice-water** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **spring-welcome-kit-rice-water** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rosemary** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **summer-welcome-kit-rosemary** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rice-water** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **summer-welcome-kit-rice-water** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rosemary-bar** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **summer-welcome-kit-rosemary-bar** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **summer-welcome-kit-rice-water-bar** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **summer-welcome-kit-rice-water-bar** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-combos** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **winter-welcome-kit-rosemary-biotin-volumizing-shampoo-conditioner-bar-combo** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **winter-welcome-kit-rosemary-biotin-volumizing-shampoo-conditioner-bar-combo** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-castor-oil-nourishing-shampoo-conditioner-bar-combo** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **winter-welcome-kit-castor-oil-nourishing-shampoo-conditioner-bar-combo** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-coconut-oil-shampoo-conditioner-bar-combo-for-dry-damaged-hair** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **winter-welcome-kit-coconut-oil-shampoo-conditioner-bar-combo-for-dry-damaged-hair** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **winter-welcome-kit-rice-water-shampoo-conditioner-bar-combo-for-hair-growth** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **winter-welcome-kit-rice-water-shampoo-conditioner-bar-combo-for-hair-growth** — _Auto-ship pricing_ — auto-ship is offered but its price could not be read
- **shampoo-conditioner-combo-with-free-welcome-kit** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **shampoo-conditioner-bundle-with-free-welcome-kit** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **hair-by-chrissy-x-kitsch-ceramic-thermal-rollers-8pc-set** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
- **ceramic-thermal-roller-variety-pack** — _Compare-at / strikethrough_ — no price element matched; nothing about this page verified
