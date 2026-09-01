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

To map them, let the discovery script fill the cart itself:

```bash
node scratch-report/discover.mjs --add https://www.mykitsch.com/products/winter-welcome-kit-combos
```

It loads the PDP, presses add-to-cart, goes to the cart and prints each role
with paste-ready selectors. Pointing it at a bare `/cart` almost always finds
an empty cart — and an empty cart is the trap: probed directly it offered the
payment-icon strip and the announcement bar as candidates for `cart_line` and
reported "no subtotal found", which reads as a fact about the theme and is a
fact about an empty page. The script now detects that and refuses to guess.

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
selectors are externalised. None of it is evidence about mykitsch.com.

For that, see §5 — the suite **has** since been run against the live store,
from a laptop outside this environment.

---

## 5. The live run, and what it actually found

Run from a Windows laptop against `https://www.mykitsch.com`, which retires
§1 entirely: the network was never the blocker on a normal machine.

The first full live run reported **231 failures**, the second **136**. Neither
number is a count of defects, and that is the whole point of this section: a
report is only as good as its ability to tell a broken store from a blind
harness. Sorted by what each failure was actually about:

### 5.1 Real findings

Counts below are from the run of 1 September against the fixed harness —
**40 failed, 50 skipped, 125 passed**, down from 136 failures when most of the
red was the harness itself.

| What | Where | Evidence |
|---|---|---|
| English nav labels render in FR/DE/IT/ES | `nav.hair`, `nav.sleep`, `nav.shower`, `nav.best_sellers`, `nav.sale`, `nav.account` | 20 failures, four locales, every browsable route |
| `footer.heading_shop` renders "Shop" in FR, IT and ES | footer | Exempt in DE only (cognate); a real gap in the other three |
| The launch product redirects out of every non-English market | `/{fr,de,it,es}/products/self-draining-soap-dish-1` → `/products/…` | 4 failures. **Not a locale defect** — see below |

**The nav finding is the substantive one**, and it is the check that most
deserves trust. Per route it is between two and six labels; the PDP carries the
most because it renders the fullest navigation. Worked example, French:

| Key | Renders | Contracted |
|---|---|---|
| `nav.hair` | "Hair" | "Cheveux" |
| `nav.sleep` | "Sleep" | "Sommeil" |
| `nav.shower` | "Shower" | "Douche" |
| `nav.best_sellers` | "Best Sellers" | "Meilleures ventes" |
| `nav.sale` | "Sale" | "Soldes" |
| `nav.account` | "Account" | "Compte" |
| `footer.heading_shop` | "Shop" | "Boutique" |

The exemptions are working, which is worth noting because it is the check on
the check: `nav.account` is absent from the Italian list (declared a cognate)
and `footer.heading_shop` is absent from the German one, both per
`config/i18n.yaml`.

**The PDP redirect is not the locale defect it looks like.** All four target
locales redirect `/products/self-draining-soap-dish-1` back to the English
path — but `/fr/`, `/fr/collections/all`, `/fr/cart` and `/fr/pages/about` all
kept their prefix and passed, in every locale. Locale routing works. **This one
product is not published to those markets**, which is a merchandising question
for whoever owns the catalogue, not a translation one. Reporting it as "the
French locale is broken" would send it to the wrong team, so the assertion now
says so and names both possibilities.

It also means the PDP row of the locale suite is not being exercised in any
non-English market: set `KITSCH_LAUNCH_HANDLE` to a product actually sold in
FR/DE/IT/ES to get coverage there.

Why the nav scan is the one to trust: it is negative-only. It asks whether an
English string the store itself uses is showing on a page requested in another
language, which needs no contracted translation to be meaningful.
`showsEnglish` matches on letter boundaries, so "Hair" cannot match inside
another word.

**A meta finding reported here earlier is withdrawn, and the reason matters more than the finding.**
It was reported here as confirmed on the strength of eight failures. Reading
one of them properly shows what it actually asserts:

```
Error: meta title is not the fr copy
+   "meta.home_title: expected \"Kitsch | Accessoires cheveux et essentiels beauté en satin\""
```

That expected string is the **fixture's invented French title**. The assertion
compares the live title against a catalogue describing a different store, and
it never prints what the live title actually was — so it cannot separate "the
meta title is English" from "the meta title is good French that differs from
ours". Eight failures, and not one of them is evidence either way.

This is the same defect as the thirty "missing its {locale} copy" failures in
§5.2, in a block I did not initially recognise as the same shape. The
provenance guard now covers it: the meta specs decline off-fixture rather than
comparing. Whether mykitsch.com localizes its meta tags is **unverified**, and
answering it needs a catalogue pulled from the store.

### 5.2 Harness problems that were being reported as store defects

Each of these was fixed rather than muted, and each fix is a check that says
more than it did before, not less:

- **27 × "fits the mobile viewport".** The overflow test asserted the site
  header was visible before measuring. That was a proxy for "the page
  rendered", not part of the measurement, and it borrowed a `site_header`
  selector that matches nothing on this theme. It now proves the page rendered
  by requiring painted text — which no theme owns, and which closes the hole
  the header assertion existed for: a blank page has no horizontal overflow
  and would otherwise pass.
- **30 × "missing its {locale} copy".** The baseline is the fixture's
  catalogue; the live footer does not say *"Join the list"* because that
  sentence was invented for the fixture. **Five of the thirty were against
  English**, and English cannot be missing its own translation — the block was
  measuring the gap between two stores. Catalogues now declare which store
  they describe, and the positive-copy specs decline rather than compare.
- **68 × HTTP 429, every one of them on `/checkout`.** Every other route in the
  same run answered 200, so this is not our request volume — it is Shopify
  refusing to open a checkout with an empty cart. `/checkout` is now tagged
  `@cart-required` and excluded from live runs.
- **4 × `price "" does not match the EUR pattern`.** `pdp_price` maps to the
  *sale* price, which exists in the markup and is empty on a product that is
  not discounted. A verdict on formatting was being issued about a string
  nobody had read; `readContainer` now refuses a matched-but-empty element.
- **`site_header` demoted to testid-only.** `header.header` and
  `#shopify-section-header header` were guesses at a Dawn-shaped theme, and
  this store is not one. `config/i18n.yaml` says not to guess theme classes
  into that block; this is what it cost.

### 5.3 What is now unverified — and unverified is not passing

Three gaps were opened deliberately, in preference to red that means nothing.
They are gaps:

| Gap | Why | To close |
|---|---|---|
| Live checkout, every locale | Not browsable with an empty cart | Seed a cart before navigating — blocked on the same bundle-builder problem as `docs/WELCOME-KIT-COVERAGE.md` |
| Positive copy on the live store — "does the French footer say the right thing?" | No collector emits a live-store catalogue | Pull one via Admin `translatableResources`, stamp it `describes: https://www.mykitsch.com`, point `KITSCH_BASELINE` at it |
| Anything read through `site_header` | Unmapped on this theme | `node scratch-report/discover.mjs https://www.mykitsch.com/` |

The English-fallback scan, price formatting, encoding integrity, hreflang and
layout overflow all still run against the live store. Those are what the
findings in §5.1 come from.
