import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffKits, normalizeLabels } from './kit-parity.js';
import type { KitProfile } from './kit-parity.js';

/**
 * The comparator has to be able to say "these differ" for each dimension
 * separately, or a report saying "the kits match" means nothing.
 */

const winter: KitProfile = {
  free_item_count: 1,
  free_item_price_label: ['free'],
  free_item_badge: ['free gift'],
  auto_added_to_cart: true,
  counted_in_subtotal: false,
  independently_removable: false,
  removed_with_qualifying_product: true,
  free_at_checkout: true,
  free_gift_option_count: 4,
  free_gift_single_select: true,
};

const like = (overrides: Partial<KitProfile>): KitProfile => ({ ...winter, ...overrides });

const dimensionsIn = (differences: readonly { readonly dimension: string }[]): readonly string[] =>
  differences.map((difference) => difference.dimension).sort();

void test('an identical kit produces no differences', () => {
  assert.deepEqual(diffKits(winter, like({})), []);
});

void test('a different number of free items is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ free_item_count: 2 }))), [
    'free_item_count',
  ]);
});

void test('a struck-through price instead of "Free" is caught', () => {
  // The commonest way two kits diverge: same item, different promise.
  const differences = diffKits(winter, like({ free_item_price_label: ['$12.00'] }));
  assert.deepEqual(dimensionsIn(differences), ['free_item_price_label']);
  assert.equal(differences[0]?.reference, 'free');
  assert.equal(differences[0]?.candidate, '$12.00');
});

void test('a missing badge is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ free_item_badge: [] }))), [
    'free_item_badge',
  ]);
});

void test('a gift that is not auto-added is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ auto_added_to_cart: false }))), [
    'auto_added_to_cart',
  ]);
});

void test('a free item that lands in the subtotal is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ counted_in_subtotal: true }))), [
    'counted_in_subtotal',
  ]);
});

void test('a separately removable gift is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ independently_removable: true }))), [
    'independently_removable',
  ]);
});

void test('several divergences are all reported, not just the first', () => {
  const differences = diffKits(
    winter,
    like({ free_item_price_label: ['$12.00'], auto_added_to_cart: false, counted_in_subtotal: true }),
  );
  assert.deepEqual(dimensionsIn(differences), [
    'auto_added_to_cart',
    'counted_in_subtotal',
    'free_item_price_label',
  ]);
});

void test('every difference explains why it matters', () => {
  const differences = diffKits(winter, like({ counted_in_subtotal: true }));
  assert.match(differences[0]?.explanation ?? '', /subtotal/u);
});

void test('only the declared dimensions are compared', () => {
  // Marketing may accept a badge difference while the money must match.
  const differences = diffKits(winter, like({ free_item_badge: [] }), ['counted_in_subtotal']);
  assert.deepEqual(differences, []);
});

void test('a free kit stranded after removing the qualifying product is caught', () => {
  assert.deepEqual(
    dimensionsIn(diffKits(winter, like({ removed_with_qualifying_product: false }))),
    ['removed_with_qualifying_product'],
  );
});

void test('a free item that is charged in the order summary is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ free_at_checkout: false }))), [
    'free_at_checkout',
  ]);
});

void test('a different number of free-gift options is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ free_gift_option_count: 3 }))), [
    'free_gift_option_count',
  ]);
});

void test('a gift selector allowing more than one choice is caught', () => {
  assert.deepEqual(dimensionsIn(diffKits(winter, like({ free_gift_single_select: false }))), [
    'free_gift_single_select',
  ]);
});

void test('label comparison ignores case, spacing and DOM order', () => {
  assert.deepEqual(normalizeLabels(['  FREE ', 'Free Gift']), ['free', 'free gift']);
  assert.deepEqual(
    diffKits(winter, like({ free_item_price_label: normalizeLabels(['  Free  ']) })),
    [],
  );
});
