import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  ALL_CHECKS,
  auditConfig,
  clientFindings,
  judgeCart,
  judgeProduct,
  loadTopProductsConfig,
  normalizeTitle,
  tally,
  titleOverlap,
  type CartObservation,
  type Observation,
  type ProductSpec,
  type TopProductsConfig,
} from './top-products.js';

const kinds = (findings: readonly { readonly kind: string }[]): readonly string[] =>
  findings.map((f) => f.kind).sort();

const config = (over: Partial<TopProductsConfig> = {}): TopProductsConfig => ({
  products: [],
  checks: ALL_CHECKS,
  thresholds: {
    minDescriptionChars: 80,
    minSpecificationChars: 40,
    minImages: 1,
    maxLoadMs: 15_000,
  },
  codes: [],
  expectedStacking: [],
  selectors: {},
  ...over,
});

const spec = (over: Partial<ProductSpec> = {}): ProductSpec => ({
  title: 'Self-Draining Soap Dish',
  handle: 'self-draining-soap-dish',
  canonicalTitle: 'Self-Draining Soap Dish',
  expectVideo: false,
  ...over,
});

const observation = (over: Partial<Observation> = {}): Observation => ({
  product: 'Self-Draining Soap Dish',
  handle: 'self-draining-soap-dish',
  status: 200,
  loadMs: 900,
  titleText: 'Self-Draining Soap Dish',
  priceText: '$12.00',
  descriptionText: 'x'.repeat(120),
  specificationsText: 'y'.repeat(60),
  imageCount: 4,
  brokenImageCount: 0,
  videoCount: 0,
  soldOut: false,
  addToCartWorked: true,
  variants: [{ label: 'Default Title', selectable: true, priceText: '$12.00', soldOut: false }],
  ...over,
});

const cart = (over: Partial<CartObservation> = {}): CartObservation => ({
  subtotalCents: 1200,
  discountCents: 0,
  totalCents: 1200,
  appliedCodes: [],
  ...over,
});

// ── the real config file ─────────────────────────────────────────────────

void test('config: the shipped top-products.yaml loads and holds all ten products', () => {
  const loaded = loadTopProductsConfig();
  assert.equal(loaded.products.length, 10);
  assert.ok(loaded.checks.length > 0);
});

void test('config: an unset handle becomes undefined rather than an empty string', () => {
  // YAML gives null for `handle:` with no value. Treating that as "" would
  // produce a request to /products/ and a confusing 404 rather than a clear
  // "we have no URL for this product".
  //
  // Asserted against a written fixture rather than the shipped config. It used
  // to require the real file to still contain an unresolved handle, so
  // resolving the last one turned this parser test red — a test about parsing
  // failing because somebody finished the merchandising data. The two are not
  // related and should not be able to break each other.
  const path = `${tmpdir()}/kitsch-top-products-${String(process.pid)}.yaml`;
  writeFileSync(
    path,
    ['products:', '  - title: Resolved', '    handle: a-handle', '  - title: Unresolved', '    handle:', 'checks:', '  - availability'].join('\n'),
    'utf8',
  );
  const loaded = loadTopProductsConfig(path);
  rmSync(path, { force: true });

  assert.equal(loaded.products[0]?.handle, 'a-handle');
  assert.equal(loaded.products[1]?.handle, undefined);
});

void test('auditConfig: reports every product the list gives no handle for', () => {
  const findings = auditConfig(
    config({ products: [spec(), spec({ title: 'Shampoo Bar Bag', handle: undefined })] }),
  );
  assert.deepEqual(kinds(findings), ['handle_unresolved']);
  assert.equal(findings[0]?.product, 'Shampoo Bar Bag');
  assert.match(findings[0]?.detail ?? '', /guessing one would test a different product/u);
});

// ── title matching ───────────────────────────────────────────────────────

void test('normalizeTitle: folds the ways a storefront prints the same name', () => {
  assert.equal(normalizeTitle('Shampoo &amp; Conditioner'), 'shampoo and conditioner');
  assert.equal(normalizeTitle('Shampoo & Conditioner'), 'shampoo and conditioner');
  assert.equal(normalizeTitle('Self‐Draining  Soap Dish'), 'self draining soap dish');
});

void test('titleOverlap: cannot separate a neighbouring product, which is why it is not the identity check', () => {
  // Measured, not assumed. The wrong product scores HIGHER than the right one,
  // because these titles share their boilerplate and differ by the one word
  // that matters. Recorded here so nobody promotes this metric to the identity
  // check later.
  const rightProduct = titleOverlap(
    'Rice Water Shampoo Bar for Hair Growth',
    'Rice Water Shampoo Bar | Kitsch',
  );
  const wrongProduct = titleOverlap(
    'Rice Water Shampoo Bar for Hair Growth',
    'Rice Water Conditioner Bar for Hair Growth',
  );
  assert.ok(
    wrongProduct > rightProduct,
    `expected the metric to be unusable for identity: right=${rightProduct}, wrong=${wrongProduct}`,
  );
});

void test('judgeProduct: a renamed or swapped product is caught by exact canonical title', () => {
  const findings = judgeProduct(
    spec({
      title: 'Rice Water Shampoo Bar for Hair Growth',
      canonicalTitle: 'Rice Water Shampoo Bar for Hair Growth',
    }),
    config(),
    observation({
      titleText: 'Rice Water Conditioner Bar for Hair Growth',
      soldOut: true,
      priceText: undefined,
    }),
  );
  // Only the mismatch: everything else on the page describes another product,
  // so reporting it too would be noise pointing at the wrong thing.
  assert.deepEqual(kinds(findings), ['title_mismatch']);
  assert.equal(findings[0]?.severity, 'critical');
});

void test('judgeProduct: canonical title matching ignores punctuation and entity spelling', () => {
  // Otherwise every product fails every morning on "&" vs "&amp;", which is
  // how a daily report teaches people to ignore it.
  assert.deepEqual(
    judgeProduct(
      spec({ canonicalTitle: 'Shampoo & Conditioner Combo' }),
      config({ checks: ['title'] }),
      observation({ titleText: 'Shampoo &amp; Conditioner Combo' }),
    ),
    [],
  );
});

void test('judgeProduct: with no canonical title recorded, identity is flagged as unconfirmed', () => {
  const findings = judgeProduct(
    spec({ canonicalTitle: undefined }),
    config({ checks: ['title'] }),
    observation(),
  );
  assert.deepEqual(kinds(findings), ['canonical_title_unrecorded']);
  assert.equal(findings[0]?.severity, 'minor');
});

void test('judgeProduct: with no canonical title, a wildly unrelated page still fails', () => {
  const findings = judgeProduct(
    spec({ title: 'Self-Draining Soap Dish', canonicalTitle: undefined }),
    config({ checks: ['title'] }),
    observation({ titleText: 'Harry Potter Satin Pillowcase King Gryffindor' }),
  );
  assert.ok(kinds(findings).includes('title_mismatch'));
});

// ── the happy path ───────────────────────────────────────────────────────

void test('judgeProduct: a healthy product produces no findings', () => {
  assert.deepEqual(judgeProduct(spec(), config(), observation()), []);
});

// ── each requirement in the brief ────────────────────────────────────────

void test('judgeProduct: sold out is critical for a top-10 seller', () => {
  const findings = judgeProduct(spec(), config(), observation({ soldOut: true }));
  assert.deepEqual(kinds(findings), ['sold_out']);
  assert.equal(findings[0]?.severity, 'critical');
});

void test('judgeProduct: a sold-out product reports one finding, not two', () => {
  // A sold-out product has no buy button, so add-to-cart cannot work. Both
  // checks used to fire, producing "sold out" AND "clicking add-to-cart did
  // not put a line in the cart" — a true sentence about a false problem, which
  // sends somebody to debug a button when the shelf is empty.
  const findings = judgeProduct(
    spec(),
    config(),
    observation({ soldOut: true, addToCartWorked: false }),
  );
  assert.deepEqual(kinds(findings), ['sold_out']);
  // And the surviving finding says what was not exercised, so the skipped
  // check is not silently mistaken for a passing one.
  assert.match(findings[0]?.detail ?? '', /add-to-cart was not exercised/iu);
});

void test('judgeProduct: an unobservable availability still reports add-to-cart', () => {
  // Only `soldOut === true` suppresses it. "We could not tell" must not.
  const findings = judgeProduct(
    spec(),
    config(),
    observation({ soldOut: undefined, addToCartWorked: false }),
  );
  assert.deepEqual([...kinds(findings)].sort(), ['add_to_cart_failed', 'not_observed']);
});

void test('judgeProduct: add-to-cart that does not add is critical', () => {
  assert.deepEqual(
    kinds(judgeProduct(spec(), config(), observation({ addToCartWorked: false }))),
    ['add_to_cart_failed'],
  );
});

void test('judgeProduct: a zero or unreadable price is critical', () => {
  assert.deepEqual(kinds(judgeProduct(spec(), config(), observation({ priceText: '$0.00' }))), [
    'price_zero',
  ]);
  assert.deepEqual(kinds(judgeProduct(spec(), config(), observation({ priceText: 'Sold out' }))), [
    'price_missing',
  ]);
});

void test('judgeProduct: a placeholder description is caught by length', () => {
  const findings = judgeProduct(spec(), config(), observation({ descriptionText: 'Coming soon' }));
  assert.deepEqual(kinds(findings), ['description_missing']);
});

void test('judgeProduct: images in the markup that did not load are reported', () => {
  const findings = judgeProduct(
    spec(),
    config(),
    observation({ imageCount: 4, brokenImageCount: 2 }),
  );
  assert.deepEqual(kinds(findings), ['image_broken']);
  assert.match(findings[0]?.detail ?? '', /the customer sees a gap/u);
});

void test('judgeProduct: no images at all is major', () => {
  assert.deepEqual(kinds(judgeProduct(spec(), config(), observation({ imageCount: 0 }))), [
    'images_missing',
  ]);
});

void test('judgeProduct: a missing video is only a finding where one is expected', () => {
  // Most of these products have no video. Requiring one everywhere would put
  // nine false failures in the report every morning.
  assert.deepEqual(judgeProduct(spec(), config(), observation({ videoCount: 0 })), []);
  assert.deepEqual(
    kinds(judgeProduct(spec({ expectVideo: true }), config(), observation({ videoCount: 0 }))),
    ['video_missing'],
  );
});

void test('judgeProduct: an empty specifications block is minor, not a blocker', () => {
  const findings = judgeProduct(spec(), config(), observation({ specificationsText: 'Details' }));
  assert.equal(findings[0]?.kind, 'specifications_missing');
  assert.equal(findings[0]?.severity, 'minor');
});

void test('judgeProduct: a variant that cannot be selected, or loses its price, is reported', () => {
  const unselectable = judgeProduct(
    spec(),
    config(),
    observation({
      variants: [{ label: 'Large', selectable: false, priceText: undefined, soldOut: false }],
    }),
  );
  assert.deepEqual(kinds(unselectable), ['variant_broken']);

  const priceless = judgeProduct(
    spec(),
    config(),
    observation({
      variants: [{ label: 'Large', selectable: true, priceText: undefined, soldOut: false }],
    }),
  );
  assert.match(priceless[0]?.detail ?? '', /left no readable price/u);
});

void test('judgeProduct: a variant priced with empty text is broken, not healthy', () => {
  // The real shape of this defect: clearing a price leaves the element in the
  // DOM with textContent "", which is defined. Testing only for undefined let
  // a genuinely unbuyable variant pass, and the fixture control caught it.
  for (const priceText of ['', '   ', 'Sold out']) {
    const findings = judgeProduct(
      spec(),
      config(),
      observation({ variants: [{ label: 'Large', selectable: true, priceText, soldOut: false }] }),
    );
    assert.deepEqual(
      kinds(findings),
      ['variant_broken'],
      `expected variant_broken for priceText ${JSON.stringify(priceText)}`,
    );
  }
});

void test('judgeProduct: a page that did not load reports once, not once per check', () => {
  // A 404 producing ten findings would make one dead page look like ten defects.
  const findings = judgeProduct(spec(), config(), observation({ status: 404 }));
  assert.deepEqual(kinds(findings), ['page_unreachable']);
});

// ── vacuity: not observed is never a pass ────────────────────────────────

void test('judgeProduct: an unmatched selector is a harness finding, never a pass', () => {
  const blind: Observation = observation({
    titleText: 'Self-Draining Soap Dish',
    priceText: undefined,
    descriptionText: undefined,
    specificationsText: undefined,
    imageCount: undefined,
    soldOut: undefined,
    addToCartWorked: undefined,
    variants: undefined,
  });
  const findings = judgeProduct(spec(), config(), blind);
  assert.ok(findings.length >= 6, `expected several harness findings, got ${findings.length}`);
  assert.ok(findings.every((f) => f.kind === 'not_observed'));
  // None of it is routed to the business: these are our failures, not defects.
  assert.deepEqual(clientFindings(findings), []);
});

void test('judgeProduct: with no title observed, nothing else is judged', () => {
  // Without a title we cannot confirm the page is even the right product, so
  // any other finding would describe an unknown page.
  const findings = judgeProduct(
    spec(),
    config(),
    observation({ titleText: undefined, soldOut: true }),
  );
  assert.deepEqual(kinds(findings), ['not_observed']);
});

void test('judgeProduct: a disabled check produces no findings', () => {
  const only = config({ checks: ['title'] });
  assert.deepEqual(judgeProduct(spec(), only, observation({ soldOut: true, imageCount: 0 })), []);
});

// ── cart and discounts ───────────────────────────────────────────────────

void test('judgeCart: a cart that adds up produces no findings', () => {
  assert.deepEqual(judgeCart(config(), cart()), []);
});

void test('judgeCart: a discount shown but not deducted is critical', () => {
  // The common real failure: the cart displays a saving and charges full price.
  const findings = judgeCart(config(), cart({ discountCents: 200, totalCents: 1200 }));
  assert.deepEqual(kinds(findings), ['cart_math_wrong']);
  assert.match(findings[0]?.detail ?? '', /not charging what it displays/u);
});

void test('judgeCart: a submitted code the cart ignored is reported', () => {
  const findings = judgeCart(
    config({ codes: [{ code: 'WELCOME10', kind: 'percentage', value: 10 }] }),
    cart({ appliedCodes: [] }),
  );
  assert.ok(kinds(findings).includes('discount_not_applied'));
});

void test('judgeCart: codes with no stacking rules report that stacking was not verified', () => {
  // Otherwise a "stacking check" with no rules passes having asserted nothing
  // about stacking.
  const findings = judgeCart(
    config({ codes: [{ code: 'WELCOME10', kind: 'percentage', value: 10 }] }),
    cart({ appliedCodes: ['WELCOME10'] }),
  );
  assert.deepEqual(kinds(findings), ['discount_rules_absent']);
  assert.equal(findings[0]?.severity, 'minor');
});

void test('judgeCart: codes that should stack but do not are critical', () => {
  const findings = judgeCart(
    config({
      codes: [
        { code: 'A', kind: 'percentage', value: 10 },
        { code: 'B', kind: 'shipping', value: 0 },
      ],
      expectedStacking: [{ codes: ['A', 'B'], applies: 'both', note: 'per merch.' }],
    }),
    cart({ appliedCodes: ['A', 'B'] }),
  );
  assert.deepEqual(findings, []);

  const broken = judgeCart(
    config({
      codes: [],
      expectedStacking: [{ codes: ['A', 'B'], applies: 'both', note: 'per merch.' }],
    }),
    cart({ appliedCodes: ['A'] }),
  );
  assert.deepEqual(kinds(broken), ['discount_stacking_wrong']);
});

void test('judgeCart: codes that must not stack but did are critical', () => {
  const findings = judgeCart(
    config({ expectedStacking: [{ codes: ['A', 'B'], applies: 'first_only', note: '' }] }),
    cart({ appliedCodes: ['A', 'B'] }),
  );
  assert.deepEqual(kinds(findings), ['discount_stacking_wrong']);
});

void test('judgeCart: unreadable totals are harness, not a clean cart', () => {
  const findings = judgeCart(config(), cart({ subtotalCents: undefined }));
  assert.deepEqual(kinds(findings), ['not_observed']);
  assert.deepEqual(clientFindings(findings), []);
});

void test('tally: counts by severity and keeps harness out of client findings', () => {
  const findings = [
    ...judgeProduct(spec(), config(), observation({ soldOut: true })),
    ...judgeProduct(spec(), config(), observation({ imageCount: undefined })),
  ];
  const counts = tally(findings);
  assert.equal(counts.critical, 1);
  assert.equal(counts.harness, 1);
  assert.equal(clientFindings(findings).length, 1);
});
