---
name: kitsch-translation-qa
description: Translation QA for mykitsch.com across ES, DE, IT and FR — locale parity, untranslated-string detection, price and meta formatting, and closing the Asana "Translate Product" backlog from the run's own evidence. Use for "translation QA", "locale check", "i18n run", or "close the translation tasks".
---

# Translation QA

Four markets plus the English source: **ES, DE, IT, FR**. Korean and Japanese
are out — the store does not serve them, so their routes 404. They are recorded
as **unverified, not passing**.

## Run

```bash
set "KITSCH_BASE_URL=https://www.mykitsch.com"
set "KITSCH_LAUNCH_HANDLE=self-draining-soap-dish-1"
npm run test:i18n
npm run audit:translation-backlog
set "KITSCH_BASE_URL="
```

Offline, and this must be green before a live result counts as evidence:

```bash
npm run parity:clean
npm run test:detection
```

## Closing the Asana backlog

93 open "Translate Product" tasks, auto-created from a translation audit. The
backlog audit asks the live storefront whether each is still true; `asana:close`
acts on that and nothing else.

```bash
npm run asana:pull                REM needs ASANA_TOKEN
npm run audit:translation-backlog
npm run asana:close               REM DRY RUN — prints what it would close
npm run asana:close -- --confirm  REM actually closes
```

**Dry run is the default on purpose.** Closing a task notifies watchers and
moves work off a board other people plan against; undoing it is not the same as
never having done it.

It refuses four verdicts, and each refusal is the point:

| Verdict | Why it is not closed |
|---|---|
| `partial` | Some locales still English. The work is not done |
| `still_open` | Nothing has changed |
| `unverified` | We could not check. **Never the same as passed** |
| `stale_product` | The product 404s. The task outlived its subject — a real thing to resolve, and not the thing the task asked for |

It also refuses a report produced against the fixture. A fixture run says
nothing about the store, so it can never close a real task.

## Reading the results

**What is trustworthy live:** the English-fallback scan. It asks whether an
English string the store itself uses is showing on a page requested in another
language — no contracted translation needed, so it means something regardless
of baseline. `showsEnglish` matches on letter boundaries, so "Hair" cannot
match inside another word.

**What declines off-fixture:** every positive-copy assertion ("does the French
footer say the right thing?"). The baseline is the fixture's catalogue, stamped
`describes: fixture`. Comparing the live store against it reports the distance
between two catalogues as missing translations — it once produced 30 failures
including five against **English**, which cannot be missing its own
translation. Closing this gap needs a catalogue pulled from the store via the
Shopify collector, which is built but has never run.

## Current live findings

Confirmed, and these are bugs to file:

| Key | Renders | Should be (fr) |
|---|---|---|
| `nav.hair` | "Hair" | "Cheveux" |
| `nav.sleep` | "Sleep" | "Sommeil" |
| `nav.shower` | "Shower" | "Douche" |
| `nav.best_sellers` | "Best Sellers" | "Meilleures ventes" |
| `nav.sale` | "Sale" | "Soldes" |
| `nav.account` | "Account" | "Compte" |
| `footer.heading_shop` | "Shop" | "Boutique" |

Same pattern in DE, IT and ES. Exemptions are working and are the check on the
check: `nav.account` is absent from the Italian list and `footer.heading_shop`
from the German one, both declared cognates in `config/i18n.yaml`.

## Rules

**A redirect out of the locale is usually the PRODUCT, not the locale.** When
`/fr/products/x` lands on `/products/x`, check whether the other `/fr/` routes
passed. If they did, that product is not published to that market — a
merchandising fact for a different team. All four locales do this on the
current launch handle while every other `/fr/` route passes.

**`/checkout` is excluded live** (`@cart-required`): Shopify will not open a
checkout with an empty cart, and answers 429. Unverified, not passing.

**An unmapped selector is never a translation defect.** The newsletter,
language and mobile-nav controls are unmapped on this theme; they report COULD
NOT CHECK, which is the truth. Do not guess a class to clear the red.

## Reporting

Follow `kitsch-qa-report`.
