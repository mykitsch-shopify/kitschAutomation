---
name: kitsch-qa-report
description: Turn a Kitsch QA run into a report the team can act on — separating "could not check" from "is broken", grading severity, and deciding what gets filed as a bug versus manually verified. Use when writing up any daily QA result, triaging a failing run, or preparing findings to send to the team.
---

# Writing up a Kitsch QA run

The single most expensive mistake in this project is reporting a blind harness
as a broken store. A live locale run once reported 136 failures; **129 were the
harness.** Anyone who read that count as defects would have sent seven people
looking for problems that did not exist.

## Step 1 — is the code current?

Before reading a single failure:

```bash
git fetch origin && git status -sb && git log --oneline -1
```

Three separate sessions have been spent re-diagnosing failures already fixed on
a branch nobody had checked out. A stale run quotes source lines and selectors
that no longer exist — grep the output for a string the current code introduced
and confirm it is there.

## Step 2 — bucket by root cause, not by test name

| Signature | Means | Report as |
|---|---|---|
| `COULD NOT CHECK` | Nothing was examined | **Not verified** — never a bug, never a pass |
| `COULD NOT COMPARE` | Two frames of different sizes | Not a visual regression |
| Plain assertion failure | The store may be wrong | Candidate bug — verify first |

**Never quote a failure count as a defect count.**

## Step 3 — the three questions per candidate

1. **Was anything actually read?** An unmapped selector, a 404, a 429, an empty
   element — all mean no.
2. **Does the baseline describe this store?** Positive-copy comparisons against
   the fixture catalogue measure the distance between two stores. The tell is
   the English row: English cannot be missing its own translation.
3. **Does it reproduce by hand, in incognito?** Do this before filing.

## Step 4 — severity

| Grade | Meaning |
|---|---|
| Critical | Customer cannot buy, or is charged wrong |
| High | Customer sees something wrong on the conversion path |
| Medium | Wrong but not on the path to purchase |
| Low | Cosmetic, or affects a low-traffic surface |

Untranslated copy in a market we sell to is **High** — that is the Translations
test plan's grading, and it is declared in `config/i18n.yaml` rather than
argued each time.

## Step 5 — the report

House format: **issues first with severity, then evidence, then a closing
comment.** Then two sections nobody skips:

**Not verified.** Everything the run could not reach, and why. Today that is:
live checkout in every locale (429 on an empty cart), positive translation copy
(no live catalogue), anything read through `site_header` (unmapped), promo-code
application (URL entry cannot apply a code), and BYOB builder flows (needs a
browser driving the builder).

**Known and already logged.** Triage against these before re-raising; several
recur daily and re-filing them is noise.

## What to send the team

File as a bug only what survives all three questions in step 3 and reproduces
by hand. For everything else say plainly which it is:

- *Harness gap* — ours to fix, not a store defect. Do not file.
- *Needs manual confirmation* — name the exact URL and what to look at.
- *Merchandising, not engineering* — e.g. a product not published to a market
  reads as a locale failure and is not one.

Confirmed bugs are worth stating with their evidence inline, so the reader does
not have to re-run anything to believe them.
