# Visual regression

## What it is for

Every other check in this repository reads the DOM: a price is present, a
selector matches, a string is translated. None of them notice a collapsed grid,
a hero image that stopped loading, a footer that has climbed into the header, or
German copy overflowing a fixed-width button. Those reach the customer as "the
site is broken" and reach us as nothing at all.

This suite photographs a small set of pages and compares them against committed
baselines.

## The honest-baseline problem

A screenshot diff fails on anything that moved, and on a live storefront almost
everything moves — a rotating banner, a review count, a lazily-loaded image, an
A/B variant. A suite that cries wolf every morning gets its baselines
re-blessed without being looked at.

**A re-blessed baseline is worse than no baseline.** It is a check that has been
taught to agree with whatever it sees, and it reports green forever.

Three rules hold the line, and they are the whole design:

1. **Mask what is legitimately dynamic.** Every mask in `config/visual.yaml`
   carries a `why`, and the loader *refuses a mask without one* — a mask is a
   declared blind spot, and one added without a reason is indistinguishable
   from one added to silence a failing check.
2. **Freeze what can be frozen.** Animations, transitions, carousel autoplay
   and caret blink are all zeroed before the shot. Lazy images are triggered by
   scrolling the page and then waited for, because `load` fires before they are
   requested at all.
3. **Compare at a threshold, not pixel-exact.** Font hinting and sub-pixel
   antialiasing differ between machines. `max_diff_ratio: 0` would mean the
   suite only ever passes on the machine that made the baseline, and the loader
   rejects both 0 and 1 with that reason.

## Layout

```
visual/
├── lib/visual.ts            config loading and the pure decisions
├── lib/visual.test.ts       every way the config can stop checking anything
├── specs/…spec.ts           the suite
└── baselines/
    └── visual-linux/        {projectName}-{platform}: a mac baseline
        ├── home-mobile.png  cannot be met on Linux, so they never collide
        └── …
```

Baselines are **committed**. A baseline nobody can review in a diff is not a
baseline, and the filenames are readable (`home-mobile.png`, not a hash) for
exactly that reason.

## Commands

```bash
npm run visual              # compare against the baselines
npm run visual:bless        # write new baselines — then READ THE DIFF
npm run visual:detection    # prove the comparison can still fail
```

`visual:bless` is not a fix. It records whatever is on screen as correct, so
the diff it produces is the only thing standing between an intended change and
a regression. Read it before committing.

## The detection control

`npm run visual:detection` asks three questions the suite cannot ask about
itself:

1. **Are there baselines at all?** With none, `toHaveScreenshot` writes one and
   reports a pass — a photograph, not a comparison.
2. **Is every configured shot blessed?** A page added to the config and never
   blessed passes the same way.
3. **Does a real visual change fail?** The seeded storefront profile overflows
   the German layout past a 390px viewport; the comparison must catch it.

Question 3 earned its place immediately. The first version of
`config/visual.yaml` photographed English pages only, and the control failed:
the seeded German overflow passed, because no configured shot was ever in
German. That is precisely the hole a screenshot suite exists to close — copy in
every market this store sells to is longer than the English it was laid out
for. `/de/` is now in the config, and the control passes.

## Pointing it at the live store

The committed baselines are of the **fixture**, which is deterministic. A live
baseline is a legitimate thing to want and is a different artifact: it belongs
to one store, one viewport set and one moment in the merchandising calendar.

```bash
set "KITSCH_BASE_URL=https://www.mykitsch.com"
npm run visual:bless
npm run visual
```

Before doing that, be clear about what you are signing up for: every banner
change, every price change and every new review count becomes a diff somebody
has to triage. The masks in `config/visual.yaml` are written for this, but a
live baseline needs a person who will look at the failures rather than re-bless
them. If nobody has that time, the fixture baselines still catch theme and
template regressions and cost nothing to keep.
