# Sample run — Translations test plan

**Date:** 12 August 2026
**Suite:** Kitsch QA automation, locale parity (content + render)
**Plan:** `docs/TEST-PLAN-TRANSLATIONS.md` — 7 locales (en, fr, de, it, es, ko, ja)
**Target:** local storefront fixture — **not** mykitsch.com (see "What was not tested")

---

## 1. Result

| Stage | Result |
|---|---|
| `npm run typecheck` (TS 6.0.3, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | clean |
| `npm run test:unit` — comparator unit tests | **63 / 63 passed** |
| Content parity, clean catalogue — 414 key comparisons across 6 target locales | **gate PASS** (0 critical, 0 major, 7 minor, 0 harness) |
| Render parity, clean storefront — 350 specs, 7 locales × 6 routes | **350 / 350 passed**, 0 skipped |
| Content parity, seeded catalogue | **gate FAIL** — 18 major, 8 minor, 1 harness, as intended |
| Detection control — planted defects caught | **19 / 19** |
| Detection control — render specs fail on a broken store | **123 specs failed**, as intended |

The suite passes on a correct store, fails on a broken one, and has been
watched doing both. That second half is the part that makes the first half
mean anything.

---

## 2. What the clean run reports

414 comparisons, seven minor findings, all one kind:

| Locale | Key | English | Target | Ratio |
|---|---|---|---|---|
| fr | `home.hero_heading` | Better hair starts here | De plus beaux cheveux commencent ici | 1.57× |
| fr | `pdp.title` | Satin Pillowcase Set | Ensemble de taies d'oreiller en satin | 1.80× |
| fr | `meta.pdp_title` | Satin Pillowcase Set \| Kitsch | Ensemble de taies d'oreiller en satin \| Kitsch | 1.55× |
| es | `home.hero_heading` | Better hair starts here | Un cabello más bonito empieza aquí | 1.48× |
| es | `pdp.title` | Satin Pillowcase Set | Juego de fundas de almohada de satén | 1.80× |
| es | `cart.shipping_note` | Shipping calculated at checkout | Los gastos de envío se calculan al finalizar la compra | 1.71× |
| es | `meta.pdp_title` | Satin Pillowcase Set \| Kitsch | Juego de fundas de almohada de satén \| Kitsch | 1.55× |

These are Romance-language expansion on headings and product titles. They are
advisory by design: the content layer cannot tell whether 1.8× breaks a
layout, so it flags and the render layer's 390px overflow spec answers. That
spec passes on all seven, so nothing here needs action — but the flags stay,
because the day one of them *does* overflow, this is the row that predicted it.

`max_minor` is set to 10 against this measured baseline of 7. A gate that
fails on a clean store gets switched off within a week.

---

## 3. What the seeded run catches

19 defects planted across all six non-English locales and every surface the
plan names. Every one was caught, by the finding kind it was planted to produce.

| Plan § | Locale | Key | Defect | Finding | Severity |
|---|---|---|---|---|---|
| §6.3 | de | `nav.accessories` | Nav item left in English | `untranslated_candidate` | major |
| §7.3 | ko | `nav.sleep` | Nav item left in English | `untranslated_candidate` | major |
| §8.3 | ja | `footer.heading_help` | Footer heading left in English | `untranslated_candidate` | major |
| §10.2 | it | `nav.sale` | Nav item left in English | `untranslated_candidate` | major |
| §5.5 | fr | `cart.subtotal` | Cart label left in English | `untranslated_candidate` | major |
| §6.2 | de | `pdp.description` | Umlauts as `Ã¤` / `Ã¼` | `encoding_error` | major |
| §8.2 | ja | `pdp.title` | Kana as `ã‚µãƒ†ãƒ³` | `encoding_error` | major |
| §7.2 | ko | `cart.subtotal` | U+FFFD replacement character | `encoding_error` | major |
| §9.2 | es | `home.hero_heading` | Accents as literal `?` | `encoding_error` | major |
| §15.2 | de | `checkout.error_required` | Validation message never registered | `missing_translation` | major |
| §5.2 | fr | `footer.newsletter_body` | Missing from translation table | `missing_translation` | major |
| §10.1 | it | `pdp.add_to_cart` | Add-to-cart button missing | `missing_translation` | major |
| §15.1 | es | `checkout.city` | Registered but blank | `empty_translation` | major |
| §13.2 | de | `home.banner_promo` | Drops `{{ amount }}` | `placeholder_drift` | major |
| §14.2 | fr | `meta.home_description` | Meta description still English | `untranslated_candidate` | major |
| §14.3 | ko | `meta.home_title` | Meta title still English | `untranslated_candidate` | major |
| §7.2 | ko | `pdp.in_stock` | Romanised Korean, no Hangul | `script_missing` | major |
| §13.1 | de | `home.section_bestsellers` | "Best sellers" is *Bestseller* in the nav, *Meistverkaufte Produkte* on the homepage | `inconsistent_translation` | minor |
| §3 | fr | `footer.link_faq` | Collector could not fetch | `collector_error` | **harness** |

That last row is the one worth dwelling on. It is not reported as a client
defect and it does not fail the gate — it is our outage, and conflating it
with a translation gap is how an outage gets reported as a clean locale.

### Render-only defects

Seven defects that no amount of Admin API reading would surface, planted in
the storefront rather than the catalogue. All caught:

| Defect | Locale | Spec that caught it | Failures |
|---|---|---|---|
| `hreflang` alternate missing for a declared market | ko | `declares hreflang alternates` | 42 |
| `html[lang]` wrong despite the route resolving | it | `resolves and applies lang` | 6 |
| Horizontal overflow at 390px | de | `fits the mobile viewport` | 6 |
| PDP price in the wrong market convention (`$24.00` in JP) | ja | `locale price formatting` | 1 |
| Unresolved `{{ amount }}` rendered to the customer | fr | `leaks no template markers` | 6 |
| Literal `translation missing:` marker | es | `leaks no template markers` | 1 |
| Modal copy ignoring the locale | it | `dynamic content` | 2 |
| Mobile nav behind the hamburger left in English | ko | `dynamic content` — mobile nav | 1 |

One failure was not planted and is worth reading twice: `horizontal overflow
in ja`. Nothing seeded a Japanese layout defect — the mojibake'd product title
is simply *longer* than the correct one, and it pushes the page past 390px.
An encoding defect surfacing as a layout defect one layer down is exactly the
cascade the two-layer split is meant to make visible.

123 specs failed in total, and each defect is now reported independently.
Two things changed to make that true:

- The `locale shell` check was one test asserting route status, `lang`,
  `hreflang` and leaked markers together. The first failing assertion hid the
  rest, so a missing `hreflang` masked a leaked `{{ amount }}` on the same
  page. It is now four separate tests.
- The render suite walked only `@smoke` routes, so `/pages/about` — where the
  `translation missing` marker was planted — was never visited. It now walks
  every declared route, and route tags travel into the test title so
  `--grep @smoke` still selects the PR subset.

Marker failures also report *which* marker leaked and the surrounding text,
rather than Playwright's default `expect(locator).not.toContainText(expected)
failed`, which left triage to go and find it.

---

## 4. What was not tested, and why

**mykitsch.com was not touched.** Two independent reasons, either sufficient:

1. It is unreachable from this environment. The egress proxy returns
   `403 CONNECT` for `mykitsch.com` — an organization egress-policy denial,
   confirmed against the proxy's own status endpoint, not a misconfiguration
   on this end. The proxy documentation is explicit that a 403 should be
   reported rather than retried or routed around.
2. The standing rule in this repo is that the harness never points at
   production, including "just to reproduce". A suite that *can* reach prod
   eventually will.

So the run targets a seven-locale storefront fixture (`fixtures/storefront/`)
that reproduces the structure the plan tests: locale routing, `hreflang`
wiring, meta tags, nav, footer, PDP, cart and a checkout with validation. It
is generated from the same content bundle as the translation catalogue, so a
defect appears in the API surface and on the page exactly as a real one would.

**What this proves:** the checks are correct, wired, and non-vacuous.
**What it does not prove:** anything about the real store's translations. That
needs the Shopify Admin token and dev-store access from §12.2 and §12.4 of the
framework proposal. `collectors/shopify-translations.ts` is written, typed and
paginating, and is the only piece between this run and a real one.

**Browsers.** This run is Chromium at 390×844. The environment ships a
Chromium build that does not match the pinned Playwright 1.62.0, and the
matching download is blocked, so the run used `KITSCH_CHROMIUM_PATH` to point
at the available binary. WebKit and Firefox binaries cannot be downloaded
here either, so `mobile-safari`, `desktop-safari` and `desktop-firefox` did
not execute. Since ~80% of this store's traffic is mobile Safari, **that is
the single largest caveat on this run** — the locale logic is verified, the
WebKit rendering of it is not. Both projects are wired and run wherever
browsers install normally.

**Still not covered:** which font ultimately drew a glyph (§12.2 — a property
of the customer's device, not the store), and order-confirmation against a
real store (§15.3 — the spec exists and passes against the fixture; a live run
needs `KITSCH_ORDER_STATUS_URL` pointing at a test order). Both are explained
in `docs/TRACEABILITY.md` rather than being quietly marked green.

---

## 5. Deviations from the Aug-11 framework proposal

| Change | Why |
|---|---|
| 4 locales → 7 (adds es, ko, ja) | The plan requires them. The engine never assumed four, so this was a `config/i18n.yaml` edit, not a code change — which is the design working. |
| `untranslated_candidate` raised from `minor` to `major` | The plan grades an untranslated string in a non-English mode as High. Settled in config via a `severities` map rather than by forking the engine, so the disagreement is visible in one place. |
| Character-integrity checks added | Net new. The proposal's content layer never looked at bytes; the plan makes mojibake and CJK garbling High-priority. `i18n/lib/text-integrity.ts`, with a known-bad **and** known-good corpus — the false-positive half matters as much, since French `café !` carries a non-breaking space that a naive mojibake rule reports as damage. |
| Length-ratio check gained a 20-character source floor | Without it the check produced 62 findings against a *clean* catalogue, all of them nav labels like "New" → "Nouveautés" (3.3×, fits fine). Noise at that volume trains people to ignore the report. |
| Five cognate exemptions added | "Collections" in French and "Subtotal" in Spanish are correct translations that happen to equal English. Recorded per-key-per-locale with reasons, not as glossary entries — "Shop" is right in German and wrong in French. |
| `verify-detection.ts` added | Nothing in the proposal checked that the checks still fire. It is now a blocking PR step — and it earned its place immediately, catching a real defect in the new §13.1 consistency check, which fired but keyed its finding on the *correct* string rather than the divergent one, making the row unactionable. |
| Terminology consistency (§13.1) added | Previously listed as a gap. Ships with a declared exemption for legitimate CTA-versus-heading divergences, which is what makes it quiet enough to keep. |
| Modal and popup coverage (§11.2) added | Overlays are hidden in the DOM, so a page-level text scan never saw them — and they are exactly where translation wiring gets missed. |
| Order confirmation (§15.3) added | Was listed as manual. Now automated, skipping loudly against a real store until a test order exists. |
| `locale shell` split into four tests; all routes walked | As one compound test, the first failing assertion hid the rest — a missing `hreflang` masked a leaked `{{ amount }}` on the same page. And `@smoke`-only route filtering meant `/pages/about` was never visited. |
| `npm run verify` fixed and aligned to CI | It crashed: with no `--catalog` the run reached for the Shopify collector and threw on a missing credential, and the quickstart in the README told people to run it. `run-parity` now refuses explicitly (exit 2, usage message) instead of stack-tracing, and refuses to fall back to fixture data — a green gate over a catalogue nobody asked about is the same false all-clear as reporting a failed fetch as a clean locale. |
| CI gained a clean-fixture render step | The `engine` job asserted the render specs *fail* against a broken store but never that they *pass* against a clean one. A spec broken badly enough to always fail would have satisfied it. Both directions are needed or neither means anything. |
| Positive translation assertions added (`localized content renders`) | Cross-checking the 27 written test cases against the suite exposed that the English-fallback scan is negative-only: it proves English is *absent*, never that the right copy is *present*. A page that dropped its navigation, or served German copy on the French route, passed everything. Thirteen of the 27 cases ask that question directly. See `docs/TEST-CASE-COVERAGE.md`. |
| Mobile nav / hamburger coverage added | TRM-001. The suite walked routes but never opened the mobile menu, which a theme renders from a different fragment than the desktop nav — one can be translated while the other is not. |
| Rendered-accent check added | TRD-007, TRD-013, TRM-004 checked umlauts and Spanish accents in the *catalogue*, not on the *rendered page*. A template or transport can strip them after the API says they are fine. |
| `desktop-firefox` project and `playwright.grid.config.ts` added | The plan names Firefox; the CI workflow already referenced a grid config that did not exist, so the real-device job would have failed on a missing file. The grid config throws if `GRID_WS_ENDPOINT` is unset rather than silently reporting emulated runs as hardware coverage. |

---

## 6. Reproducing this run

```bash
npm ci
npx playwright install chromium

npm run verify          # everything below, in the order CI runs it
```

Or step by step:

```bash
npm run typecheck
npm run test:unit

# Content layer — the manual-pass replacement
npm run i18n:parity -- --catalog fixtures/catalog/catalog-clean.json  --out i18n-report/clean --gate
npm run i18n:parity -- --catalog fixtures/catalog/catalog-seeded.json --out i18n-report/seeded

# Render layer
npm run test:i18n

# Negative control — both layers must fail on a broken store
npm run test:detection
```

Against a real store, drop `--catalog` and set `SHOPIFY_SHOP_DOMAIN` and
`SHOPIFY_ADMIN_TOKEN` (scoped `read_translations`), and set `KITSCH_BASE_URL`
to the dev store.
