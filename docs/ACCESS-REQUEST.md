# Access request — what is blocked and what unblocks it

For whoever grants environment and store access. Written to be forwarded.

---

## 1. The issue in one paragraph

The QA automation suite is built and verified, but it has never made a single
request to mykitsch.com. Every run so far targeted a local mock storefront in
this repository. The session running the automation cannot reach the public
internet: its egress proxy answers `403 Forbidden` to the `CONNECT` for
mykitsch.com, and for every other external host tested. Until that is lifted,
the suite can prove its own logic is correct and can prove nothing about the
store — so the questions it was built to answer (do the summer and spring
welcome kits handle free items like the winter kit; are the seven locales
correctly translated) remain **unanswered**, not answered green.

---

## 2. Evidence

```
> CONNECT www.mykitsch.com:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

The 403 answers the `CONNECT`, so it comes from the egress gateway before any
TLS handshake with Shopify. Supporting facts:

| Check | Result | Rules out |
|---|---|---|
| `playwright.dev`, `example.com` | Same `ERR_TUNNEL_CONNECTION_FAILED` | Anything specific to mykitsch.com |
| `curl --noproxy '*'` | Also 403 | A direct route existing |
| DNS for `www.mykitsch.com` | Resolves to `23.227.38.74` (Shopify) | Name resolution |
| Stealth plugin, spoofed UA, headful | `navigator.webdriver=false`, identical failure | Bot detection |

The last row is worth stating plainly, because it is the natural first guess:
this is **not** Cloudflare or Shopify blocking automation. Fingerprint evasion
operates on JavaScript the site runs after it answers a request. No request
reaches the site. No browser-side configuration can change that.

Per the environment's own documentation, a 403 from this proxy should be
reported rather than retried or worked around, so no circumvention was
attempted.

---

## 3. What to grant

### A. Network egress — **the only blocker for the welcome-kit question**

| | |
|---|---|
| **What** | Allow outbound HTTPS (`CONNECT`) from the automation session/runner |
| **Hosts** | `www.mykitsch.com`, `mykitsch.com`, `cdn.shopify.com` |
| **Why those** | The storefront serves pages from the first two and images, CSS and JS from the Shopify CDN. Without the CDN host, pages render without styling and layout checks become meaningless |
| **Who grants** | The administrator who owns this Claude Code environment's configuration (egress policy is set per environment, not per session) |
| **Access level** | Read-only browsing. No credentials, no login, no writes |
| **Verify in one step** | `KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight` — prints `reachable HTTP 200` when granted |

**This alone answers the welcome-kit requirement.** The parity check browses
product pages, adds to cart and reads the order summary. It never submits
payment, never completes an order, and never signs in.

### B. Dev store — needed to go further, and preferable to production

| | |
|---|---|
| **What** | A dev/staging Shopify store with the four welcome kits and the seven markets configured |
| **Why** | Standing rule in this repo: production is read-only, including "just to reproduce". Anything that seeds data belongs on a dev store |
| **Who grants** | Shopify store admin / the dev team |
| **Then** | `export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com` |
| **Egress** | The dev store host needs the same allowlist entry as (A) |

### C. Shopify Admin API token — for the translations content layer

| | |
|---|---|
| **What** | A read-only Admin API access token |
| **Scopes** | `read_translations`, `read_products`, `read_online_store_pages` — nothing more |
| **Why** | The content layer compares every translatable string across all seven locales via `translatableResources`. That is the exhaustive check; the browser layer only sees what a page renders |
| **Who grants** | Shopify store admin |
| **Used as** | `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ADMIN_TOKEN`, injected as CI secrets, never committed |
| **Not needed** | Any write scope. The collector issues queries only, and a lint rule (`kitsch/no-write-operation`) fails the build if a GraphQL mutation ever appears in a collector |

### D. Theme selectors — a dependency, not a permission

| | |
|---|---|
| **What** | A `data-testid` set on the welcome-kit and cart templates, or someone to walk the theme markup with me once |
| **Why** | The suite's mock uses `data-testid` attributes that the live theme will not have. Without mapping, the first live run reports "selector matched nothing" rather than a real result |
| **Who** | Storefront / theme team |
| **Interim** | `config/kits.yaml` has a `selectors:` block with class-name fallbacks that can be mapped without code changes. This is a bridge — theme classes regenerate on deploy, which is why the testid set is the durable answer (framework proposal §8) |

### E. A test order — for order-confirmation coverage only

A completed test order on the dev store, its status URL passed as
`KITSCH_ORDER_STATUS_URL`. Covers WK-TC-053 and the §15.3 confirmation checks.
Lowest priority of the five.

---

## 4. What is explicitly **not** being asked for

Stated because a narrow ask is easier to approve:

- No write access to any store, production or dev
- No payment credentials, and no test that completes a purchase
- No customer data, no order data beyond a single test order
- No production Shopify admin access
- No general internet access — three named hosts is sufficient

---

## 5. Priority

| Ask | Unblocks | Priority |
|---|---|---|
| **A** — egress to the three hosts | The welcome-kit free-item question, and the render layer for all seven locales | **Blocking** |
| **D** — theme selectors | The first live run producing a real result rather than a locator error | **Blocking in practice**, immediately after A |
| **C** — read-only Admin token | The exhaustive translation comparison across every string | High |
| **B** — dev store | Everything that should not touch production | High |
| **E** — test order | Order-confirmation translation | Low |

A and D together are the difference between "the check exists" and "here is
the answer about the kits".

---

## 6. What happens once A and D are granted

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight   # confirms reach + selectors
KITSCH_BASE_URL=https://www.mykitsch.com npm run test:kits   # the actual answer
```

The result is either "all three seasonal kits handle free items exactly like
winter", or a per-dimension list naming what differs and why it matters, in a
form that can be forwarded to marketing as-is.
