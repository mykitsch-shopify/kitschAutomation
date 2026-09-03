/**
 * Welcome-kit fixture.
 *
 * Models the structure the Welcome Kit test plan describes: a qualifying
 * product at a sale price with a struck-through original, a "Your free gift!"
 * selector offering several options of which exactly one may be chosen, and a
 * free Welcome Kit that auto-adds at $0, never reaches the subtotal, cannot
 * be removed on its own, and disappears when the qualifying product does.
 *
 * The winter kit is the live reference. The seasonal kits are compared
 * against it, so in the clean profile they behave identically; in the seeded
 * profile one of them diverges, which is what proves the comparison can fail.
 */

export type KitItem = { readonly title: string; readonly price: string; readonly free: boolean };

export type Kit = {
  readonly handle: string;
  readonly title: string;
  readonly salePrice: string;
  readonly originalPrice: string;
  readonly items: readonly KitItem[];
  readonly giftOptions: readonly string[];
};

const FREE_KIT = 'Free Welcome Kit';

/** Test plan §7 — the four free-gift options on the qualifying SKUs. */
const GIFTS = [
  'Terracotta Scalp Exfoliator',
  'Shampoo Bar Bag',
  'Black Seamless Hair Elastics 8pc Set',
  'Black Conditioner Bar Bag',
] as const;

const kit = (handle: string, title: string, product: string): Kit => ({
  handle,
  title,
  salePrice: '$28.00',
  originalPrice: '$53.00',
  items: [
    { title: product, price: '$28.00', free: false },
    { title: FREE_KIT, price: 'Free', free: true },
  ],
  giftOptions: [...GIFTS],
});

export const KITS: readonly Kit[] = [
  // SKU 2 — the live reference.
  //
  // Titled as the storefront titles it, not as the brief names it. The handle
  // `winter-welcome-kit-combos` serves a page called "Shampoo & Conditioner
  // Bundle with Free Welcome Kit" on mykitsch.com — the kit was renamed and
  // the handle kept. config/kits.yaml records that as `canonical_title` and
  // the spec asserts it, so the fixture has to render the same thing or the
  // identity check would pass against the store and fail against the fixture.
  kit(
    'winter-welcome-kit-combos',
    'Shampoo & Conditioner Bundle with Free Welcome Kit',
    'Rice Water Shampoo & Conditioner Combo',
  ),
  kit(
    'summer-welcome-kit-liquid-combos',
    'Summer Welcome Kit with Shampoo & Conditioner',
    'Summer Shampoo & Conditioner Combo',
  ),
  kit(
    'summer-welcome-kit-bar-combos',
    'Summer Welcome Kit with Shampoo & Conditioner Bars',
    'Summer Shampoo & Conditioner Bar Combo',
  ),
  // "Spring Welcome Kit", not "Spring Welcome Kit Combo" — the brief says
  // Combo, the storefront does not. Titled as the store titles it, for the
  // same reason as the reference above: one config has to satisfy the identity
  // check against both this fixture and mykitsch.com.
  kit(
    'shampoo-conditioner-bar-bundle-with-free-spring-welcome-kit-combo',
    'Spring Welcome Kit',
    'Spring Shampoo & Conditioner Bar Bundle',
  ),
];

export const kitByHandle = (handle: string): Kit | undefined =>
  KITS.find((entry) => entry.handle === handle);

/**
 * How a divergent kit misbehaves. Every field is a real defect class from the
 * test plan: MSRP leakage (§12), a gift that is not auto-added or is
 * separately removable (§7, §8), and a free item reaching the subtotal or the
 * order summary at a non-zero price (§8, §10).
 *
 * Two fields used to live here — `multiSelectGifts` and `droppedGiftOption`,
 * both about the §7 gift selector — and are gone. Not because the fixture
 * cannot render them, but because the parity spec no longer looks at the
 * selector: mykitsch.com does not have one, so the dimensions that read it
 * were removed rather than left to pass by default. A seeded defect that
 * nothing can detect is worse than no seeded defect at all — it makes the
 * fixture look like it is proving more than it is.
 */
export type KitDivergence = {
  readonly leakedPrice: boolean;
  readonly notAutoAdded: boolean;
  readonly separatelyRemovable: boolean;
  readonly strandedOnRemoval: boolean;
  readonly chargedAtCheckout: boolean;
};

/** Every way this fixture knows how to break a kit. */
export const DIVERGENCE_KINDS = [
  'leakedPrice',
  'notAutoAdded',
  'separatelyRemovable',
  'strandedOnRemoval',
  'chargedAtCheckout',
] as const;

export type DivergenceKind = (typeof DIVERGENCE_KINDS)[number];

export const NO_DIVERGENCE: KitDivergence = {
  leakedPrice: false,
  notAutoAdded: false,
  separatelyRemovable: false,
  strandedOnRemoval: false,
  chargedAtCheckout: false,
};

/**
 * The seeded divergence, on one seasonal kit only. Everything at once, which
 * is what the `seeded` profile serves.
 *
 * Useful for eyeballing, and useless as proof. Defects mask each other when
 * they are stacked: a leaked price means the gift line is no longer a free
 * line, so `separatelyRemovable` and `strandedOnRemoval` — both of which are
 * read off the free lines — become invisible behind it. The detection control
 * therefore seeds one at a time; see `onlyDivergence` and
 * tools/verify-kit-parity.ts.
 */
export const SEEDED_DIVERGENCE: KitDivergence = {
  leakedPrice: true,
  notAutoAdded: false,
  separatelyRemovable: true,
  strandedOnRemoval: true,
  chargedAtCheckout: true,
};

/** One defect and nothing else, so what the spec catches is unambiguous. */
export const onlyDivergence = (kind: DivergenceKind): KitDivergence => ({
  ...NO_DIVERGENCE,
  [kind]: true,
});

export type KitRender = {
  readonly escape: (value: string) => string;
  readonly addToCartLabel: string;
  readonly removeLabel: string;
  readonly subtotalLabel: string;
  readonly checkoutLabel: string;
  readonly cartHeading: string;
  readonly localePrefix: string;
};

const money = (value: string): number => Number(value.replace(/[^0-9.]/gu, '')) || 0;

/** Price shown for a free item — "$12.00" when the kit leaks its MSRP. */
const freePrice = (divergence: KitDivergence): string =>
  divergence.leakedPrice ? '$12.00' : 'Free';

export const kitPdp = (kit: Kit, divergence: KitDivergence, view: KitRender): string => {
  // Kept rendering, no longer varied. The spec does not read the selector any
  // more — see KitDivergence — but the markup stays so the fixture page still
  // resembles the kind of PDP the test plan describes.
  const gifts = kit.giftOptions;
  const selector = 'radio';

  return `
    <h1 data-testid="pdp-title">${view.escape(kit.title)}</h1>
    <p class="price" data-testid="pdp-price">${view.escape(kit.salePrice)}</p>
    <p data-testid="pdp-compare-at"><s>${view.escape(kit.originalPrice)}</s></p>
    <ul data-testid="kit-contents">
${kit.items
  .map(
    (item) => `      <li data-testid="kit-item" data-free="${String(item.free)}">
        <span data-testid="kit-item-title">${view.escape(item.title)}</span>
        <span data-testid="kit-item-price">${view.escape(item.free ? freePrice(divergence) : item.price)}</span>
        ${item.free && !divergence.leakedPrice ? `<span data-testid="kit-item-badge">Free gift</span>` : ''}
      </li>`,
  )
  .join('\n')}
    </ul>
    <fieldset data-testid="free-gift-selector">
      <legend>Your free gift!</legend>
${gifts
  .map(
    (gift, index) => `      <label data-testid="free-gift-option">
        <input type="${selector}" name="free-gift" value="${String(index)}" data-testid="free-gift-input" />
        ${view.escape(gift)}
      </label>`,
  )
  .join('\n')}
    </fieldset>
    <a data-testid="add-to-cart" href="${view.localePrefix}/cart?kit=${kit.handle}">${view.escape(
      view.addToCartLabel,
    )}</a>`;
};

/**
 * Which items are in the cart, as data.
 *
 * Shared by the rendered cart and by `/cart.js`, and it has to be, because the
 * spec now reads both: it asks the store for an item count to tell "nothing was
 * added" apart from "the selectors cannot see it". A fixture whose JSON and DOM
 * disagreed would make that check fire on a cart that is perfectly fine.
 *
 * §8 — removing the qualifying product takes the free kit with it, unless this
 * kit strands it.
 */
export const cartLines = (
  kit: Kit,
  divergence: KitDivergence,
  qualifyingRemoved: boolean,
): readonly KitItem[] =>
  kit.items.filter((item) => {
    if (item.free) {
      if (divergence.notAutoAdded) return false;
      return qualifyingRemoved ? divergence.strandedOnRemoval : true;
    }
    return !qualifyingRemoved;
  });

export const kitCart = (
  kit: Kit,
  divergence: KitDivergence,
  view: KitRender,
  qualifyingRemoved: boolean,
): string => {
  const lines = cartLines(kit, divergence, qualifyingRemoved);

  const subtotal = lines
    .filter((item) => !item.free || divergence.leakedPrice)
    .reduce((total, item) => total + money(item.free ? freePrice(divergence) : item.price), 0);

  return `
    <h1 data-testid="cart-heading">${view.escape(view.cartHeading)}</h1>
    <ul>
${lines
  .map(
    (item) => `      <li data-testid="cart-line-item" data-free="${String(item.free)}">
        <span data-testid="line-title">${view.escape(item.title)}</span>
        <span class="price" data-testid="line-price">${view.escape(item.free ? freePrice(divergence) : item.price)}</span>
        ${!item.free || divergence.separatelyRemovable ? `<a data-testid="cart-remove" href="${view.localePrefix}/cart?kit=${kit.handle}&removed=1">${view.escape(view.removeLabel)}</a>` : ''}
      </li>`,
  )
  .join('\n')}
    </ul>
    <p data-testid="cart-subtotal-label">${view.escape(view.subtotalLabel)}</p>
    <p class="price" data-testid="cart-subtotal">$${subtotal.toFixed(2)}</p>
    <a data-testid="checkout-button" href="${view.localePrefix}/checkout?kit=${kit.handle}">${view.escape(
      view.checkoutLabel,
    )}</a>`;
};

/** §10 — the order summary, where a free item last has a chance to cost money. */
export const kitOrderSummary = (kit: Kit, divergence: KitDivergence, view: KitRender): string => `
    <h2 data-testid="order-summary">Order summary</h2>
    <ul>
${kit.items
  .filter((item) => !item.free || !divergence.notAutoAdded)
  .map(
    (item) => `      <li data-testid="summary-line" data-free="${String(item.free)}">
        <span>${view.escape(item.title)}</span>
        <span data-testid="summary-price">${view.escape(
          item.free ? (divergence.chargedAtCheckout ? '$12.00' : '$0.00') : item.price,
        )}</span>
      </li>`,
  )
  .join('\n')}
    </ul>`;
