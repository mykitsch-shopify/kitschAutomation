import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadTopProductsConfig } from '../../web/lib/top-products.js';
import { loadI18nConfig } from './config.js';
import type { FindingKind, I18nConfig, LocaleSpec, Severity } from './config.js';
import {
  auditSource,
  compareCatalog,
  comparePair,
  evaluateGate,
  summarize,
} from './locale-parity.js';
import type { Finding, TranslationEntry } from './locale-parity.js';

/**
 * Every comparator here is exercised with a **known-bad** input, not only a
 * known-good one. A comparator that never fails is the most dangerous code in
 * this repo: it makes an unchecked catalogue look like a clean one.
 *
 *   npm run test:unit
 */

const severities: Record<FindingKind, Severity> = {
  missing_translation: 'major',
  empty_translation: 'major',
  placeholder_drift: 'major',
  untranslated_candidate: 'major',
  encoding_error: 'major',
  script_missing: 'major',
  protected_term_translated: 'minor',
  length_overflow_risk: 'minor',
  diacritic_absent: 'minor',
  meta_untranslated: 'minor',
  inconsistent_translation: 'minor',
  collector_error: 'harness',
};

const locale = (overrides: Partial<LocaleSpec> & Pick<LocaleSpec, 'code'>): LocaleSpec => ({
  market: 'DE',
  currency: 'EUR',
  pricePattern: /^\d+,\d{2}\s?€$/u,
  expectScript: undefined,
  expectDiacritics: false,
  diacritics: [],
  fontFamilies: [],
  ...overrides,
});

const de = locale({ code: 'de', diacritics: ['ü', 'ö', 'ä', 'ß'] });
const ko = locale({ code: 'ko', market: 'KR', currency: 'KRW', expectScript: /\p{Script=Hangul}/u });
const ja = locale({
  code: 'ja',
  market: 'JP',
  currency: 'JPY',
  expectScript: /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u,
});

const config: I18nConfig = {
  sourceLocale: 'en',
  locales: [locale({ code: 'en', market: 'US', currency: 'USD' }), de, ko, ja],
  routes: [{ path: '/', name: 'home', tags: ['@smoke'] }],
  resources: ['PRODUCT'],
  doNotTranslate: ['Kitsch'],
  // The comparator does not read either of these; they are here because the
  // config type carries them for the render layer. A test fixture that drifts
  // from the real shape stops catching real shape changes.
  selectors: {},
  hreflangAtLeast: 1,
  exemptions: [{ key: 'policy.terms', locales: ['de'], reason: 'pending counsel review' }],
  consistencyExemptions: [{ source: 'Checkout', reason: 'CTA versus heading' }],
  severities,
  thresholds: {
    lengthRatioWarn: 1.45,
    lengthRatioMinSourceChars: 20,
    overflowPx: 2,
    maxMajor: 0,
    maxMinor: 5,
  },
  placeholderPatterns: [/\{\{\s*[\w.]+\s*\}\}/g, /%[sd]/g],
};

const entry = (
  overrides: Partial<TranslationEntry> & Pick<TranslationEntry, 'key' | 'locale'>,
): TranslationEntry => ({
  resourceType: 'PRODUCT',
  resourceId: 'gid://shopify/Product/1',
  status: 'present',
  value: '',
  ...overrides,
});

const source = (key: string, value: string): TranslationEntry =>
  entry({ key, locale: 'en', value });

/** Asserts exactly one finding and returns it, so assertions read directly. */
const only = (findings: readonly Finding[]): Finding => {
  assert.equal(findings.length, 1, `expected exactly one finding, got ${String(findings.length)}`);
  const [first] = findings;
  if (first === undefined) {
    throw new Error('unreachable: length checked above');
  }
  return first;
};

const kinds = (findings: readonly Finding[]): readonly string[] =>
  findings.map((item) => item.kind);

// ── Presence and completeness ──────────────────────────────────────────────

// ── cross-config drift ───────────────────────────────────────────────────

void test('config: the PDP price selector agrees with config/top-products.yaml', () => {
  // Two configs describing the same element on the same theme, so they are
  // asserted equal rather than maintained in parallel.
  //
  // They had drifted. config/top-products.yaml learned two more alternatives
  // from a discovery run against the live store; config/i18n.yaml kept the
  // narrower pair it shipped with, and nothing connected them. That is the
  // same failure as the stale product handle in config/a11y.yaml, which sat
  // 404ing for weeks after config/top-products.yaml had recorded the live one.
  //
  // If a future theme genuinely needs these to differ, delete this test and
  // say why in both files — do not let them drift silently.
  assert.equal(
    loadI18nConfig().selectors.pdp_price,
    loadTopProductsConfig().selectors.price,
    'config/i18n.yaml selectors.pdp_price and config/top-products.yaml selectors.price ' +
      'name the same element and must stay identical',
  );
});

void test('absent translation is a major finding', () => {
  const found = only(
    comparePair(
      source('product.title', 'Satin Sleep Set'),
      entry({ key: 'product.title', locale: 'de', status: 'absent', value: undefined }),
      config,
      de,
    ),
  );
  assert.equal(found.kind, 'missing_translation');
  assert.equal(found.severity, 'major');
});

void test('declared exemption suppresses the missing-translation finding', () => {
  const findings = comparePair(
    source('policy.terms', 'Terms of Service'),
    entry({ key: 'policy.terms', locale: 'de', status: 'absent', value: undefined }),
    config,
    de,
  );
  assert.deepEqual(findings, []);
});

void test('empty translation is major, not silently accepted', () => {
  const found = only(
    comparePair(
      source('product.title', 'Satin Sleep Set'),
      entry({ key: 'product.title', locale: 'de', value: '   ' }),
      config,
      de,
    ),
  );
  assert.equal(found.kind, 'empty_translation');
  assert.equal(found.severity, 'major');
});

void test('dropped interpolation token is caught', () => {
  const findings = comparePair(
    source('cart.count', 'You have {{ count }} items'),
    entry({ key: 'cart.count', locale: 'de', value: 'Sie haben Artikel' }),
    config,
    de,
  );
  assert.ok(kinds(findings).includes('placeholder_drift'));
});

void test('identical string is flagged, unless it is a protected term', () => {
  const flagged = comparePair(
    source('product.title', 'Satin Sleep Set'),
    entry({ key: 'product.title', locale: 'de', value: 'Satin Sleep Set' }),
    config,
    de,
  );
  assert.ok(kinds(flagged).includes('untranslated_candidate'));

  const brand = comparePair(
    source('brand.name', 'Kitsch'),
    entry({ key: 'brand.name', locale: 'de', value: 'Kitsch' }),
    config,
    de,
  );
  assert.deepEqual(brand, []);
});

void test('untranslated English fallback is High priority per the test plan', () => {
  const found = only(
    comparePair(
      source('nav.accessories', 'Accessories'),
      entry({ key: 'nav.accessories', locale: 'de', value: 'Accessories' }),
      config,
      de,
    ),
  );
  assert.equal(found.kind, 'untranslated_candidate');
  // config/i18n.yaml raises this from the framework's default `minor`.
  assert.equal(found.severity, 'major');
});

void test('non-linguistic strings do not generate noise', () => {
  const findings = comparePair(
    source('meta.url', 'https://mykitsch.com/products/satin'),
    entry({ key: 'meta.url', locale: 'de', value: 'https://mykitsch.com/products/satin' }),
    config,
    de,
  );
  assert.deepEqual(findings, []);
});

void test('a failed fetch is harness debt, never a clean locale', () => {
  const found = only(
    comparePair(
      source('product.title', 'Satin Sleep Set'),
      entry({ key: 'product.title', locale: 'de', status: 'fetch_failed', value: undefined }),
      config,
      de,
    ),
  );
  assert.equal(found.kind, 'collector_error');
  assert.equal(found.severity, 'harness');
});

void test('long German copy is flagged for a visual check', () => {
  const findings = comparePair(
    source('footer.newsletter_body', 'Be first to hear about new arrivals and offers.'),
    entry({
      key: 'footer.newsletter_body',
      locale: 'de',
      value:
        'Erfahren Sie als Allererste von unseren Neuheiten, Sonderaktionen und exklusiven Angeboten, die ausschliesslich unseren Mitgliedern vorbehalten sind.',
    }),
    config,
    de,
  );
  assert.ok(kinds(findings).includes('length_overflow_risk'));
});

void test('a short label that triples in length is not an overflow risk', () => {
  // "New" → "Nouveautés" is 3.3x and fits any layout. Reporting it buried the
  // genuinely long strings under dozens of rows nobody read.
  const findings = comparePair(
    source('nav.new', 'New'),
    entry({ key: 'nav.new', locale: 'de', value: 'Nouveautés' }),
    config,
    de,
  );
  assert.equal(kinds(findings).includes('length_overflow_risk'), false);
});

void test('key present in target but not in source is harness debt', () => {
  const findings = compareCatalog(
    [],
    [entry({ key: 'orphan.key', locale: 'de', value: 'Waise' })],
    config,
  );
  assert.equal(only(findings).severity, 'harness');
});

// ── Character integrity — test plan §6.2, §7.2, §8.2, §9.2, §12 ───────────

void test('mojibake in German umlauts is a major finding', () => {
  const findings = comparePair(
    source('product.title', 'Satin Pillowcase'),
    entry({ key: 'product.title', locale: 'de', value: 'Satin-KissenbezÃ¼ge fÃ¼r schÃ¶nes Haar' }),
    config,
    de,
  );
  const encoding = findings.find((item) => item.kind === 'encoding_error');
  assert.ok(encoding !== undefined, 'expected an encoding_error finding');
  assert.equal(encoding.severity, 'major');
});

void test('mojibake in Japanese kana is caught', () => {
  const findings = comparePair(
    source('nav.hair', 'Hair'),
    entry({ key: 'nav.hair', locale: 'ja', value: 'ã‚µã‚¤ã‚º' }),
    config,
    ja,
  );
  assert.ok(kinds(findings).includes('encoding_error'));
});

void test('replacement characters are caught', () => {
  const findings = comparePair(
    source('nav.hair', 'Hair'),
    entry({ key: 'nav.hair', locale: 'ko', value: '헤어 �세서리' }),
    config,
    ko,
  );
  assert.ok(kinds(findings).includes('encoding_error'));
});

void test('question-mark substitution for umlauts is caught', () => {
  const findings = comparePair(
    source('shipping.city', 'Munich warehouse'),
    entry({ key: 'shipping.city', locale: 'de', value: 'M?nchen Lager' }),
    config,
    de,
  );
  assert.ok(kinds(findings).includes('encoding_error'));
});

void test('legitimate French typography is not reported as damage', () => {
  // "café !" carries a non-breaking space before the exclamation mark, which
  // puts an accented vowel next to U+00A0 — the shape a naive mojibake rule
  // reports as a defect.
  const findings = comparePair(
    source('promo.banner', 'Free shipping!'),
    entry({ key: 'promo.banner', locale: 'de', value: 'Livraison offerte ! Café : à très vite' }),
    config,
    de,
  );
  assert.equal(
    kinds(findings).includes('encoding_error'),
    false,
    'accented Latin text with French spacing must not be reported as mojibake',
  );
});

void test('correct CJK text produces no encoding finding', () => {
  const korean = comparePair(
    source('nav.hair', 'Hair'),
    entry({ key: 'nav.hair', locale: 'ko', value: '헤어' }),
    config,
    ko,
  );
  assert.deepEqual(korean, []);

  const japanese = comparePair(
    source('nav.sleep', 'Sleep'),
    entry({ key: 'nav.sleep', locale: 'ja', value: 'スリープ' }),
    config,
    ja,
  );
  assert.deepEqual(japanese, []);
});

// ── Expected script — test plan §7.1, §8.1 ────────────────────────────────

void test('a Korean value with no Hangul is a major finding', () => {
  const findings = comparePair(
    source('nav.accessories', 'Accessories'),
    // Differs from English, so the identical-string check will not catch it.
    entry({ key: 'nav.accessories', locale: 'ko', value: 'Accessory items' }),
    config,
    ko,
  );
  const script = findings.find((item) => item.kind === 'script_missing');
  assert.ok(script !== undefined, 'expected a script_missing finding');
  assert.equal(script.severity, 'major');
});

void test('script_missing does not double-count an already-untranslated string', () => {
  const findings = comparePair(
    source('nav.accessories', 'Accessories'),
    entry({ key: 'nav.accessories', locale: 'ko', value: 'Accessories' }),
    config,
    ko,
  );
  assert.deepEqual(kinds(findings), ['untranslated_candidate']);
});

void test('kanji-only Japanese satisfies the script expectation', () => {
  const findings = comparePair(
    source('nav.new', 'New arrivals'),
    entry({ key: 'nav.new', locale: 'ja', value: '新着商品' }),
    config,
    ja,
  );
  assert.deepEqual(findings, []);
});

void test('a Latin locale is not asked for a script it has not declared', () => {
  const findings = comparePair(
    source('nav.hair', 'Hair'),
    entry({ key: 'nav.hair', locale: 'de', value: 'Haare' }),
    config,
    de,
  );
  assert.deepEqual(findings, []);
});

// ── Catalogue-level checks ────────────────────────────────────────────────

void test('a German catalogue with every umlaut stripped is flagged', () => {
  const germanWords = [
    'Haare',
    'Schlafen',
    'Zubehor',
    'Haut',
    'Dusche',
    'Kollektionen',
    'Bestseller',
    'Neuheiten',
    'Angebote',
    'Warenkorb',
    'Zur Kasse',
    'Suchen',
  ];
  const sources = germanWords.map((_, index) => source(`nav.${String(index)}`, `English ${String(index)}`));
  const targets = germanWords.map((word, index) =>
    entry({ key: `nav.${String(index)}`, locale: 'de', value: word }),
  );

  const findings = compareCatalog(sources, targets, {
    ...config,
    locales: [locale({ code: 'en' }), { ...de, expectDiacritics: true }],
  });
  const diacritic = findings.find((item) => item.kind === 'diacritic_absent');
  assert.ok(diacritic !== undefined, 'expected a diacritic_absent finding');
  assert.equal(diacritic.severity, 'minor');
});

void test('one umlaut anywhere in the catalogue clears the diacritic check', () => {
  const words = ['Haare', 'Schlafen', 'Zubehör', 'Haut', 'Dusche', 'Kollektionen', 'Bestseller', 'Neuheiten', 'Angebote', 'Warenkorb', 'Zur Kasse', 'Suchen'];
  const sources = words.map((_, index) => source(`nav.${String(index)}`, `English ${String(index)}`));
  const targets = words.map((word, index) =>
    entry({ key: `nav.${String(index)}`, locale: 'de', value: word }),
  );

  const findings = compareCatalog(sources, targets, {
    ...config,
    locales: [locale({ code: 'en' }), { ...de, expectDiacritics: true }],
  });
  assert.equal(kinds(findings).includes('diacritic_absent'), false);
});

// ── Terminology consistency — test plan §13.1 ─────────────────────────────

void test('the same English string translated two ways is flagged', () => {
  const findings = compareCatalog(
    [source('nav.best_sellers', 'Best Sellers'), source('home.section_bestsellers', 'Best sellers')],
    [
      entry({ key: 'nav.best_sellers', locale: 'de', value: 'Bestseller' }),
      entry({ key: 'home.section_bestsellers', locale: 'de', value: 'Meistverkaufte Produkte' }),
    ],
    config,
  );
  const inconsistent = findings.find((item) => item.kind === 'inconsistent_translation');
  assert.ok(inconsistent !== undefined, `expected inconsistent_translation, got [${kinds(findings).join(', ')}]`);
  assert.match(inconsistent.detail, /Bestseller/u);
});

void test('a consistently translated term produces no consistency finding', () => {
  const findings = compareCatalog(
    [source('nav.best_sellers', 'Best Sellers'), source('home.section_bestsellers', 'Best sellers')],
    [
      entry({ key: 'nav.best_sellers', locale: 'de', value: 'Bestseller' }),
      entry({ key: 'home.section_bestsellers', locale: 'de', value: 'Bestseller' }),
    ],
    config,
  );
  assert.equal(kinds(findings).includes('inconsistent_translation'), false);
});

void test('a declared consistency exemption suppresses a legitimate divergence', () => {
  // "Checkout" is a cart button and a page heading. Different words, on
  // purpose, in most of these locales.
  const findings = compareCatalog(
    [source('cart.checkout_cta', 'Checkout'), source('checkout.heading', 'Checkout')],
    [
      entry({ key: 'cart.checkout_cta', locale: 'de', value: 'Zur Kasse' }),
      entry({ key: 'checkout.heading', locale: 'de', value: 'Kasse' }),
    ],
    config,
  );
  assert.equal(kinds(findings).includes('inconsistent_translation'), false);
});

void test('entries for an undeclared locale are harness debt, not a pass', () => {
  const findings = compareCatalog(
    [source('nav.hair', 'Hair care')],
    [entry({ key: 'nav.hair', locale: 'pt', value: 'Cabelo' })],
    config,
  );
  const collector = findings.find((item) => item.kind === 'collector_error');
  assert.ok(collector !== undefined, `expected a collector_error, got [${kinds(findings).join(', ')}]`);
  assert.equal(collector.severity, 'harness');
});

// ── English baseline — test plan §4 ───────────────────────────────────────

void test('damage in the English baseline is reported in its own right', () => {
  const findings = auditSource(
    [source('promo.banner', 'Save 20% on the â€œbestâ€ sets')],
    config,
  );
  assert.equal(only(findings).kind, 'encoding_error');
});

void test('a clean English baseline produces no findings', () => {
  const findings = auditSource(
    [source('promo.banner', 'Save 20% on our best-selling sets'), source('nav.hair', 'Hair')],
    config,
  );
  assert.deepEqual(findings, []);
});

// ── Gate ──────────────────────────────────────────────────────────────────

void test('a clean locale produces no findings and passes the gate', () => {
  const findings = compareCatalog(
    [source('product.title', 'Satin Sleep Set')],
    [entry({ key: 'product.title', locale: 'de', value: 'Satin-Schlafset' })],
    config,
  );
  assert.deepEqual(findings, []);
  assert.equal(evaluateGate(summarize(findings, 1), config).passed, true);
});

void test('gate fails on a single major and reports why', () => {
  const verdict = evaluateGate(
    { critical: 0, major: 1, minor: 0, harness: 0, comparedKeys: 10 },
    config,
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.reasons.join(' '), /major/u);
});

void test('harness findings alone never fail the gate — they are our debt', () => {
  const verdict = evaluateGate(
    { critical: 0, major: 0, minor: 0, harness: 12, comparedKeys: 10 },
    config,
  );
  assert.equal(verdict.passed, true);
});
