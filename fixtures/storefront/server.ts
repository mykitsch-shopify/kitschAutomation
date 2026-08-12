import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  CONTENT,
  FREE_SHIPPING_THRESHOLD,
  LAUNCH_HANDLE,
  LOCALES,
  PRICE,
} from '../catalog/content.js';
import type { Locale } from '../catalog/content.js';
import { FETCH_FAILED, SEEDED_DEFECTS } from '../catalog/defects.js';

/**
 * A seven-locale storefront fixture.
 *
 * mykitsch.com is production and is not reachable from CI anyway, and the
 * standing rule in this repo is that the harness never points at production.
 * This server stands in for it: same locale routing, same hreflang wiring,
 * same meta tags, same testids the real theme is being asked for, and the
 * same content bundle the content-layer catalogue is generated from.
 *
 * Two profiles:
 *   clean  — the render specs must pass against it (no false positives)
 *   seeded — carries the defects from fixtures/catalog/defects.ts plus the
 *            render-only ones below; the specs must fail against it
 *
 *   KITSCH_FIXTURE_PROFILE=seeded tsx fixtures/storefront/server.ts
 */

export type Profile = 'clean' | 'seeded';

/**
 * Defects that only exist in a browser. These are the render layer's reason
 * to exist — no amount of Admin API reading would surface any of them.
 */
type RenderDefects = {
  /** Locale whose <html lang> is wrong despite the route resolving. */
  readonly wrongHtmlLang: Locale | undefined;
  /** Locale that is missing from the hreflang alternates. */
  readonly missingHreflang: Locale | undefined;
  /** Locale whose PDP price uses the wrong market convention. */
  readonly wrongPriceFormat: Locale | undefined;
  /** Locale whose layout overflows the 390px viewport. */
  readonly overflow: Locale | undefined;
  /** Locale that leaks a Shopify "translation missing" marker. */
  readonly translationMissingMarker: Locale | undefined;
  /** Locale that renders an unresolved interpolation token. */
  readonly unresolvedToken: Locale | undefined;
  /**
   * Locale whose modal content stays English even though the page around it
   * is translated — the §11.2 "dynamic content ignores the locale" defect,
   * which is invisible until something opens the modal.
   */
  readonly untranslatedModal: Locale | undefined;
  /**
   * Locale whose mobile nav stays English behind the hamburger. The desktop
   * nav on the same page is translated, so only a spec that opens the menu
   * sees it — TRM-001.
   */
  readonly untranslatedMobileNav: Locale | undefined;
};

const NO_RENDER_DEFECTS: RenderDefects = {
  wrongHtmlLang: undefined,
  missingHreflang: undefined,
  wrongPriceFormat: undefined,
  overflow: undefined,
  translationMissingMarker: undefined,
  unresolvedToken: undefined,
  untranslatedModal: undefined,
  untranslatedMobileNav: undefined,
};

const SEEDED_RENDER_DEFECTS: RenderDefects = {
  wrongHtmlLang: 'it',
  missingHreflang: 'ko',
  wrongPriceFormat: 'ja',
  overflow: 'de',
  translationMissingMarker: 'es',
  unresolvedToken: 'fr',
  untranslatedModal: 'it',
  untranslatedMobileNav: 'ko',
};

const profile: Profile = process.env.KITSCH_FIXTURE_PROFILE === 'seeded' ? 'seeded' : 'clean';
const renderDefects = profile === 'seeded' ? SEEDED_RENDER_DEFECTS : NO_RENDER_DEFECTS;

/** Content-layer defects, applied so the page shows what the API reports. */
const contentOverrides = new Map<string, string | null>();
if (profile === 'seeded') {
  for (const defect of SEEDED_DEFECTS) {
    if (defect.value !== FETCH_FAILED) {
      contentOverrides.set(`${defect.locale}:${defect.key}`, defect.value);
    }
  }
}

const escape = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/**
 * Resolves a string the way a Shopify theme does: the locale's value if it
 * has one, otherwise the English source. That fallback is the behaviour the
 * "no untranslated strings" check exists to catch, so the fixture has to
 * reproduce it rather than render a blank.
 */
const t = (locale: Locale, key: string): string => {
  const override = contentOverrides.get(`${locale}:${key}`);
  const value = override !== undefined ? override : (CONTENT[locale][key] ?? null);
  if (value === null || value.trim() === '') {
    return CONTENT.en[key] ?? `translation missing: ${locale}.${key}`;
  }
  return value;
};

const interpolate = (
  locale: Locale,
  key: string,
  bindings: Readonly<Record<string, string>>,
): string => {
  const raw = t(locale, key);
  if (renderDefects.unresolvedToken === locale) {
    // A Liquid variable that never got bound — reaches the customer as "{{ amount }}".
    return raw;
  }
  let out = raw;
  for (const [token, value] of Object.entries(bindings)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'gu'), value);
  }
  return out;
};

/**
 * Modal copy, which in the seeded profile ignores the locale entirely. Real
 * theme modals are often rendered by a separate section that misses the
 * translation wiring — the page looks right and the popup does not.
 */
const modal = (locale: Locale, key: string): string =>
  t(renderDefects.untranslatedModal === locale ? 'en' : locale, key);

const NAV_KEYS = [
  'nav.hair',
  'nav.sleep',
  'nav.accessories',
  'nav.skin',
  'nav.shower',
  'nav.collections',
  'nav.best_sellers',
  'nav.new',
  'nav.sale',
] as const;

const UTILITY_KEYS = ['nav.search', 'nav.account', 'nav.cart'] as const;
const SUPPLEMENTAL_KEYS = ['nav.hair_quiz', 'nav.rewards', 'nav.gift_cards'] as const;

const FOOTER_LINK_KEYS = [
  'footer.link_contact',
  'footer.link_shipping',
  'footer.link_returns',
  'footer.link_faq',
  'footer.legal_privacy',
] as const;

const CHECKOUT_FIELD_KEYS = [
  'checkout.contact_email',
  'checkout.first_name',
  'checkout.last_name',
  'checkout.address',
  'checkout.city',
  'checkout.postal_code',
  'checkout.phone',
] as const;

const localePrefix = (locale: Locale): string => (locale === 'en' ? '' : `/${locale}`);

const head = (locale: Locale, titleKey: string, descriptionKey: string): string => {
  const alternates = LOCALES.filter((code) => code !== renderDefects.missingHreflang)
    .map(
      (code) =>
        `    <link rel="alternate" hreflang="${code}" href="http://localhost${localePrefix(code)}/" />`,
    )
    .join('\n');

  return [
    `  <meta charset="utf-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `  <title>${escape(t(locale, titleKey))}</title>`,
    `  <meta name="description" content="${escape(t(locale, descriptionKey))}" />`,
    alternates,
  ].join('\n');
};

const styles = (locale: Locale): string => `
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, "Noto Sans KR", "Noto Sans JP", sans-serif; }
    header, footer, main { padding: 12px; }
    nav ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0; }
    .price { font-weight: 600; }
    ${
      renderDefects.overflow === locale
        ? `.overflow-probe { white-space: nowrap; width: 640px; }`
        : `.overflow-probe { max-width: 100%; }`
    }
  </style>`;

const header = (locale: Locale): string => `
  <header data-testid="site-header">
    <a data-testid="logo" href="${localePrefix(locale)}/">${escape(t(locale, 'brand.name'))}</a>
    <nav data-testid="primary-nav" aria-label="Primary">
      <ul>
${NAV_KEYS.map(
  (key) =>
    `        <li><a data-testid="nav-link" href="${localePrefix(locale)}/collections/hair-tools">${escape(t(locale, key))}</a></li>`,
).join('\n')}
      </ul>
    </nav>
    <nav data-testid="utility-nav" aria-label="Utility">
      <ul>
${UTILITY_KEYS.map(
  (key) => `        <li><a data-testid="nav-link" href="${localePrefix(locale)}/cart">${escape(t(locale, key))}</a></li>`,
).join('\n')}
      </ul>
    </nav>
    <nav data-testid="supplemental-nav" aria-label="Supplemental">
      <ul>
${SUPPLEMENTAL_KEYS.map(
  (key) => `        <li><a data-testid="nav-link" href="${localePrefix(locale)}/pages/about">${escape(t(locale, key))}</a></li>`,
).join('\n')}
      </ul>
    </nav>
    <p data-testid="promo-banner" class="overflow-probe">${escape(
      interpolate(locale, 'home.banner_promo', { amount: FREE_SHIPPING_THRESHOLD[locale] }),
    )}</p>
    <button data-testid="newsletter-open" type="button">${escape(t(locale, 'footer.newsletter_cta'))}</button>
    <button data-testid="language-open" type="button">${escape(t(locale, 'modal.language_heading'))}</button>
    <button data-testid="mobile-nav-toggle" type="button" aria-expanded="false">${escape(
      t(locale, 'nav.search'),
    )}</button>
    <nav data-testid="mobile-nav" aria-label="Mobile" hidden>
      <ul>
${NAV_KEYS.map(
  (key) =>
    `        <li><a data-testid="mobile-nav-link" href="${localePrefix(locale)}/collections/hair-tools">${escape(
      t(renderDefects.untranslatedMobileNav === locale ? 'en' : locale, key),
    )}</a></li>`,
).join('\n')}
      </ul>
      <div data-testid="mega-menu">
${SUPPLEMENTAL_KEYS.map(
  (key) =>
    `        <a data-testid="mega-menu-link" href="${localePrefix(locale)}/pages/about">${escape(
      t(renderDefects.untranslatedMobileNav === locale ? 'en' : locale, key),
    )}</a>`,
).join('\n')}
      </div>
    </nav>
  </header>`;

/**
 * Dynamically revealed surfaces — test plan §11.2. Present in the DOM but
 * hidden, exactly like a theme's newsletter modal and region switcher, so a
 * spec has to open them before it can judge them.
 */
const overlays = (locale: Locale): string => `
  <div data-testid="newsletter-modal" hidden>
    <h2>${escape(modal(locale, 'footer.newsletter_heading'))}</h2>
    <p>${escape(modal(locale, 'footer.newsletter_body'))}</p>
    <button type="button">${escape(modal(locale, 'footer.newsletter_cta'))}</button>
    <button data-testid="newsletter-close" type="button">${escape(modal(locale, 'modal.close'))}</button>
  </div>
  <div data-testid="language-popup" hidden>
    <h2>${escape(modal(locale, 'modal.language_heading'))}</h2>
    <button data-testid="language-close" type="button">${escape(modal(locale, 'modal.close'))}</button>
  </div>
  <script>
    for (const [opener, panel] of [
      ['newsletter-open', 'newsletter-modal'],
      ['language-open', 'language-popup'],
      ['mobile-nav-toggle', 'mobile-nav'],
    ]) {
      document.querySelector('[data-testid="' + opener + '"]').addEventListener('click', (event) => {
        document.querySelector('[data-testid="' + panel + '"]').hidden = false;
        event.currentTarget.setAttribute('aria-expanded', 'true');
      });
    }
  </script>`;

const footer = (locale: Locale): string => `
  <footer data-testid="site-footer">
    <h2 data-testid="footer-heading">${escape(t(locale, 'footer.heading_help'))}</h2>
    <h2 data-testid="footer-heading">${escape(t(locale, 'footer.heading_shop'))}</h2>
    <h2 data-testid="footer-heading">${escape(t(locale, 'footer.heading_about'))}</h2>
    <ul>
${FOOTER_LINK_KEYS.map(
  (key) => `      <li><a data-testid="footer-link" href="${localePrefix(locale)}/pages/about">${escape(t(locale, key))}</a></li>`,
).join('\n')}
    </ul>
    <section data-testid="newsletter">
      <h2>${escape(t(locale, 'footer.newsletter_heading'))}</h2>
      <p>${escape(t(locale, 'footer.newsletter_body'))}</p>
      <button type="button">${escape(t(locale, 'footer.newsletter_cta'))}</button>
    </section>
  </footer>`;

const page = (locale: Locale, titleKey: string, descriptionKey: string, main: string): string => {
  const lang = renderDefects.wrongHtmlLang === locale ? 'en' : locale;
  return `<!doctype html>
<html lang="${lang}">
<head>
${head(locale, titleKey, descriptionKey)}
${styles(locale)}
</head>
<body>
${header(locale)}
  <main data-testid="main">
${main}
  </main>
${footer(locale)}
${overlays(locale)}
</body>
</html>
`;
};

const price = (locale: Locale): string =>
  renderDefects.wrongPriceFormat === locale ? PRICE.en : PRICE[locale];

const homeMain = (locale: Locale): string => `
    <h1 data-testid="hero-heading">${escape(t(locale, 'home.hero_heading'))}</h1>
    <p data-testid="hero-sub">${escape(t(locale, 'home.hero_sub'))}</p>
    <a data-testid="hero-cta" href="${localePrefix(locale)}/collections/hair-tools">${escape(t(locale, 'home.hero_cta'))}</a>
    <h2 data-testid="section-heading">${escape(t(locale, 'home.section_bestsellers'))}</h2>
    <h2 data-testid="section-heading">${escape(t(locale, 'home.section_new'))}</h2>`;

const collectionMain = (locale: Locale): string => `
    <h1 data-testid="collection-heading">${escape(t(locale, 'nav.hair'))}</h1>
    <ul>
      <li data-testid="product-card">
        <a href="${localePrefix(locale)}/products/${LAUNCH_HANDLE}">${escape(t(locale, 'pdp.title'))}</a>
        <span class="price" data-testid="card-price">${escape(price(locale))}</span>
      </li>
    </ul>`;

const pdpMain = (locale: Locale): string => `
    <h1 data-testid="pdp-title">${escape(t(locale, 'pdp.title'))}</h1>
    <p class="price" data-testid="pdp-price">${escape(price(locale))}</p>
    <p data-testid="pdp-description">${escape(t(locale, 'pdp.description'))}</p>
    <p data-testid="pdp-stock">${escape(t(locale, 'pdp.in_stock'))}</p>
    <label data-testid="pdp-size-label">${escape(t(locale, 'pdp.size_label'))}
      <select data-testid="pdp-size"><option>${escape(t(locale, 'brand.material'))} XL</option></select>
    </label>
    <label data-testid="pdp-color-label">${escape(t(locale, 'pdp.color_label'))}
      <select data-testid="pdp-color"><option>Blush</option></select>
    </label>
    <p data-testid="pdp-reviews">${escape(interpolate(locale, 'pdp.reviews_label', { count: '128' }))}</p>
    <button data-testid="add-to-cart" type="button">${escape(t(locale, 'pdp.add_to_cart'))}</button>`;

const cartMain = (locale: Locale): string => `
    <h1 data-testid="cart-heading">${escape(t(locale, 'cart.heading'))}</h1>
    <ul>
      <li data-testid="cart-line-item">
        <span>${escape(t(locale, 'pdp.title'))}</span>
        <span class="price" data-testid="line-price">${escape(price(locale))}</span>
        <button data-testid="cart-remove" type="button">${escape(t(locale, 'cart.remove'))}</button>
      </li>
    </ul>
    <p data-testid="cart-subtotal-label">${escape(t(locale, 'cart.subtotal'))}</p>
    <p class="price" data-testid="cart-subtotal">${escape(price(locale))}</p>
    <p data-testid="cart-shipping-note">${escape(t(locale, 'cart.shipping_note'))}</p>
    <a data-testid="checkout-button" href="${localePrefix(locale)}/checkout">${escape(t(locale, 'cart.checkout_cta'))}</a>`;

const checkoutMain = (locale: Locale, showErrors: boolean): string => `
    <h1 data-testid="checkout-heading">${escape(t(locale, 'checkout.heading'))}</h1>
    <form data-testid="checkout-form" method="get" action="${localePrefix(locale)}/checkout">
      <input type="hidden" name="submitted" value="1" />
${CHECKOUT_FIELD_KEYS.map(
  (key, index) => `      <label data-testid="checkout-field-label" for="field-${String(index)}">${escape(t(locale, key))}</label>
      <input data-testid="checkout-field" id="field-${String(index)}" name="field-${String(index)}" />${
        showErrors
          ? `\n      <p data-testid="checkout-error" role="alert">${escape(t(locale, 'checkout.error_required'))}</p>`
          : ''
      }`,
).join('\n')}
      <fieldset>
        <legend data-testid="checkout-shipping-method">${escape(t(locale, 'checkout.shipping_method'))}</legend>
      </fieldset>
      <button data-testid="checkout-continue" type="submit">${escape(t(locale, 'checkout.continue_cta'))}</button>
    </form>`;

const confirmationMain = (locale: Locale): string => `
    <h1 data-testid="confirmation-heading">${escape(t(locale, 'confirmation.heading'))}</h1>
    <p data-testid="confirmation-order">${escape(
      interpolate(locale, 'confirmation.order_number', { number: '#1042' }),
    )}</p>
    <p data-testid="confirmation-email">${escape(
      interpolate(locale, 'confirmation.email_sent', { email: 'qa@mykitsch.com' }),
    )}</p>
    <a data-testid="confirmation-continue" href="${localePrefix(locale)}/">${escape(
      t(locale, 'confirmation.continue_shopping'),
    )}</a>`;

const aboutMain = (locale: Locale): string => `
    <h1 data-testid="page-heading">${escape(t(locale, 'footer.heading_about'))}</h1>
    <p>${escape(t(locale, 'home.hero_sub'))}</p>
    ${
      renderDefects.translationMissingMarker === locale
        ? `<p data-testid="cms-block">translation missing: ${locale}.about.body</p>`
        : `<p data-testid="cms-block">${escape(t(locale, 'footer.newsletter_body'))}</p>`
    }`;

type Route = { readonly locale: Locale; readonly path: string; readonly query: URLSearchParams };

const parseRoute = (url: string): Route => {
  const parsed = new URL(url, 'http://localhost');
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  const first = segments[0];
  const matched = LOCALES.find((code) => code === first && code !== 'en');
  const locale: Locale = matched ?? 'en';
  const rest = matched === undefined ? segments : segments.slice(1);
  return { locale, path: `/${rest.join('/')}`, query: parsed.searchParams };
};

const render = (route: Route): { readonly status: number; readonly body: string } => {
  const { locale, path } = route;

  if (path === '/' || path === '/index.html') {
    return { status: 200, body: page(locale, 'meta.home_title', 'meta.home_description', homeMain(locale)) };
  }
  if (path === '/collections/hair-tools') {
    return { status: 200, body: page(locale, 'meta.home_title', 'meta.home_description', collectionMain(locale)) };
  }
  if (path === `/products/${LAUNCH_HANDLE}`) {
    return { status: 200, body: page(locale, 'meta.pdp_title', 'meta.pdp_description', pdpMain(locale)) };
  }
  if (path === '/cart') {
    return { status: 200, body: page(locale, 'meta.home_title', 'meta.home_description', cartMain(locale)) };
  }
  if (path === '/checkout') {
    const submitted = route.query.get('submitted') === '1';
    return {
      status: 200,
      body: page(locale, 'meta.home_title', 'meta.home_description', checkoutMain(locale, submitted)),
    };
  }
  if (path === '/checkout/confirmation') {
    return {
      status: 200,
      body: page(locale, 'meta.home_title', 'meta.home_description', confirmationMain(locale)),
    };
  }
  if (path === '/pages/about') {
    return { status: 200, body: page(locale, 'meta.home_title', 'meta.home_description', aboutMain(locale)) };
  }

  return { status: 404, body: `<!doctype html><html lang="${locale}"><body><h1>404</h1></body></html>\n` };
};

const handler = (request: IncomingMessage, response: ServerResponse): void => {
  const { status, body } = render(parseRoute(request.url ?? '/'));
  response.writeHead(status, {
    // Declared explicitly. A fixture that got this wrong would manufacture
    // the very mojibake the suite is meant to detect.
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
};

const port = Number(process.env.KITSCH_FIXTURE_PORT ?? '4173');
createServer(handler).listen(port, () => {
  process.stdout.write(`storefront fixture (${profile}) listening on http://127.0.0.1:${String(port)}\n`);
});
