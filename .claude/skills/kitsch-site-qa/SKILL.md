---
name: kitsch-site-qa
description: Daily site QA on mykitsch.com — product pages, cart and checkout, UI/UX, FAQs, header, footer, banners, offers, promo codes, and visual regression. Covers Asana 1218053338721930 and its five subtasks. Use for "daily site QA", "site check", "UI QA", "FAQ/header/footer check", or "visual regression".
---

# Daily site QA

Covers Asana [1218053338721930](https://app.asana.com/0/0/1218053338721930) —
"QA Site Daily to verify no issues. All tests should be done in incognito
mode." Its five subtasks map onto the runs below.

**Do not paste the task description.** The mapping is here.

## Run

```bash
set "KITSCH_BASE_URL=https://www.mykitsch.com"
npm run audit:health-check
npm run audit:a11y
npm run visual
```

Incognito is the default: Playwright runs a fresh context per test, with no
cookies and no logged-in session.

## Subtask → coverage

| Asana subtask | Covered by | Gap |
|---|---|---|
| Product Page Validation | `audit:top-products` — see `kitsch-top-sellers` | — |
| Cart & checkout Testing | Cart yes; **checkout no** | Live checkout returns 429 with an empty cart. Unverified, not passing |
| UI/UX Testing | `npm run visual`, `npm run audit:a11y` | Only the pages in `config/visual.yaml` |
| Landing Pages Validation | `kitsch-lp-qa` | — |
| Promo Code Validation | **No** | URL entry cannot apply a code. Manual only |

## FAQs, header, footer, banners, offers

The locale suite reads the footer and the page body on every route, so
untranslated or missing footer copy surfaces there. Two live gaps:

- **`site_header` is unmapped on this theme.** Anything read through it reports
  COULD NOT CHECK. Map it from a discovery run before trusting header coverage.
- **Banners rotate on a timer** and are masked in `config/visual.yaml`. A
  banner regression is a masked blind spot by design — check it by eye.

To map the header, or the newsletter / language / mobile-nav controls that are
still unmapped:

```bash
node scratch-report/discover.mjs https://www.mykitsch.com/
```

Paste the output back and the roles get mapped in `config/i18n.yaml`.

## Visual regression — expanding it

`config/visual.yaml` currently photographs home, collection, PDP, cart and
`/de/` at two viewports. To add a page, add a `pages:` entry with a `why`, then:

```bash
npm run visual:bless      REM then READ THE DIFF
npm run visual:detection
```

Rules that keep it honest, in `docs/VISUAL-REGRESSION.md`:

- **A re-blessed baseline is worse than no baseline.** It has been taught to
  agree with whatever it sees.
- Every mask needs a written `why`; the loader refuses one without.
- **A different image SIZE is not a repaint.** Ignore the pixel ratio in that
  message — everything past the first change counts as different because it
  moved. On a grid it means the catalogue changed. Use `clip_height_px`.
- A bless followed immediately by a compare proves the store held still for
  three minutes, nothing more. Judge on the next morning's run.

## Reporting

Follow `kitsch-qa-report`.
