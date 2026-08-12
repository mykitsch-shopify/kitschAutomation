# KitschAutomation

QA automation for the Kitsch storefront. Playwright + TypeScript, mobile-first,
with locale parity as the flagship suite.

The framework proposal and roadmap live in
[`docs/FRAMEWORK-AND-ROADMAP.md`](docs/FRAMEWORK-AND-ROADMAP.md). The suite
currently implements Phase 2 — **translation validation** — against the
Translations test plan in [`docs/TEST-PLAN-TRANSLATIONS.md`](docs/TEST-PLAN-TRANSLATIONS.md).

- Coverage mapping, including what is deliberately *not* automated:
  [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md)
- Executed sample run and its caveats:
  [`docs/RUN-REPORT-2026-08-12.md`](docs/RUN-REPORT-2026-08-12.md)

---

## Quickstart

```bash
npm ci
npx playwright install chromium

npm run verify          # the whole gate, exactly as CI runs it
```

`verify` mirrors the `engine` job in `.github/workflows/translation-gate.yml`
step for step, so "green locally, red in CI" has one less way to happen:
typecheck → unit → content parity on a clean catalogue → render parity on a
clean fixture → detection against a broken one.

Individually:

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run test:unit` | Comparator unit tests (`node --test`) |
| `npm run i18n:parity` | Content-layer parity — every string, every locale, no browser. Needs `--catalog <file>` or Shopify credentials; it will not guess |
| `npm run parity:clean` | Content parity against the bundled clean catalogue, gated |
| `npm run test:i18n` | Render-layer parity — Playwright at 390px |
| `npm run test:detection` | Negative control: both layers must fail on a broken store |
| `npm run storefront` | Serve the local storefront fixture on :4173 |

---

## The two layers

**Content layer** (`i18n/run-parity.ts`, no browser). Pulls every translatable
resource for English and compares each target locale against it. Exhaustive,
fast, cheap enough to run nightly on the full catalogue. This is the
replacement for the manual translation pass.

**Render layer** (`i18n/specs/locale-parity.spec.ts`, Playwright). Only what a
DOM can show that an API cannot: locale routing and `html[lang]`, `hreflang`
alternates, leaked `translation missing` / `{{ }}` markers, market price
formatting, meta title and description, characters surviving to the page, and
layout overflow at 390px.

Everything either layer treats as a rule lives in
[`config/i18n.yaml`](config/i18n.yaml) — locales, price patterns, expected
writing systems, the do-not-translate glossary, exemptions with written
reasons, severities, and thresholds. **Adding an eighth language is an edit to
that file, not a code change.**

---

## Running against a real store

By default the suite runs against a local seven-locale storefront fixture, so
it works offline and in CI without credentials. To point it at a real store:

```bash
export SHOPIFY_SHOP_DOMAIN=kitsch-dev.myshopify.com
export SHOPIFY_ADMIN_TOKEN=...          # scoped read_translations, read-only
export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com

npm run i18n:parity -- --gate     # no --catalog: reads the live store
npm run test:i18n
```

With neither `--catalog` nor credentials, the run exits 2 with a usage error
rather than falling back to fixture data. A green "gate: PASS" over a
catalogue nobody asked about is the same false all-clear as reporting a failed
fetch as a clean locale.

Production is read-only, always, including "just to reproduce". Nothing in
this repo writes to a live store; seeding belongs on the dev store.

### Environment variables

| Variable | Purpose |
|---|---|
| `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` | Read-only Admin GraphQL access for the translations collector |
| `KITSCH_BASE_URL` | Storefront under test. Defaults to the local fixture |
| `KITSCH_BASELINE` | English baseline the render layer scans against. Defaults to the generated fixture catalogue; in CI, point at the content-layer artifact |
| `KITSCH_FIXTURE_PROFILE` | `clean` (default) or `seeded` |
| `KITSCH_FIXTURE_PORT` | Fixture storefront port, default `4173` |
| `KITSCH_CHROMIUM_PATH` | Escape hatch for images with a pre-baked Chromium that does not match the pinned Playwright version |
| `KITSCH_ORDER_STATUS_URL` | Path to a test order's status page, so the §15.3 order-confirmation specs can run against a real store |
| `GRID_WS_ENDPOINT` | Cloud device grid, for `playwright.grid.config.ts`. That config refuses to load without it rather than silently running local browsers |

---

## Why there is a negative control

`npm run test:detection` runs the engine over a catalogue with 19 deliberately
planted defects and asserts that each one produces the finding it was planted
to produce, then runs the render specs against a deliberately broken
storefront and asserts they **fail**.

It has already paid for itself: it caught the §13.1 consistency check keying
its findings on the string that was *correct* rather than the one that needed
changing — a check that fired, passed every unit test, and produced an
unactionable report.

A comparator that never fires is the most dangerous code here: it makes an
unchecked catalogue look like a clean one. This is the step that keeps the
gate from quietly becoming decorative, and it blocks on every PR that touches
the engine.

---

## Layout

```
collectors/          shopify-translations (read-only, paginated), fixture, constructor
config/              i18n.yaml — the locale parity contract; sla
core/                consistency helper (async-node SLA handling)
i18n/
  lib/               config loader, parity engine, text-integrity — pure, unit-tested
  specs/             render-layer specs
  run-parity.ts      content-layer CLI
  verify-detection.ts negative control
web/specs/           Playwright web specs (Phase 1)
fixtures/
  catalog/           7-locale content bundle, seeded defects, catalogue builder
  storefront/        local 7-locale storefront the render specs browse
mobile/maestro/      Phase 4 app smoke flow
.github/workflows/   web-matrix, translation-gate
```
