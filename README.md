# KitschAutomation

QA automation for the Kitsch storefront — **Playwright + TypeScript**, mobile-first,
with locale parity as the flagship suite.

The suite validates that all seven supported languages (en, fr, de, it, es, ko, ja)
are correctly implemented across navigation, footer, homepage, product pages, cart,
checkout and meta content — replacing a recurring manual translation pass.

| | |
|---|---|
| **Runs offline** | Ships a local seven-locale storefront fixture; no credentials needed to run everything |
| **Two layers** | Content (no browser, exhaustive) + render (Playwright, only what a DOM can show) |
| **One contract** | `config/i18n.yaml` and `config/kits.yaml` — adding a language or a kit is a config edit, not a code change |
| **Self-checking** | 19 + 5 + 9 + 10 + 5 planted defects prove the checks still fire; a check that never fires is the danger |
| **Gated** | `npm run precommit` locally (26s, offline), the same gates in CI on every push, `npm run gate:release` before a launch |
| **Every market** | Accessibility scanned in all 7 locales — WCAG 2.2 AA plus the locale rules axe cannot express |

---

## Table of contents

1. [Requirements](#1-requirements)
2. [Setup](#2-setup)
3. [Project structure](#3-project-structure)
4. [Running from the terminal](#4-running-from-the-terminal)
5. [Running from an IDE](#5-running-from-an-ide)
6. [The rules](#6-the-rules)
7. [Configuration reference](#7-configuration-reference)
8. [Common tasks](#8-common-tasks)
9. [Running against a real store](#9-running-against-a-real-store)
10. [CI](#10-ci)
11. [Troubleshooting](#11-troubleshooting)
12. [Documentation index](#12-documentation-index)

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | **≥ 22** | Enforced by `engines` in `package.json`. Uses the built-in test runner |
| npm | ≥ 10 | Ships with Node 22 |
| A browser | Chromium | Installed via Playwright, see below |
| Maestro | optional | Only for `npm run test:app` (Phase 4, mobile app) |

Nothing else. No database, no Docker, no running store — the fixture storefront is
a local Node HTTP server started automatically by Playwright.

**Repository access.** This repository lives in the **`mykitsch-shopify`**
organization and is private, so cloning needs a GitHub account that is a member
of the org with access to it. Ask an org owner for access first — without it the
clone below fails no matter how you authenticate.

---

## 2. Setup

### 2.0 Authenticate once

Skip only if `git clone` of a private repo already works on this machine.
GitHub does not accept account passwords for git operations, so typing one at
the prompt always fails. Use either:

```bash
# GitHub CLI — easiest, opens a browser
gh auth login          # GitHub.com -> HTTPS -> Login with a web browser
```

or create a Personal Access Token at <https://github.com/settings/tokens>
(classic, `repo` scope) and paste the **token as the password** when git asks.

> If a `Username for 'https://github.com':` prompt appears, that is git asking
> for credentials, not a shell. Press **Ctrl+C** before typing anything else.

### 2.1 Clone and install

Three commands from a fresh clone:

```bash
git clone -b develop https://github.com/mykitsch-shopify/kitschAutomation.git
cd kitschAutomation

npm ci                          # 1. install exact locked dependencies
npx playwright install chromium # 2. download the browser binary
npm run verify                  # 3. run the whole gate — proves the setup works
```

> **Windows CMD users:** `#` is not a comment character there — paste the
> commands without the trailing comments, one per line. Run them from
> `C:\...\kitschAutomation>`, not from your home directory; `npm ci` in the
> wrong folder reports a missing `package-lock.json`. And where later sections
> use `export VAR=value`, CMD needs `set VAR=value` and PowerShell needs
> `$env:VAR = "value"`.

Every command below runs from the repository root — the directory holding
`package.json`. npm searches upward for one, so running from a subdirectory
can appear to work and then resolve config paths wrongly. `node -p
"require('./package.json').name"` should print `kitsch-automation`.

**What each step does**

| Step | Command | Why |
|---|---|---|
| 1 | `npm ci` | Installs from `package-lock.json` exactly. Use this rather than `npm install`, which can drift the lockfile |
| 2 | `npx playwright install chromium` | Downloads the Chromium build matching the pinned `@playwright/test` version. Chromium alone covers `i18n-mobile`, `mobile-chrome` and `desktop-chrome` |
| 3 | `npm run verify` | End-to-end proof the toolchain works. Takes ~3 minutes. Expect it to finish `Detection verified` |

**Additional browsers** — only needed for the wider matrix, which runs nightly rather than on a PR:

```bash
npx playwright install webkit firefox   # for mobile-safari, desktop-safari, desktop-firefox
npx playwright install msedge           # for desktop-edge (a real Edge channel, not Chromium)
```

**Expected output of a successful `npm run verify`:**

```
critical 0 | major 0 | minor 0 | harness 0
review: PASS
# tests 218
# pass 218
critical 0 | major 0 | minor 7 | harness 0
gate: PASS
  350 passed (1.9m)
  7 passed (6.3s)
  19/19 planted defects detected
Detection verified: both layers fail when the store is broken.
  planted 5 | caught 5 | clean-run findings 0
```

The seven `minor` findings in the parity run are expected — French and Spanish
copy legitimately runs 1.5–1.8× longer than English on headings. See
[`docs/RUN-REPORT-2026-08-12.md`](docs/RUN-REPORT-2026-08-12.md) §2.

---

## 3. Project structure

```
KitschAutomation/
│
├── .vscode/                 ── VS Code launch configs + tasks (headless by default)
├── .run/                    ── JetBrains shared run configurations
│
├── config/
│   ├── kits.yaml              Welcome-kit parity contract — reference kit,
│   │                          candidates, and the compared dimensions
│   ├── i18n.yaml            ★ THE CONTRACT — locales, price patterns, writing
│   │                          systems, glossary, exemptions, severities, thresholds
│   └── index.ts               Declared SLAs for asynchronous nodes
│
├── i18n/                    ── the locale parity suite
│   ├── lib/                   Pure, browser-free, unit-tested logic
│   │   ├── config.ts          Typed loader — parses YAML as `unknown`, narrows explicitly
│   │   ├── locale-parity.ts   The comparison engine; emits canonical findings
│   │   ├── text-integrity.ts  Mojibake / U+FFFD / script detection
│   │   ├── sentinels.ts       Helpers behind the render layer's content checks
│   │   └── *.test.ts          Unit tests — every comparator gets known-bad input
│   ├── specs/                 Render layer (Playwright)
│   │   ├── locale-parity.spec.ts   All render-layer specs
│   │   └── baseline.ts        Loads the English baseline the specs scan against
│   ├── run-parity.ts          Content-layer CLI — the manual-pass replacement
│   └── verify-detection.ts    Negative control: both layers must fail on a broken store
│
├── collectors/              ── read-only data sources
│   ├── shopify-translations.ts   Admin GraphQL, paginated, read-only
│   ├── fixture-translations.ts   Offline catalogue, for CI without credentials
│   └── constructor.ts            Search index (Phase 1)
│
├── fixtures/                ── test data and the local storefront
│   ├── catalog/
│   │   ├── content.ts         7-locale content bundle (source of truth)
│   │   ├── defects.ts         19 planted defects, each tagged with its plan section
│   │   ├── build-catalog.ts   Generates the clean + seeded catalogues
│   │   └── catalog-*.json     Generated — do not hand-edit
│   ├── storefront/server.ts   Local 7-locale storefront the render specs browse
│   ├── compare-at/            Storefront fixture for the compare-at audit
│   │   ├── server.ts          Serves a PDP per handle from the real sheets
│   │   └── seeded.ts          The 5 planted defects the seeded profile plants
│   └── launch-set.ts          Fixture SKUs, resolved at runtime
│
├── web/                     ── web specs
│   ├── lib/compare-at.ts      Compare-at removal: CSV reading, sheet audit, judging
│   ├── lib/top-products.ts    Daily top-10 check: config, judging, cart maths
│   ├── lib/ad-landing.ts      Ad-traffic daily QA: non-stacking, redirects, BYOB,
│   │                          OOS substitution, auto-ship, compare-at
│   ├── lib/kit-parity.ts      Welcome-kit free-item comparison (pure, unit-tested)
│   └── specs/                 welcome-kit-parity, search-visibility
├── mobile/maestro/          ── Phase 4 app smoke flow
├── core/consistency.ts      ── async-node SLA helper
│
├── tools/                   ── CLIs and the offline review layer
│   ├── lib/browser.ts       ★ Shared browser launcher for every audit CLI —
│   │                          --browser / --headed / --slow-mo / --viewport,
│   │                          headless desktop by default
│   ├── preflight.ts           Do our handles, titles and selectors match the
│   │                          live theme? Covers kits.yaml and
│   │                          top-products.yaml
│   ├── compare-at-audit.ts    Compare-at removal audit
│   ├── top-products-audit.ts  Daily top-10 seller check
│   ├── ad-landing-audit.ts    Daily ad-traffic landing page QA
│   ├── resolve-handles.ts     Title -> handle, by asking the store's own search
│   ├── verify-*.ts            Negative controls, one per audit
│   ├── eslint-plugin-kitsch/  Four custom rules
│   └── review/
│       ├── run-review.ts      The offline reviewer
│       ├── bugbot.ts          Triage: severity → route → SLA
│       └── *.test.ts          Rule and triage tests
│
├── docs/                    ── framework proposal, test plan, traceability, run reports
├── .github/workflows/       ── translation-gate, web-matrix, daily-top-products,
│                               daily-ad-landing
├── eslint.config.js           Static gate configuration
├── playwright.config.ts       Traffic-weighted project matrix
└── playwright.grid.config.ts  Real-device cloud grid (needs GRID_WS_ENDPOINT)
```

**Generated, git-ignored:** `node_modules/`, `test-results/`, `playwright-report/`,
`blob-report/`, `i18n-report/`, `review-report/`.

---

## 4. Running from the terminal

### The one command

```bash
npm run verify
```

Runs the whole gate in the same order CI does, so "green locally, red in CI" has
one less way to happen. Roughly 3 minutes.

### Every command, individually

| Command | What it does | When you want it |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | Fast feedback while editing |
| `npm run lint` | ESLint: TypeScript, Playwright spec standards, Kitsch rules | Before committing |
| `npm run review` | **Offline reviewer** — runs typecheck + lint, triages every finding by severity and route, writes `review-report/` | The static gate; add `-- --gate` to exit non-zero on failure |
| `npm run test:unit` | 142 unit tests over the comparators, helpers, kit diffing and lint rules (`node --test`) | After touching anything in `i18n/lib/`, `web/lib/` or `tools/` |
| `npm run parity:clean` | Content parity against the bundled clean catalogue, gated | Quick check that the engine reports no false positives |
| `npm run i18n:parity` | Content parity, source chosen explicitly — see [§9](#9-running-against-a-real-store) | Against a real store, or a specific catalogue |
| `npm run test:i18n` | Render-layer parity: 350 specs, 7 locales × 6 routes, at 390px | After touching specs or the storefront fixture |
| `npm run test:mobile-web` | The `mobile-chrome` project (Pixel 7) — web specs plus locale specs | Wider mobile check |
| `npm run test:kits` | Welcome-kit parity: the summer and spring kits must handle free items exactly like `winter-welcome-kit-combos`, across seven dimensions read from the cart and order summary | After touching kits, or when marketing changes a kit |
| `npm run test:kits-detection` | **Negative control** for it — each of the five kit defects seeded *alone* (stacked ones mask each other), and each run must fail naming the dimension that moved | After touching `web/lib/kit-parity.ts` or the parity spec |
| `npm run visual` | **Visual regression** — photographs each configured page at 390px and 1280px and compares against committed baselines. The only check here that sees a collapsed grid or overflowing copy. See [`docs/VISUAL-REGRESSION.md`](docs/VISUAL-REGRESSION.md) | After a theme or template change |
| `npm run visual:bless` | Rewrite the baselines. **Not a fix** — it records whatever is on screen as correct, so read the diff before committing | Only when a visual change was intended |
| `npm run visual:detection` | **Negative control** for it — are there baselines at all, does every configured shot have one, and does a real layout break still fail? | After touching the visual config or spec |
| `npm run asana:pull` | Pull the open translation tasks off the Asana board into `data/asana/translation-tasks.json`. Needs `ASANA_TOKEN`. Read-only | Before a backlog verification run |
| `npm run asana:close` | Close the tasks the audit proved are done. **Dry run by default**; `-- --confirm` acts. Only ever touches `closeable` — never `partial`, `stale_product` or `unverified` | After reading the backlog report |
| `npm run test:detection` | **Negative control** — 19 planted defects must be caught, and the render specs must fail against a broken store | After touching any comparator. This is what keeps the gate honest |
| `npm run audit:compare-at` | **Compare-at removal audit** — the struck-through price must be gone and the real price untouched; audits the two sheets first, then the storefront. See [`docs/COMPARE-AT-AUDIT.md`](docs/COMPARE-AT-AUDIT.md) | Before and after the compare-at import runs. `--sheets-only` needs no browser |
| `npm run test:compare-at-detection` | **Negative control** for that audit — 5 planted defects, plus a clean run that must report nothing | After touching `web/lib/compare-at.ts` |
| `npm run audit:top-products` | **Daily top-10 check** — availability, add-to-cart, title, description, images, videos, pricing, specs, variants, cart discount maths. See [`docs/TOP-PRODUCTS-DAILY.md`](docs/TOP-PRODUCTS-DAILY.md) | Daily in CI; by hand when investigating a top seller |
| `npm run resolve:handles` | Maps the top-10 list's titles to storefront handles by asking the store's own search. Writes nothing without `--write` | When the top-10 list changes |
| `npm run test:top-products-detection` | **Negative control** for the daily check — 9 planted defects, one per requirement | After touching `web/lib/top-products.ts` |
| `npm run audit:ad-landing` | **Daily ad-traffic QA** — 29 welcome-kit/BYOB/traffic pages, discount non-stacking, redirect flows, OOS redirects, auto-ship, compare-at. See [`docs/AD-LANDING-DAILY.md`](docs/AD-LANDING-DAILY.md) | Daily in CI, first thing; by hand when ad spend looks wrong |
| `npm run test:ad-landing-detection` | **Negative control** for it — 10 planted defects, one per check in the brief | After touching `web/lib/ad-landing.ts` |
| `npm run audit:health-check` | **Daily report re-verification** — every issue from a previous QA report, re-checked against Live and Fuego. Drafts a ticket for each one still present, and refuses to call anything "invalid" | Every morning, against the latest health-check report |
| `npm run test:health-check-detection` | **Negative control** for it — both 2026-04-28 findings planted in the places they were found (one in an `aria-label`, one in `sr-only` text), plus a repaired theme that must produce no tickets | After touching `web/lib/health-check.ts` or `web/lib/page-markers.ts` |
| `npm run audit:translation-backlog` | **Translation backlog check** — are the open Asana translation tasks still true? Writes no copy and changes nothing in Asana. See [`docs/TRANSLATION-BACKLOG.md`](docs/TRANSLATION-BACKLOG.md) | Before a backlog grooming pass |
| `npm run test:translation-backlog-detection` | **Negative control** for it — every verdict against a known fixture state | After touching `web/lib/translation-backlog.ts` |
| `npm run precommit` | **The local gate** — typecheck, eslint + Kitsch rules, reviewer + bugbot, unit tests. Offline, ~26s | Runs automatically on `git commit` once `npm run hooks:install` has been run |
| `npm run gate:release` | **Release gate** — 17 offline stages, then the live tier with `-- --live`. One answer: is it safe to ship? | Before a launch or a release |
| `npm run audit:a11y` | **Accessibility across all 7 markets** — WCAG 2.2 AA via axe, plus wrong-language and untranslated-label rules. See [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) | Nightly; before a launch |
| `npm run test:a11y-detection` | **Negative control** for it — 5 planted defects across 4 markets | After touching `web/lib/a11y.ts` |
| `npm run storefront` | Serves the fixture storefront on `:4173` so you can browse it by hand | Debugging a spec, or seeing what the fixture renders |
| `npm run test:app` | Maestro app smoke flow | Phase 4; needs Maestro and a device |

### Useful invocations

```bash
# One locale, content layer
npm run i18n:parity -- --catalog fixtures/catalog/catalog-clean.json --locale de

# See the engine fail on purpose
npm run i18n:parity -- --catalog fixtures/catalog/catalog-seeded.json

# One spec by name
npx playwright test --project=i18n-mobile -g "fr — cart"

# Only the PR-blocking subset
npx playwright test --project=i18n-mobile --grep @smoke

# Watch it run in a real browser window
npx playwright test --project=i18n-mobile --headed -g "de — homepage"

# Open the HTML report from the last run
npx playwright show-report

# Browse the fixture storefront by hand
npm run storefront    # then open http://127.0.0.1:4173/fr/cart
```

### Test tags

| Tag | Meaning |
|---|---|
| `@smoke` | Must pass on every PR |
| `@launch` | Runs at the T-4h launch gate, blocking |
| `@i18n` | Locale parity, render layer |
| `@order` | Needs a real order to exist — skips without `KITSCH_ORDER_STATUS_URL` |

Select with `--grep @smoke` or exclude with `--grep-invert @order`.

### Reading the output

Both layers report the same four severities:

| Severity | Meaning | Routes to |
|---|---|---|
| `critical` | Blocks a launch | Slack + named owner, ≤ 1 hour |
| `major` | A customer-visible defect | Asana, same business day |
| `minor` | Cosmetic, or signal-by-volume | Asana backlog |
| `harness` | **Our** fault — a collector outage or a broken tool | Our backlog. Never reported to the client, never blocks a merge |

Reports land in `i18n-report/` (parity) and `review-report/` (static review), as both
JSON and Markdown.

### The Allure report

For anything going outside the team, build the Allure report instead of quoting
terminal output:

```bash
# the whole daily run against a target, ending in one report
npm run daily -- --base-url https://www.mykitsch.com

# or build a report from whatever has already run
npm run report -- --open
```

It covers the Playwright specs *and* all six audits in one place, grouped by
consequence — critical / major / minor / **could not check**. Every check that
ran appears, not only the ones that failed, because 9 failures out of 12 and 9
out of 600 describe different stores.

Read the target line on the front page before quoting any number from it: a run
against the local fixture is titled `SELF-TEST … NOT the live store` and proves
only that the suite works. Full detail in [docs/REPORTING.md](docs/REPORTING.md).

---

## 5. Running from an IDE

Everything below runs **headless on your local desktop browser** by default. That
is deliberate: a run that opens a window fails on any machine without a display,
and that failure reads as a broken check rather than a wrong setting. Headed mode
is an explicit opt-in for the one job that needs eyes on it — watching a flow to
work out why a selector missed.

### 5.1 Browsers

Playwright specs use the projects in `playwright.config.ts`:

```bash
npm run test:desktop            # desktop-chrome, headless
npm run test:desktop:headed     # same, with a visible window
npm run test:desktop:firefox    # desktop-firefox
npm run test:desktop:safari     # desktop-safari (WebKit)
npm run test:desktop:edge       # desktop-edge (real Edge channel)
npm run test:desktop:all        # chrome + firefox + safari
npm run test:ui                 # Playwright UI mode — time-travel debugging
npm run test:debug              # step through with the Inspector
```

The audit CLIs (`audit:ad-landing`, `audit:top-products`, `audit:compare-at`)
take the same choice as flags, handled by `tools/lib/browser.ts`:

| Flag | Env | Default |
|---|---|---|
| `--browser chromium\|firefox\|webkit\|chrome\|edge` | `KITSCH_BROWSER` | `chromium` |
| `--headed` | `KITSCH_HEADED=1` | headless |
| `--slow-mo <ms>` | `KITSCH_SLOW_MO` | `0` |
| `--viewport <WxH>` | `KITSCH_VIEWPORT` | `1440x900` |

Every run prints what it actually drove, so a report is never ambiguous about it:

```
  browser      chromium headless 1440x900
```

`chrome` and `edge` drive the real installed applications rather than bundled
Chromium — distinct rendering and distinct update cadence, which is why the QA
scorecard names Edge separately. `KITSCH_CHROMIUM_PATH` applies to bundled
Chromium only; pointing a channel at another binary would silently run a
different browser than the one named in the report.

Watching a flow, when a selector is missing and you need to see why:

```bash
KITSCH_BASE_URL=https://www.mykitsch.com \
  npm run audit:ad-landing -- --headed --slow-mo 300
```

### 5.2 VS Code

`.vscode/` ships run configurations, so nothing needs typing:

- **Run and Debug** (`launch.json`) — 11 configurations covering each audit
  headless, two headed variants, preflight, the detection controls, the unit
  tests for the open file, and the offline review. Breakpoints work directly in
  the `.ts` files. The fixture-backed ad-landing config starts its storefront
  first via a background task.
- **Tasks** (`tasks.json`, ⇧⌘B / Ctrl+Shift+B) — `verify`, `review`, unit tests,
  preflight, each daily audit headless, one headed, the desktop spec runs, UI
  mode, and all four detection controls in one go.

`.vscode/extensions.json` recommends the two extensions that matter; VS Code will
offer to install them on first open.

- **Playwright Test for VSCode** (`ms-playwright.playwright`) — green run arrows in
  the gutter of every spec, a Test Explorer tree, and a **Pick locator** tool.
- **ESLint** (`dbaeumer.vscode-eslint`) — the Kitsch and Playwright rules appear as
  you type, so a conditional assertion is flagged before you commit it.

**To run a single test:** open `i18n/specs/locale-parity.spec.ts` and click the ▶
arrow beside any `test(...)`. Pick the `i18n-mobile` project in the Test Explorer
sidebar — the storefront fixture starts automatically.

**To debug:** click the arrow with the ▾ and choose *Debug Test*. Breakpoints in
both the spec and `i18n/lib/**` work; the browser opens and pauses.

### 5.3 JetBrains (WebStorm / IntelliJ)

`.run/` ships 11 shared run configurations — they appear in the run dropdown on
first open, with the right environment already set:

| Configuration | What it runs |
|---|---|
| verify (whole gate) | everything, offline |
| review / unit tests | the static gate, the unit suite |
| specs: desktop chrome (headless / headed / all) | Playwright desktop projects |
| preflight (live) | do our selectors match the live theme? |
| daily: ad-landing / top-products (live, headless) | the daily audits |
| control: ad-landing / top-products detection | the negative controls |

Playwright is also supported natively — run arrows appear beside each `test()`.

For a one-off unit test, create a **Node.js** configuration:
- Node parameters: `--import tsx --test`
- JavaScript file: the `*.test.ts` you want

### 5.4 Playwright UI mode (any editor)

The best debugging experience, and it needs no extension:

```bash
npm run test:ui                 # or: npx playwright test --project=i18n-mobile --ui
```

A time-travel window with a DOM snapshot at every step, network log, and a watch
mode that re-runs on save.

### 5.5 Traces

Traces are captured on first retry. After a failure:

```bash
npx playwright show-trace test-results/<test-dir>/trace.zip
```

---

## 6. The rules

### 6.1 Standing agreements

These are not style preferences — each cost something to learn, and four of them are
enforced by lint (see 6.3).

1. **The harness never points at production.** Including "just to reproduce". Default
   `KITSCH_BASE_URL` is the local fixture, never a live store.
2. **Collectors never write.** Read-only by contract. Anything that writes belongs
   under a dev store.
3. **No hardcoded prices, SKUs or inventory counts in specs.** They go stale, and a
   stale expected value produces a green test asserting the wrong number — the worst
   failure mode available.
4. **Every spec answers: what does this catch that an API-level check cannot?** The UI
   is the thinnest layer here on purpose.
5. **A failed fetch is never a clean result.** `harness` exists so an outage cannot be
   reported as a pass.
6. **`data-testid` locators, never XPath or `nth-child`.** Shopify themes regenerate
   classes on deploy.
7. **The suite has a ceiling.** 25–35 spec *definitions*, held there. Spec count is a
   cost, not an achievement. (Parameterisation across locales is free — 16 definitions
   currently produce 350 executed tests.)

### 6.2 Spec standards, enforced by `eslint-plugin-playwright`

| Rule | Why |
|---|---|
| `no-conditional-expect` | An assertion inside an `if` does not run when the condition is false. A spec that silently asserts nothing is worse than a missing one |
| `no-conditional-in-test` | A branch in a test is one step from the above. Put the logic in a module-scope helper |
| `no-wait-for-timeout` | Hard waits make a suite slow *and* still flaky |
| `no-force-option` | `force` clicks past the thing that would have caught the bug |
| `expect-expect` | A test with no assertion is decoration |
| `no-skipped-test` | Allowed **only** conditionally, with a stated reason — e.g. "needs a real store" |

### 6.3 Kitsch rules, `tools/eslint-plugin-kitsch/`

| Rule | Catches |
|---|---|
| `kitsch/no-prod-target` | A production URL used as a harness target |
| `kitsch/no-hardcoded-price` | A currency literal in a spec |
| `kitsch/no-write-operation` | A GraphQL `mutation` in a collector (reads are POSTs too, so the method proves nothing) |
| `kitsch/require-spec-rationale` | A spec with no comment stating what it catches |

Each has a RuleTester test giving it code it must reject *and* code it must accept —
a rule that never fires leaves the gate green while it has stopped looking.

### 6.4 TypeScript

`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters`, `verbatimModuleSyntax`.

Config is parsed as `unknown` and narrowed explicitly — a loader that casts its input
hands malformed config to the engine, which then reports nothing and looks green.

---

## 7. Configuration reference

### 7.1 `config/i18n.yaml` — the contract

Everything either layer treats as a rule lives here. **Adding an eighth language is an
edit to this file, not a code change.**

| Key | Purpose |
|---|---|
| `source_locale` | The baseline everything compares against (`en`) |
| `locales.<code>.market` / `.currency` | Market and currency for the locale |
| `locales.<code>.price_pattern` | Regex the rendered price must match |
| `locales.<code>.expect_script` | Unicode script the copy must contain (ko, ja) |
| `locales.<code>.expect_diacritics` / `.diacritics` | Accented characters that must appear somewhere |
| `locales.<code>.font_families` | Families the theme must declare for this script |
| `routes` | Paths the render layer visits, with tags |
| `resources` | Shopify resource types the collector pulls |
| `do_not_translate` | Terms that must stay identical in every locale |
| `exemptions` | Per-key, per-locale opt-outs — **each needs a written reason** |
| `consistency_exemptions` | English strings allowed to translate differently in different places |
| `severities` | Finding kind → severity. This is where the test plan's High/Medium grading lives |
| `thresholds` | Length ratio, overflow px, and the gate's `max_major` / `max_minor` budgets |

### 7.2 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `KITSCH_BASE_URL` | local fixture | Storefront under test |
| `SHOPIFY_SHOP_DOMAIN` | — | Store for the translations collector |
| `SHOPIFY_ADMIN_TOKEN` | — | Read-only token, scoped `read_translations` |
| `KITSCH_BASELINE` | generated fixture catalogue | English baseline the render layer scans against |
| `KITSCH_FIXTURE_PROFILE` | `clean` | `clean` or `seeded` |
| `KITSCH_FIXTURE_PORT` | `4173` | Fixture storefront port |
| `KITSCH_CHROMIUM_PATH` | — | Escape hatch for images with a pre-baked Chromium that does not match the pinned Playwright version |
| `KITSCH_ORDER_STATUS_URL` | — | Test order's status page, so the order-confirmation specs can run against a real store |
| `GRID_WS_ENDPOINT` | — | Cloud device grid. `playwright.grid.config.ts` refuses to load without it rather than silently running local browsers |
| `CI` | — | Enables retries, blob reporting and `forbidOnly` |

---

## 8. Common tasks

### Add an eighth language

1. Add the locale block to `config/i18n.yaml` (market, currency, `price_pattern`, and
   `expect_script` if it is non-Latin).
2. Add its column to `fixtures/catalog/content.ts` and the code to `LOCALES`.
3. Regenerate the catalogues: `npx tsx fixtures/catalog/build-catalog.ts`
4. `npm run verify`

No engine code changes. The specs are parameterised over the config.

### Add a render-layer spec

Ask the question in rule 6.1.4 first — *what does this catch that an API check
cannot?* — and write the answer in a block comment, or
`kitsch/require-spec-rationale` will fail the build.

Then add it to `i18n/specs/locale-parity.spec.ts`, keep branching in module-scope
helpers, and **watch it fail** by adding a matching defect to
`fixtures/storefront/server.ts` or `fixtures/catalog/defects.ts`.

### Add a planted defect

Add an entry to `fixtures/catalog/defects.ts` with the finding kind it must produce
and the test-plan section it exercises, then `npm run test:detection`. The control
asserts every planted defect is caught by name.

### Regenerate the fixture catalogues

```bash
npx tsx fixtures/catalog/build-catalog.ts
```

Never hand-edit `catalog-clean.json` / `catalog-seeded.json`.

---

## 9. Running against a real store

The suite is fixture-backed by default so it works offline. There are two ways
to point it at a store, and they need very different things.

### 9.1 Render layer — no credentials at all

The storefront is a public website. Any machine that can open it in a browser
can run these checks against it: no VPN, no allowlist, no token, no login.

```bash
export KITSCH_BASE_URL=https://www.mykitsch.com

npm run preflight     # ALWAYS first — see below
npm run test:kits     # welcome-kit free-item parity
npm run test:i18n     # locale parity, render layer
```

**Run `preflight` before the suite, every time you point at a new target.** It
separates four failures that look identical in a test report — an unreachable
network, a product handle that no longer resolves, a handle that resolves to
the *wrong product*, and a selector that does not match the theme:

```
Preflight against https://www.mykitsch.com

  reachable      HTTP 200

  Winter Welcome Kit Combos  (HTTP 200)
    title        MISMATCH
      recorded:  "Winter Welcome Kit Combos"
      on page:   "Shampoo & Conditioner Bundle with Free Welcome Kit"
    → either the product was renamed (update canonical_title) or this
      handle now points at a different product.
    pdp_title         1 match(es)
    pdp_price         3 match(es)
        1  .main-product span.text-red-700
        ...
```

That mismatch is real and it is why the title check exists: the handle
returned 200, every selector matched, and the whole comparison would have been
measuring a product nobody meant.

It covers **both** product configs — the welcome kits and the top-10 sellers.
The top-10 audit had no preflight, so the only way to learn which of its
fifteen selectors fit the theme was to run the whole audit and read eleven
`not_observed` findings out of the report: harness failures dressed as results,
costing an audit run each time to discover.

The top-10 half needs the real store — the local storefront fixture does not
carry that catalogue, and pointed at it preflight says so rather than reporting
ten unresolvable handles. To run one half, or to check the tool itself against
a fixture that does serve a given catalogue:

```bash
npm run preflight -- --only kits
npm run preflight -- --only products
npx tsx tools/preflight.ts --only products --products-config fixtures/top-products/config.yaml
```

Not every zero is a problem, and preflight says which is which: `compare_at 0`
on a product that is not on sale, `video 0` where there is no video, and
`add_to_cart 0` on a product whose `sold_out` selector matched are all correct
and are labelled as such. Reporting those would put nine false entries in front
of someone every morning, and the first thing they would learn is to skim past
all of them.

Expect unmapped selectors on the first live run against a new theme. The
fixture uses `data-testid` attributes that a real theme does not carry, so
mapping them in `config/kits.yaml` under `selectors` is the first job — an
edit, not a code change. A spec that cannot find markup reports a defect that
is not there, and each one costs a triage cycle.

### 9.2 Content layer — needs a read-only Admin token

This is the exhaustive check: every translatable string across all seven
locales, including on pages nobody thinks to open.

```bash
export SHOPIFY_SHOP_DOMAIN=kitsch-dev.myshopify.com
export SHOPIFY_ADMIN_TOKEN=...              # scoped read_translations, read-only
export KITSCH_BASE_URL=https://kitsch-dev.myshopify.com

npm run i18n:parity -- --gate               # no --catalog: reads the live store
```

With neither `--catalog` nor credentials, the run **exits 2 with a usage error**
rather than falling back to fixture data. A green `gate: PASS` over a catalogue nobody
asked about is the same false all-clear as reporting a failed fetch as a clean locale.

> **Production is read-only, always.** Nothing in this repo writes to a live store.
> Seeding belongs on the dev store. A lint rule (`kitsch/no-write-operation`)
> fails the build if a GraphQL mutation ever appears in a collector.

> **Where the token lives is a decision, not a default.** A store credential in
> a `.env` file on a personal machine sits outside device management, rotation
> and revocation. Prefer holding it as a CI secret and running §9.2 there; §9.1
> needs nothing and can stay local. See [`docs/ACCESS-REQUEST.md`](docs/ACCESS-REQUEST.md) §3.

---

## 10. CI

| Workflow | Trigger | Does |
|---|---|---|
| `translation-gate.yml` → `engine` | PRs touching the engine | Offline review → unit → content parity (clean) → render parity (clean) → detection. No credentials needed |
| `translation-gate.yml` → `parity` | Nightly + manual | Content and render parity against the real store. Blocking when given a `launch_ref` |
| `web-matrix.yml` → `pr-mobile` | Every PR | `@smoke` on mobile Safari + mobile Chrome, 2 shards |
| `web-matrix.yml` → `nightly-full` | Nightly | The full browser matrix |
| `web-matrix.yml` → `real-devices` | Nightly | Cloud grid. Only this job may be reported as real-device coverage |

The `engine` job checks the specs both **pass on a clean fixture and fail on a broken
one**. Both directions are needed, or neither means anything.

---

## 11. Troubleshooting

**`COULD NOT RUN` on every gate from `npm run precommit`**
Nothing ran. The gates did not fail — they never started, which is why the
output says so in those words and exits **2** rather than 1. The usual cause is
that dependencies are not installed: run `npm ci` in the repository root and try
again. Read the `── could not run ──` block at the top of the output; it names
the reason per gate. This state is deliberately not called a failure: the commit
is unchecked, not broken, and nothing in that output is a statement about your
code. If the reason reads `could not be started on this platform`, that is a bug
in the harness rather than in your setup — please report it.

**`NO BROWSER` from preflight, or `Executable doesn't exist at .../chrome-headless-shell`**
The installed browser does not match the pinned Playwright version. Normally
`npx playwright install chromium` fixes it. Where browser downloads are blocked
it cannot, so point at a build you already have:
```bash
ls ~/.cache/ms-playwright/            # or $PLAYWRIGHT_BROWSERS_PATH
export KITSCH_CHROMIUM_PATH=/path/to/chromium-XXXX/chrome-linux/chrome
```
Honoured by `preflight` and by every chromium project in `playwright.config.ts`.
Deliberately *not* applied to `desktop-edge`, which pins a real Edge channel.

**`NO BROWSER` when using `--headed`**
Headed mode needs a display. On a headless server, in CI, or over plain SSH there
isn't one — drop `--headed` (headless is the default) or run under `xvfb-run`.
The error names this case explicitly.

**`Unknown browser "safari"`**
WebKit is spelled `webkit`. Valid names: `chromium`, `firefox`, `webkit`,
`chrome`, `edge`. It exits 2 rather than quietly falling back to Chromium, which
would report a Chromium run as a Safari one.

**`UNREACHABLE  net::ERR_TUNNEL_CONNECTION_FAILED`**
Something is intercepting outbound traffic — a sandbox or CI runner with a
restricted egress policy is the usual cause. On an ordinary machine this should
not happen: the storefront is public and needs no grant. Note this is *not* the
store refusing automated traffic, which presents as a loaded page returning
HTTP 403 or a challenge. `docs/LIVE-RUN.md` has the full diagnosis.

**`Authentication failed` / `Password authentication is not supported` on clone**
The repository is private and GitHub does not accept account passwords for git.
See §2.0 — `gh auth login`, or a Personal Access Token used as the password. If
you get `Repository not found` *after* authenticating, your account is not in the
`mykitsch-shopify` org or has not been granted access; ask an org owner. A
classic PAT also needs SSO authorised for the org before it will work.

**`npm ci` reports a missing `package-lock.json`**
You are not in the repository root. `cd KitschAutomation` first — `node -p
"require('./package.json').name"` should print `kitsch-automation`.

**`No translation source given` (exit 2)**
`npm run i18n:parity` needs to be told what to read. Pass
`--catalog fixtures/catalog/catalog-clean.json`, or set the Shopify credentials.
This is deliberate — it will not guess.

**`Baseline "..." has no entry for locale "xx"`**
You added a locale to `config/i18n.yaml` but did not regenerate the catalogues.
Run `npx tsx fixtures/catalog/build-catalog.ts`. The error exists because an empty
baseline would silently turn every translation assertion into a no-op.

**Parity fails with `N minor finding(s), gate allows 10`**
Legitimate translation growth may have pushed past the budget. Read
`i18n-report/clean/parity.md`, confirm the render layer's overflow spec still passes,
and adjust `thresholds.max_minor` *with the new baseline recorded in the comment*.

**Port 4173 already in use**
A fixture storefront is still running. `KITSCH_FIXTURE_PORT=4180 npm run test:i18n`,
or stop the stray process.

**ESLint reports nothing at all**
`npm run review` reports that as `harness` severity rather than a pass. Check
`review-report/review.md` — a config error means the review did not run, which is not
the same as a clean review.

---

## 12. Documentation index

| Document | What it is |
|---|---|
| [`docs/FRAMEWORK-AND-ROADMAP.md`](docs/FRAMEWORK-AND-ROADMAP.md) | The framework proposal: tool choices, architecture, phases, risks, open questions |
| [`docs/TEST-PLAN-TRANSLATIONS.md`](docs/TEST-PLAN-TRANSLATIONS.md) | The Translations test plan this suite automates |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) | Plan section → automated check, including what is deliberately *not* automated |
| [`docs/TEST-CASE-COVERAGE.md`](docs/TEST-CASE-COVERAGE.md) | The 27 written test cases cross-verified against the suite |
| [`docs/WELCOME-KIT-COVERAGE.md`](docs/WELCOME-KIT-COVERAGE.md) | Welcome-kit free-item parity: the requirement, the ten dimensions, and all 57 written cases |
| [`docs/COMPARE-AT-AUDIT.md`](docs/COMPARE-AT-AUDIT.md) | Compare-at (struck-through price) removal: how to run it, what it checks, and the findings on the sheets as supplied |
| [`docs/TOP-PRODUCTS-DAILY.md`](docs/TOP-PRODUCTS-DAILY.md) | Daily top-10 seller check: availability, add-to-cart, content, variants, cart discount maths — and why 8 of 10 handles need resolving first |
| [`docs/AD-LANDING-DAILY.md`](docs/AD-LANDING-DAILY.md) | Daily QA of ad-traffic landing pages: welcome kits, BYOB flows, discount non-stacking, redirect flows, OOS redirects, auto-ship, compare-at |
| [`docs/TRANSLATION-BACKLOG.md`](docs/TRANSLATION-BACKLOG.md) | Verifying the ~93 open Asana translation tasks against the live store — which are already done, half done, or about products that no longer exist |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) | Accessibility across markets: WCAG 2.2 AA, plus the wrong-language and untranslated-label failures a generic scan cannot see |
| [`docs/REPORTING.md`](docs/REPORTING.md) | The Allure report: how it is built, what the four buckets mean, and the one line to check before quoting a number from it |
| [`docs/ADDING-A-CHECK.md`](docs/ADDING-A-CHECK.md) | The seven steps for turning an Asana task into an automated check, and the rules that are not negotiable |
| [`docs/ACCESS-REQUEST.md`](docs/ACCESS-REQUEST.md) | What is genuinely outstanding — selector mapping, a read-only token, where this should run. The earlier network request is withdrawn |
| [`docs/ACCESS-REQUEST-EMAIL.md`](docs/ACCESS-REQUEST-EMAIL.md) | The problem statement for a manager, in email and Slack form |
| [`docs/LIVE-RUN.md`](docs/LIVE-RUN.md) | Running against the live storefront: why the sandbox attempt failed, the selector mapping it needs, and the exact commands |
| [`docs/RUN-REPORT-2026-08-12.md`](docs/RUN-REPORT-2026-08-12.md) | An executed run with its results and its caveats |

### Known limitations

Read [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) before trusting a green run. In
short: which font ultimately drew a glyph is a property of the customer's device and
is not asserted; order-confirmation against a real store needs a test order; and
Firefox and the real-device grid are wired but have not yet been executed.
