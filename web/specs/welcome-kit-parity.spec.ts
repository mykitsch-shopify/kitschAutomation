import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { diffKits, isFreePrice, loadKitConfig, normalizeLabels } from '../lib/kit-parity.js';
import type { KitDimension, KitProfile, KitSpec, SelectorName } from '../lib/kit-parity.js';

/**
 * Welcome-kit free-item parity.
 *
 * What this catches that an API check cannot: two kits can contain identical
 * line items and still make different promises. The Admin API says both hold
 * a Welcome Kit at zero cost; it does not say that one shows "Free" and the
 * other a struck-through $12.00, that one auto-adds the kit and the other
 * waits to be noticed, that one strands the free kit in the cart after the
 * qualifying product is removed, or that one lets a customer tick three free
 * gifts. All of that is theme and cart behaviour, and all of it is what a
 * customer actually meets.
 *
 * Deliberately differential. The live Winter Welcome Kit Combos defines
 * correct; the seasonal kits are measured against whatever it does. So this
 * spec keeps working when merchandising changes the winter kit — the
 * reference moves and the comparison moves with it — and it never has to be
 * told what a free item "should" do.
 *
 * Requirement: the summer and spring welcome kits must handle free items
 * exactly like the live winter kit.
 *
 * Covers, from testcaseswelcomekit.xlsx: WK-TC-017 through 026 and WK-TC-050
 * (free-kit handling), plus WK-TC-002, 005, 008, 009 (page load) via the
 * second describe below. Full mapping, including what is deliberately not
 * automated, in docs/WELCOME-KIT-COVERAGE.md.
 */

const config = loadKitConfig();

const money = (value: string): number => Number(value.replace(/[^0-9.]/gu, '')) || 0;

const free = (value: string): boolean => isFreePrice(value, config.freePricePattern);

/**
 * Prices of the items a kit page lists, paired with whether each is free.
 * Free-ness is read from the price the customer is shown, not from a
 * `data-free` attribute — the attribute is a fixture invention and would not
 * exist on the live theme.
 */
const classify = (prices: readonly string[]): { readonly freePrices: readonly string[]; readonly paidTotal: number } => ({
  freePrices: prices.filter(free),
  paidTotal: prices.filter((price) => !free(price)).reduce((total, price) => total + money(price), 0),
});

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
  readonly kitItems: number;
  readonly cartLines: number;
  readonly summaryLines: number;
  readonly giftInputs: number;
};

/** Which observation each dimension depends on, and the selector behind it. */
const REQUIRES: Readonly<Record<KitDimension, keyof Observed>> = {
  free_item_count: 'kitItems',
  free_item_price_label: 'kitItems',
  free_item_badge: 'kitItems',
  auto_added_to_cart: 'cartLines',
  counted_in_subtotal: 'cartLines',
  independently_removable: 'cartLines',
  removed_with_qualifying_product: 'cartLines',
  free_at_checkout: 'summaryLines',
  free_gift_option_count: 'giftInputs',
  free_gift_single_select: 'giftInputs',
};

const SELECTOR_FOR: Readonly<Record<keyof Observed, SelectorName>> = {
  kitItems: 'kit_item',
  cartLines: 'cart_line',
  summaryLines: 'summary_line',
  giftInputs: 'free_gift_input',
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

  const items = page.locator(config.selectors.kit_item);
  const kitItemCount = await items.count();
  expect(
    kitItemCount,
    `no kit items matched "${config.selectors.kit_item}" on ${kit.name}. If the theme markup differs, map it in config/kits.yaml under "selectors" — a spec that finds nothing must not pass.`,
  ).toBeGreaterThan(0);

  const itemPrices = await items.locator(config.selectors.kit_item_price).allInnerTexts();
  const badges = await items.locator(config.selectors.kit_item_badge).allInnerTexts();
  const onPdp = classify(itemPrices);

  // §7 — the free-gift selector. A radio group permits one choice.
  const giftInputs = page.locator(config.selectors.free_gift_input);
  const giftOptionCount = await giftInputs.count();
  const inputTypes = await giftInputs.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement).type),
  );

  // Adding the kit is where auto-add, subtotal and removability appear.
  await page.locator(config.selectors.add_to_cart).first().click();

  // Walked line by line so a free line can be paired with its own remove
  // control — a cart-wide count cannot tell which line the control belongs to.
  const cartLines = page.locator(config.selectors.cart_line);
  const cartPrices: string[] = [];
  let freeLinesWithRemove = 0;
  for (let index = 0; index < (await cartLines.count()); index += 1) {
    const line = cartLines.nth(index);
    const price = await line.locator(config.selectors.cart_line_price).first().innerText();
    cartPrices.push(price);
    if (free(price) && (await line.locator(config.selectors.cart_line_remove).count()) > 0) {
      freeLinesWithRemove += 1;
    }
  }
  const inCart = classify(cartPrices);

  const subtotal = money(await page.locator(config.selectors.cart_subtotal).first().innerText());

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
    free_item_count: onPdp.freePrices.length,
    free_item_price_label: normalizeLabels(onPdp.freePrices),
    free_item_badge: normalizeLabels(badges),
    auto_added_to_cart: inCart.freePrices.length > 0,
    counted_in_subtotal: subtotal > inCart.paidTotal,
    independently_removable: freeLinesWithRemove > 0,
    removed_with_qualifying_product: strandedPrices.filter(free).length === 0,
    free_at_checkout: freeAtCheckout,
    free_gift_option_count: giftOptionCount,
    free_gift_single_select: inputTypes.length > 0 && inputTypes.every((type) => type === 'radio'),
  };

  return {
    profile,
    observed: {
      // Captured on the PDP: by now the page is the cart, where this locator
      // would report zero and turn the guard below into a false alarm.
      kitItems: kitItemCount,
      cartLines: cartPrices.length,
      summaryLines: summaryPrices.length,
      giftInputs: giftOptionCount,
    },
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

      expect(
        reference.profile.free_item_count,
        `the ${config.reference.name} has no free items, so there is nothing to match against — check the handle in config/kits.yaml`,
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
