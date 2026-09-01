import { expect, test } from '@playwright/test';

import { loadVisualConfig, shotName } from '../lib/visual.js';

/**
 * Visual regression.
 *
 * Photographs each configured page at each configured viewport and compares it
 * against a committed baseline. The point is the class of defect nothing else
 * here can see: a page that is correct in every assertable way and wrong to
 * look at — a collapsed grid, a hero that stopped loading, copy overflowing a
 * button, a footer that has climbed into the header.
 *
 * ── Determinism is the whole job ─────────────────────────────────────────
 *
 * A screenshot diff fails on anything that moved, and on a storefront almost
 * everything moves. Every step below exists to remove a source of movement
 * that is not a regression, because a suite that fails every morning gets its
 * baselines re-blessed unread — and a re-blessed baseline is a check that has
 * been taught to agree with whatever it sees.
 *
 *   npm run visual              compare against the baselines
 *   npm run visual:bless        write new baselines, then READ THE DIFF
 *   npm run visual:detection    prove the comparison can still fail
 */

const config = loadVisualConfig();

test.describe('visual regression @visual', () => {
  for (const page of config.pages) {
    for (const viewport of config.viewports) {
      test(`${page.id} @ ${viewport.id} matches its baseline`, async ({ page: browserPage }) => {
        await browserPage.setViewportSize({ width: viewport.width, height: viewport.height });

        const response = await browserPage.goto(page.path, { waitUntil: 'load' });
        expect(
          response?.status(),
          `${page.path} did not load, so there was nothing to photograph. This is not a visual regression — it is a page that is down.`,
        ).toBe(200);

        // Stop everything that animates.
        //
        // Without this the diff catches a carousel mid-slide, a caret mid-blink
        // and a fade mid-fade — three failures a morning, none of them real.
        // `animation-play-state` alone is not enough: a transition already in
        // flight keeps going, so durations are zeroed too.
        await browserPage.addStyleTag({
          content: `
            *, *::before, *::after {
              animation-duration: 0s !important;
              animation-delay: 0s !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0s !important;
              transition-delay: 0s !important;
              caret-color: transparent !important;
              scroll-behavior: auto !important;
            }
          `,
        });

        // Lazy images load on scroll, so a screenshot of an unscrolled page is
        // a screenshot of placeholders — and which placeholders depends on how
        // fast the machine is. Walk the page to trigger them, then come back.
        //
        // The walk is bounded and then waits for the page to stop growing,
        // which the first version did neither of. It re-read
        // `document.body.scrollHeight` on every iteration, so on a grid that
        // appends products as you scroll it chased a moving target: where it
        // stopped depended on network timing, and the page ended up a
        // different height on every run. That is the harness deciding how much
        // of the store to photograph, and it is indistinguishable in the
        // report from the store having changed.
        await browserPage.evaluate(async () => {
          const settle = (ms: number): Promise<void> =>
            new Promise((resolve) => setTimeout(resolve, ms));

          const step = window.innerHeight;
          // Capped so an infinite-scroll grid cannot walk forever. 40 screens
          // is far past any page worth a full-frame baseline.
          for (let index = 0; index < 40; index += 1) {
            const y = index * step;
            if (y >= document.body.scrollHeight) break;
            window.scrollTo(0, y);
            await settle(60);
          }

          // Then hold until the document stops growing. Without this the shot
          // can be taken while a final batch is still being appended, and the
          // frame height becomes a race.
          let previous = -1;
          for (let attempt = 0; attempt < 20 && previous !== document.body.scrollHeight; attempt += 1) {
            previous = document.body.scrollHeight;
            await settle(150);
          }

          window.scrollTo(0, 0);
        });

        // Then wait for the images to actually arrive. `load` fired before the
        // lazy ones were requested at all.
        await browserPage
          .waitForFunction(
            () => Array.from(document.images).every((image) => image.complete),
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => undefined);

        try {
          await expect(browserPage).toHaveScreenshot(shotName(page.id, viewport.id), {
            fullPage: true,
            // A declared clip makes the frame a fixed size, so a page whose
            // length moves with the catalogue still has a comparable baseline.
            ...(page.clipHeightPx === undefined
              ? {}
              : {
                  clip: { x: 0, y: 0, width: viewport.width, height: page.clipHeightPx },
                }),
            // Masked regions are painted over before comparison. Each one is a
            // declared blind spot with a reason in config/visual.yaml.
            mask: config.masks.map((entry) => browserPage.locator(entry.selector)),
            maxDiffPixelRatio: config.maxDiffRatio,
            threshold: config.pixelThreshold,
            animations: 'disabled',
            timeout: config.stabilityTimeoutMs,
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);

          // A different-SIZED frame is not a measured visual difference, and
          // Playwright's pixel count says otherwise in a way that misleads.
          //
          // Live run: baseline 390x6044, actual 390x5626, "622608 pixels
          // (ratio 0.27 of all image pixels) are different". Only 163,020
          // pixels of content actually went missing (390 x 418). The other
          // 460,000 are everything below the change shifted up by one grid row
          // and counted as different — so 0.27 measures displacement, not
          // repainting, and reads in the report as a catastrophic regression.
          //
          // The honest reading of a height change on a paginated grid is "the
          // page has a different amount of content on it than when the
          // baseline was taken", which is a merchandising question, not a
          // layout one.
          const sizes = /an image (\d+)px by (\d+)px, received (\d+)px by (\d+)px/u.exec(message);
          if (sizes !== null) {
            const [, baseW, baseH, gotW, gotH] = sizes;
            const delta = Number(gotH) - Number(baseH);
            throw new Error(
              `COULD NOT COMPARE — ${page.path} at ${viewport.id} is a different size than its ` +
                `baseline (${String(baseW)}x${String(baseH)} then, ${String(gotW)}x${String(gotH)} now: ` +
                `${delta > 0 ? '+' : ''}${String(delta)}px tall).\n\n` +
                `Two frames of different sizes were not compared pixel-for-pixel, so ignore the ` +
                `ratio in the message below — everything past the first change counts as ` +
                `different simply because it moved, and that number measures displacement rather ` +
                `than how much of the page repainted.\n\n` +
                `On a full-page shot of a grid or feed this almost always means the page has a ` +
                `different amount of content on it than when the baseline was taken — a product ` +
                `added or sold out, a row of results gone. That is merchandising, not a layout ` +
                `regression, and re-blessing teaches the baseline to agree with today's catalogue ` +
                `and nothing more.\n\n` +
                `If this page's content changes on its own schedule, give it a clip_height_px in ` +
                `config/visual.yaml so the shot covers the part whose LAYOUT is worth a baseline ` +
                `and stops before the part whose CONTENT is not.\n\n` +
                `Playwright's own account:\n${message}`,
              { cause },
            );
          }

          // "Failed to take two consecutive stable screenshots" is not a
          // regression, and the raw message does not say so. It means the page
          // never held still: Playwright compares consecutive shots for EXACT
          // equality before it compares anything to a baseline, so no
          // `maxDiffPixelRatio` relaxes it. Against the live homepage this
          // reported 725k, 191k, 188k then 321k differing pixels — 4-14% of
          // the frame still moving — and read in the report as a visual defect.
          if (!message.includes('consecutive stable screenshots')) throw cause;
          throw new Error(
            `COULD NOT CHECK — ${page.path} at ${viewport.id} never held still, so no ` +
              `screenshot was compared and this is not a visual regression.\n\n` +
              `Something on the page is still animating after ` +
              `${String(config.stabilityTimeoutMs)}ms with animations disabled and every ` +
              `configured mask applied. A wider max_diff_ratio will NOT fix this — the ` +
              `stability check is a separate gate and demands exact equality.\n\n` +
              `The fix is to find what is moving and mask it (with a reason), or to drop ` +
              `this page from config/visual.yaml. A page that will not hold still has no ` +
              `meaningful baseline.\n\n` +
              `Playwright's own account of what moved:\n${message}`,
            { cause },
          );
        }
      });
    }
  }
});
