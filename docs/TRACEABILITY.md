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
| §11.2 | Dynamic content (banners, popups, modals) respects locale | render | `dynamic content` spec — opens the newsletter modal and language popup, then scans both for English fallbacks and encoding damage | automated |
| §12.1 | Cross-language character test | content + render | `findEncodingDefects` over every string and every rendered page | automated |
| §12.2 | Font support for each character set | render | `theme declares a font covering the script` — asserts the computed stack names a script-appropriate family and the text paints at non-zero width. Does **not** assert which font drew the glyphs | partial |
| §13.1 | Terminology consistent across page types | content | `inconsistent_translation` — same English source rendered two ways in one locale, with declared exemptions for legitimate divergences | automated |
| §13.2 | Promotional/campaign content translated | content | `placeholder_drift` + banner key comparison | automated |
| §14.1 | Meta title translated (German) | render | `meta translation` spec, all 6 locales | automated |
| §14.2 | Meta description translated (French) | render | `meta translation` spec, all 6 locales | automated |
| §14.3 | Meta spot-check for Korean/Japanese | render | `meta translation` spec + encoding check on meta content | automated |
| §15.1 | Checkout form labels translated | render | `checkout translation` spec, all 6 locales | automated |
| §15.2 | Checkout validation errors translated | render | `checkout validation errors` spec — submits an incomplete form | automated |
| §15.3 | Order confirmation page translated | render | `order confirmation` spec — localized copy, no English fallback, no encoding damage, and order-number/email interpolation bound. Needs `KITSCH_ORDER_STATUS_URL` against a real store; skips loudly without one | automated (fixture) / blocked on a test order |

---

## Known gaps, with reasons

**§12.2 — which font actually drew the glyphs.** The check asserts the theme
*declares* a family covering the locale's script, and that localized text
paints at non-zero width. It cannot assert which font the browser finally
picked, because that depends on the fonts installed on the customer's device:
a headless Linux container and an iPhone have different font sets, so any CI
assertion about the resolved family would be a green check that means nothing
about real customers. Appearance verification belongs to Phase 5 visual
regression, on real devices.

**§15.3 — order confirmation, against a real store.** The spec exists and runs
green against the fixture, covering localized copy, English fallbacks,
encoding and the order-number/email interpolation. Against a live store it
needs a real order to point at: set `KITSCH_ORDER_STATUS_URL`. Without one it
skips with that reason rather than reporting a 404 as a translation defect.
Blocked on dev-store access — framework proposal §12.4.

**§13.1 — consistency exemptions need an owner.** The check ships with one
declared exemption ("Checkout": a cart CTA and a page heading, correctly
different words in five of six locales). That list will grow, and every entry
is a judgement about copy rather than about code. It should be reviewed by
whoever owns localisation copy, on the same cadence as the do-not-translate
glossary — otherwise exemptions accumulate and the check quietly stops
covering anything.

**Third-party app content (§11.2, partial).** The modal and popup checks cover
theme-rendered overlays. Content injected by third-party apps — reviews
widgets, chat — is out of scope per the plan itself, and the suite does not
distinguish the two. If an app starts rendering customer-visible copy inside a
theme container, this check will report it and the triage answer will be "not
ours". Worth knowing before it happens.

**Firefox.** Now in the project matrix (`desktop-firefox`), nightly rather
than on the PR gate, since it is under 1% of this store's traffic. It has
**not been executed** — the Firefox binary cannot be downloaded in this
environment. The project is wired; the first green Firefox run has to happen
somewhere with normal browser installs.

**Real devices.** `playwright.grid.config.ts` now exists and the nightly job
references it. It throws at load time if `GRID_WS_ENDPOINT` is unset, rather
than silently falling back to local browsers and reporting emulated runs as
hardware runs. Still blocked on the device-farm budget decision (§12.6).
Emulated `mobile-safari` is WebKit on Linux: close to iOS Safari, and not iOS
Safari.

**WebKit and production, in this environment specifically.** Neither is a
design decision:

- `mykitsch.com` returns `403` from the egress proxy — an organization policy
  denial, confirmed against the proxy status endpoint. Not routable around,
  and the proxy documentation is explicit that it should be reported rather
  than retried.
- WebKit and Firefox binaries cannot be downloaded here, so the executed run
  is Chromium only. Since ~80% of this store's traffic is mobile Safari, that
  is the single largest caveat on the sample run.
