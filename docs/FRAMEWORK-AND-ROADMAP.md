# Kitsch QA Automation — Framework Proposal & Roadmap

**Author:** Kuruva Dinesh (QA Analyst — Automation)
**Date:** 12 August 2026
**Status:** Proposal, for Justine & Sufian
**Closes:** the "propose an automation framework after reviewing the tech stack" action from the 11 Aug meet & greet

---

## 1. The proposal in one page

Automate web and mobile-web first, on **Playwright + TypeScript**, with the **translation
validation pass for en / fr / de / it as the first thing shipped** — it is the highest-volume
redundant manual task we have, and it is fully mechanisable. The Fuego mobile app comes after
the web suite is stable and trusted, on **Maestro**, on a cloud device farm.

The reconciliation core stays where it is (Python, `core/`, `collectors/`). Nothing in this
proposal rebuilds it. The new work sits alongside it and reuses its severity model, its SLA
config, and its escalation path so every finding lands on the same scorecard.

| Decision | Choice | Why not the alternative |
|---|---|---|
| Web/mobile-web runner | Playwright Test (~1.62) | Cypress has no real WebKit engine, so Safari — the majority of our mobile traffic — would be untested. Selenium costs more maintenance for less. The team already has Playwright and TypeScript in hand. |
| Language for UI + i18n | TypeScript, strict | The repo's `tsconfig.json` and ESLint gates already exist and are type-aware. Adding a second dynamic language buys nothing. |
| Mobile app (Phase 4) | Maestro, cloud device farm | Appium is more capable and more expensive to keep alive. For ~10 smoke flows against a Fuego-generated React Native app, Maestro's YAML flows survive rebuilds better. Appium stays the fallback if we need deep native control or enterprise parallelism. |
| Reconciliation core | Unchanged (Python) | It works, it owns the money claims, and rewriting it would be motion without progress. |
| CI | GitHub Actions (existing) | Already in place, already gated. |

**The governing rule, taken from the existing `playwright-standards` skill and worth
restating:** UI is the thinnest layer in this architecture on purpose. Before any spec is
written, it has to answer *what does this catch that an API-level check cannot?* Target for the
web suite is **25–35 specs total**. A suite that grows past that starts failing for reasons
nobody trusts, and a distrusted suite is worse than no suite.

---

## 2. What this is built on

| Input | Used for |
|---|---|
| Meet & greet notes, 11 Aug 2026 | Priorities: translation automation, mobile-first, Safari/Chrome/Edge, web before app |
| `tsconfig.json`, `eslint.config.js`, `eslint-plugin-kitsch` | The static gate layer — reused as-is, not redesigned |
| `QUALITY-GATES.md` | Existing CI shape, launch gate, request-budget discipline |
| `.claude/skills/` (bugbot, reviewer, playwright-standards) | Triage format, review checklist, spec standards |
| Kitsch brand guidelines | Traffic surfaces, market list, tone of client-facing output |
| Traffic split (80% mobile / 18% desktop / 2% other) | Project weighting in `playwright.config.ts` |

**One gap.** The QA-concerns spreadsheet (`docs.google.com/spreadsheets/d/1QRrXj…`) is not
readable from here — it returns 401 without a signed-in session. That document is the single
most useful input to Phase 0, because a year of real misses tells us where coverage should go
far better than intuition does. Please either share it to my account or export it to CSV. Until
then, Phase 0's risk ranking is provisional.

---

## 3. Scope

**In, Phase 1–3 (web + mobile web):** mykitsch.com storefront on Shopify — PDP rendering,
collection/search visibility, cart and promo logic, checkout handoff, locale parity for
en/fr/de/it, across mobile Safari, mobile Chrome, desktop Chrome, desktop Safari, Edge.

**In, Phase 4 (mobile app):** Fuego-built iOS/Android app — ~10 smoke flows on real devices.

**Explicitly out:** anything the reconciliation engine already proves. Price, inventory and
status agreement across NetSuite → Shopify → Constructor → TikTok is its claim, not the UI
suite's. Re-asserting it in a browser pays once and costs twice.

Also out: payment authorisation against production, load/performance testing (Phase 5,
different tooling), and translation *quality* judgement — we validate presence, integrity and
formatting, not whether the French reads well. That stays human.

---

## 4. Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │  Reporting & escalation (existing)           │
                    │  severity → scorecard → Slack + Asana ticket │
                    └───────────────▲──────────────────────────────┘
                                    │  canonical findings
        ┌───────────────────┬───────┴────────┬────────────────────┐
        │                   │                │                    │
┌───────┴────────┐ ┌────────┴───────┐ ┌──────┴────────┐ ┌─────────┴────────┐
│ Reconciliation │ │ Locale parity  │ │ Web / mobile  │ │ Mobile app       │
│ engine         │ │ CONTENT layer  │ │ web UI specs  │ │ smoke (Phase 4)  │
│ (Python, ex.)  │ │ (TS, no        │ │ (Playwright)  │ │ (Maestro)        │
│                │ │  browser)      │ │               │ │                  │
│ price, stock,  │ │ every string,  │ │ rendering,    │ │ launch, browse,  │
│ visibility     │ │ every locale   │ │ client logic, │ │ cart, checkout   │
│ across 4 nodes │ │                │ │ RENDER layer  │ │ handoff          │
└───────┬────────┘ └────────┬───────┘ └──────┬────────┘ └─────────┬────────┘
        │                   │                │                    │
        └───────────────────┴────────┬───────┴────────────────────┘
                                     │ read-only collectors
                    ┌────────────────┴─────────────────────────────┐
                    │ NetSuite · Shopify · Constructor · TikTok     │
                    │ (dev store for anything that writes)          │
                    └───────────────────────────────────────────────┘
```

Two rules hold this together:

1. **Every layer emits the same finding shape and the same four severities**
   (`critical` / `major` / `minor` / `harness`). A translation gap and a price mismatch arrive
   in the same format, get counted in the same KPI, and escalate through the same path.
2. **Read-only by default.** Collectors never write. Seeding happens in the dev store, under
   `integration/`, where `kitsch/no-prod-write` is deliberately relaxed and the scope is
   enforced by config rather than hope.

### Repo layout

```
collectors/            # read-only source clients (+ NEW shopify-translations)
core/                  # diff engine, consistency helper, reporting  (existing)
config/                # rules.yaml, sla.yaml  +  NEW i18n.yaml
web/
  specs/               # 25–35 Playwright specs, one behaviour each
  pages/               # page objects — locators only, never assertions
  fixtures/            # SKU sets, resolved at runtime, never hardcoded prices
  helpers/
i18n/
  lib/                 # config loader + parity engine (pure, unit-testable)
  specs/               # render-layer parity specs
  run-parity.ts        # content-layer CLI — the manual-pass replacement
mobile/
  maestro/             # Phase 4 flows
integration/           # sandbox-bound, writes permitted
tools/eslint-plugin-kitsch/
.github/workflows/
```

---

## 5. Tool stack

| Concern | Tool | Version / note |
|---|---|---|
| Runner (web, mobile web) | `@playwright/test` | ~1.62 — pin exactly; upgrade deliberately, in its own PR |
| Language | TypeScript | 5.x, `strict` + the repo's extra flags |
| Static gates | typescript-eslint (type-aware), `eslint-plugin-kitsch` | Already in repo — no change needed |
| Pre-commit | husky + lint-staged | Already specified in `QUALITY-GATES.md` |
| YAML config | `yaml` | For `config/i18n.yaml`, parsed and narrowed, never cast |
| Money | `decimal.js` (TS) / `Decimal` (Python) | Enforced by `kitsch/no-float-money` |
| Locale data source | Shopify Admin GraphQL `translatableResources` + Storefront `@inContext` | Read-only, paginated, scoped token |
| Real devices + Edge | Cloud grid (BrowserStack Automate or LambdaTest) via `connectOptions` | Nightly + launch only; keeps iOS hardware off the critical path |
| Mobile app | Maestro (primary), Appium 2.x (fallback) | Phase 4 |
| Reporting | Playwright HTML + `blob` merge across shards, JUnit for CI | Flake analytics (Currents / TestDino) optional in Phase 3 |
| Triage & routing | `kitsch-bugbot` skill → Asana ticket, Slack for `critical` | Format already defined; do not invent a second one |
| Secrets | GitHub Actions secrets + OIDC; NetSuite **OAuth 2.0 client credentials** | TBA is dead at 2027.1 — no new code on it |

Two things deliberately *not* on this list yet: visual regression and accessibility scanning.
Both are real value, both generate noise before the suite is stable. They arrive in Phase 5,
after flake rate is under control.

---

## 6. Translation validation — the flagship automation

This is the first thing to ship, because it is the clearest win available: four languages,
a repetitive manual pass, and a task where a machine is simply better than a person at
noticing that one of nine hundred strings is still in English.

It runs as **two layers, deliberately split**:

**Content layer** (`i18n/run-parity.ts`, no browser). Pulls every translatable resource for
`en` and compares each target locale against it. Exhaustive, fast, and cheap enough to run
nightly on the full catalogue. Checks:

| Check | Severity | Reasoning |
|---|---|---|
| Translation absent for a key | `major` | Market surface falls back to English — a discovery and trust problem, not a wrong price |
| Translation present but empty | `major` | Renders as a blank string, which is worse than a fallback |
| Interpolation tokens differ from source (`{{count}}`, `%s`) | `major` | Renders a broken sentence or a missing value to the customer |
| Value identical to English, not a protected term or declared exemption | `minor` | Cosmetic per row; the signal is volume and trend |
| Do-not-translate term (Kitsch, Satin, Pro…) altered | `minor` | Brand drift, not a commerce defect |
| Target > 1.45× source length | `minor` | German runs long — flags for the render layer to confirm, does not fail alone |
| Fetch failed | `harness` | Our outage. Must never be reported as a clean locale |

**Render layer** (`i18n/specs/locale-parity.spec.ts`, Playwright, 390px viewport). Only the
four things a DOM can show that an API cannot:

1. locale routing resolves and `html[lang]` is actually applied
2. `hreflang` alternates exist for every declared market
3. no `translation missing` marker and no unresolved `{{` reaching the customer
4. price matches the market's formatting convention (`24,00 €` vs `$24.00`), and the layout
   does not overflow horizontally

Note what the render layer does *not* assert: whether the price *amount* is right. That is the
reconciliation engine's claim. This spec only says it is formatted for the market it is being
shown in.

Everything about the contract lives in `config/i18n.yaml` — locales, currency patterns, routes,
the do-not-translate glossary, exemptions (each with a written reason), and thresholds. Adding
a fifth language is an edit to that file. Japanese and Korean are out per the 11 Aug decision;
nothing in the engine assumes four.

**The one thing to build:** `collectors/shopify-translations.ts`. Read-only, paginated,
returns the canonical `TranslationEntry` shape, and distinguishes "fetch failed" from "value
absent" — conflating those two turns an outage into a false all-clear.

---

## 7. Coverage matrix — what runs when

| Suite | On PR | Nightly | Launch gate (T-4h) |
|---|---|---|---|
| `typecheck` + `lint` | ✅ blocking | ✅ | ✅ |
| Web specs `@smoke` — mobile Safari + mobile Chrome (emulated) | ✅ blocking, 2 shards | ✅ | ✅ blocking |
| Web specs — desktop Chrome / Safari / Edge | — | ✅ | ✅ `@launch` only |
| Real devices — iOS Safari, Android Chrome | — | ✅ | ✅ `@smoke` |
| Locale parity — content layer (all strings, 4 locales) | — | ✅ advisory | ✅ **blocking** |
| Locale parity — render layer | — | ✅ | ✅ |
| Reconciliation (`--scope changed --budget 500`) | ✅ | ✅ | ✅ blocking on `critical` |
| Mobile app smoke (Phase 4) | — | ✅ | advisory until Phase 4 exit |

PRs stay fast on purpose. A gate people wait for is a gate people keep; a 40-minute PR check
teaches the team to merge around it.

Emulated `mobile-safari` is WebKit on Linux. It is close to iOS Safari and it is not iOS
Safari — only the real-device job may be reported as real-device coverage. The same rule
applies to the app: a green `mobile-safari` run is never app coverage.

---

## 8. Test data and environments

- **Dev store for everything that writes.** Production is read-only, always, including
  "just to reproduce".
- **No hardcoded SKUs, prices or inventory counts** in specs. They go stale, and a stale
  expected value produces a green test asserting the wrong number — the worst failure mode
  available. Fixtures resolve at runtime.
- **Each spec owns its fixture SKUs.** Shared mutable fixtures cause parallel contention,
  which reads as flakiness and gets the suite ignored.
- **Request budgets are declared, not hoped for.** NetSuite enforces daily per-account API
  limits; a runaway harness throttles the finance team's production access. Batch via SuiteQL,
  never per-SKU fetches in a loop.
- **`data-testid` is a dependency we ask for.** Shopify themes regenerate classes on deploy,
  and merchandising reorders break positional selectors weekly. A one-line theme change buys
  permanent stability — we need a standing agreement with the storefront team, not a favour
  each time.

---

## 9. Reporting and the triage loop

```
failure / discrepancy
   → kitsch-bugbot triage: defect | SLA breach | harness fault
   → severity assigned from the scorecard definitions
   → critical:  Slack + named owner, ≤1 hour, report carries all node values
     major:     Asana ticket, same business day
     minor:     Asana backlog, next launch cycle
     harness:   our backlog, not reported to the client
```

The distinction that matters most in this stack: **most "bugs" are propagation timing, not
defects.** Constructor's catalog writes complete asynchronously via task IDs. Filing timing as
a defect burns engineering trust; dismissing a defect as flakiness ships wrong prices. Never
escalate on a first observation of an async node — one re-poll cycle costs 30 seconds.

We track **harness-fault rate** as a first-class metric. A rising one is the leading indicator
of a suite about to lose credibility, and it is the number that tells us whether the automation
is actually working.

---

## 10. Roadmap

| Phase | Window | Theme | Blocking exit criteria |
|---|---|---|---|
| 0 | Aug 12 – Aug 21 | Assess, baseline, decide | Risk-ranked coverage map from the QA-miss log; framework signed off |
| 1 | Aug 24 – Sep 11 | Harness foundation + first 8 specs | Green PR gate < 12 min; 0 hardcoded prices; flake rate measured |
| 2 | Sep 7 – Oct 2 | Translation validation live | Manual translation pass retired; nightly + launch gate running |
| 3 | Oct 5 – Oct 30 | Full browser + real device matrix | Safari/Chrome/Edge + real iOS/Android green nightly; flake < 2% |
| 4 | Nov 2 – Dec 18 | Fuego app smoke | 10 flows on device farm; app architecture confirmed |
| 5 | Jan 2027 → | Harden and extend | Visual, a11y, perf budgets, synthetic prod monitoring |

### Phase 0 — Assess and baseline (Aug 12–21)

Write no automation. Read.

1. Work the QA-concerns spreadsheet and the year of missed-issue history. Every past miss is
   evidence about where coverage belongs; classify each as *would-be-caught-by-API-check*,
   *would-be-caught-by-UI-spec*, *would-be-caught-by-locale-parity*, or *not automatable*.
2. Inventory existing manual test cases and test plans from Sufian. Mark each: automate,
   keep manual, or delete (duplicated by reconciliation).
3. Read `docs/system-of-record.md`, `config/rules.yaml`, `config/sla.yaml`,
   `core/diff_engine.py` — in that order. Everything else follows from those four.
4. Confirm the open questions in §12, particularly the translation source of truth and the
   Fuego app's data path.
5. Ship: the coverage map, the automate/keep/delete list, and this proposal signed off.

### Phase 1 — Harness foundation (Aug 24 – Sep 11)

- Scaffold `web/`, `i18n/`, fixtures, page objects; wire `playwright.config.ts`.
- Turn on the static gates that already exist (`typecheck`, `lint`, husky + lint-staged).
- Dev-store seeding path under `integration/`; fixture resolution at runtime.
- CI: `web-matrix.yml` PR job, 2 shards, blob-report merge.
- First **8 specs**, chosen from the Phase 0 map, mobile-first: PDP price *rendering*,
  variant switching, search visibility, collection listing, add-to-cart, promo application in
  cart, checkout handoff, TikTok deep-link landing.
- Ask the storefront team for the `data-testid` set these need.

*Exit:* PR gate green and under 12 minutes; every spec answers the "what does this catch that
an API check cannot" question in a comment; flake rate baselined over 10 nightly runs.

### Phase 2 — Translation validation (Sep 7 – Oct 2) ← highest priority

- Build `collectors/shopify-translations.ts` (read-only, paginated).
- Land `config/i18n.yaml` with the glossary and exemptions, reviewed by whoever owns
  localisation copy.
- Run content-layer parity in **shadow mode for one week** against the current manual pass.
  Every disagreement gets resolved before the gate turns on — that week is what earns the
  right to retire the manual step.
- Turn on `translation-gate.yml`: nightly advisory, blocking at launch.
- Retire the manual pass; record the hours it was taking so the saving is a number, not a
  claim.

*Exit:* two consecutive launches gated on parity with zero manual translation checking, and
zero false blocks.

### Phase 3 — Cross-browser and real devices (Oct 5–30)

- Desktop Chrome / Safari / Edge nightly; Edge via `channel: 'msedge'`, not plain Chromium.
- Cloud grid config (`playwright.grid.config.ts`) for real iOS Safari and Android Chrome.
- Sharding, blob merge, and a **quarantine policy**: a spec that fails twice for
  non-product reasons is quarantined with an owner and a deadline, not retried harder.
- Web suite grows to its 25–35 ceiling and stops.

*Exit:* flake rate under 2% over 20 nightly runs; harness-fault rate under 10% of all
findings; real-device job green three nights running.

### Phase 4 — Fuego mobile app (Nov 2 – Dec 18)

First, a question that changes everything: **does the Fuego app read Shopify Storefront data
directly, or through its own backend?** Fuego builds React Native apps over Shopify, so the
likely answer is "directly" — in which case independent data assertions are redundant and the
scope is ~10 smoke flows. But if it caches or transforms pricing in its own layer, it is a
**fifth reconciliation node**, and it goes into the diff engine *before* any UI spec is
written. The data risk would live there, not in the screens.

- Confirm the above with Fuego (§12).
- Maestro flows: launch, browse, search, PDP render, add to cart, cart, checkout handoff,
  push-notification deep link, TikTok deep link, login.
- Real devices on the farm — iOS 17/18, Android 14/15, one low-end Android.
- Request `testID`s on Fuego's custom React Native blocks. Matching on visible copy means
  marketing breaks the suite without knowing it.

*Exit:* 10 flows green on the farm three consecutive nights; app coverage reported separately
from web, never merged into one number.

### Phase 5 — Harden and extend (Jan 2027 onward)

Visual regression on PDP/collection at three viewports; `axe` accessibility scan on the same
routes; Lighthouse budgets on PDP and collection; read-only synthetic monitoring against
production for the launch-critical paths; quarterly review of the whole suite with deletions
expected, not just additions.

---

## 11. How we prove it worked

| Metric | Baseline | Target |
|---|---|---|
| Manual translation-pass hours per cycle | measure in Phase 0 | → 0 by end of Phase 2 |
| `critical` discrepancies reaching a launch | per scorecard | 0 |
| `minor` findings per launch | per scorecard | < 2 |
| Time from discovery to escalation (`critical`) | — | ≤ 1 hour, with all four node values attached |
| Flake rate (non-product failures / total runs) | measure in Phase 1 | < 2% |
| Harness-fault rate (share of all findings) | measure in Phase 2 | < 10% |
| PR gate duration | — | < 12 min |
| Web spec count | 0 | 25–35, and held there |

That last row is a target *ceiling*, not a floor. Spec count is a cost, not an achievement.

---

## 12. Open questions — needed to start

| # | Question | Blocks | Owner |
|---|---|---|---|
| 1 | Access to the QA-concerns spreadsheet (401 from here) | Phase 0 risk ranking | Justine |
| 2 | How are translations authored — Shopify native (Markets + Translate & Adapt) or a third-party app (Weglot / Langify / Transcy)? The source of truth determines what the collector reads. | Phase 2 | Sufian / dev |
| 3 | Does the Fuego app hit Shopify Storefront directly, or its own backend with caching? | Phase 4 scope | Fuego / Justine |
| 4 | Is there a dev/staging Shopify store I can seed, and does it have the four markets configured? | Phase 1 | dev |
| 5 | Who owns adding `data-testid` to the theme, and can we agree a standing process? | Phase 1 | storefront team |
| 6 | Device-farm budget approved (BrowserStack or LambdaTest, ~1 parallel + app automate)? | Phase 3 | Justine |
| 7 | Should `critical` findings auto-create Asana tickets, or stay Slack-first with manual filing? | Phase 1 | Justine |
| 8 | Confirm the storefront domain — meeting notes say `mykitnov.com`, brand guidelines say `mykitsch.com`. I've assumed the latter. | Phase 1 | Justine |

---

## 13. Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Shopify theme deploys break locators | Suite goes red for non-product reasons, trust erodes | Role- and testid-based locators only; standing agreement on testids; never XPath or `nth-child` |
| Constructor async propagation read as defects | False alarms burn engineering trust | `awaitConsistency` with SLA from `sla.yaml`; re-poll before escalating; timeout reports as SLA breach, not failure |
| NetSuite governance budget exhausted | Finance team throttled in production — fastest way for QA to lose its welcome | `--budget` ceiling on every run, SuiteQL batching, lint rule blocking per-record loops |
| Fuego app exposes no testIDs | App suite matches on copy and breaks weekly | Request testIDs on custom RN blocks in Phase 4 planning, before flows are written |
| Suite grows past its useful size | Slow, flaky, ignored | 25–35 ceiling enforced in review; deletion is a valid PR outcome |
| Single automation owner | Bus factor of one | Specs and skills documented in-repo; Sufian pairs on Phase 1 and 2; the three Claude skills encode the standards so review stays consistent |
| Launch gate made advisory under time pressure | Removes the mechanism behind the on-time QA KPI | If proposed, it's a scorecard decision with a named owner — not a config change |

---

## 14. Files in this scaffold

| File | Purpose |
|---|---|
| `playwright.config.ts` | Traffic-weighted project matrix, tags, retry policy |
| `config/i18n.yaml` | The locale parity contract — locales, routes, glossary, exemptions, thresholds |
| `i18n/lib/config.ts` | Typed loader; parses YAML as `unknown` and narrows explicitly |
| `i18n/lib/locale-parity.ts` | Pure comparison engine; emits canonical findings with scorecard severities |
| `i18n/lib/locale-parity.test.ts` | 11 unit tests, each with a known-bad input — a comparator that never fails is the most dangerous code here |
| `i18n/run-parity.ts` | Content-layer CLI — the manual-pass replacement |
| `i18n/specs/locale-parity.spec.ts` | Render layer: lang, hreflang, markers, price format, overflow |
| `web/specs/search-visibility.spec.ts` | Reference spec — `awaitConsistency`, fixtures, testid locators |
| `mobile/maestro/launch-to-checkout.yaml` | Phase 4 smoke flow |
| `.github/workflows/web-matrix.yml` | PR mobile job + nightly full matrix + real devices + report merge |
| `.github/workflows/translation-gate.yml` | Nightly advisory, blocking at launch |

**Assumed existing modules** (referenced by the scaffold, already in or planned for the repo):
`@kitsch/config` (`sla`), `@kitsch/core/consistency` (`awaitConsistency`),
`@kitsch/collectors/constructor` (`searchIndex`), `@kitsch/fixtures/launch-set`, and
`reporting.escalate`. The one net-new collector to write is
`@kitsch/collectors/shopify-translations`.

**`package.json` additions:**

```json
{
  "scripts": {
    "i18n:parity": "tsx i18n/run-parity.ts",
    "test:unit": "node --import tsx --test \"i18n/lib/**/*.test.ts\"",
    "test:i18n": "playwright test --project=i18n-mobile",
    "test:mobile-web": "playwright test --project=mobile-safari --project=mobile-chrome",
    "test:app": "maestro test mobile/maestro/",
    "verify": "npm run typecheck && npm run lint && npm run test:unit && npm run test:mobile-web"
  },
  "devDependencies": {
    "@playwright/test": "1.62.0",
    "typescript": "~6.0.3",
    "yaml": "^2.5.0",
    "tsx": "^4.19.0"
  }
}
```

### Verified against the existing gates

I ran the scaffold through the repo's own toolchain rather than assuming it would pass:

```
tsc --noEmit          clean  (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
eslint .              clean  (type-aware rules + eslint-plugin-kitsch + playwright plugin)
node --test           11/11  passing
```

Four toolchain issues surfaced while doing that, all in the existing setup rather than the new
code. Each is a small fix, and each currently breaks `npm run lint` outright:

1. **`tools/eslint-plugin-kitsch/*.js` is CommonJS, but `package.json` declares
   `"type": "module"`.** ESLint fails to load the plugin: *"does not provide an export named
   default"*. Rename the plugin files to `.cjs` (and update the import in `eslint.config.js`),
   or convert them to ESM. Nothing else needs to change.
2. **TypeScript must be pinned to 6.x.** typescript-eslint refuses to run against TS 7.0 —
   it exits with *"typescript-eslint does not support TS 7.0"*, which takes the whole lint step
   down. Pin `typescript: ~6.0.3` and revisit when typescript-eslint ships TS 7 support.
3. **`baseUrl` was removed in TS 6+.** `tsconfig.json` still sets it, and `tsc` now errors on
   it. Drop `baseUrl` and keep the `paths` map — the `@kitsch/*` aliases resolve fine without it.
4. **`eslint.config.js` scopes the Playwright rule block to `web/**` and `mobile/**` specs.**
   The `i18n/specs/**` specs need to be added to that block, or the locale specs get the
   baseline TypeScript rules but none of the Playwright ones — which is exactly where a
   conditional assertion or a hard wait would slip in unnoticed.

---

## 15. Next five working days

1. **Wed 12 Aug** — send this proposal; request the spreadsheet, dev-store access, and answers
   to §12 items 2–4.
2. **Thu 13 Aug** — walk the existing test cases and test plans with Sufian; start the
   automate / keep / delete classification.
3. **Fri 14 Aug** — read `system-of-record.md`, `rules.yaml`, `sla.yaml`, `diff_engine.py`;
   install and run the existing suite locally end to end.
4. **Mon 17 Aug** — build the risk-ranked coverage map from the QA-miss history; pick the
   Phase 1 eight specs from it.
5. **Tue 18 Aug** — walk the scaffold and the Phase 1 spec list with Justine and Sufian, agree
   the `data-testid` request list, and get the framework decision recorded in Asana.
