# What is outstanding, and what is not

For whoever grants store access and owns where this runs. Written to be
forwarded.

---

## 0. Withdrawn: the network request

An earlier version of this document asked for outbound network access to
`www.mykitsch.com`, `mykitsch.com` and `cdn.shopify.com`. **That request is
withdrawn. Do not action it.**

It was written from inside a sandboxed authoring environment that denies
general web access by policy, and I read that denial as an organisational
one. It is not. The suite runs on an analyst's own computer, on an ordinary
internet connection, with no VPN and no corporate proxy in the path. There is
no gateway to allowlist there. `www.mykitsch.com` is a public storefront and
Playwright reaches it exactly as a browser does.

Stated plainly because the correction matters more than the original ask:
**nothing needs to be opened for the automation to reach our website.** The
evidence trail is preserved in `LIVE-RUN.md` §1 for one reason only — it
explains why every number this repository reports today is a fixture number
rather than a fact about the store.

---

## 1. The issue in one paragraph

The QA automation suite is built and verified against a local mock of the
storefront, and has never made a request to mykitsch.com. That is not because
anything blocked it — on the machine it will actually run on, nothing does.
It is because the suite reads pages using element identifiers that exist in
our mock and almost certainly do not exist in the live Shopify theme. Pointed
at the real store today, it would report "selector matched nothing" rather
than an answer. So the questions it was built to answer — do the summer and
spring welcome kits handle free items like the winter kit; are the seven
locales correctly translated — are **unanswered**, not answered green.
Closing that gap is a mapping exercise plus, for one layer of the checks, a
read-only credential.

---

## 2. What is outstanding

### A. Theme selectors — the only thing blocking a first real result

| | |
|---|---|
| **What** | Either a `data-testid` set on the welcome-kit, cart and checkout templates, or 30 minutes with someone who knows the theme markup |
| **Why** | The suite locates prices, cart lines and free-gift options by CSS selector. Our mock uses `data-testid` attributes; the live theme will use its own class names. Until they are mapped, every check reports a missing locator |
| **Who** | Storefront / theme team |
| **Not a permission** | Nothing needs approving. It is someone's time, or a small template change |
| **Interim** | `config/kits.yaml` has a `selectors:` block with class-name fallbacks that can be mapped without touching code. Theme classes regenerate on deploy, which is why the testid set is the durable answer (`FRAMEWORK-AND-ROADMAP.md` §8) — the fallbacks are a bridge |
| **How progress is measured** | `KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight` lists every selector that matched nothing. The list shrinking to empty is the definition of done |

**This alone answers the welcome-kit requirement.** The parity check browses
product pages, adds to cart and reads the order summary. It never submits
payment, never completes an order, and never signs in.

### B. Shopify Admin API token — for the exhaustive translation layer, and the one real security decision here

| | |
|---|---|
| **What** | A read-only Admin API access token |
| **Scopes** | `read_translations`, `read_products`, `read_online_store_pages` — nothing more. No write scope of any kind |
| **Why** | The browser layer only sees what a page renders. The content layer compares *every* translatable string across all seven locales via `translatableResources`; that is the check that catches a missing translation on a page nobody thought to open |
| **Who grants** | Shopify store admin |
| **Used as** | `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ADMIN_TOKEN`, never committed |
| **Enforced** | A lint rule (`kitsch/no-write-operation`) fails the build if a GraphQL mutation ever appears in a collector |

**Flagging the part that is properly an IT decision, not a QA one.** The
suite currently runs on a personal, unmanaged machine. A store API token —
even read-only — sitting in a `.env` file there is a credential outside any
device management, backup, rotation or revocation process we control. I would
rather not be the one who quietly decided that was fine.

Two ways to resolve it, and the second is better:

1. **Issue the token for local use anyway**, accepting that it is read-only,
   narrowly scoped, and revocable in one click if the machine is lost. Fastest
   path; the exposure is a read-only view of catalogue and translation text.
2. **Run the credentialed layer in CI instead** (GitHub Actions on this
   repository), with the token held as a repository secret and never present
   on any laptop. The browser layer keeps running locally for development;
   the token never leaves managed infrastructure.

Option 2 also fixes something worth fixing regardless — see §3.

### C. Dev store — preferable to production for anything that seeds data

| | |
|---|---|
| **What** | A dev/staging Shopify store with the four welcome kits and the seven markets configured |
| **Why** | Standing rule in this repository: production is read-only, including "just to reproduce". Anything that seeds data belongs on a dev store |
| **Who grants** | Shopify store admin / the dev team |
| **Then** | `export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com` |
| **Priority** | High, but not blocking — the read-only checks are safe against production as written |

### D. A test order — for order-confirmation coverage only

A completed test order on the dev store, its status URL passed as
`KITSCH_ORDER_STATUS_URL`. Covers WK-TC-053 and the §15.3 confirmation
checks. Lowest priority of the four.

---

## 3. The question underneath all of this

The suite runs on one analyst's personal computer. That is entirely fine for
building it, and it is how it got built. It is not where a pre-release gate
should live, for reasons that have nothing to do with trust:

- A check that only exists on one laptop runs when that person remembers to
  run it, and stops existing when they are on leave or change machines.
- Results reported from an unmanaged machine cannot be independently
  reproduced, so they are testimony rather than evidence.
- Any credential the checks need has to live on that machine, which is the
  problem in §2B.

The repository already carries CI workflows; they run the offline layers
today. Pointing them at the storefront is configuration, not development. The
decision I am asking for is **where this programme should run once it is
proving things about the live store** — and if the answer is CI, §2B resolves
itself and I would stop asking for a token on a laptop.

---

## 4. What is explicitly **not** being asked for

Stated because a narrow ask is easier to approve:

- No network access, allowlist entry, VPN or firewall change — see §0
- No write access to any store, production or dev
- No payment credentials, and no test that completes a purchase
- No customer data, no order data beyond a single test order
- No production Shopify admin console access

---

## 5. Priority

| Ask | Unblocks | Priority |
|---|---|---|
| **A** — theme selectors | The welcome-kit free-item answer, and the render layer for all seven locales | **Blocking** |
| **B** — read-only Admin token, and where it lives | The exhaustive translation comparison across every string | High |
| **C** — dev store | Everything that should not touch production | High |
| **D** — test order | Order-confirmation translation | Low |

Only **A** stands between "the check exists" and "here is the answer about
the kits".

---

## 6. What happens once A is done

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight   # confirms selectors resolve
KITSCH_BASE_URL=https://www.mykitsch.com npm run test:kits   # the actual answer
```

The result is either "all three seasonal kits handle free items exactly like
winter", or a per-dimension list naming what differs and why it matters, in a
form that can be forwarded to marketing as-is.
