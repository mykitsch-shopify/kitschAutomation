---
name: kitsch-daily-qa
description: Index and runner for the whole daily QA pass on mykitsch.com. Routes to the focused skills for landing pages, site QA, translation and top sellers, and runs everything in one command. Use for "daily QA", "run the daily tasks", "morning QA", or when you do not know which QA skill applies.
---

# Kitsch daily QA — index

Four focused skills do the work. This one routes and runs them together. Load a
child directly when you know which you want; each is self-contained and none
needs its Asana task pasted in.

| Skill | Covers | Asana |
|---|---|---|
| `kitsch-lp-qa` | Ad-traffic landing pages, Welcome Kits, BYOBs, discount redirects, non-stacking, auto-ship, compare-at | 1218024537034778, 1218024873228422 |
| `kitsch-site-qa` | Product pages, cart, UI/UX, FAQs, header, footer, banners, offers, visual regression | 1218053338721930 |
| `kitsch-translation-qa` | ES/DE/IT/FR parity, untranslated strings, closing the Asana backlog | Translate Product ×93 |
| `kitsch-top-sellers` | Top-10 product pages | subtask: Product Page Validation |
| `kitsch-qa-report` | How to write any of it up | — |

## Run everything

```bash
git pull
set "KITSCH_BASE_URL=https://www.mykitsch.com"
npm run preflight
npm run daily -- --base-url https://www.mykitsch.com
set "KITSCH_BASE_URL="
npm run report
```

`npm run daily` runs every stage regardless of what fails and carries the worst
exit code to the end — chaining with `&&` would stop at the first real defect
and never build the report, on the morning the report matters most.

Exit codes: `0` clean, `1` findings to act on, **`2` at least one stage could
not check — which is never a pass.**

## Order of work

1. **`git pull` first.** Three sessions have gone into re-diagnosing failures
   already fixed on a branch nobody had checked out.
2. **`npm run preflight`.** A selector that matches nothing — or matches
   something blank — reports a defect that is not there. Fix the harness before
   spending a run.
3. **Run.** `npm run daily`, or the individual audits from the child skills.
4. **Split "could not check" from "is broken"** before counting anything. See
   `kitsch-qa-report`; this is where the value is, and where the mistakes are.
5. **Write it up** in the house format, with a "Not verified" section.

## Offline gates — cheap, and they must be green first

A live result from a harness that is not itself green is a number of unknown
provenance, and under time pressure it gets read as a pass.

```bash
npm run test:unit
npm run parity:clean
npm run test:detection
npm run gate:release
```

## Token discipline

This project generates enormous run output. Reading it wholesale is the main
cost, and it is avoidable.

**Bucket before reading.** A 4,500-line Playwright log has maybe eight distinct
causes. Count them first, then read one example of each:

```bash
grep -oE "COULD NOT CHECK[^\"]*|Error: [^\"]{0,60}" Error.txt | sort | uniq -c | sort -rn | head
```

**Never paste a task description that a skill already carries.** Every scope
list from Asana is transcribed into the skill that owns it. Paste only what is
new — a comment, an attachment, a changed reference sheet.

**Prefer the machine-readable artifact.** `i18n-report/**/parity.json`,
`review-report/review.json` and the Allure results are structured; the console
transcript is not. Query the JSON rather than scrolling the log.

**Send files, do not paste them.** Attach `Error.txt` rather than pasting it —
it can then be grepped instead of read into context.

**Ask for the failure summary, not the run.** The tail block listing failed test
names is a few dozen lines and carries the same information as thousands.

**One target per run.** A fixture run and a live run answer different questions;
mixing them in one report doubles the reading and halves the trust.
