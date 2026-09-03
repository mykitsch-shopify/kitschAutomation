import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  auditConfig,
  clientFindings,
  judgeByob,
  judgeOosRedirect,
  judgePage,
  judgeRedirect,
  judgeStacking,
  loadAdLandingConfig,
  tally,
  type AdLandingConfig,
  type ByobObservation,
  type PageObservation,
  type PageSpec,
  type StackObservation,
} from './ad-landing.js';

const kinds = (findings: readonly { readonly kind: string }[]): readonly string[] =>
  findings.map((f) => f.kind).sort();

const config = (over: Partial<AdLandingConfig> = {}): AdLandingConfig => ({
  pages: [],
  byob: [],
  unresolved: [],
  discountRedirects: [],
  oosRedirects: [],
  fixedCodes: [],
  siteWideCodes: [],
  autoshipPercent: undefined,
  autoshipRequiredOn: [],
  maxLoadMs: 15_000,
  minByobOptions: 2,
  selectors: {},
  ...over,
});

const spec = (over: Partial<PageSpec> = {}): PageSpec => ({
  handle: 'spring-welcome-kit',
  group: 'welcome_kit:spring',
  fixedDiscountCode: undefined,
  ...over,
});

const page = (over: Partial<PageObservation> = {}): PageObservation => ({
  handle: 'spring-welcome-kit',
  status: 200,
  finalHandle: 'spring-welcome-kit',
  redirectedTo: undefined,
  soldOut: false,
  priceText: '$36.00',
  compareAtText: undefined,
  autoshipOffered: false,
  autoshipPriceText: undefined,
  ...over,
});

const byob = (over: Partial<ByobObservation> = {}): ByobObservation => ({
  handle: 'build-your-own-hair-routine-bundle',
  status: 200,
  optionCount: 8,
  priceBeforeText: '$0.00',
  priceAfterText: '$42.00',
  selectedCount: 2,
  ...over,
});

const stack = (over: Partial<StackObservation> = {}): StackObservation => ({
  fixedCode: 'WELCOMEKIT',
  siteWideCode: 'SAVE20',
  appliedCodes: ['WELCOMEKIT'],
  subtotalCents: 4000,
  discountCents: 1000,
  totalCents: 3000,
  ...over,
});

// ── the shipped config ───────────────────────────────────────────────────

void test('config: the shipped ad-landing.yaml loads with the full daily scope', () => {
  const loaded = loadAdLandingConfig();
  // 5 spring + 6 summer + 5 winter + 2 free-kit + 9 byob + 2 traffic products.
  assert.equal(loaded.pages.length, 29);
  assert.equal(loaded.byob.length, 9);
  assert.equal(loaded.discountRedirects.length, 3);
  assert.equal(loaded.oosRedirects.length, 2);
  assert.deepEqual([...loaded.fixedCodes].sort(), ['6reasons', 'FREECADDY', 'WELCOMEKIT']);
});

void test('config: brief items with no handle are carried as unresolved, not dropped', () => {
  // Dropping them would make the daily report look complete while silently
  // covering less than the brief asks for.
  const loaded = loadAdLandingConfig();
  assert.equal(loaded.unresolved.length, 4);
  assert.ok(loaded.unresolved.some((entry) => entry.title === 'Top 10 Best Sellers'));
});

void test('auditConfig: reports every unresolved brief item', () => {
  const findings = auditConfig(
    config({ unresolved: [{ title: 'Top 10 Best Sellers', note: 'needs its URL' }] }),
  );
  assert.ok(kinds(findings).includes('handle_unresolved'));
});

void test('auditConfig: says non-stacking was not verified when there is nothing to stack', () => {
  // The brief's standing rule is the point of this suite; a check with no
  // site-wide code has verified nothing about it and must not read as a pass.
  const findings = auditConfig(config({ fixedCodes: ['WELCOMEKIT'], siteWideCodes: [] }));
  assert.ok(kinds(findings).includes('non_stacking_unverifiable'));

  const withCode = auditConfig(
    config({ fixedCodes: ['WELCOMEKIT'], siteWideCodes: ['SAVE20'], autoshipPercent: 15 }),
  );
  assert.deepEqual(kinds(withCode), []);
});

void test('auditConfig: says the auto-ship rate is unverified without an expected percentage', () => {
  const findings = auditConfig(config({ autoshipPercent: undefined }));
  assert.ok(kinds(findings).includes('autoship_rate_unverified'));
});

// ── compare-at on ad pages ───────────────────────────────────────────────

void test('judgePage: a healthy page produces no findings', () => {
  assert.deepEqual(judgePage(spec(), config(), page()), []);
});

void test('judgePage: a strikethrough that is not a reduction is a false saving', () => {
  for (const compareAtText of ['$36.00', '$30.00']) {
    const findings = judgePage(spec(), config(), page({ priceText: '$36.00', compareAtText }));
    assert.deepEqual(kinds(findings), ['compare_at_invalid'], `for ${compareAtText}`);
  }
});

void test('judgePage: a genuine reduction is fine', () => {
  assert.deepEqual(
    judgePage(spec(), config(), page({ priceText: '$36.00', compareAtText: '$45.00' })),
    [],
  );
});

void test('judgePage: sold out on an ad landing page is critical', () => {
  assert.ok(kinds(judgePage(spec(), config(), page({ soldOut: true }))).includes('sold_out'));
});

void test('judgePage: an unreadable price is harness, never a pass', () => {
  const findings = judgePage(spec(), config(), page({ priceText: undefined }));
  assert.deepEqual(kinds(findings), ['not_observed']);
  assert.deepEqual(clientFindings(findings), []);
});

void test('judgePage: a dead page reports once, not once per check', () => {
  assert.deepEqual(kinds(judgePage(spec(), config(), page({ status: 404 }))), ['page_unreachable']);
});

// ── auto-ship ────────────────────────────────────────────────────────────

void test('judgePage: auto-ship priced at or above one-time saves nothing', () => {
  const findings = judgePage(
    spec(),
    config(),
    page({ priceText: '$36.00', autoshipOffered: true, autoshipPriceText: '$36.00' }),
  );
  assert.deepEqual(kinds(findings), ['autoship_not_cheaper']);
});

void test('judgePage: auto-ship at the advertised rate passes, off-rate fails', () => {
  const at15 = config({ autoshipPercent: 15 });
  assert.deepEqual(
    judgePage(
      spec(),
      at15,
      page({ priceText: '$36.00', autoshipOffered: true, autoshipPriceText: '$30.60' }),
    ),
    [],
  );
  const wrong = judgePage(
    spec(),
    at15,
    page({ priceText: '$36.00', autoshipOffered: true, autoshipPriceText: '$34.00' }),
  );
  assert.deepEqual(kinds(wrong), ['autoship_rate_wrong']);
});

void test('judgePage: auto-ship absence is only a finding where it is expected', () => {
  // Most bundles carry no subscription option; requiring one everywhere would
  // fail most of the scope every morning.
  assert.deepEqual(judgePage(spec(), config(), page({ autoshipOffered: false })), []);
  const required = config({ autoshipRequiredOn: ['spring-welcome-kit'] });
  assert.deepEqual(kinds(judgePage(spec(), required, page({ autoshipOffered: false }))), [
    'autoship_missing',
  ]);
});

// ── BYOB ─────────────────────────────────────────────────────────────────

void test('judgeByob: a working builder produces no findings', () => {
  assert.deepEqual(judgeByob(config(), byob()), []);
});

void test('judgeByob: a builder with nothing to build is critical', () => {
  const findings = judgeByob(config(), byob({ optionCount: 0 }));
  assert.deepEqual(kinds(findings), ['byob_no_options']);
  assert.equal(findings[0]?.severity, 'critical');
});

void test('judgeByob: a price that does not move after selecting is not wired up', () => {
  const findings = judgeByob(
    config(),
    byob({ priceBeforeText: '$0.00', priceAfterText: '$0.00', selectedCount: 2 }),
  );
  assert.deepEqual(kinds(findings), ['byob_price_static']);
});

void test('judgeByob: a static price with nothing selected is not a finding', () => {
  // Otherwise a builder whose options could not be clicked reports a pricing
  // defect, sending triage at the wrong thing.
  assert.deepEqual(
    judgeByob(config(), byob({ priceBeforeText: '$0.00', priceAfterText: '$0.00', selectedCount: 0 })),
    [],
  );
});

void test('judgeByob: unmatched builder options are harness, not a working builder', () => {
  const findings = judgeByob(config(), byob({ optionCount: undefined }));
  assert.deepEqual(kinds(findings), ['not_observed']);
  assert.deepEqual(clientFindings(findings), []);
});

// ── discount redirects ───────────────────────────────────────────────────

void test('judgeRedirect: landing on the configured product is fine', () => {
  assert.deepEqual(
    judgeRedirect(
      { code: 'WELCOMEKIT', expectHandle: 'shampoo-conditioner-bundle-with-free-welcome-kit' },
      {
        code: 'WELCOMEKIT',
        status: 200,
        finalHandle: 'shampoo-conditioner-bundle-with-free-welcome-kit',
        finalPath: '/products/shampoo-conditioner-bundle-with-free-welcome-kit',
      },
    ),
    [],
  );
});

void test('judgeRedirect: a dead discount link is critical', () => {
  const findings = judgeRedirect(
    { code: 'WELCOMEKIT', expectHandle: 'x' },
    { code: 'WELCOMEKIT', status: 404, finalHandle: undefined, finalPath: '/404' },
  );
  assert.deepEqual(kinds(findings), ['redirect_broken']);
  assert.equal(findings[0]?.severity, 'critical');
});

void test('judgeRedirect: landing on the homepage instead of the offer is reported', () => {
  // The link "works" and the customer never sees the offer, which is the
  // failure that looks fine in a status check.
  const findings = judgeRedirect(
    { code: '6reasons', expectHandle: 'build-your-own-soap-dish-bundle' },
    { code: '6reasons', status: 200, finalHandle: undefined, finalPath: '/' },
  );
  assert.deepEqual(kinds(findings), ['redirect_wrong_target']);
  assert.match(findings[0]?.detail ?? '', /rather than a product page/u);
});

void test('judgeRedirect: landing on the wrong product is reported with both handles', () => {
  const findings = judgeRedirect(
    { code: 'FREECADDY', expectHandle: 'build-your-own-shampoo-conditioner-caddy-bundle' },
    { code: 'FREECADDY', status: 200, finalHandle: 'some-other-thing', finalPath: '/products/some-other-thing' },
  );
  assert.deepEqual(kinds(findings), ['redirect_wrong_target']);
  assert.match(findings[0]?.detail ?? '', /some-other-thing/u);
});

// ── out-of-stock redirect ────────────────────────────────────────────────

const oos = { handle: 'thermal-a', expectHandle: 'thermal-b' };

void test('judgeOosRedirect: in stock and serving its own page is correct', () => {
  assert.deepEqual(judgeOosRedirect(oos, page({ handle: 'thermal-a', soldOut: false })), []);
});

void test('judgeOosRedirect: sold out with no redirect strands ad traffic', () => {
  const findings = judgeOosRedirect(oos, page({ handle: 'thermal-a', soldOut: true }));
  assert.deepEqual(kinds(findings), ['oos_no_redirect']);
});

void test('judgeOosRedirect: redirecting to the configured substitute is correct', () => {
  assert.deepEqual(
    judgeOosRedirect(oos, page({ handle: 'thermal-a', redirectedTo: 'thermal-b' })),
    [],
  );
});

void test('judgeOosRedirect: redirecting anywhere else is reported', () => {
  const findings = judgeOosRedirect(
    oos,
    page({ handle: 'thermal-a', redirectedTo: 'thermal-z' }),
  );
  assert.deepEqual(kinds(findings), ['oos_wrong_target']);
  assert.match(findings[0]?.detail ?? '', /thermal-z/u);
});

void test('judgeOosRedirect: a redirect is judged on destination alone, not on stock', () => {
  // Deliberate limitation, recorded so it is not mistaken for a bug. Once the
  // storefront redirects, the product page never renders, so there is no stock
  // state to read — soldOut here describes whatever the probe saw, and must
  // not change the verdict.
  for (const soldOut of [true, false, undefined]) {
    assert.deepEqual(
      judgeOosRedirect(oos, page({ handle: 'thermal-a', redirectedTo: 'thermal-b', soldOut })),
      [],
      `redirect to the configured target should pass regardless of soldOut=${String(soldOut)}`,
    );
  }
});

void test('judgeOosRedirect: no assertion is made when stock could not be observed', () => {
  const findings = judgeOosRedirect(oos, page({ soldOut: undefined }));
  assert.deepEqual(kinds(findings), ['not_observed']);
});

// ── non-stacking ─────────────────────────────────────────────────────────

void test('judgeStacking: the fixed code applying alone is correct', () => {
  assert.deepEqual(judgeStacking(stack()), []);
});

void test('judgeStacking: a site-wide code stacking on a fixed one is critical', () => {
  const findings = judgeStacking(stack({ appliedCodes: ['WELCOMEKIT', 'SAVE20'] }));
  assert.deepEqual(kinds(findings), ['discount_stacked']);
  assert.equal(findings[0]?.severity, 'critical');
  assert.match(findings[0]?.detail ?? '', /discounted twice/u);
});

void test('judgeStacking: a refused fixed code is reported and stops there', () => {
  // If the page's own offer is refused, whether something stacks on top of it
  // is not the story, and reporting both would split attention.
  const findings = judgeStacking(stack({ appliedCodes: [] }));
  assert.deepEqual(kinds(findings), ['fixed_code_rejected']);
});

void test('judgeStacking: a cart that displays a discount it does not deduct is critical', () => {
  const findings = judgeStacking(
    stack({ subtotalCents: 4000, discountCents: 1000, totalCents: 4000 }),
  );
  assert.ok(kinds(findings).includes('cart_math_wrong'));
});

void test('judgeStacking: unreadable totals are harness, not a clean cart', () => {
  const findings = judgeStacking(stack({ subtotalCents: undefined, totalCents: undefined }));
  assert.deepEqual(kinds(findings), ['not_observed']);
  assert.deepEqual(clientFindings(findings), []);
});

void test('tally: harness stays out of what is routed to the business', () => {
  const findings = [
    ...judgeStacking(stack({ appliedCodes: ['WELCOMEKIT', 'SAVE20'] })),
    ...judgePage(spec(), config(), page({ priceText: undefined })),
  ];
  const counts = tally(findings);
  assert.equal(counts.critical, 1);
  assert.equal(counts.harness, 1);
  assert.equal(clientFindings(findings).length, 1);
});
