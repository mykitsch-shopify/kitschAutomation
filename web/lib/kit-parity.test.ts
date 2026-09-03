import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffKits, isSameProduct, normalizeLabels } from './kit-parity.js';
import type { KitProfile } from './kit-parity.js';

/**
 * The comparator has to be able to say "these differ" for each dimension
 * separately, or a report saying "the kits match" means nothing.
 */

/**
 * The reference cart: one paid line for the qualifying product, one free line
 * for the Welcome Kit, the free line absent from the subtotal, not removable
 * on its own, gone when the qualifying product goes, still $0 at checkout.
 */
const winter: KitProfile = {
  free_line_count: 1,
  paid_line_count: 1,
  free_line_price_label: ['free'],
  counted_in_subtotal: false,
  independently_removable: false,
  removed_with_qualifying_product: true,
  free_at_checkout: true,
};

const like = (overrides: Partial<KitProfile>): KitProfile => ({ ...winter, ...overrides });

const dimensionsIn = (differences: readonly { readonly dimension: string }[]): readonly string[] =>
  differences.map((difference) => difference.dimension).sort();

void test('an identical kit produces no differences', () => {
  assert.deepEqual(diffKits(winter, like({})), []);
});

void test('a gift that never reaches the cart is caught', () => {
  // The auto-add failure: free line gone, paid line count unchanged.
  assert.deepEqual(
    dimensionsIn(diffKits(winter, like({ free_line_count: 0 }))),
    ['free_line_count'],
  );
});

void test('a gift that reaches the cart but is charged reads differently from one that never arrives', () => {
  // Both defects zero the free line. Only paid_line_count separates them, and
  // that separation is the whole reason it is a dimension.
  const charged = dimensionsIn(
    diffKits(winter, like({ free_line_count: 0, paid_line_count: 2, free_line_price_label: [] })),
  );
  const missing = dimensionsIn(
    diffKits(winter, like({ free_line_count: 0, free_line_price_label: [] })),
  );
  assert.ok(charged.includes('paid_line_count'));
  assert.ok(!missing.includes('paid_line_count'));
});

void test('a struck-through price instead of "Free" in the cart is caught', () => {
  const differences = diffKits(winter, like({ free_line_price_label: ['$0.00'] }));
  assert.deepEqual(dimensionsIn(differences), ['free_line_price_label']);
  assert.equal(differences[0]?.reference, 'free');
  assert.equal(differences[0]?.candidate, '$0.00');
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
    like({ free_line_price_label: ['$0.00'], free_line_count: 2, counted_in_subtotal: true }),
  );
  assert.deepEqual(dimensionsIn(differences), [
    'counted_in_subtotal',
    'free_line_count',
    'free_line_price_label',
  ]);
});

void test('every difference explains why it matters', () => {
  const differences = diffKits(winter, like({ counted_in_subtotal: true }));
  assert.match(differences[0]?.explanation ?? '', /subtotal/u);
});

void test('only the declared dimensions are compared', () => {
  // Marketing may accept a wording difference while the money must match.
  const differences = diffKits(winter, like({ free_line_price_label: ['$0.00'] }), [
    'counted_in_subtotal',
  ]);
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

void test('label comparison ignores case, spacing and DOM order', () => {
  assert.deepEqual(normalizeLabels(['  FREE ', 'Free Gift']), ['free', 'free gift']);
  assert.deepEqual(
    diffKits(winter, like({ free_line_price_label: normalizeLabels(['  Free  ']) })),
    [],
  );
});

// ── identity ──────────────────────────────────────────────────────────────

void test('a renamed product is not the same product', () => {
  assert.equal(
    isSameProduct(
      'Shampoo & Conditioner Bundle with Free Welcome Kit',
      'Winter Welcome Kit Combos',
    ),
    false,
  );
});

void test('identity survives case, ampersand encoding and dash variants', () => {
  // The live page renders the ampersand entity-encoded and uses an en dash
  // where the recorded title has a hyphen. Neither is a rename.
  assert.equal(
    isSameProduct(
      'Shampoo & Conditioner Bundle with Free Welcome Kit',
      'shampoo &amp; conditioner bundle with free welcome kit',
    ),
    true,
  );
  assert.equal(isSameProduct('2-Compartment Travel Case', '2–Compartment Travel Case'), true);
});
