import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { diffKits, loadKitConfig, normalizeLabels } from '../lib/kit-parity.js';
import type { KitProfile, KitSpec } from '../lib/kit-parity.js';

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

/** Reads one kit's free-item treatment as a customer would experience it. */
const profileKit = async (page: Page, kit: KitSpec): Promise<KitProfile> => {
  const response = await page.goto(`/products/${kit.handle}`);
  expect(
    response?.status(),
    `"${kit.name}" (/products/${kit.handle}) did not resolve — check the handle in config/kits.yaml`,
  ).toBe(200);

  const freeItems = page.locator('[data-testid="kit-item"][data-free="true"]');
  const priceLabels = await freeItems.locator('[data-testid="kit-item-price"]').allInnerTexts();
  const badges = await freeItems.locator('[data-testid="kit-item-badge"]').allInnerTexts();

  // §7 — the free-gift selector. A radio group permits one choice; anything
  // else permits several.
  const giftInputs = page.getByTestId('free-gift-input');
  const giftOptionCount = await giftInputs.count();
  const inputTypes = await giftInputs.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement).type),
  );

  // Adding the kit is where auto-add, subtotal and removability appear.
  await page.getByTestId('add-to-cart').click();

  const freeLines = page.locator('[data-testid="cart-line-item"][data-free="true"]');
  const autoAdded = (await freeLines.count()) > 0;
  const removableAlone = (await freeLines.locator('[data-testid="cart-remove"]').count()) > 0;

  const subtotal = money(await page.getByTestId('cart-subtotal').innerText());
  const paidLines = await page
    .locator('[data-testid="cart-line-item"][data-free="false"] [data-testid="line-price"]')
    .allInnerTexts();
  const paidSum = paidLines.reduce((total, value) => total + money(value), 0);

  // §10 — the order summary, the last place a "free" item can cost money.
  await page.getByTestId('checkout-button').click();
  const summaryFreePrices = await page
    .locator('[data-testid="summary-line"][data-free="true"] [data-testid="summary-price"]')
    .allInnerTexts();
  const freeAtCheckout =
    summaryFreePrices.length > 0 && summaryFreePrices.every((value) => money(value) === 0);

  // §8 negative case — remove the qualifying product and see whether the free
  // kit goes with it.
  await page.goto(`/cart?kit=${kit.handle}&removed=1`);
  const strandedFreeLines = await page
    .locator('[data-testid="cart-line-item"][data-free="true"]')
    .count();

  return {
    free_item_count: priceLabels.length,
    free_item_price_label: normalizeLabels(priceLabels),
    free_item_badge: normalizeLabels(badges),
    auto_added_to_cart: autoAdded,
    counted_in_subtotal: subtotal > paidSum,
    independently_removable: removableAlone,
    removed_with_qualifying_product: strandedFreeLines === 0,
    free_at_checkout: freeAtCheckout,
    free_gift_option_count: giftOptionCount,
    free_gift_single_select: inputTypes.length > 0 && inputTypes.every((type) => type === 'radio'),
  };
};

test.describe('welcome kit parity @kits @launch', () => {
  for (const candidate of config.candidates) {
    test(`${candidate.name} handles free items like the ${config.reference.name}`, async ({
      page,
    }) => {
      const reference = await profileKit(page, config.reference);
      const actual = await profileKit(page, candidate);

      // The reference must itself have free items and a gift selector, or
      // every comparison below is between two kits with nothing to compare —
      // a green run that checked nothing.
      expect(
        reference.free_item_count,
        `the ${config.reference.name} has no free items, so there is nothing to match against — check the handle in config/kits.yaml`,
      ).toBeGreaterThan(0);
      expect(
        reference.free_gift_option_count,
        `the ${config.reference.name} shows no free-gift options, so §7 cannot be compared`,
      ).toBeGreaterThan(0);

      const differences = diffKits(reference, actual, config.compare);

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

      await expect(page.getByTestId('pdp-title')).toBeVisible();
      await expect(page.getByTestId('add-to-cart')).toBeVisible();

      // §4 — sale price with the original struck through beside it.
      const sale = money(await page.getByTestId('pdp-price').innerText());
      const original = money(await page.getByTestId('pdp-compare-at').innerText());
      expect(sale, `sale price on ${kit.name} must be a real amount`).toBeGreaterThan(0);
      expect(
        original,
        `original price on ${kit.name} must be higher than the sale price, or the saving is not a saving`,
      ).toBeGreaterThan(sale);
    });
  }
});
