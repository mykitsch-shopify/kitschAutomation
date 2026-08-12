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
| `npm run test:unit` — comparator unit tests | **60 / 60 passed** |
| Content parity, clean catalogue — 378 key comparisons across 6 target locales | **gate PASS** (0 critical, 0 major, 7 minor, 0 harness) |
| Render parity, clean storefront — 167 specs, 7 locales × 5 routes | **167 / 167 passed** |
| Content parity, seeded catalogue | **gate FAIL** — 18 major, 1 harness, as intended |
| Detection control — planted defects caught | **18 / 18** |
| Detection control — render specs fail on a broken store | **78 specs failed**, as intended |

The suite passes on a correct store, fails on a broken one, and has been
watched doing both. That second half is the part that makes the first half
mean anything.

---

## 2. What the clean run reports

378 comparisons, seven minor findings, all one kind:

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

18 defects planted across all six non-English locales and every surface the
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
| §3 | fr | `footer.link_faq` | Collector could not fetch | `collector_error` | **harness** |

That last row is the one worth dwelling on. It is not reported as a client
defect and it does not fail the gate — it is our outage, and conflating it
with a translation gap is how an outage gets reported as a clean locale.

### Render-only defects

Six defects that no amount of Admin API reading would surface, planted in the
storefront rather than the catalogue. All caught:

| Defect | Locale | Spec that caught it | Failures |
|---|---|---|---|
| `hreflang` alternate missing for a declared market | ko | `locale shell` | 30 |
| `html[lang]` wrong despite the route resolving | it | `locale shell` | 5 |
| Horizontal overflow at 390px | de | `fits the mobile viewport` | 5 |
| PDP price in the wrong market convention (`$24.00` in JP) | ja | `locale price formatting` | 1 |
| Unresolved `{{ amount }}` rendered to the customer | fr | `locale shell` | — (masked, see below) |
| Literal `translation missing:` marker | es | `locale shell` | — (route not in `@smoke`) |

78 specs failed in total. Two notes on honesty here:

- The missing-`hreflang` defect fails the same spec that checks for `{{` and
  `translation missing`, and assertion order means it reports first. The `{{`
  leak is caught — it simply is not the message you see. Independent
  demonstration would need one defect per run.
- The `translation missing` marker was planted on `/pages/about`, which
  carries no `@smoke` tag and is therefore not visited by this run. It is
  caught when the untagged route is included. Left as-is rather than quietly
  retagging the route to make the demo look better.

---

## 4. What was not tested, and why

**mykitsch.com was not touched.** Two independent reasons, either sufficient:

1. It is unreachable from this environment — the egress proxy returns
   `403 CONNECT` for `mykitsch.com`.
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
at the available binary. WebKit is not installed here, so `mobile-safari` did
not run — and since ~80% of this store's traffic is mobile Safari, that is a
real coverage caveat for this run, not a footnote. The nightly matrix covers
it wherever browsers can be installed normally.

**Not covered at all:** order-confirmation translation (§15.3, needs a real
order), popups and modals (§11.2), font-family verification (§12.2), and
terminology consistency (§13.1). Each is explained in `docs/TRACEABILITY.md`
rather than being quietly marked green.

---

## 5. Deviations from the Aug-11 framework proposal

| Change | Why |
|---|---|
| 4 locales → 7 (adds es, ko, ja) | The plan requires them. The engine never assumed four, so this was a `config/i18n.yaml` edit, not a code change — which is the design working. |
| `untranslated_candidate` raised from `minor` to `major` | The plan grades an untranslated string in a non-English mode as High. Settled in config via a `severities` map rather than by forking the engine, so the disagreement is visible in one place. |
| Character-integrity checks added | Net new. The proposal's content layer never looked at bytes; the plan makes mojibake and CJK garbling High-priority. `i18n/lib/text-integrity.ts`, with a known-bad **and** known-good corpus — the false-positive half matters as much, since French `café !` carries a non-breaking space that a naive mojibake rule reports as damage. |
| Length-ratio check gained a 20-character source floor | Without it the check produced 62 findings against a *clean* catalogue, all of them nav labels like "New" → "Nouveautés" (3.3×, fits fine). Noise at that volume trains people to ignore the report. |
| Five cognate exemptions added | "Collections" in French and "Subtotal" in Spanish are correct translations that happen to equal English. Recorded per-key-per-locale with reasons, not as glossary entries — "Shop" is right in German and wrong in French. |
| `verify-detection.ts` added | Nothing in the proposal checked that the checks still fire. It is now a blocking PR step. |

---

## 6. Reproducing this run

```bash
npm ci
npx playwright install chromium

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
