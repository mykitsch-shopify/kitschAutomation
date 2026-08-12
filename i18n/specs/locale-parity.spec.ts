import { expect, test } from '@playwright/test';

import { resolveLaunchHandle } from '@kitsch/fixtures/launch-set.js';

import { loadI18nConfig, targetLocales } from '../lib/config.js';
import { describeDefects, findEncodingDefects, matchesScript } from '../lib/text-integrity.js';
import { englishSentinels, renderedFragments, showsEnglish } from './baseline.js';

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

/**
 * Routes a browser can simply visit. The order-confirmation route needs an
 * order to exist, so it is handled separately rather than reporting a 404 as
 * a translation defect.
 */
const browsableRoutes = config.routes.filter((route) => !route.tags.includes('@order'));

const localizedPath = (localeCode: string, path: string): string => {
  const resolved = path.replace('{launch_handle}', resolveLaunchHandle());
  return localeCode === config.sourceLocale ? resolved : `/${localeCode}${resolved}`;
};

/** Route tags travel into the test title, so `--grep @smoke` selects correctly. */
const tags = (route: { readonly tags: readonly string[] }): string =>
  ['@i18n', ...route.tags].join(' ');

/**
 * These are three separate tests rather than one, deliberately. As a single
 * test the first failing assertion hides the rest, so a missing hreflang
 * masks a leaked `{{ amount }}` on the same page and the report understates
 * how much is wrong.
 */
/**
 * Logic that needs branching lives here rather than inside a test body.
 *
 * Two reasons, and the second is the real one: `playwright/no-conditional-in-test`
 * bans it, and the rule is right — a branch inside a test is one step from an
 * assertion that only sometimes runs, which is the failure mode this whole
 * suite is built to avoid.
 */

const TEMPLATE_MARKERS = [
  // Shopify renders this literal when a key is missing at request time.
  ['translation missing', 'a key is unresolved at request time'],
  // Unresolved interpolation reaching the customer.
  ['{{', 'a Liquid variable was never bound'],
] as const;

/** Markers that reached the customer, each quoted with its surrounding text. */
const leakedMarkers = (text: string): readonly string[] =>
  TEMPLATE_MARKERS.flatMap(([marker, meaning]) => {
    const index = text.indexOf(marker);
    return index < 0
      ? []
      : [`"${marker}" (${meaning}) near: ${text.slice(Math.max(0, index - 30), index + 50).replace(/\n/gu, ' ')}`];
  });

/** Contracted fragments for `keys` that are absent from `text`. */
const missingCopy = (locale: string, keys: readonly string[], text: string): readonly string[] =>
  keys.flatMap((key) => {
    const absent = renderedFragments(locale, key).filter((fragment) => !text.includes(fragment));
    return absent.length === 0 ? [] : [`${key}: expected "${absent.join('", "')}"`];
  });

/** How many of `keys` the baseline actually contracts a value for. */
const contractedCount = (locale: string, keys: readonly string[]): number =>
  keys.filter((key) => renderedFragments(locale, key).length > 0).length;

test.describe('locale shell', () => {
  for (const locale of config.locales) {
    for (const route of browsableRoutes) {
      test(`${locale.code} — ${route.name} resolves and applies lang ${tags(route)}`, async ({
        page,
      }) => {
        const response = await page.goto(localizedPath(locale.code, route.path));
        expect(
          response?.status(),
          'localized route must resolve without a redirect chain to /en',
        ).toBe(200);

        await expect(page.locator('html')).toHaveAttribute(
          'lang',
          new RegExp(`^${locale.code}`, 'i'),
        );
      });

      test(`${locale.code} — ${route.name} declares hreflang alternates ${tags(route)}`, async ({
        page,
      }) => {
        await page.goto(localizedPath(locale.code, route.path));

        // Every declared market needs an alternate, or the localized page is
        // invisible to search in that market — a discovery defect, not cosmetic.
        const counts = await Promise.all(
          config.locales.map(async (alternate) => ({
            code: alternate.code,
            count: await page
              .locator(`link[rel="alternate"][hreflang^="${alternate.code}"]`)
              .count(),
          })),
        );
        const missing = counts
          .filter((entry) => entry.count !== 1)
          .map((entry) => `${entry.code} (found ${String(entry.count)})`);

        expect(missing, `hreflang alternates missing on the ${locale.code} ${route.name}`).toEqual(
          [],
        );
      });

      test(`${locale.code} — ${route.name} leaks no template markers ${tags(route)}`, async ({
        page,
      }) => {
        await page.goto(localizedPath(locale.code, route.path));
        const text = await page.locator('body').innerText();

        // Asserted over extracted text rather than with `not.toContainText`,
        // because that reports "expect(locator).not.toContainText(expected)
        // failed" and leaves triage to go find which marker leaked where.
        expect(
          leakedMarkers(text),
          `template markers reached the customer on the ${locale.code} ${route.name}`,
        ).toEqual([]);
      });

      test(`${locale.code} — ${route.name} fits the mobile viewport ${tags(route)}`, async ({
        page,
      }) => {
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
 * Positive translation assertions — TRD-001 through TRD-006, TRD-008,
 * TRD-010, TRD-012, TRD-014, TRD-015, TRD-018, TRD-022.
 *
 * The English-fallback scan below is negative-only: it proves English is
 * *absent*, never that the right copy is *present*. A page that dropped its
 * navigation entirely, or served German strings on the French route, passes
 * every negative check in this file. The test cases ask the opposite
 * question — "do the French nav items display?" — so this asks it directly.
 *
 * The surface map is spec-local rather than config, because it describes how
 * this theme composes its pages, which is the same reason the testids live
 * here. Running it across all seven locales covers the English baseline
 * (TRS-001) with the same code path as the six translations.
 */
const SURFACES = [
  {
    name: 'primary navigation',
    route: '/',
    container: 'site-header',
    keys: [
      'nav.hair',
      'nav.sleep',
      'nav.accessories',
      'nav.skin',
      'nav.shower',
      'nav.collections',
      'nav.best_sellers',
      'nav.new',
      'nav.sale',
      'nav.search',
      'nav.account',
      'nav.cart',
      'nav.hair_quiz',
      'nav.rewards',
      'nav.gift_cards',
    ],
  },
  {
    name: 'footer',
    route: '/',
    container: 'site-footer',
    keys: [
      'footer.heading_help',
      'footer.heading_shop',
      'footer.heading_about',
      'footer.link_contact',
      'footer.link_shipping',
      'footer.link_returns',
      'footer.link_faq',
      'footer.newsletter_heading',
      'footer.newsletter_body',
      'footer.newsletter_cta',
      'footer.legal_privacy',
    ],
  },
  {
    name: 'homepage',
    route: '/',
    container: 'main',
    keys: [
      'home.hero_heading',
      'home.hero_sub',
      'home.hero_cta',
      'home.section_bestsellers',
      'home.section_new',
    ],
  },
  {
    name: 'product page',
    route: `/products/${resolveLaunchHandle()}`,
    container: 'main',
    keys: [
      'pdp.title',
      'pdp.description',
      'pdp.add_to_cart',
      'pdp.size_label',
      'pdp.color_label',
      'pdp.reviews_label',
      'pdp.in_stock',
    ],
  },
  {
    name: 'cart',
    route: '/cart',
    container: 'main',
    keys: [
      'cart.heading',
      'cart.subtotal',
      'cart.checkout_cta',
      'cart.shipping_note',
      'cart.remove',
    ],
  },
  {
    name: 'checkout',
    route: '/checkout',
    container: 'main',
    keys: [
      'checkout.heading',
      'checkout.contact_email',
      'checkout.first_name',
      'checkout.last_name',
      'checkout.address',
      'checkout.city',
      'checkout.postal_code',
      'checkout.phone',
      'checkout.shipping_method',
      'checkout.continue_cta',
    ],
  },
] as const;

test.describe('localized content renders', () => {
  for (const locale of config.locales) {
    for (const surface of SURFACES) {
      test(`${locale.code} — ${surface.name} shows the contracted copy @i18n @smoke`, async ({
        page,
      }) => {
        await page.goto(localizedPath(locale.code, surface.route));
        const text = await page.getByTestId(surface.container).innerText();

        // A surface where every key resolved to nothing would pass this test
        // without examining the page at all. That is the failure mode worth
        // guarding: a silent no-op looks exactly like a clean result.
        expect(
          contractedCount(locale.code, surface.keys),
          `no contracted ${locale.code} copy was found for the ${surface.name} — this test would have passed without asserting anything`,
        ).toBeGreaterThan(0);

        expect(
          missingCopy(locale.code, surface.keys, text),
          `${surface.name} is missing its ${locale.code} copy — the strings are contracted but not on the page`,
        ).toEqual([]);
      });
    }
  }
});

/**
 * Test plan §6.2, §9.2 / TRD-007, TRD-013, TRM-004 — the accented characters
 * have to survive to the rendered page, not merely exist in the catalogue.
 * The content layer's `diacritic_absent` check works on the whole catalogue;
 * this asks the narrower question a tester asks with their eyes.
 */
test.describe('accented characters render', () => {
  for (const locale of targetLocales(config).filter((entry) => entry.expectDiacritics)) {
    test(`${locale.code} — ${locale.market} accented characters appear on the page @i18n @smoke`, async ({
      page,
    }) => {
      await page.goto(localizedPath(locale.code, '/'));
      const text = await page.locator('body').innerText();

      const found = locale.diacritics.filter((character) => text.includes(character));
      expect(
        found,
        `not one of ${locale.market}'s accented characters (${locale.diacritics.join(' ')}) reached the rendered ${locale.code} homepage — either the copy is not really in ${locale.code} or the characters are being stripped`,
      ).not.toEqual([]);

      // ...and nothing on the page is damaged, which is the other half of the
      // same question: present is not the same as correct.
      expect(
        describeDefects(findEncodingDefects(text)),
        `accented characters are present but damaged in ${locale.code}`,
      ).toBe('');
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
test.describe('no untranslated strings', () => {
  for (const locale of targetLocales(config)) {
    for (const route of browsableRoutes) {
      test(`${locale.code} — ${route.name} shows no English fallback copy ${tags(route)}`, async ({
        page,
      }) => {
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
test.describe('character integrity', () => {
  for (const locale of config.locales) {
    for (const route of browsableRoutes) {
      test(`${locale.code} — ${route.name} renders without encoding damage ${tags(route)}`, async ({
        page,
      }) => {
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
    test(`${locale.code} — page renders in the ${locale.market} writing system @i18n @smoke`, async ({
      page,
    }) => {
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

  /**
   * Test plan §12.2 — font support.
   *
   * What this asserts: the theme declares a font family that covers the
   * locale's script, and the localized text actually paints at a non-zero
   * size. That catches the real, recurring product defect — CSS that never
   * names a CJK family, so Korean falls through to whatever the customer's
   * device happens to have.
   *
   * What it deliberately does not assert: which font ultimately drew the
   * glyphs. That depends on the fonts installed on the customer's device, so
   * no CI machine can answer it — a headless Linux container has a different
   * font set from an iPhone. Claiming otherwise would be a green check that
   * means nothing. Visual regression in Phase 5 is where appearance gets
   * verified.
   */
  for (const locale of targetLocales(config).filter((entry) => entry.fontFamilies.length > 0)) {
    test(`${locale.code} — theme declares a font covering the ${locale.market} script @i18n @smoke`, async ({
      page,
    }) => {
      await page.goto(localizedPath(locale.code, '/'));
      const heading = page.getByTestId('hero-heading');

      const stack = await heading.evaluate((node) => getComputedStyle(node).fontFamily);
      const normalized = stack.toLowerCase().replace(/["']/gu, '');
      const declared = locale.fontFamilies.filter((family) =>
        normalized.includes(family.toLowerCase()),
      );

      expect(
        declared,
        `the font stack for ${locale.code} is "${stack}" and names none of ${locale.fontFamilies.join(', ')} — ${locale.market} customers fall through to whatever their device provides`,
      ).not.toEqual([]);

      // ...and the text is actually painted, not collapsed to nothing.
      const box = await heading.boundingBox();
      expect(box?.width ?? 0, 'localized heading must render with a measurable width').toBeGreaterThan(0);
    });
  }
});

/**
 * Test plan §11.2 — dynamically loaded content.
 *
 * A newsletter modal and a language popup are in the DOM but hidden, so a
 * page-level text scan never sees them. They are also exactly where
 * translation wiring gets missed: the section renders from a different
 * template and nobody notices until a customer opens it.
 */
test.describe('dynamic content', () => {
  const overlays = [
    {
      opener: 'newsletter-open',
      panel: 'newsletter-modal',
      name: 'newsletter modal',
      keys: ['footer.newsletter_heading', 'footer.newsletter_cta', 'modal.close'],
    },
    {
      opener: 'language-open',
      panel: 'language-popup',
      name: 'language popup',
      keys: ['modal.language_heading', 'modal.close'],
    },
    // TRM-001. The desktop nav on the same page can be perfectly translated
    // while the menu behind the hamburger is not — they are separate template
    // fragments, and only one of them is visible without a click.
    {
      opener: 'mobile-nav-toggle',
      panel: 'mobile-nav',
      name: 'mobile nav',
      keys: ['nav.hair', 'nav.sleep', 'nav.accessories', 'nav.sale', 'nav.hair_quiz', 'nav.rewards'],
    },
  ] as const;

  for (const locale of targetLocales(config)) {
    for (const overlay of overlays) {
      test(`${locale.code} — ${overlay.name} respects the selected language @i18n @smoke`, async ({
        page,
      }) => {
        await page.goto(localizedPath(locale.code, '/'));

        const panel = page.getByTestId(overlay.panel);
        await expect(panel, 'overlay must start hidden, or the scan proves nothing').toBeHidden();

        await page.getByTestId(overlay.opener).click();
        await expect(panel).toBeVisible();

        const text = await panel.innerText();

        // Positive first: the overlay must show this locale's copy, not just
        // avoid showing English.
        expect(
          missingCopy(locale.code, overlay.keys, text),
          `${overlay.name} is missing its ${locale.code} copy`,
        ).toEqual([]);

        const leaked = englishSentinels(locale.code).filter((sentinel) =>
          showsEnglish(text, sentinel.english),
        );
        expect(
          leaked.map((sentinel) => `${sentinel.key}: "${sentinel.english}"`),
          `${overlay.name} renders English copy in ${locale.code} mode`,
        ).toEqual([]);

        expect(
          describeDefects(findEncodingDefects(text)),
          `${overlay.name} carries encoding damage in ${locale.code}`,
        ).toBe('');
      });
    }
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

        // Asserted positively — the meta content must *be* this locale's
        // copy. The earlier form ("must not equal the English string") only
        // ran when the baseline happened to contract something different,
        // so a missing baseline entry silently skipped the check entirely.
        expect(
          contractedCount(locale.code, [route.titleKey, route.descriptionKey]),
          `no contracted ${locale.code} meta copy — this test would assert nothing`,
        ).toBe(2);

        expect(
          missingCopy(locale.code, [route.titleKey], title),
          `meta title is not the ${locale.code} copy — invisible on the page, visible in search results`,
        ).toEqual([]);

        expect(
          missingCopy(locale.code, [route.descriptionKey], description),
          `meta description is not the ${locale.code} copy`,
        ).toEqual([]);

        expect(
          describeDefects(findEncodingDefects(`${title} ${description}`)),
          `meta content carries encoding damage in ${locale.code}`,
        ).toBe('');
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

      expect(
        missingCopy(locale.code, ['checkout.error_required'], message),
        `validation error is not the ${locale.code} copy — submitted an incomplete form and got "${message}"`,
      ).toEqual([]);

      expect(
        describeDefects(findEncodingDefects(message)),
        `validation error carries encoding damage in ${locale.code}`,
      ).toBe('');
    });
  }
});

/**
 * Test plan §15.3 — order confirmation.
 *
 * Needs an order to exist. Against the storefront fixture the route is
 * always available; against a real store it is reachable only via an order
 * status URL, so set KITSCH_ORDER_STATUS_URL to a test order's path. Without
 * one this skips loudly rather than reporting a 404 as a translation defect,
 * and rather than being quietly deleted because it is inconvenient.
 */
test.describe('order confirmation', () => {
  const confirmationRoute = config.routes.find((route) => route.tags.includes('@order'));
  const orderPath = process.env.KITSCH_ORDER_STATUS_URL ?? confirmationRoute?.path;
  // Matches how playwright.config resolves baseURL: an unset KITSCH_BASE_URL
  // means the local fixture, not a real store.
  const explicitBaseURL = process.env.KITSCH_BASE_URL;
  const usingFixture = explicitBaseURL === undefined || explicitBaseURL.includes('127.0.0.1');

  test.skip(
    orderPath === undefined || (!usingFixture && process.env.KITSCH_ORDER_STATUS_URL === undefined),
    'needs a test order — set KITSCH_ORDER_STATUS_URL against a real store (framework §12.4)',
  );

  for (const locale of targetLocales(config)) {
    test(`${locale.code} — order confirmation is localized @i18n @launch @order`, async ({
      page,
    }) => {
      await page.goto(localizedPath(locale.code, orderPath ?? '/checkout/confirmation'));

      const heading = page.getByTestId('confirmation-heading');
      await expect(heading).toBeVisible();

      const text = await page.getByTestId('main').innerText();

      const leaked = englishSentinels(locale.code)
        .filter((sentinel) => sentinel.key.startsWith('confirmation.'))
        .filter((sentinel) => showsEnglish(text, sentinel.english));
      expect(
        leaked.map((sentinel) => `${sentinel.key}: "${sentinel.english}"`),
        `order confirmation shows English copy in ${locale.code} mode`,
      ).toEqual([]);

      expect(
        describeDefects(findEncodingDefects(text)),
        `order confirmation carries encoding damage in ${locale.code}`,
      ).toBe('');

      // The order number and customer email are interpolated; a dropped
      // binding here means the customer is told about someone else's order,
      // or about "{{ email }}".
      await expect(page.getByTestId('confirmation-order')).not.toContainText('{{');
      await expect(page.getByTestId('confirmation-email')).toContainText('@');
    });
  }
});
