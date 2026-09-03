# Reporting

The suite produces one Allure report covering everything it ran — the
Playwright specs and all six audit CLIs — so a reader outside the team can
answer three questions without opening a terminal:

1. What was checked, and how much of it?
2. What is broken, and how badly?
3. What could not be checked at all?

---

## The one thing to check before quoting a number

Every report states its target on the front page, and the report title says it
again:

| Title | Meaning |
|---|---|
| `Kitsch QA — www.mykitsch.com — 2026-08-26` | Evidence about the real store. |
| `Kitsch QA — SELF-TEST against a local fixture, NOT the live store — …` | Proof the suite works. Says nothing about the store. |

A fixture report and a live report are visually identical apart from that line.
A green self-test pasted into a deck as "the site is clean" is the most
expensive mistake this repo can produce, so the distinction is repeated in the
title, in the environment block, and in the terminal output that built it.

If a results directory somehow contains both, `npm run report` refuses to build
and exits 2. Delete `allure-results/` and re-run one of them.

---

## Building a report

```bash
npm run report              # build from allure-results/
npm run report -- --open    # build and open it in a browser
npm run report:open         # open one already built
npm run report:clean        # delete results and report
```

The whole daily run, target to report, is one command:

```bash
npm run daily -- --base-url https://www.mykitsch.com
```

`daily` runs every stage regardless of what the previous one found. Chaining
the audits with `&&` gets this backwards: an audit exits 1 when it finds
something, so `&&` stops at the first real defect and never builds the report —
the one morning the report matters most is the morning it does not get made.

---

## What the report contains

### Categories — the front page

Findings are bucketed by consequence, not by test file:

| Bucket | Meaning |
|---|---|
| **Critical — customer cannot buy** | Blocks a purchase or shows a wrong price. Fix before the next ad spend. |
| **Major — customer sees something wrong** | Visible and damaging, purchase still completes. |
| **Minor — cosmetic or low impact** | Worth fixing, does not block a release. |
| **Could not check — NOT a pass** | The harness could not observe this. Not a store defect and not evidence the store is fine. |

That last bucket is the one worth understanding. Allure renders it as *broken*,
separately from *failed*, which is the only honest place for it. It is what the
repo calls a `harness` finding: our gap, not the store's.

### Suites — what was checked

Grouped as parent suite → item → check:

```
Daily — top 10 selling products
  └─ Self-Draining Soap Dish
       ├─ availability          passed
       ├─ add_to_cart           passed
       ├─ pricing               passed
       └─ …
```

Every check that ran gets a case, including the ones that passed. This is
deliberate: 9 failures out of 12 and 9 out of 600 describe very different
stores, and a report that lists only failures cannot tell them apart. Coverage
is the denominator and it has to be visible.

Checks switched off in config appear as **skipped**, never as passed — we did
not verify them.

### Severity

Our four levels map onto Allure's fixed scale, shifted up one because Allure's
top level is "blocker":

| Ours | Allure |
|---|---|
| critical | blocker |
| major | critical |
| minor | minor |
| harness | normal (and status *broken*) |

### History

Each case carries a stable `historyId` of `suite | item | check`, so a check
that fails three nights running shows as a trend rather than three unrelated
tests. History accumulates when the previous report is kept — CI does this via
the workflow artifact.

---

## How it is wired

Six of the eight things this repo runs are audit CLIs, not Playwright specs. A
report built from `allure-playwright` alone would show the render specs and
silently omit every daily check — the half a reader outside the team came for.
So both sources write into one results directory:

| Source | How it emits |
|---|---|
| Playwright specs | `allure-playwright` reporter, enabled by `KITSCH_ALLURE=<dir>` |
| The six audit CLIs | `tools/lib/allure.ts`, enabled by `--allure [dir]` |

Both default to `allure-results/`. Emission is opt-in in both cases: a
directory that silently accumulates results across unrelated runs produces a
report that describes no single run.

`tools/lib/allure.ts` holds the shared pieces — the case model, the severity
mapping, the categories, and `buildMatrix`, which crosses the items an audit
visited with the checks it ran and resolves each cell against the findings
raised. That function is what turns a list of failures into a coverage report.

The categories live in `tools/lib/allure.ts` and are read by `allurerc.ts`
(Allure 3's config) — one definition, because a severity scheme defined twice
will eventually disagree with itself about what "critical" means. They are
*also* written into `allure-results/categories.json`, which is where Allure 2's
`allure-commandline` looks, so a team standardised on the Java CLI gets the
same buckets.

---

## Running individual pieces with Allure

```bash
# an audit
npm run audit:top-products -- --base-url https://www.mykitsch.com --allure

# the Playwright specs
KITSCH_ALLURE=allure-results KITSCH_BASE_URL=https://www.mykitsch.com \
  npx playwright test --project=desktop-chrome
```

Windows CMD:

```cmd
set KITSCH_ALLURE=allure-results
set KITSCH_BASE_URL=https://www.mykitsch.com
npx playwright test --project=desktop-chrome
```

---

## Allure 2 instead of Allure 3

The repo uses Allure 3 (`allure`), which is a Node package and needs no Java.
The results directory is Allure-2 format, so `allure-commandline` works too if
your team already standardises on it:

```bash
npm i -D allure-commandline      # requires Java 8+
npx allure generate allure-results --clean -o allure-report
npx allure open allure-report
```

You lose the target-labelled title that `npm run report` adds, so check the
environment block on the front page instead.

---

## Sharing a report

`allure-report/` is a static site — about 4 MB, no server needed. Options:

- Zip it and send it. Opening `index.html` from disk works.
- `npx allure open allure-report` serves it locally.
- In CI it is uploaded as a workflow artifact (see `.github/workflows/pipeline.yml`).

The directory is gitignored. Reports are outputs; committing them makes the
repository grow without bound and makes it easy to open a stale one by
accident.
