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
    ├── fixture-linux/       committed and reviewed
    │   ├── home-mobile.png
    │   └── …
    └── live-win32/          somebody's photograph of the real store
```

**`fixture-` and `live-` are separate on purpose.** Without that split they
collided: blessing against mykitsch.com overwrote the fixture baseline of the
same name, and the next offline run compared the fixture to a photograph of the
real store. The `{platform}` half is there because font rendering differs — a
baseline made on Windows cannot be met on Linux.

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

**A bless immediately followed by a compare is a weak signal.** Nine of ten
shots passing that way proves the store held still for three minutes — not
that the baselines are right, and not that the suite would notice a regression
tomorrow. The number worth watching is the second morning's run, against
baselines nobody has touched since.

### When a page will not hold still

The first live bless failed on `home @ desktop` with *"Failed to take two
consecutive stable screenshots"* — 725k, then 191k, then 188k, then 321k
differing pixels between consecutive shots, 4–14% of the frame still moving
after 20 seconds.

**That is not a regression and no threshold fixes it.** Before comparing
anything to a baseline, Playwright takes screenshots until two consecutive ones
are *identical*. It is a separate gate from `max_diff_ratio`, and a page that
never settles can never be photographed however wide the tolerance.

The suite now reports it as COULD NOT CHECK, with Playwright's own account of
what moved. When you see it:

1. Find what is animating and **mask it, with a reason**. The masks added for
   this failure — announcement bar, carousels, the Rivo widget — are all things
   this theme animates on its own schedule.
2. If it still will not settle, **drop the page from `config/visual.yaml`**.

Do not raise `stability_timeout_ms` past the point where it is buying real
settling, and never widen `max_diff_ratio` to make it go away: that knob does
not apply to this gate, and a page that will not hold still has no meaningful
baseline.

### When the page is a different height than its baseline

The first live comparison failed on `collection @ mobile` like this:

```
Expected an image 390px by 6044px, received 390px by 5626px.
622608 pixels (ratio 0.27 of all image pixels) are different.
```

**Read the two sizes, not the ratio.** Only 163,020 pixels of content actually
went missing — 390 × the 418px difference, about one row of a mobile product
grid. The other 460,000 are everything below that row shifted up and counted as
different. The ratio measures *displacement*, not repainting, and read as a
percentage it looks like a quarter of the page broke. Nothing broke.

Two frames of different sizes are not compared pixel-for-pixel at all, so no
`max_diff_ratio` and no mask changes the outcome. The suite now reports this as
COULD NOT COMPARE, with both sizes and the delta.

On a grid or a feed it almost always means the page has a different amount of
content on it than when the baseline was taken — a product added or sold out.
That is merchandising, and re-blessing only teaches the baseline to agree with
today's catalogue.

The fix is `clip_height_px`:

```yaml
  - id: collection
    path: /collections/all
    why: 'Grid layout — the thing most likely to collapse on a breakpoint change.'
    clip_height_px: 2400
```

It photographs the first N px instead of the whole page, which makes the frame
a fixed size. The judgement it encodes is worth stating: this shot exists to
catch a grid **collapsing**, and that shows in the first rows. The remaining
4,000px is product photography that turns over weekly and was never what the
baseline was for. Clipping is a coverage decision — make it where the page's
layout is worth a baseline and its content is not, and leave it off anything
with a bounded, designed length.

### The fixture has to resemble the page in the ways the check depends on

The fixture's collection page used to serve **one** product card, in a `<ul>`
with no grid. So the offline baseline was a photograph of a list item: a grid
of one cannot collapse, and the check could not have failed for the reason it
was written for. It was also 844px tall against the live page's 6,000px, which
is why nothing offline resembled the store closely enough to predict the
failure above.

It now serves 24 cards in a real two-then-four-column grid. That is what makes
`clip_height_px` exercised offline rather than only against the store — the
mobile shot is 2400px and clipped, the desktop one is 2083px and is not.

Before pointing at the store, be clear about what you are signing up for: every
banner change, every price change and every new review count becomes a diff
somebody has to triage. The masks in `config/visual.yaml` are written for this, but a
live baseline needs a person who will look at the failures rather than re-bless
them. If nobody has that time, the fixture baselines still catch theme and
template regressions and cost nothing to keep.
