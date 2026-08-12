# Traceability — Translations test plan → automated coverage

Maps every section of `docs/TEST-PLAN-TRANSLATIONS.md` to the check that
covers it, the layer it runs in, and its honest status.

**Layers**

| Layer | Where | What it can see |
|---|---|---|
| `content` | `i18n/run-parity.ts` — no browser | Every translatable string in the catalogue, exhaustively |
| `render` | `i18n/specs/locale-parity.spec.ts` — Playwright, 390px | Only what a DOM shows: routing, `lang`, hreflang, meta tags, price format, encoding-on-page, layout |
| `unit` | `i18n/lib/*.test.ts` | The comparators themselves |
| `manual` | — | Stays with a person, deliberately |

**Status**

- **automated** — runs, and has been watched to fail on a planted defect
- **partial** — automated for the part a machine can judge; the rest is noted
- **manual** — deliberately not automated, with a reason
- **gap** — should be automated, is not yet, has an owner

---

## Coverage

| Plan § | Requirement | Layer | Check | Status |
|---|---|---|---|---|
| §4.1 | English nav baseline | content | `auditSource` + full key comparison | automated |
| §4.2 | English footer baseline | content | `auditSource` | automated |
| §4.3 | English homepage baseline | content | `auditSource` | automated |
| §4.4 | English PDP baseline | content | `auditSource` | automated |
| §4.5 | English cart/checkout baseline | content | `auditSource` | automated |
| §5.1–5.5 | French nav / footer / home / PDP / cart / checkout | content + render | `compareCatalog`, `no untranslated strings`, `checkout translation` | automated |
| §5.6 | No untranslated strings — French | content + render | `untranslated_candidate`, English-sentinel scan | automated |
| §6.1 | German content translated | content + render | `compareCatalog` | automated |
| §6.2 | German ü ö ä ß render correctly | content + render | `encoding_error` (mojibake, U+FFFD, `?` substitution, entities) + `diacritic_absent` | automated |
| §6.3 | No untranslated strings — German | content + render | English-sentinel scan | automated |
| §7.1 | Korean content translated | content + render | `compareCatalog`, `script_missing` | automated |
| §7.2 | Korean Hangul renders, no garbling | content + render | `encoding_error`, `matchesScript(Hangul)` | automated |
| §7.3 | No untranslated strings — Korean | content + render | English-sentinel scan | automated |
| §8.1 | Japanese content translated | content + render | `compareCatalog`, `script_missing` | automated |
| §8.2 | Hiragana/katakana/kanji render, no mojibake | content + render | `encoding_error`, `matchesScript(Hiragana\|Katakana\|Han)` | automated |
| §8.3 | No untranslated strings — Japanese | content + render | English-sentinel scan | automated |
| §9.1 | Spanish content translated | content + render | `compareCatalog` | automated |
| §9.2 | Spanish á é í ó ú ñ ¿ ¡ render | content + render | `encoding_error` + `diacritic_absent` | automated |
| §9.3 | No untranslated strings — Spanish | content + render | English-sentinel scan | automated |
| §10.1 | Italian content translated | content + render | `compareCatalog` | automated |
| §10.2 | No untranslated strings — Italian | content + render | English-sentinel scan | automated |
| §11.1 | Systematic English-string scan, 6 locales × 6 surfaces | content + render | `untranslated_candidate` (every key) + per-page sentinel scan | automated |
| §11.2 | Dynamic content (banners, popups, modals) respects locale | render | Promo banner and interpolation covered; **popups and modals are not** | partial |
| §12.1 | Cross-language character test | content + render | `findEncodingDefects` over every string and every rendered page | automated |
| §12.2 | Font support for each character set | render | `matchesScript` proves the characters reach the page; it does **not** prove which font drew them | partial |
| §13.1 | Terminology consistent across page types | — | See "Known gaps" below | gap |
| §13.2 | Promotional/campaign content translated | content | `placeholder_drift` + banner key comparison | automated |
| §14.1 | Meta title translated (German) | render | `meta translation` spec, all 6 locales | automated |
| §14.2 | Meta description translated (French) | render | `meta translation` spec, all 6 locales | automated |
| §14.3 | Meta spot-check for Korean/Japanese | render | `meta translation` spec + encoding check on meta content | automated |
| §15.1 | Checkout form labels translated | render | `checkout translation` spec, all 6 locales | automated |
| §15.2 | Checkout validation errors translated | render | `checkout validation errors` spec — submits an incomplete form | automated |
| §15.3 | Order confirmation page translated | manual | Requires placing a real order. Production is read-only here, so this runs on the dev store as a manual step until §12.4 (dev-store access) is answered | manual |

---

## Known gaps, with reasons

**§13.1 — terminology consistency across pages.** The obvious implementation
is: within a locale, if the same English source maps to two different target
strings, flag it. It was written and then dropped, because on this content it
fires on `cart.checkout_cta` ("Checkout" → *Passer la commande*) versus
`checkout.heading` ("Checkout" → *Commande*) in five of six locales — a CTA
and a page heading that are *correctly* different. Scoping by `resourceType`
does not separate them; both are theme strings.

A version worth shipping needs a surface dimension the Shopify collector does
not currently carry. Phase 2 work, not a one-line addition, and shipping the
noisy version would cost more trust than the check is worth.

**§11.2 — popups and modals.** The render layer walks routes, not
interaction states. Covering a newsletter modal or a region-switcher popup
means driving it open first. Worth doing; needs the storefront team to
confirm which of these are theme-rendered versus third-party app-rendered,
since app-rendered content is out of scope per the plan.

**§12.2 — font support.** Proving *which* font drew a glyph needs
`document.fonts` interrogation plus a per-locale expected family list, and it
goes wrong the moment marketing changes a font. The current check proves the
correct characters reach the page, which catches the failure that actually
matters (garbling). Genuine font-fallback detection is Phase 5 visual-
regression material.

**Firefox.** The plan names Chrome, Firefox and Safari. The Playwright
project matrix carries mobile Safari, mobile Chrome, desktop Chrome, desktop
Safari and desktop Edge — Edge because the QA scorecard names it, Firefox not
yet because it is under 1% of this store's traffic. If the plan's Firefox
requirement is firm, it is a one-line project addition; flagging it rather
than silently reporting Firefox as covered.

**Real devices.** Emulated `mobile-safari` is WebKit on Linux. It is close to
iOS Safari and it is not iOS Safari. Only the cloud-grid job may be reported
as real-device coverage, and that job needs the device-farm budget decision
(§12.6 of the framework proposal).
