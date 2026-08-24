# Translation backlog — verification

The Asana board carries ~93 open "Translate Product" tasks, auto-created from a
translation audit on **2026-05-27**. This checks whether each is still true.

Contract: [`data/translation-backlog/asana-tasks.json`](../data/translation-backlog/asana-tasks.json) (snapshot, see §5).

---

## 1. What this does and does not do

**Does not write translations.** A brand's product copy in six languages is a
professional translation job and a business decision. Nothing here proposes,
generates or applies copy.

**Does not change anything in Asana.** It reads a task export and reports. No
task is closed, commented on or reassigned — those are decisions for a person,
and an automated close on a wrong verdict is worse than no check at all.

**Does** answer the question the board cannot: of the 93 open tasks, which are
already done? The audit that created them is three months old. The backlog's
real problem is not that the work is unknown — it is that nobody knows which of
the ninety-three are stale.

---

## 2. Run it

```bash
KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:translation-backlog
npm run test:translation-backlog-detection    # prove the verdicts are right
```

Useful flags: `--limit 10` for a smoke run, `--tasks <path>` for a fresh export,
`--locale-prefix '/{locale}'` if market URLs are shaped differently, plus the
shared `--browser` / `--headed` / `--viewport`.

Exit codes: `0` every open task still true, `1` the board is out of date,
`2` could not check.

---

## 3. Verdicts

| Verdict | Meaning | What to do |
|---|---|---|
| `closeable` | Every locale the task names now shows localized copy | Close it — a person's call |
| `partial` | Some locales done, some not | Narrow the task to the locales still named |
| `still_open` | Unchanged since the audit | Leave it |
| `stale_product` | The handle 404s in every locale | The task outlived its product |
| `unverified` | Could not read the copy | Our gap, not a statement about the store |

---

## 4. How "translated" is decided

**By difference from English, not by presence of text.** Shopify falls back to
the source language when a translation is missing, so an untranslated page is
never empty — it is English. Checking "is there copy?" would mark the entire
backlog done.

**Field by field, not as one blob.** Title and description are compared
separately, because the common half-done state is a translated title above an
English description. Merged into one string that page differs from English
overall and reads as translated — passing a product whose description was never
touched. The fixture plants exactly that case (`title-only-translated`) and the
control asserts it comes back `still_open`.

**By distinctive phrase, not whole string.** A phrase of four-plus words and
twenty-plus characters surviving verbatim in another language means the copy
was not translated. Brand names — *Kitsch*, *Bridgerton*, *Star Wars* —
legitimately stay English everywhere and fall well under that bar, so they are
not flagged.

---

## 5. The task export is a snapshot

`data/translation-backlog/asana-tasks.json` was captured **2026-08-24** from an
Asana search for incomplete "Translate Product" tasks. It goes stale as the
board moves. Refresh it by re-exporting to the same shape:

```json
{ "captured": "YYYY-MM-DD",
  "tasks": [{ "gid": "...", "name": "...", "notes": "...", "due_on": "..." }] }
```

### Parsing, and what running it against real data found

Task notes come in three shapes, all load-bearing:

1. `Product handle: x` on its own line — the auto-created majority
2. A product URL only — the hand-written ones
3. `Product: Name (handle: x)` inline — a re-work task in a different format

Shapes 2 and 3, plus collection-scoped URLs like
`/collections/tennis-collection/products/x`, were each being **silently
dropped** by the first version of the parser. Four real tasks were invisible.
That is why the report names tasks it could not parse instead of omitting them:
a backlog check that quietly covers less than the backlog is worse than one
that admits the gap.

Current parse of the snapshot: **93 of 100** tasks resolve to a product handle,
**495** handle × locale checks, **6** named a translation with no product link
and are reported as needing one.

---

## 6. Why the verdicts are trusted

```
npm run test:translation-backlog-detection
```

The consequence of a wrong verdict is asymmetric — a false `closeable` closes a
task on work that was never done, and nobody finds out until a customer sees
English copy in Spanish. So every verdict is exercised against a fixture built
to produce a known answer:

```
  correct   closeable      fully-translated
  correct   still_open     not-translated
  correct   partial        half-translated
  correct   still_open     title-only-translated
  correct   stale_product  gone-product
  correct   reported a task with no product URL

  verdicts checked 6 | correct 6
```

---

## 7. Has it run against mykitsch.com?

**No.** Attempted; every page failed at this sandbox's egress policy — see
[`LIVE-RUN.md`](LIVE-RUN.md):

```
  ?      satin-pillowcase-in-aura-2-pack
  closeable 0 | partial 0 | still open 0 | stale 0 | unverified 3
  backlog: INCOMPLETE — nothing loaded, no task was verified
```

Note what it did **not** report: zero closeable. A run that reached nothing
cannot produce a single "this task is done", which is the only way this tool
could do harm.

From a normal machine the full run is ~93 tasks × 7 page loads. Expect
`unverified` on the first run until the title and description selectors are
mapped to the live theme — unmapped selectors are harness gaps and never a
verdict about a task.

---

## 8. What it does not cover

The board also holds translation tasks that are not per-product:

- **"Translate Banners to other languages"** (three separate tasks) — theme
  content, not a PDP. Needs the banner surface named before it can be checked.
- **"Translate 'Our Founder' page"** — a content page; the same check would work
  against a page URL, which the config does not yet take.
- Four 2025 subtasks named only `translate to french` / `german` / `spanish` /
  `italian`, with no product and no parent context.

These are reported as "no product URL" rather than counted as covered.
