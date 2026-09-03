import { expect, test, type Page } from '@playwright/test';

import { resolveLaunchHandle } from '@kitsch/fixtures/launch-set.js';

import { loadI18nConfig, targetLocales } from '../lib/config.js';
import { describeDefects, findEncodingDefects, matchesScript } from '../lib/text-integrity.js';
import {
  baselineDescribesTarget,
  baselineProvenance,
  englishSentinels,
  renderedFragments,
  showsEnglish,
} from './baseline.js';

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
 * Whether this run is pointed at the local storefront fixture.
 *
 * Resolved exactly the way playwright.config.ts resolves `baseURL`: an unset
 * KITSCH_BASE_URL means the fixture, and the detection control sets it
 * explicitly to a 127.0.0.1 port that is not the default one.
 */
const usingFixture =
  process.env.KITSCH_BASE_URL === undefined || process.env.KITSCH_BASE_URL.includes('127.0.0.1');

/**
 * Routes a browser can simply visit.
 *
 * Two exclusions, both because the route is not browsable rather than because
 * it is uninteresting:
 *
 *   @order          needs an order to exist.
 *   @cart-required  needs a cart. On the fixture `/checkout` is a static page,
 *                   so it stays in. On mykitsch.com every request for it —
 *                   68 across five locales in one run — came back HTTP 429,
 *                   while every other route in the same run loaded normally.
 *                   That is not our request volume: it is Shopify's checkout
 *                   throttle answering a session with nothing in its cart.
 *
 * Excluded rather than left to fail. Those 68 reported as COULD NOT CHECK,
 * which is honest but is still half the run's red on one route that was never
 * going to open — and a report where the noise outnumbers the findings is a
 * report nobody reads to the bottom.
 *
 * This is a coverage gap and it is worth naming: **checkout is unverified on
 * the live store, not passing.** Closing it needs a seeded cart before the
 * navigation, which the render layer cannot do today — the buy button on this
 * theme opens a bundle builder rather than adding a line (docs/WELCOME-KIT-COVERAGE.md).
 */
const browsableRoutes = config.routes.filter(
  (route) =>
    !route.tags.includes('@order') && (usingFixture || !route.tags.includes('@cart-required')),
);

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

/**
 * Navigates, and says so plainly when the page never arrived.
 *
 * A `page.goto` timeout surfaces in a report as a red test beside the real
 * findings, and reads as "this page has a defect". It is the opposite: nothing
 * was examined. Two live runs made the case — four failures each time, all
 * navigation timeouts, and on different pages each run. Somebody reading that
 * report would have gone looking for translation defects on four pages that
 * were never opened.
 *
 * Playwright has no verdict between pass and fail, so this cannot be reported
 * as "could not check" the way the audit CLIs do with exit 2. What it can do
 * is refuse to be mistaken for a finding about the copy.
 */
const visit = async (
  page: Page,
  path: string,
): Promise<Awaited<ReturnType<Page['goto']>>> => {
  try {
    const response = await page.goto(path);

    // 429 is throttling, and throttling is never a statement about the copy.
    //
    // It first appeared as `Expected: 200 / Received: 429` and read in the
    // report as a checkout that is down. It is not — nothing on the page was
    // read either way.
    //
    // The later evidence narrowed *which* throttle. Across a full run every
    // one of the 68 429s was on `/checkout`, in all five locales, while every
    // other route answered 200 in the same run: not our request volume, which
    // would have been spread across routes, but Shopify refusing a checkout
    // with nothing in the cart. `/checkout` is tagged @cart-required and left
    // out of live runs for that reason; this stays as the general case,
    // because a genuinely rate-limited sweep looks the same from here.
    if (response?.status() === 429) {
      throw new Error(
        `COULD NOT CHECK — ${path} returned HTTP 429 (throttled).\n` +
          'Nothing on the page was read, so this is not a defect in the copy.\n' +
          'If it is only /checkout, the cart is empty and Shopify will not open ' +
          'checkout — that route is tagged @cart-required and excluded from live ' +
          'runs. If it is spread across routes, it is our own traffic: re-run with ' +
          'fewer workers, or run the locale suite on its own rather than alongside ' +
          'the daily audits.',
      );
    }
    return response;
  } catch (cause) {
    throw new Error(
      `COULD NOT CHECK — ${path} did not load, so nothing on it was examined.\n` +
        'This is not a statement about the page: no translation, marker or price ' +
        'was read. Treat it as harness or network, not as a store defect.\n' +
        `Cause: ${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}`,
      { cause },
    );
  }
};

/**
 * A theme selector by role, or a harness failure naming the role.
 *
 * Roles used to be `data-testid` strings written into this file. The fixture
 * carries them and mykitsch.com does not, so ~90 specs failed with
 * "element(s) not found" and were counted as translation defects — when in
 * fact no copy had been read at all, because the container was never located.
 *
 * Both failure shapes below are harness problems and say so. Neither is a
 * statement about the store's translations.
 */
const selectorFor = (role: string): string => {
  const selector = config.selectors[role] ?? '';
  if (selector === '') {
    throw new Error(
      `COULD NOT CHECK — no selector is mapped for "${role}".\n` +
        `Nothing was read, so this is not a finding about the ${role} copy.\n` +
        `Map it in config/i18n.yaml under "selectors", or delete the check if ` +
        `this theme has no such element. To find it:\n` +
        `  node scratch-report/discover.mjs ${process.env.KITSCH_BASE_URL ?? 'http://127.0.0.1:4173'}/`,
    );
  }
  return selector;
};

/**
 * Reads a container's text, refusing to confuse "not found" or "empty" with
 * "read, and here is what it said".
 *
 * Two ways to get `''` out of a locator, and both used to be returned as if
 * they were the page's answer:
 *
 *   nothing matched   Every "is this string translated?" assertion over `''`
 *                     reports every string as missing — ninety defects from
 *                     one unmapped selector.
 *   matched, no text  Subtler and it got through. `pdp_price` maps to
 *                     `.main-product span.text-red-700`, the *sale* price:
 *                     present in the markup and empty on a product that is
 *                     not on sale. `innerText` returned `''`, and the price
 *                     spec reported `price "" does not match the EUR pattern
 *                     for FR` in four locales — a confident claim about
 *                     formatting, made about a string that was never on the
 *                     page.
 */
const readContainer = async (page: Page, role: string, where: string): Promise<string> => {
  const selector = selectorFor(role);
  const count = await page.locator(selector).count();
  if (count === 0) {
    throw new Error(
      `COULD NOT CHECK — "${selector}" (role: ${role}) matched nothing on ${where}.\n` +
        'No copy was read, so nothing here is a translation defect. Either the ' +
        'selector does not fit this theme, or the element is absent from this ' +
        'page. Remap it in config/i18n.yaml under "selectors".',
    );
  }

  const text = await page.locator(selector).first().innerText();
  if (text.trim() === '') {
    throw new Error(
      `COULD NOT CHECK — "${selector}" (role: ${role}) matched ${String(count)} element(s) on ` +
        `${where}, and the first one renders no text.\n` +
        'A matched-but-empty element is still nothing read. Reporting the `""` as ' +
        'the page\'s answer would claim the copy is wrong, or the price malformed, ' +
        'on evidence that was never collected.\n' +
        'Usual cause: the selector names an element this page keeps empty — a sale ' +
        'price on a product that is not on sale, a slot the theme fills only ' +
        'sometimes. Scope it to the element that always carries the value, in ' +
        'config/i18n.yaml under "selectors".',
    );
  }
  return text;
};

/**
 * Clicks a control by role, saying which selector missed rather than timing out.
 *
 * `locator.click()` on an unmatched selector spends thirty seconds and then
 * reports `waiting for getByTestId('newsletter-open')` — accurate, and it reads
 * as a broken page. It is a control this theme does not have under that name,
 * and nothing was read either way.
 */
const clickRole = async (page: Page, role: string, where: string): Promise<void> => {
  const selector = selectorFor(role);
  if ((await page.locator(selector).count()) === 0) {
    throw new Error(
      `COULD NOT CHECK — "${selector}" (role: ${role}) matched nothing on ${where}, ` +
        'so the overlay was never opened and its copy was never read. This is a ' +
        'selector that does not fit this theme, not a translation defect. Remap ' +
        'it in config/i18n.yaml under "selectors".',
    );
  }
  await page.locator(selector).first().click();
};

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
        const requested = localizedPath(locale.code, route.path);
        const response = await visit(page, requested);
        expect(
          response?.status(),
          'localized route must resolve without a redirect chain to /en',
        ).toBe(200);

        // Reported with the URL the browser actually ended on, because the two
        // ways this fails need opposite fixes and `Received: "en"` names
        // neither:
        //
        //   still on /fr/products/x   the localized page renders, in English —
        //                             a translation/theme wiring defect.
        //   now on /products/x        the store redirected the locale away, so
        //                             the French page was never served.
        //
        // Compared on the locale prefix rather than the whole path: a store may
        // normalise a trailing slash or append a query without that being a
        // redirect away from the locale.
        const landed = new URL(page.url()).pathname;
        const keptLocale =
          locale.code === config.sourceLocale ||
          landed === `/${locale.code}` ||
          landed.startsWith(`/${locale.code}/`);

        // A redirect out of the locale has two causes, and which one it is
        // depends on whether the OTHER routes in this locale survived.
        //
        // Measured, not assumed: a live run redirected all four target locales
        // off `/products/<launch handle>` while `/fr/`, `/fr/collections/all`,
        // `/fr/cart` and `/fr/pages/about` all kept their prefix and passed.
        // Locale routing was working; the product was not available in those
        // markets. Reporting that as "the French locale is broken" would send
        // somebody to the wrong team.
        const redirectedOut =
          `the store redirected out of /${locale.code}, so no ${locale.code} page was rendered ` +
          `at all.\n\nTwo causes, and the sibling tests in this run tell them apart:\n` +
          `  • if the other ${locale.code} routes passed, this RESOURCE is not published to ` +
          `the ${locale.market} market — a merchandising fact about ${route.path}, not a ` +
          `locale defect. Publish it to that market, or point KITSCH_LAUNCH_HANDLE at a ` +
          `product that is sold there.\n` +
          `  • if the other ${locale.code} routes redirected too, the market itself is not ` +
          `routing — that is the locale defect.`;

        await expect(
          page.locator('html'),
          `requested ${requested} and landed on ${landed}; ` +
            (keptLocale
              ? 'the localized page was served but declares the wrong language — the locale is routed and not applied'
              : redirectedOut),
        ).toHaveAttribute('lang', new RegExp(`^${locale.code}`, 'i'));
      });

      test(`${locale.code} — ${route.name} declares hreflang alternates ${tags(route)}`, async ({
        page,
      }) => {
        await visit(page, localizedPath(locale.code, route.path));

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
        // Reported as what actually happened, because "missing" and "there are
        // seventy-four of them" need opposite fixes and the message used to
        // call both of them missing. A live multi-market store emits a regional
        // alternate per market (en-US, en-CA, en-GB…), and `hreflang^="en"`
        // counts every one of them — so a large number here is a question
        // about this assertion, not a discovery defect on the page.
        // At least one, not exactly one.
        //
        // The contract was "exactly one per market", and against the live store
        // that reported `en: 74 alternates, expected exactly 1` on every single
        // page. Shopify emits one alternate per market × language, so a store
        // selling into many countries correctly has dozens of `hreflang="en-*"`.
        // The assertion was wrong; the page was right. Reporting it as a
        // discovery defect on every route buried the one that IS a defect —
        // `no alternate declared`, which is a localized page search engines
        // cannot associate with its market.
        const missing = counts
          .filter((entry) => entry.count < config.hreflangAtLeast)
          .map((entry) => `${entry.code}: no alternate declared`);

        expect(
          missing,
          `a market we sell in has no hreflang alternate on the ${locale.code} ${route.name} — that localized page is invisible to search in that market`,
        ).toEqual([]);
      });

      test(`${locale.code} — ${route.name} leaks no template markers ${tags(route)}`, async ({
        page,
      }) => {
        await visit(page, localizedPath(locale.code, route.path));
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
        await visit(page, localizedPath(locale.code, route.path));

        // Both numbers in one evaluate, because the second is what makes the
        // first mean anything.
        //
        // An overflow measurement passes trivially on a page that rendered
        // nothing: a blank body has scrollWidth === clientWidth, so the test
        // goes green having measured an empty frame. This used to be guarded
        // by asserting the site header was visible — which was a proxy for
        // "the page rendered", not part of what the test measures, and it
        // borrowed a selector this theme does not match. That cost 27 failures
        // in one live run, on pages that had rendered perfectly well.
        //
        // Painted text is the proof the measurement needs and it belongs to no
        // theme: every one of these routes carries copy.
        const { overflowPx, renderedChars } = await page.evaluate(() => ({
          overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          renderedChars: (document.body.innerText ?? '').trim().length,
        }));

        expect(
          renderedChars,
          `COULD NOT CHECK — the ${locale.code} ${route.name} rendered almost no text (${String(renderedChars)} characters), so measuring its width proves nothing. An empty page has no horizontal overflow. This is a page that did not render, not a layout that fits.`,
        ).toBeGreaterThan(200);

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
      await visit(page, localizedPath(locale.code, `/products/${resolveLaunchHandle()}`));

      const priceText = await readContainer(page, 'pdp_price', `the ${locale.code} PDP`);

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
    container: 'site_header',
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
    container: 'site_footer',
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
  /**
   * Positive copy assertions need a baseline captured from the store under
   * test. Pointed at mykitsch.com with the fixture catalogue, this block
   * reported 30 failures of the form "footer is missing its {locale} copy" —
   * **five of them against English**, whose contracted footer says "Join the
   * list" because that sentence was written for the fixture. English cannot be
   * missing its own translation: the block was measuring the distance between
   * two stores and calling every inch of it a defect.
   *
   * Declined rather than deleted, and declined rather than left red. There is
   * no live-store catalogue collector yet (see i18n/specs/baseline.ts), so
   * **live positive-copy coverage is absent, not passing.** What still runs
   * against the real store is the negative scan below, which needs only an
   * English string the store actually uses — and that is where the run's real
   * findings came from.
   */
  test.skip(
    !baselineDescribesTarget(usingFixture),
    `the baseline ${baselineProvenance()} holds the fixture's copy, not this store's — ` +
      'comparing them would report the difference between two catalogues as missing ' +
      'translations. Point KITSCH_BASELINE at a catalogue pulled from this store to ' +
      'restore the check.',
  );

  for (const locale of config.locales) {
    for (const surface of SURFACES) {
      test(`${locale.code} — ${surface.name} shows the contracted copy @i18n @smoke`, async ({
        page,
      }) => {
        await visit(page, localizedPath(locale.code, surface.route));
        const text = await readContainer(page, surface.container, `the ${locale.code} ${surface.name}`);

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
      await visit(page, localizedPath(locale.code, '/'));
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
        await visit(page, localizedPath(locale.code, route.path));
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
        await visit(page, localizedPath(locale.code, route.path));
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
      await visit(page, localizedPath(locale.code, '/'));
      const heading = await readContainer(page, 'hero_heading', `the ${locale.code} homepage`);

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
      await visit(page, localizedPath(locale.code, '/'));
      const heading = page.locator(selectorFor('hero_heading')).first();

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
      opener: 'newsletter_open',
      panel: 'newsletter_panel',
      name: 'newsletter modal',
      keys: ['footer.newsletter_heading', 'footer.newsletter_cta', 'modal.close'],
    },
    {
      opener: 'language_open',
      panel: 'language_panel',
      name: 'language popup',
      keys: ['modal.language_heading', 'modal.close'],
    },
    // TRM-001. The desktop nav on the same page can be perfectly translated
    // while the menu behind the hamburger is not — they are separate template
    // fragments, and only one of them is visible without a click.
    {
      opener: 'mobile_nav_toggle',
      panel: 'mobile_nav_panel',
      name: 'mobile nav',
      keys: ['nav.hair', 'nav.sleep', 'nav.accessories', 'nav.sale', 'nav.hair_quiz', 'nav.rewards'],
    },
  ] as const;

  for (const locale of targetLocales(config)) {
    for (const overlay of overlays) {
      test(`${locale.code} — ${overlay.name} respects the selected language @i18n @smoke`, async ({
        page,
      }) => {
        await visit(page, localizedPath(locale.code, '/'));

        const panel = page.locator(selectorFor(overlay.panel)).first();
        await expect(panel, 'overlay must start hidden, or the scan proves nothing').toBeHidden();

        await clickRole(page, overlay.opener, `the ${locale.code} ${overlay.name}`);
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
  // Same reason as `localized content renders`: `missingCopy` compares the
  // served title against a contracted one, and a contract belonging to another
  // store makes every title look untranslated. Eight failures live, on meta
  // tags that may well be correct — nobody can say from this baseline.
  test.skip(
    !baselineDescribesTarget(usingFixture),
    `the baseline ${baselineProvenance()} holds the fixture's meta copy, not this ` +
      "store's, so a mismatch here would say nothing about the store's meta tags.",
  );

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
        await visit(page, localizedPath(locale.code, route.path));

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
  // These navigate to /checkout directly rather than through browsableRoutes,
  // so the @cart-required exclusion has to be repeated here. On a live store
  // the navigation returns 429 before a label is ever read — the cart is
  // empty and Shopify will not open checkout for it.
  //
  // **Live checkout translation is unverified, not passing.** Closing it needs
  // a seeded cart, which the render layer cannot build on this theme today
  // (docs/WELCOME-KIT-COVERAGE.md), and a hosted checkout that is not
  // themeable may never expose these selectors at all.
  test.skip(
    !usingFixture,
    'checkout is not browsable with an empty cart — every live request for it ' +
      'returned HTTP 429, so no form label was read. See @cart-required in config/i18n.yaml.',
  );

  for (const locale of targetLocales(config)) {
    test(`${locale.code} — checkout form labels are localized`, async ({ page }) => {
      await visit(page, localizedPath(locale.code, '/checkout'));

      const labels = page.locator(selectorFor('checkout_field_label'));
      await expect(labels.first()).toBeVisible();
      expect(await labels.count(), 'checkout form must render its field labels').toBeGreaterThan(0);

      const text = await readContainer(page, 'checkout_form', `the ${locale.code} checkout`);
      const leaked = englishSentinels(locale.code)
        .filter((sentinel) => sentinel.key.startsWith('checkout.'))
        .filter((sentinel) => showsEnglish(text, sentinel.english));

      expect(
        leaked.map((sentinel) => `${sentinel.key}: "${sentinel.english}"`),
        `checkout form shows English labels in ${locale.code} mode`,
      ).toEqual([]);
    });

    test(`${locale.code} — checkout validation errors are localized`, async ({ page }) => {
      await visit(page, localizedPath(locale.code, '/checkout'));
      await clickRole(page, 'checkout_continue', `the ${locale.code} checkout`);

      const errors = page.locator(selectorFor('checkout_error'));
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

  test.skip(
    orderPath === undefined || (!usingFixture && process.env.KITSCH_ORDER_STATUS_URL === undefined),
    'needs a test order — set KITSCH_ORDER_STATUS_URL against a real store (framework §12.4)',
  );

  for (const locale of targetLocales(config)) {
    test(`${locale.code} — order confirmation is localized @i18n @launch @order`, async ({
      page,
    }) => {
      await visit(page, localizedPath(locale.code, orderPath ?? '/checkout/confirmation'));

      const heading = page.locator(selectorFor('confirmation_heading')).first();
      await expect(heading).toBeVisible();

      const text = await readContainer(page, 'main', 'the order confirmation');

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
      await expect(page.locator(selectorFor('confirmation_order')).first()).not.toContainText('{{');
      await expect(page.locator(selectorFor('confirmation_email')).first()).toContainText('@');
    });
  }
});
