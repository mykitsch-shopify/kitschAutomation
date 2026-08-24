# Accessibility across markets

WCAG 2.2 AA on every route in all seven locales — **plus the two failures a
generic scan cannot see.**

Contract: [`config/a11y.yaml`](../config/a11y.yaml).

---

## 1. Why a plain axe scan is not enough

axe checks a page against WCAG. It has no idea which language the page is
*meant* to be in. Two failures that only exist in a multi-market store are
therefore invisible to it, and both are severe:

**A localized page declaring the wrong language.** A German page with
`<html lang="en">` passes every axe rule there is. A screen reader then
pronounces German text with English phonemes, which does not make the page
awkward — it makes it unusable. Nothing about the page looks wrong to a
sighted tester.

**Alt text and aria-labels left in English.** Sighted customers in Japan never
notice, because they read the visible copy. A blind customer gets the alt text
and nothing else, so English alt text on a Japanese page means that customer
receives no product information at all.

Both are checked explicitly. A scan without them reports every market as
accessible while two of them are not.

---

## 2. Run it

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:a11y
npm run audit:a11y -- --locales de,ja        # one or two markets
npm run test:a11y-detection                  # prove it still catches things
```

Exit codes: `0` within budget, `1` over budget, `2` some pages were not
scanned — which is never a pass.

---

## 3. Coverage

| | |
|---|---|
| Markets | US, FR, DE, IT, ES, JP, KR |
| Routes | Home, Collection, Product, Cart |
| Standard | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` |
| Scans | 28 per run |

WCAG 2.2 AA is the honest bar because the jurisdictions we sell into converge
on it: the European Accessibility Act (FR/DE/IT/ES), Section 508 and ADA
practice (US), and JIS X 8341 (JP).

---

## 4. What it reports

| Finding | Severity | Meaning |
|---|---|---|
| `wcag_violation` | mapped from axe impact | A WCAG rule failed |
| `html_lang_mismatch` | major | The page declares a different language than it serves |
| `untranslated_alt` | major | Image descriptions identical to the source locale |
| `untranslated_aria_label` | minor | Control labels identical to the source locale |
| `locale_only_violation` | major | A rule failing in some markets and passing in others |
| `not_scanned` | harness | Our gap — the page or axe did not run |

`locale_only_violation` is the finding a per-page report cannot produce and the
one worth most. A violation present in **every** market is a theme defect. The
same violation in only two markets was introduced by *their localization* — and
the two need different people to fix them.

Every finding is rolled up per market, so a report says which countries are
affected rather than which URLs.

---

## 5. Budgets and exemptions

Criticals and majors block at zero. Minors have a budget of 25, deliberately:
a theme carries a long tail of them, and a gate nobody can ever pass is a gate
people switch off.

Every exemption requires a **reason, an owner and a review date** — enforced by
the config loader and asserted by a unit test. An exemption with no reason is
indistinguishable from a rule someone turned off because it was inconvenient.

---

## 6. Why it is trusted

```
  clean profile   no findings in any market                    OK

  caught          html_lang_mismatch         DE
  caught          untranslated_alt           JP
  caught          untranslated_aria_label    KR
  caught          wcag_violation             FR
  caught          locale_only_violation      FR

  planted 5 | caught 5 | clean-run findings 0
```

An accessibility gate that has never been watched to fail is indistinguishable
from one whose scan silently stopped running — and the second reports every
market as accessible.

The control also earned its keep immediately: its first run reported four
`untranslated_alt` findings on the *clean* profile. The rule was right and the
fixture was wrong — it served the brand-mark alt text identically in every
locale, and "Kitsch brand mark shown on the packaging" is prose a German page
should translate, not a brand name it should keep.

---

## 7. Has it run against mykitsch.com?

**No.** Blocked by this sandbox's egress policy, like every other live check —
see [`LIVE-RUN.md`](LIVE-RUN.md). From a normal machine or the CI nightly it
will run; expect selector-independent results, since axe needs no selectors of
ours. The locale rules need the `/{locale}` URL shape confirmed, which
`--locale-prefix` sets.
