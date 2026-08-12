import { expect, test } from '@playwright/test';

import { resolveLaunchHandle } from '@kitsch/fixtures/launch-set.js';

import { loadI18nConfig, targetLocales } from '../lib/config.js';
import { describeDefects, findEncodingDefects, matchesScript } from '../lib/text-integrity.js';
import { englishSentinels, expectedValue, showsEnglish } from './baseline.js';

/**
 * Locale parity — render layer.
 *
 * Deliberately thin. The content-layer run (`npm run i18n:parity`) already
 * compares every translatable string without a browser; re-asserting that
 * here would cost twice and pay once. These specs cover only what the DOM can
 * show that the API cannot:
 *
 *   1. locale routing and `html[lang]` actually applied
 *   2. hreflang alternates wired for every declared market
 *   3. untranslated / broken-interpolation markers rendered to the customer
 *   4. price formatted to the market's convention, and no layout overflow
 *   5. meta title and description served in-locale (invisible on the page,
 *      which is exactly why an API-shaped check misses it going stale)
 *   6. characters surviving all the way to the rendered page — a catalogue
 *      can be clean UTF-8 and still reach the customer as mojibake if a
 *      template, a header or a font gets it wrong
 *
 * Runs at 390px because 80% of traffic is mobile.
 */

const config = loadI18nConfig();
const smokeRoutes = config.routes.filter((route) => route.tags.includes('@smoke'));

const localizedPath = (localeCode: string, path: string): string => {
  const resolved = path.replace('{launch_handle}', resolveLaunchHandle());
  return localeCode === config.sourceLocale ? resolved : `/${localeCode}${resolved}`;
};

test.describe('locale shell @i18n @smoke', () => {
  for (const locale of config.locales) {
    for (const route of smokeRoutes) {
      test(`${locale.code} — ${route.name} renders in-locale`, async ({ page }) => {
        const response = await page.goto(localizedPath(locale.code, route.path));
        expect(
          response?.status(),
          'localized route must resolve without a redirect chain to /en',
        ).toBe(200);

        await expect(page.locator('html')).toHaveAttribute(
          'lang',
          new RegExp(`^${locale.code}`, 'i'),
        );

        // Every declared market needs an alternate, or the localized page is
        // invisible to search in that market — a discovery defect, not cosmetic.
        for (const alternate of config.locales) {
          await expect(
            page.locator(`link[rel="alternate"][hreflang^="${alternate.code}"]`),
            `hreflang alternate for ${alternate.code} is missing`,
          ).toHaveCount(1);
        }

        const body = page.locator('body');

        // Shopify renders this literal when a key is missing at request time.
        await expect(body).not.toContainText('translation missing');
        // Unresolved interpolation reaching the customer.
        await expect(body).not.toContainText('{{');
      });

      test(`${locale.code} — ${route.name} fits the mobile viewport`, async ({ page }) => {
        await page.goto(localizedPath(locale.code, route.path));
        await expect(page.getByTestId('site-header')).toBeVisible();

        const overflowPx = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          overflowPx,
          `horizontal overflow in ${locale.code} — long strings (typically de) are breaking the layout`,
        ).toBeLessThanOrEqual(config.thresholds.overflowPx);
      });
    }
  }
});

test.describe('locale price formatting @i18n @launch', () => {
  for (const locale of targetLocales(config)) {
    test(`${locale.code} — PDP price uses ${locale.market} convention`, async ({ page }) => {
      await page.goto(localizedPath(locale.code, `/products/${resolveLaunchHandle()}`));

      const priceText = await page.getByTestId('pdp-price').innerText();

      // Format only. Whether the amount agrees with NetSuite is the
      // reconciliation engine's claim, not this spec's.
      expect(
        priceText.trim(),
        `price "${priceText.trim()}" does not match the ${locale.currency} pattern for ${locale.market}`,
      ).toMatch(locale.pricePattern);
    });
  }
});

/**
 * Test plan §11.1 — the systematic "is any English still showing" scan, which
 * is the single most repetitive part of the manual pass.
 *
 * Sentinels come from the English baseline the content layer pulled, and only
 * for keys whose contracted translation actually differs from English. That
 * is what keeps it from firing on "Collections", which is the same word in
 * four of these locales.
 */
test.describe('no untranslated strings @i18n @smoke', () => {
  for (const locale of targetLocales(config)) {
    for (const route of smokeRoutes) {
      test(`${locale.code} — ${route.name} shows no English fallback copy`, async ({ page }) => {
        await page.goto(localizedPath(locale.code, route.path));
        const text = await page.locator('body').innerText();

        const leaked = englishSentinels(locale.code).filter((sentinel) =>
          showsEnglish(text, sentinel.english),
        );

        expect(
          leaked.map((sentinel) => `${sentinel.key}: "${sentinel.english}" (expected "${sentinel.expected}")`),
          `English strings are rendering in ${locale.code} mode`,
        ).toEqual([]);
      });
    }
  }
});

/**
 * Test plan §6.2, §7.2, §8.2, §9.2, §12 — characters have to survive the
 * template and the transport, not just the translation table.
 */
test.describe('character integrity @i18n @smoke', () => {
  for (const locale of config.locales) {
    for (const route of smokeRoutes) {
      test(`${locale.code} — ${route.name} renders without encoding damage`, async ({ page }) => {
        await page.goto(localizedPath(locale.code, route.path));
        const text = await page.locator('body').innerText();

        const defects = findEncodingDefects(text);
        expect(
          defects.length === 0 ? '' : describeDefects(defects),
          `encoding damage rendered in ${locale.code}`,
        ).toBe('');
      });
    }
  }

  for (const locale of targetLocales(config).filter((entry) => entry.expectScript !== undefined)) {
    test(`${locale.code} — page renders in the ${locale.market} writing system`, async ({ page }) => {
      await page.goto(localizedPath(locale.code, '/'));
      const heading = await page.getByTestId('hero-heading').innerText();

      const script = locale.expectScript;
      expect(script, 'locale declares an expected script').toBeDefined();
      expect(
        script !== undefined && matchesScript(heading, script),
        `hero heading "${heading}" contains no ${locale.market} script characters — the font or the locale routing is wrong`,
      ).toBe(true);
    });
  }
});

/**
 * Test plan §14 — meta title and description.
 *
 * Worth its own spec precisely because it is invisible on the page: nobody
 * notices an English meta description in French mode by looking at the site,
 * which is how it survives a manual pass and reaches search results.
 */
test.describe('meta translation @i18n @launch', () => {
  const metaRoutes = [
    { path: '/', titleKey: 'meta.home_title', descriptionKey: 'meta.home_description' },
    {
      path: `/products/${resolveLaunchHandle()}`,
      titleKey: 'meta.pdp_title',
      descriptionKey: 'meta.pdp_description',
    },
  ] as const;

  for (const locale of targetLocales(config)) {
    for (const route of metaRoutes) {
      test(`${locale.code} — ${route.path} meta title and description are localized`, async ({
        page,
      }) => {
        await page.goto(localizedPath(locale.code, route.path));

        const title = await page.title();
        const description =
          (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';

        expect(title.trim(), 'meta title must not be empty').not.toBe('');
        expect(description.trim(), 'meta description must not be empty').not.toBe('');

        for (const [label, value, key] of [
          ['title', title, route.titleKey],
          ['description', description, route.descriptionKey],
        ] as const) {
          const english = expectedValue('en', key);
          const expectedLocalized = expectedValue(locale.code, key);

          if (english !== undefined && expectedLocalized !== undefined && english !== expectedLocalized) {
            expect(
              value.trim(),
              `meta ${label} is still the English string in ${locale.code} — invisible on the page, visible in search results`,
            ).not.toBe(english.trim());
          }

          expect(
            describeDefects(findEncodingDefects(value)),
            `meta ${label} carries encoding damage in ${locale.code}`,
          ).toBe('');
        }
      });
    }
  }
});

/**
 * Test plan §15 — checkout. Field labels and validation messages, which are
 * the part of the funnel a customer cannot skip and the part most often left
 * behind when translations are added surface by surface.
 */
test.describe('checkout translation @i18n @launch', () => {
  for (const locale of targetLocales(config)) {
    test(`${locale.code} — checkout form labels are localized`, async ({ page }) => {
      await page.goto(localizedPath(locale.code, '/checkout'));

      const labels = page.getByTestId('checkout-field-label');
      await expect(labels.first()).toBeVisible();
      expect(await labels.count(), 'checkout form must render its field labels').toBeGreaterThan(0);

      const text = await page.getByTestId('checkout-form').innerText();
      const leaked = englishSentinels(locale.code)
        .filter((sentinel) => sentinel.key.startsWith('checkout.'))
        .filter((sentinel) => showsEnglish(text, sentinel.english));

      expect(
        leaked.map((sentinel) => `${sentinel.key}: "${sentinel.english}"`),
        `checkout form shows English labels in ${locale.code} mode`,
      ).toEqual([]);
    });

    test(`${locale.code} — checkout validation errors are localized`, async ({ page }) => {
      await page.goto(localizedPath(locale.code, '/checkout'));
      await page.getByTestId('checkout-continue').click();

      const errors = page.getByTestId('checkout-error');
      await expect(errors.first()).toBeVisible();

      const message = (await errors.first().innerText()).trim();
      const english = expectedValue('en', 'checkout.error_required');
      const expectedLocalized = expectedValue(locale.code, 'checkout.error_required');

      if (english !== undefined && expectedLocalized !== undefined && english !== expectedLocalized) {
        expect(
          message,
          `validation error is still English in ${locale.code} — submitted an incomplete form and got "${message}"`,
        ).not.toBe(english);
      }
      expect(
        describeDefects(findEncodingDefects(message)),
        `validation error carries encoding damage in ${locale.code}`,
      ).toBe('');
    });
  }
});
