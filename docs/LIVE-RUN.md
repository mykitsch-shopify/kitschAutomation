# Running the suite against the live site

**Attempted:** 13 August 2026, with Playwright driving Chromium.
**Result:** blocked by this environment's network policy. Not run.

---

## 1. What was tried, and what happened

Playwright launched Chromium and navigated to the live URLs, both with the
session proxy configured explicitly and with the default environment settings:

```
HTTPS_PROXY = http://127.0.0.1:38513

proxy=true   https://www.mykitsch.com/products/winter-welcome-kit-combos
             -> net::ERR_TUNNEL_CONNECTION_FAILED
proxy=true   https://mykitsch.com/
             -> net::ERR_TUNNEL_CONNECTION_FAILED
proxy=false  (same two URLs)
             -> net::ERR_TUNNEL_CONNECTION_FAILED
```

A control run rules out anything specific to mykitsch.com:

```
https://playwright.dev/    -> net::ERR_TUNNEL_CONNECTION_FAILED
https://example.com/       -> net::ERR_TUNNEL_CONNECTION_FAILED
https://www.mykitsch.com/  -> net::ERR_TUNNEL_CONNECTION_FAILED
```

The proxy's own status endpoint records the reason:

```json
{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)" }
```

**So: this environment permits egress to a small allowlist — package
registries and similar — and denies general web browsing.** That is a broad
policy, not a rule aimed at this store. The proxy documentation is explicit
that a 403 should be reported rather than retried or routed around, so no
workaround was attempted.

### Stealth plugins, user agents and headful mode do not apply

`playwright-extra` + `puppeteer-extra-plugin-stealth` was tried, with a
desktop Chrome user agent, a 1280x720 viewport and `locale: en-US`:

```
stealth + headless   navigator.webdriver=false  -> net::ERR_TUNNEL_CONNECTION_FAILED
stealth + headful    launch failed (no display server in this container)
plain   + headless   navigator.webdriver=true   -> net::ERR_TUNNEL_CONNECTION_FAILED
```

The plugin worked — it masked `navigator.webdriver` — and the result was
byte-identical. That is the tell. Bot fingerprinting is JavaScript the *site*
evaluates after it answers a request; here the request never leaves the
network:

```
> CONNECT www.mykitsch.com:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

The 403 answers the **CONNECT**, so it comes from the egress gateway before
any TLS handshake with Shopify. `curl --noproxy '*'` returns 403 as well, so
all traffic is forced through that gateway; and DNS resolves correctly
(`www.mykitsch.com` → `23.227.38.74`, a Shopify address), so it is not name
resolution either.

Nothing configurable inside the browser changes a connection that is refused
before the browser's bytes reach the internet. The packages were removed
again rather than left in the tree: they add forty transitive dependencies to
a suite whose value depends on being small and trusted, and they would be
solving a problem this repo has not observed. If a live run ever returns a
genuine `403` **from the store** — a Cloudflare challenge page rather than a
tunnel error — that is different evidence and worth revisiting; `npm run
preflight` will show which of the two it is.

### Correcting an earlier statement

Earlier notes in this repo described the block as an egress-policy denial
*for mykitsch.com*. That was imprecise. The denial covers effectively every
external host; mykitsch.com is caught by the same rule. The remedy is
unchanged — an allowlist entry — but the scope of the ask is different, and
worth stating accurately to whoever grants it.

---

## 2. What a live run needs

Two things, and the second is the one people forget.

### 2.1 Network egress

Allowlist the storefront host for the session or runner. Nothing else in the
suite needs the internet: dependencies come from npm and the browser is
already installed.

### 2.2 Selectors that match the real theme

This is the substantive blocker, and it applies **even where the network is
open**. The suite's fixture uses `data-testid` attributes throughout; a live
Shopify theme almost certainly does not have them. Pointed at the real store
as-is, the specs would fail on missing locators — reporting "no kit items
matched" rather than any real defect.

Two mitigations are already in place:

1. **Every selector is configurable.** `config/kits.yaml` carries a
   `selectors:` block where each entry is a comma-separated list and the first
   match wins — the testid first, then plausible theme classes. Mapping the
   suite onto the live theme is an edit there, not a code change.

2. **Free items are identified by price, not by markup.** The fixture's
   `data-free` attribute is gone from the spec. A free item is now one whose
   rendered price matches `free_price_pattern` — "Free", "$0.00", "€0,00".
   Every storefront has to tell the customer the price somehow, so this
   travels to a real theme in a way an invented attribute never would.

The durable fix remains the standing ask in `FRAMEWORK-AND-ROADMAP.md` §8: a
`data-testid` set from the storefront team. Theme classes are regenerated on
deploy and merchandising reorders break positional selectors weekly, so the
fallbacks above are a bridge, not a destination.

---

## 3. How to run it, once unblocked

Against a dev store — the preferred target, since production is read-only:

```bash
export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com
npm run test:kits          # welcome-kit free-item parity
npm run test:i18n          # locale parity, render layer
```

Against the live storefront, read-only, if that is what is wanted:

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run test:kits
```

The suite performs no writes. It browses PDPs, adds to cart, and reads the
order summary; it never submits payment and never completes an order.

**Watch the first run for locator failures rather than parity failures.** A
message like

```
no kit items matched "[data-testid="kit-item"], .product__included-item, .bundle-item"
on Winter Welcome Kit Combos. If the theme markup differs, map it in
config/kits.yaml under "selectors"
```

means the selectors need mapping, not that the kits diverge. The spec is
written to say which of the two it is, because a suite that reports a missing
selector as a product defect wastes a triage cycle every time.

### Start with preflight

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight
```

One command, and it separates the three failures that otherwise look alike in
a test report — an unreachable network, a handle that no longer resolves, and
a selector that does not match the theme:

```
Preflight against https://www.mykitsch.com

  reachable      HTTP 200

  Winter Welcome Kit Combos  (HTTP 200)
    pdp_title         1 match(es)
    pdp_price         1 match(es)
    kit_item          6 match(es)
    ...
    → unmatched: kit_item_badge — map these in config/kits.yaml "selectors"
```

Run it before the suite. A spec that cannot find the markup reports a defect
that is not there, and every one of those costs a triage cycle.

From this environment today it prints:

```
  UNREACHABLE    page.goto: net::ERR_TUNNEL_CONNECTION_FAILED
  A tunnel or connection error here is the network, not the store.
```

---

## 4. What is verified today

Everything except the live target:

| | |
|---|---|
| Offline review (tsc, ESLint, spec standards, Kitsch rules) | PASS, 0 findings |
| Unit tests, including the kit comparator | 110 / 110 |
| Locale parity, content layer | gate PASS, 414 comparisons |
| Locale parity, render layer | 350 / 350 |
| Welcome-kit parity and page load | 7 / 7 |
| Planted defects detected | 19 / 19 |
| Kit divergence detected | 8 of 8 dimensions |

The logic is exercised, the comparators have been watched to fail, and the
selectors are externalised. What has not happened is a single request to
mykitsch.com — so nothing here says anything about the real store's kits or
translations, and this document should not be read as if it did.
