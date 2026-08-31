import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { diffKits, isFreePrice, isSameProduct, loadKitConfig, normalizeLabels } from '../lib/kit-parity.js';
import type { KitDimension, KitProfile, KitSpec, SelectorName } from '../lib/kit-parity.js';

/**
 * Welcome-kit free-item parity.
 *
 * What this catches that an API check cannot: two kits can contain identical
 * line items and still make different promises. The Admin API says both hold
 * a Welcome Kit at zero cost; it does not say that one shows "Free" in the
 * cart and the other a struck-through $12.00, that one auto-adds the kit and
 * the other waits to be noticed, or that one strands the free kit in the cart
 * after the qualifying product is removed. All of that is theme and cart
 * behaviour, and all of it is what a customer actually meets.
 *
 * Deliberately differential. The live Winter Welcome Kit Combos defines
 * correct; the seasonal kits are measured against whatever it does. So this
 * spec keeps working when merchandising changes the winter kit — the
 * reference moves and the comparison moves with it — and it never has to be
 * told what a free item "should" do.
 *
 * Everything compared is read from the cart and the order summary. The theme
 * renders no kit-contents list and no gift selector on a kit PDP, so the
 * PDP-side dimensions were removed rather than left to pass by default — see
 * the header of web/lib/kit-parity.ts.
 *
 * Requirement: the summer and spring welcome kits must handle free items
 * exactly like the live winter kit.
 *
 * Covers, from testcaseswelcomekit.xlsx: WK-TC-017, 018, 019, 021, 022, 023,
 * 025, 026 and 050 (free-kit handling), plus WK-TC-002, 005, 008, 009 (page
 * load) via the second describe below. Full mapping, including what is
 * deliberately not automated, in docs/WELCOME-KIT-COVERAGE.md.
 */

const config = loadKitConfig();

/**
 * Confirm the page on screen is still the product the config names, before
 * anything is read off it.
 *
 * A 200 is not identity. `winter-welcome-kit-combos` resolves and serves a
 * page titled "Shampoo & Conditioner Bundle with Free Welcome Kit" — the
 * reference had been renamed under the same handle. Every dimension compared
 * below would have described whatever product that turned out to be, and
 * reported it as the winter kit's behaviour.
 *
 * Where no canonical title has been recorded, this annotates the test rather
 * than failing it: "not checked" and "checked and fine" are different results,
 * and the run must not imply the second when it means the first.
 */
const assertIdentity = async (page: Page, kit: KitSpec): Promise<void> => {
  // Read defensively. An unmatched `pdp_title` would otherwise surface as a
  // locator timeout — true, and useless: it reads as "the page is broken" when
  // it means "this selector does not fit this theme". Those are different
  // problems with different owners.
  const observed = await page
    .locator(config.selectors.pdp_title)
    .first()
    .innerText()
    .then((text) => text.trim())
    .catch(() => '');

  expect(
    observed,
    `no title matched "${config.selectors.pdp_title}" on /products/${kit.handle}, so nothing here could confirm which product this is. Map pdp_title in config/kits.yaml "selectors", or run: npm run preflight`,
  ).not.toBe('');

  if (kit.canonicalTitle === undefined) {
    test.info().annotations.push({
      type: 'identity unverified',
      description:
        `No canonical_title recorded for "${kit.name}" (/products/${kit.handle}), so it ` +
        `could not be confirmed that this handle still serves that kit. The page is ` +
        `titled "${observed}" — if that is the right product, paste the title into ` +
        `config/kits.yaml under this kit as canonical_title.`,
    });
    return;
  }

  expect(
    isSameProduct(kit.canonicalTitle, observed),
    `/products/${kit.handle} is titled "${observed}" but config/kits.yaml records ` +
      `"${kit.canonicalTitle}". Either the product was renamed (update canonical_title) ` +
      `or the handle now points at a different product — in which case every result ` +
      `below would be describing that other product.`,
  ).toBe(true);
};

/**
 * Get to the cart page after adding, however this theme handles the click.
 *
 * The spec used to assume the click navigates. That is true of the fixture,
 * whose add-to-cart is an `<a href="/cart?kit=…">`, and false of most real
 * Shopify themes — mykitsch.com renders `.bundle-buy-button` as a DIV and
 * opens a drawer, leaving the URL on the PDP. Reading "the cart" off a product
 * page finds nothing, which is indistinguishable from a cart that is empty.
 *
 * So: give the click a moment to navigate on its own, and if it did not, go to
 * the cart. Not the other way round — navigating unconditionally would drop
 * the fixture's `?kit=` parameter and serve a generic cart, which would break
 * the detection control while looking like it still worked.
 */
/**
 * What the STORE says is in the cart, rather than what the page looks like.
 *
 * Shopify serves `/cart.js` as JSON on every storefront, and it is the only
 * thing that separates the two failures an empty-looking cart can mean:
 *
 *   0 items                    nothing was added. Against mykitsch.com this is
 *                              the real answer for the kit PDPs — pressing
 *                              `.bundle-buy-button` opened a builder and put
 *                              nothing in the cart. No selector fixes it.
 *   items, but no lines found  everything was added and `cart_line` does not
 *                              fit this theme. A config edit fixes it.
 *
 * Returns undefined where `/cart.js` is absent — the local fixture does not
 * serve it — and the caller then reports without it rather than inventing a
 * number.
 */
const serverCartCount = async (page: Page): Promise<number | undefined> =>
  page
    .evaluate(async () => {
      // The current page's query is carried across. A real storefront keys the
      // cart to the session and ignores unknown parameters, so this is a no-op
      // there; the local fixture is stateless and keys its cart by `?kit=`, and
      // fetching a bare `/cart.js` made it answer "empty" about a cart that had
      // two lines in it — which would have exercised the wrong branch of the
      // diagnosis below and passed for a test of it.
      const response = await fetch(`/cart.js${location.search}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      const count =
        typeof body === 'object' && body !== null
          ? (body as { item_count?: unknown }).item_count
          : undefined;
      return typeof count === 'number' ? count : undefined;
    })
    .catch(() => undefined);

const settleOnCart = async (page: Page): Promise<void> => {
  const onCart = (): boolean => new URL(page.url()).pathname.replace(/\/$/u, '').endsWith('/cart');

  await page.waitForURL((url) => url.pathname.replace(/\/$/u, '').endsWith('/cart'), {
    timeout: 5_000,
  }).catch(() => undefined);

  if (!onCart()) await page.goto('/cart');
};

const money = (value: string): number => Number(value.replace(/[^0-9.]/gu, '')) || 0;

/** The command that maps this theme's cart, quoted into failures verbatim. */
const baseCartProbeUrl = (handle: string): string =>
  `${process.env.KITSCH_BASE_URL ?? 'http://127.0.0.1:4173'}/products/${handle}`;

const free = (value: string): boolean => isFreePrice(value, config.freePricePattern);

/**
 * Cart-line prices split into the ones that cost nothing and the ones that do.
 * Free-ness is read from the price the customer is shown, not from a
 * `data-free` attribute — the attribute is a fixture invention and would not
 * exist on the live theme.
 */
const classify = (
  prices: readonly string[],
): {
  readonly freePrices: readonly string[];
  readonly paidPrices: readonly string[];
  readonly paidTotal: number;
} => {
  const freePrices = prices.filter(free);
  const paidPrices = prices.filter((price) => !free(price));
  return {
    freePrices,
    paidPrices,
    paidTotal: paidPrices.reduce((total, price) => total + money(price), 0),
  };
};

/**
 * What the profiler actually managed to see.
 *
 * Without this, an unmatched selector is indistinguishable from a real
 * finding. If `cart_line` matches nothing on a live theme, every cart
 * dimension falls to its default — not auto-added, not in the subtotal, not
 * separately removable — and both kits agree on all of them. The comparison
 * then reports no differences and the run goes green having examined no cart
 * at all. That is the worst outcome available to this suite, so the reference
 * kit has to prove it observed each thing the comparison claims to compare.
 */
type Observed = {
  readonly cartLines: number;
  readonly summaryLines: number;
};

/** Which observation each dimension depends on, and the selector behind it. */
const REQUIRES: Readonly<Record<KitDimension, keyof Observed>> = {
  free_line_count: 'cartLines',
  paid_line_count: 'cartLines',
  free_line_price_label: 'cartLines',
  counted_in_subtotal: 'cartLines',
  independently_removable: 'cartLines',
  removed_with_qualifying_product: 'cartLines',
  free_at_checkout: 'summaryLines',
};

const SELECTOR_FOR: Readonly<Record<keyof Observed, SelectorName>> = {
  cartLines: 'cart_line',
  summaryLines: 'summary_line',
};

/** Reads one kit's free-item treatment as a customer would experience it. */
const profileKit = async (
  page: Page,
  kit: KitSpec,
): Promise<{ readonly profile: KitProfile; readonly observed: Observed }> => {
  const response = await page.goto(`/products/${kit.handle}`);
  expect(
    response?.status(),
    `"${kit.name}" (/products/${kit.handle}) did not resolve — check the handle in config/kits.yaml`,
  ).toBe(200);

  // Before anything is read off this page, confirm it is the right product.
  await assertIdentity(page, kit);

  // Adding the kit is where every dimension below becomes visible. Nothing is
  // read from the PDP: this theme lists no kit contents and offers no gift
  // selector, so there is nothing there to read.
  await page.locator(config.selectors.add_to_cart).first().click();
  await settleOnCart(page);

  // Walked line by line so a free line can be paired with its own remove
  // control — a cart-wide count cannot tell which line the control belongs to.
  const cartLines = page.locator(config.selectors.cart_line);
  const lineCount = await cartLines.count();

  // Fail here, on the root cause, rather than thirty seconds later on whatever
  // reads next. Against mykitsch.com every cart selector matched nothing, and
  // the first thing to notice was `cart_subtotal` — which timed out with
  // Playwright's own "locator.innerText: Timeout 30000ms exceeded". True, and
  // useless: it reads as a hung page when it means the cart selectors do not
  // fit this theme. Three tests spent 54 seconds each arriving at the wrong
  // description of the same problem.
  if (lineCount === 0) {
    // Ask the store which of the two this is, rather than offering both and
    // leaving the reader to guess. They have different owners: one is a config
    // edit, the other is a product that cannot be added to a cart at all.
    const inStore = await serverCartCount(page);
    const diagnosis =
      inStore === undefined
        ? `"${config.selectors.cart_line}" matched nothing, and /cart.js did not answer, so it cannot be said here whether the cart is empty or merely unreadable.`
        : inStore === 0
          ? `the store reports an EMPTY cart (/cart.js item_count 0), so pressing "${config.selectors.add_to_cart}" added nothing. This is not a selector problem and no config edit fixes it — on this theme the buy control on a bundle PDP opens a builder, and pressing it is not the whole flow.`
          : `the store reports ${String(inStore)} item(s) in the cart (/cart.js), so the add worked and "${config.selectors.cart_line}" does not fit this theme. Map the cart selectors in config/kits.yaml "selectors".`;

    expect(
      lineCount,
      `no cart lines were read after adding ${kit.name}, so no dimension below could be measured. ${diagnosis} To see this theme's cart markup: node scratch-report/discover.mjs --add ${baseCartProbeUrl(kit.handle)}`,
    ).toBeGreaterThan(0);
  }

  const cartPrices: string[] = [];
  let freeLinesWithRemove = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const line = cartLines.nth(index);
    // A line with no price is a mapping problem, not a free line: defaulting
    // it to "" would classify it as not-free and inflate paid_line_count.
    const price = await line
      .locator(config.selectors.cart_line_price)
      .first()
      .innerText()
      .catch(() => undefined);
    expect(
      price,
      `cart line ${String(index + 1)} of ${String(lineCount)} on ${kit.name} has no price matching "${config.selectors.cart_line_price}". Every money dimension reads this, so a missing price cannot be treated as $0 — map cart_line_price in config/kits.yaml "selectors".`,
    ).not.toBeUndefined();
    cartPrices.push(price ?? '');
    if (free(price ?? '') && (await line.locator(config.selectors.cart_line_remove).count()) > 0) {
      freeLinesWithRemove += 1;
    }
  }
  const inCart = classify(cartPrices);

  const subtotalText = await page
    .locator(config.selectors.cart_subtotal)
    .first()
    .innerText()
    .catch(() => undefined);
  expect(
    subtotalText,
    `no subtotal matched "${config.selectors.cart_subtotal}" on the cart for ${kit.name}. counted_in_subtotal compares the subtotal against the paid lines, so without it a free item reaching the subtotal would go unreported — map cart_subtotal in config/kits.yaml "selectors".`,
  ).not.toBeUndefined();
  const subtotal = money(subtotalText ?? '');

  // §10 — the order summary, the last place a "free" item can cost money.
  await page.locator(config.selectors.checkout_button).first().click();
  const summaryPrices = await page
    .locator(config.selectors.summary_line)
    .locator(config.selectors.summary_price)
    .allInnerTexts();
  const freeAtCheckout =
    summaryPrices.length > 0 && summaryPrices.filter((price) => money(price) === 0).length > 0;

  // §8 negative case — remove the qualifying product and see whether the free
  // kit goes with it.
  await page.goto(`/cart?kit=${kit.handle}&removed=1`);
  const strandedPrices = await page
    .locator(config.selectors.cart_line)
    .locator(config.selectors.cart_line_price)
    .allInnerTexts();

  const profile: KitProfile = {
    free_line_count: inCart.freePrices.length,
    paid_line_count: inCart.paidPrices.length,
    free_line_price_label: normalizeLabels(inCart.freePrices),
    counted_in_subtotal: subtotal > inCart.paidTotal,
    independently_removable: freeLinesWithRemove > 0,
    removed_with_qualifying_product: strandedPrices.filter(free).length === 0,
    free_at_checkout: freeAtCheckout,
  };

  return {
    profile,
    observed: { cartLines: cartPrices.length, summaryLines: summaryPrices.length },
  };
};

/** Observations the configured comparison depends on, deduplicated. */
const REQUIRED_OBSERVATIONS = [
  ...new Set(config.compare.map((dimension) => REQUIRES[dimension])),
];

test.describe('welcome kit parity @kits @launch', () => {
  for (const candidate of config.candidates) {
    test(`${candidate.name} handles free items like the ${config.reference.name}`, async ({
      page,
    }) => {
      const reference = await profileKit(page, config.reference);
      const actual = await profileKit(page, candidate);

      // Every observation the comparison depends on must have been made on
      // the reference. An unmatched selector otherwise looks like agreement.
      const blind = REQUIRED_OBSERVATIONS.filter((name) => reference.observed[name] === 0).map(
        (name) =>
          `${name} (selector "${config.selectors[SELECTOR_FOR[name]]}" matched nothing on the ${config.reference.name})`,
      );
      expect(
        blind,
        `the comparison depends on observations that were never made, so agreement here would mean nothing. Map these in config/kits.yaml "selectors", or run: npm run preflight`,
      ).toEqual([]);

      // The reference must actually give something away, or "the candidate
      // matches it" is a statement about two carts that both contain nothing
      // free. That agreement would be perfect and worthless.
      expect(
        reference.profile.free_line_count,
        `adding the ${config.reference.name} put no free line in the cart, so there is nothing to match against. Either the reference kit no longer includes a free item — which is the finding — or "${config.selectors.cart_line_price}" is not reading this theme's cart prices. Run: npm run preflight`,
      ).toBeGreaterThan(0);

      const differences = diffKits(reference.profile, actual.profile, config.compare);

      expect(
        differences.map(
          (difference) =>
            `${difference.dimension}: ${config.reference.name} shows "${difference.reference}", ${candidate.name} shows "${difference.candidate}" — ${difference.explanation}`,
        ),
        `"${candidate.name}" handles free items differently from the live ${config.reference.name}`,
      ).toEqual([]);
    });
  }
});

/**
 * Test plan §4 / WK-TS-01 — page load and layout, on every kit including the
 * reference. Cheap, and it catches the case where a kit page is broken
 * outright, which would otherwise surface as a confusing parity difference.
 */
test.describe('welcome kit pages @kits @smoke', () => {
  for (const kit of [config.reference, ...config.candidates]) {
    test(`${kit.name} loads with title, sale price and Add to Cart`, async ({ page }) => {
      const response = await page.goto(`/products/${kit.handle}`);
      expect(response?.status(), `/products/${kit.handle} did not resolve`).toBe(200);

      await expect(page.locator(config.selectors.pdp_title).first()).toBeVisible();
      await expect(page.locator(config.selectors.add_to_cart).first()).toBeVisible();

      // WK-TC-005 — "correct product title on each page". A visible <h1> is
      // not that; this is.
      await assertIdentity(page, kit);

      // §4 — sale price with the original struck through beside it.
      const sale = money(await page.locator(config.selectors.pdp_price).first().innerText());
      const original = money(await page.locator(config.selectors.pdp_compare_at).first().innerText());
      expect(sale, `sale price on ${kit.name} must be a real amount`).toBeGreaterThan(0);
      expect(
        original,
        `original price on ${kit.name} must be higher than the sale price, or the saving is not a saving`,
      ).toBeGreaterThan(sale);
    });
  }
});
