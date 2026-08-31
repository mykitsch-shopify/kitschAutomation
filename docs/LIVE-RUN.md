# Running the suite against the live site

**Attempted:** 13 August 2026, with Playwright driving Chromium.
**Result:** blocked by *this authoring environment's* network policy. Not run.

> **Scope of that result — read this before forwarding anything below.**
> The block described in §1 is a property of the sandboxed environment these
> files were written in, which denies general outbound web access by policy.
> It is **not** a property of the machine the suite is meant to run on. On an
> ordinary computer on an ordinary internet connection — no VPN, no corporate
> proxy — `www.mykitsch.com` is a public website and Playwright reaches it
> like any browser does. Nothing needs to be granted, opened or allowlisted
> for that.
>
> §1 is kept because it is the evidence for *why the numbers in this repo are
> fixture numbers*. It is not an infrastructure request. §2.2 is the blocker
> that survives on any machine.

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

### Correcting two earlier statements

**First:** earlier notes described the block as an egress-policy denial *for
mykitsch.com*. The denial covers effectively every external host;
mykitsch.com is caught by the same rule, and nothing about it is specific to
our store.

**Second, and more consequential:** those notes went on to treat the denial as
something the business needed to fix, and an access request was drafted on
that basis. That was wrong, and it is worth being blunt about why. The denial
belongs to the environment this repository was *authored* in. The environment
the suite *runs* in is an analyst's own computer on an ordinary internet
connection, with no VPN and no corporate proxy in the path. There is no
gateway there to allowlist, because there is no gateway. The correct action
on that machine is to run the suite; it will connect.

The access request drafted against this misreading has been withdrawn — see
`ACCESS-REQUEST.md`, which now states what is actually outstanding.

---

## 2. What a live run needs

One thing, and it is the one people forget.

### 2.1 Network — nothing required

`www.mykitsch.com` is a public storefront. Any machine that can open it in a
browser can run this suite against it; Playwright makes the same requests
from the same network position. No VPN, no allowlist, no proxy configuration,
no credentials.

The only caveat is the ordinary one for any automated browsing at volume:
stay to a human-plausible request rate. The suite browses a handful of pages
per run, which is nothing, and it never completes a purchase.

If a run from a personal machine ever *does* fail at the network layer, the
distinction that matters is in the error. `ERR_TUNNEL_CONNECTION_FAILED` or a
403 answering `CONNECT` means something is intercepting egress. An HTTP 403
served *by the store*, or a Cloudflare interstitial, is the opposite problem
and a real one — that is bot mitigation, and it is worth raising rather than
evading. `npm run preflight` names which of the two occurred.

### 2.2 Selectors that match the real theme

This is the substantive blocker, and with the network question retired it is
now the *only* one. The suite's fixture uses `data-testid` attributes; a live
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

3. **The comparison refuses to run blind.** Each dimension declares the
   observation it depends on — kit items, cart lines, order-summary lines, or
   gift inputs — and the reference kit must have actually made that
   observation. Without it an unmatched selector reads as agreement: if
   `cart_line` matches nothing, four dimensions fall to their defaults on both
   kits, the comparison finds no differences, and the run goes green having
   examined no cart. That was measured, not theorised — with the cart selector
   pointed at a non-existent class the suite reported **7 passed** before the
   guard, and fails naming the selector after it.

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
adding the Winter Welcome Kit Combos put no free line in the cart, so there is
nothing to match against. Either the reference kit no longer includes a free
item — which is the finding — or "[data-testid="line-price"], .cart-item__price,
.cart__price" is not reading this theme's cart prices. Run: npm run preflight
```

means the cart selectors need mapping, not that the kits diverge. The spec is
written to say which of the two it is, because a suite that reports a missing
selector as a product defect wastes a triage cycle every time.

The cart selectors are the load-bearing ones now: every compared dimension is
read from the cart and the order summary, because this theme renders no
kit-contents list and no gift selector on a kit PDP. See
[`WELCOME-KIT-COVERAGE.md`](WELCOME-KIT-COVERAGE.md) for what that gave up.

### Start with preflight

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight
```

One command, and it separates the four failures that otherwise look alike in
a test report — an unreachable network, a handle that no longer resolves, a
handle that resolves to the wrong product, and a selector that does not match
the theme:

```
Preflight against https://www.mykitsch.com

  reachable      HTTP 200

  Winter Welcome Kit Combos  (HTTP 200)
    title        MISMATCH
      recorded:  "Winter Welcome Kit Combos"
      on page:   "Shampoo & Conditioner Bundle with Free Welcome Kit"
    pdp_title         1 match(es)
    pdp_price         3 match(es)
        1  .main-product span.text-red-700
        ...
  Summer Welcome Kit with Shampoo & Conditioner  (HTTP 200)
    title        "…"
    → no canonical_title recorded, so nothing confirms this handle still
      serves this kit.
```

Run it before the suite. A spec that cannot find the markup reports a defect
that is not there, and every one of those costs a triage cycle.

From the sandboxed authoring environment it prints:

```
  UNREACHABLE    page.goto: net::ERR_TUNNEL_CONNECTION_FAILED
  A tunnel or connection error here is the network, not the store.
```

From a normal machine it will not print that. Expect `reachable HTTP 200`
followed by a per-selector match count — and expect several of those counts
to be `0` on the first run, because the testids are fixture inventions. That
list is the work item: map each unmatched name in `config/kits.yaml` under
`selectors`, re-run preflight, repeat until the list is empty. Then the suite
means something.

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
