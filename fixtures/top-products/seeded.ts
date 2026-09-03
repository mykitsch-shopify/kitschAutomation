/**
 * Defects the seeded top-products fixture plants, and nothing else.
 *
 * Kept apart from server.ts because that module listens on a port as an import
 * side effect, and the detection check needs this list without starting one.
 */

export type SeededDefect = {
  readonly handle: string;
  readonly kind:
    | 'sold_out'
    | 'add_to_cart_failed'
    | 'price_zero'
    | 'description_missing'
    | 'image_broken'
    | 'images_missing'
    | 'specifications_missing'
    | 'variant_broken'
    | 'title_mismatch'
    | 'cart_math_wrong';
  readonly note: string;
};

/** One per requirement in the daily brief, so no requirement goes unproven. */
export const SEEDED: readonly SeededDefect[] = [
  {
    handle: 'seed-sold-out',
    kind: 'sold_out',
    note: 'top seller shown as sold out — availability check',
  },
  {
    handle: 'seed-cart-broken',
    kind: 'add_to_cart_failed',
    note: 'add-to-cart button present but adds no line',
  },
  {
    handle: 'seed-price-zero',
    kind: 'price_zero',
    note: 'price renders as $0.00',
  },
  {
    handle: 'seed-no-description',
    kind: 'description_missing',
    note: 'description is a placeholder, under the length floor',
  },
  {
    handle: 'seed-broken-image',
    kind: 'image_broken',
    note: 'image in the markup that never loads — customer sees a gap',
  },
  {
    handle: 'seed-no-specs',
    kind: 'specifications_missing',
    note: 'specifications heading with nothing under it',
  },
  {
    handle: 'seed-variant-broken',
    kind: 'variant_broken',
    note: 'selecting the second variant leaves no price',
  },
  {
    handle: 'seed-wrong-product',
    kind: 'title_mismatch',
    note: 'handle serves a different product than the list records',
  },
];

/** Cart-level defect, not tied to one product. */
export const SEEDED_CART = {
  kind: 'cart_math_wrong' as const,
  note: 'cart displays a $2.00 discount and charges the full subtotal',
};
