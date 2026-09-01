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
        await browserPage.evaluate(async () => {
          const step = window.innerHeight;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 60));
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

        await expect(browserPage).toHaveScreenshot(shotName(page.id, viewport.id), {
          fullPage: true,
          // Masked regions are painted over before comparison. Each one is a
          // declared blind spot with a reason in config/visual.yaml.
          mask: config.masks.map((entry) => browserPage.locator(entry.selector)),
          maxDiffPixelRatio: config.maxDiffRatio,
          threshold: config.pixelThreshold,
          animations: 'disabled',
        });
      });
    }
  }
});
