# Test-case coverage — `testcasestranslations.xlsx`

Cross-verification of the 27 written test cases (22 desktop `TRD-*`, 5 mobile
`TRM-*`) across 12 scenarios (`TRS-*`) against what the suite actually asserts.

**Coverage is judged per scenario, not per case.** Several cases are the same
assertion at a different viewport, and those do not need their own scripts —
they need the same spec executed by a different Playwright project. Where a
case describes something the suite genuinely could not see, a spec was
written for it.

---

## Scenario coverage

| Scenario | Cases | Covered by | Status |
|---|---|---|---|
| TRS-001 English baseline | TRD-001, 002 | `localized content renders` (en) + `auditSource` | ✅ |
| TRS-002 French completeness | TRD-003, 004, 005, TRM-001 | `localized content renders` (fr) + `dynamic content` (mobile nav) | ✅ |
| TRS-003 German completeness | TRD-006, 007, TRM-004 | `localized content renders` (de) + `accented characters render` | ✅ |
| TRS-004 Korean completeness | TRD-008, 009, TRM-002 | `localized content renders` (ko) + `character integrity` + writing-system spec | ✅ |
| TRS-005 Japanese completeness | TRD-010, 011 | `localized content renders` (ja) + `character integrity` | ✅ |
| TRS-006 Spanish completeness | TRD-012, 013 | `localized content renders` (es) + `accented characters render` | ✅ |
| TRS-007 Italian completeness | TRD-014, 015 | `localized content renders` (it) | ✅ |
| TRS-008 No untranslated strings | TRD-016, 017, TRM-003 | `no untranslated strings` + content `untranslated_candidate` | ✅ |
| TRS-009 Special character rendering | TRD-021, TRM-004 | `character integrity` + `findEncodingDefects` over every string | ✅ |
| TRS-010 Consistency across pages | TRD-018, 022 | `localized content renders` (cart, homepage) + content `inconsistent_translation` | ✅ |
| TRS-011 Meta title/description | TRD-020 | `meta translation` | ✅ |
| TRS-012 Checkout translation | TRD-019, TRM-005 | `checkout translation` + `checkout validation errors` | ✅ |

---

## Case-by-case

| Case | What it asks | Automated by | Notes |
|---|---|---|---|
| TRD-001 | EN nav displays English | `localized content renders` — en, primary navigation | Asserts all 15 nav labels render |
| TRD-002 | EN footer displays English | `localized content renders` — en, footer | |
| TRD-003 | FR nav translated | `localized content renders` — fr, primary navigation | |
| TRD-004 | FR footer translated | `localized content renders` — fr, footer | |
| TRD-005 | FR PDP translated | `localized content renders` — fr, product page | Title, description, Add to Cart, option labels, reviews, stock |
| TRD-006 | DE nav translated | `localized content renders` — de, primary navigation | |
| TRD-007 | DE umlauts render | `accented characters render` — de | Plus `character integrity` and content-layer `diacritic_absent` |
| TRD-008 | KO nav translated | `localized content renders` — ko + `script_missing` | |
| TRD-009 | KO renders without garbling | `character integrity` — ko × 6 routes | Plus the Hangul writing-system spec |
| TRD-010 | JA nav translated | `localized content renders` — ja | |
| TRD-011 | JA renders without mojibake | `character integrity` — ja × 6 routes | |
| TRD-012 | ES nav translated | `localized content renders` — es | |
| TRD-013 | ES accents render (á é í ó ú ñ ¿ ¡) | `accented characters render` — es | |
| TRD-014 | IT nav translated | `localized content renders` — it | |
| TRD-015 | IT footer translated | `localized content renders` — it, footer | |
| TRD-016 | No English in FR mode | `no untranslated strings` — fr × 6 routes | |
| TRD-017 | No English in KO mode | `no untranslated strings` — ko × 6 routes | |
| TRD-018 | FR cart translated | `localized content renders` — fr, cart | |
| TRD-019 | FR checkout translated | `checkout translation` + `checkout validation errors` | Submits an incomplete form for the error path |
| TRD-020 | DE meta title | `meta translation` — all 6 locales, home + PDP | Case asks for DE only; the spec covers all six |
| TRD-021 | Special chars, all 7 languages | `character integrity` — 7 locales × 6 routes | The parameterised sweep *is* this case |
| TRD-022 | ES homepage translated | `localized content renders` — es, homepage | |
| TRM-001 | FR mobile nav behind hamburger | `dynamic content` — mobile nav | Opens the menu; the desktop nav can be correct while this one is not |
| TRM-002 | KO renders on mobile | `character integrity` + writing-system spec, `i18n-mobile` @390px | Same assertion, mobile project |
| TRM-003 | No English on mobile, JA | `no untranslated strings` @390px | Same assertion, mobile project |
| TRM-004 | DE umlauts on mobile | `accented characters render` @390px | Same assertion, mobile project |
| TRM-005 | ES checkout on mobile | `checkout translation` @390px | Same assertion, mobile project |

---

## What the cross-check found

The spreadsheet exposed one substantive hole. The suite's "no untranslated
strings" scan is **negative-only**: it proves English is *absent*, never that
the correct copy is *present*. Thirteen cases — TRD-001 through TRD-006,
TRD-008, TRD-010, TRD-012, TRD-014, TRD-015, TRD-018, TRD-022 — ask the
opposite question ("do the French nav items display?"), and nothing in the
suite answered it.

A page that dropped its navigation entirely, or served German copy on the
French route, passed every check that existed. `localized content renders`
was written for exactly that: for each locale and surface, every contracted
string must appear on the page, with interpolated strings matched on their
literal fragments.

Two smaller gaps came from the same reading:

- **TRM-001** — the mobile nav lives behind a hamburger. The suite walked
  routes but never opened it, and a theme renders the mobile menu from a
  different fragment than the desktop nav, so one can be translated while the
  other is not. Now opened and asserted, along with the mega-menu labels the
  plan names in §2.
- **TRD-007, TRD-013, TRM-004** — umlauts and Spanish accents were checked in
  the *catalogue*, not on the *rendered page*. A template or transport can
  strip them after the API says they are fine.

---

## Platform coverage

The five `TRM-*` cases are not separate scripts. `i18n-mobile` runs the whole
locale suite at 390×844, which is the mobile column; the nightly
`desktop-chrome` / `desktop-safari` / `desktop-firefox` / `desktop-edge`
projects run the same specs for the desktop column. Writing mobile-specific
duplicates would double the maintenance for no additional assertion — the one
genuinely mobile-only behaviour, the hamburger menu, does have its own spec.

The caveat from `docs/RUN-REPORT-2026-08-12.md` still applies: WebKit and
Firefox binaries cannot be downloaded in this environment, so the executed
runs are Chromium only.

---

## Fields the spreadsheet leaves for a human

`Actual Result` and `Status` are unfilled in the source workbook, and this
suite does not write them back. Automated runs report through the Playwright
HTML/JUnit reports and `i18n-report/parity.json`, which is the record that
CI, the scorecard and the escalation path already consume. Copying results
into a spreadsheet by hand would create a second source of truth that goes
stale the first time it is skipped.
