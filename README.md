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
| **Self-checking** | 19 planted defects prove the checks still fire; a check that never fires is the danger |

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
cd KitschAutomation

npm ci                          # 1. install exact locked dependencies
npx playwright install chromium # 2. download the browser binary
npm run verify                  # 3. run the whole gate — proves the setup works
```

> **Windows CMD users:** `#` is not a comment character there — paste the
> commands without the trailing comments, one per line. Run them from
> `C:\...\KitschAutomation>`, not from your home directory; `npm ci` in the
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
# tests 110
# pass 110
critical 0 | major 0 | minor 7 | harness 0
gate: PASS
  350 passed (1.9m)
  7 passed (6.3s)
  19/19 planted defects detected
Detection verified: both layers fail when the store is broken.
```

The seven `minor` findings in the parity run are expected — French and Spanish
copy legitimately runs 1.5–1.8× longer than English on headings. See
[`docs/RUN-REPORT-2026-08-12.md`](docs/RUN-REPORT-2026-08-12.md) §2.

---

## 3. Project structure

```
KitschAutomation/
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
│   └── launch-set.ts          Fixture SKUs, resolved at runtime
│
├── web/                     ── web specs
│   ├── lib/kit-parity.ts      Welcome-kit free-item comparison (pure, unit-tested)
│   └── specs/                 welcome-kit-parity, search-visibility
├── mobile/maestro/          ── Phase 4 app smoke flow
├── core/consistency.ts      ── async-node SLA helper
│
├── tools/                   ── the offline review layer
│   ├── eslint-plugin-kitsch/  Four custom rules
│   └── review/
│       ├── run-review.ts      The offline reviewer
│       ├── bugbot.ts          Triage: severity → route → SLA
│       └── *.test.ts          Rule and triage tests
│
├── docs/                    ── framework proposal, test plan, traceability, run report
├── .github/workflows/       ── translation-gate.yml, web-matrix.yml
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
| `npm run test:unit` | 110 unit tests over the comparators, helpers, kit diffing and lint rules (`node --test`) | After touching anything in `i18n/lib/`, `web/lib/` or `tools/` |
| `npm run parity:clean` | Content parity against the bundled clean catalogue, gated | Quick check that the engine reports no false positives |
| `npm run i18n:parity` | Content parity, source chosen explicitly — see [§9](#9-running-against-a-real-store) | Against a real store, or a specific catalogue |
| `npm run test:i18n` | Render-layer parity: 350 specs, 7 locales × 6 routes, at 390px | After touching specs or the storefront fixture |
| `npm run test:mobile-web` | The `mobile-chrome` project (Pixel 7) — web specs plus locale specs | Wider mobile check |
| `npm run test:kits` | Welcome-kit parity: the summer and spring kits must handle free items exactly like `winter-welcome-kit-combos`, across ten dimensions | After touching kits, or when marketing changes a kit |
| `npm run test:detection` | **Negative control** — 19 planted defects must be caught, and the render specs must fail against a broken store | After touching any comparator. This is what keeps the gate honest |
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

---

## 5. Running from an IDE

### VS Code

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

### JetBrains (WebStorm / IntelliJ)

Playwright is supported natively — run arrows appear beside each `test()`. For the
npm scripts, open the **npm** tool window and double-click any script.

For the unit tests, create a **Node.js** run configuration:
- Node parameters: `--import tsx --test`
- JavaScript file: `i18n/lib/locale-parity.test.ts`

### Playwright UI mode (any editor)

The best debugging experience, and it needs no extension:

```bash
npx playwright test --project=i18n-mobile --ui
```

A time-travel window with a DOM snapshot at every step, network log, and a watch
mode that re-runs on save.

### Traces

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
separates three failures that look identical in a test report — an unreachable
network, a product handle that no longer resolves, and a selector that does not
match the theme:

```
Preflight against https://www.mykitsch.com

  reachable      HTTP 200

  Winter Welcome Kit Combos  (HTTP 200)
    pdp_title         1 match(es)
    kit_item          0 match(es)
    ...
    → unmatched: kit_item — map these in config/kits.yaml "selectors"
```

Expect zeros on the first live run. The fixture uses `data-testid` attributes
that the real theme does not carry, so mapping them in `config/kits.yaml` under
`selectors` is the first job — an edit, not a code change. A spec that cannot
find markup reports a defect that is not there, and each one costs a triage
cycle.

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
| [`docs/ACCESS-REQUEST.md`](docs/ACCESS-REQUEST.md) | What is genuinely outstanding — selector mapping, a read-only token, where this should run. The earlier network request is withdrawn |
| [`docs/ACCESS-REQUEST-EMAIL.md`](docs/ACCESS-REQUEST-EMAIL.md) | The problem statement for a manager, in email and Slack form |
| [`docs/LIVE-RUN.md`](docs/LIVE-RUN.md) | Running against the live storefront: why the sandbox attempt failed, the selector mapping it needs, and the exact commands |
| [`docs/RUN-REPORT-2026-08-12.md`](docs/RUN-REPORT-2026-08-12.md) | An executed run with its results and its caveats |

### Known limitations

Read [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) before trusting a green run. In
short: which font ultimately drew a glyph is a property of the customer's device and
is not asserted; order-confirmation against a real store needs a test order; and
Firefox and the real-device grid are wired but have not yet been executed.
