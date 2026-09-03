import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSentinels, fragmentsOf, showsEnglish } from './sentinels.js';
import type { LocaleStrings } from './sentinels.js';

/**
 * These three functions decide what the render layer looks for. Each of them
 * fails silently when it goes wrong: a sentinel list that comes back empty, or
 * a matcher that never matches, turns "no English is showing" into a test that
 * examines nothing and passes. So each is exercised against input that must
 * produce a finding, not only input that must not.
 */

const en: LocaleStrings = {
  'nav.hair': 'Hair',
  'nav.new': 'New',
  'nav.collections': 'Collections',
  'nav.best_sellers': 'Best Sellers',
  'footer.newsletter_cta': 'Subscribe',
  'pdp.reviews_label': '{{ count }} reviews',
  'policy.terms': 'Terms of Service',
};

const fr: LocaleStrings = {
  'nav.hair': 'Cheveux',
  'nav.new': 'Nouveautés',
  'nav.collections': 'Collections',
  'nav.best_sellers': 'Meilleures ventes',
  'footer.newsletter_cta': 'S’inscrire',
  'pdp.reviews_label': '{{ count }} avis',
  'policy.terms': null,
};

const keysOf = (sentinels: readonly { readonly key: string }[]): readonly string[] =>
  sentinels.map((sentinel) => sentinel.key).sort();

// ── buildSentinels ────────────────────────────────────────────────────────

void test('a diverging translation becomes a sentinel', () => {
  const sentinels = buildSentinels(en, fr);
  assert.ok(keysOf(sentinels).includes('nav.hair'));
  const hair = sentinels.find((sentinel) => sentinel.key === 'nav.hair');
  assert.equal(hair?.english, 'Hair');
  assert.equal(hair?.expected, 'Cheveux');
});

void test('a cognate is not a sentinel', () => {
  // "Collections" is the correct French word. Flagging it would train the
  // team to ignore the check.
  assert.equal(keysOf(buildSentinels(en, fr)).includes('nav.collections'), false);
});

void test('short English strings are skipped', () => {
  // "New" would match inside unrelated copy far more often than it would
  // catch a real fallback.
  assert.equal(keysOf(buildSentinels(en, fr)).includes('nav.new'), false);
});

void test('a key with no contracted translation is not a sentinel', () => {
  // The content layer reports the missing translation; the render layer must
  // not report the resulting English fallback a second time.
  assert.equal(keysOf(buildSentinels(en, fr)).includes('policy.terms'), false);
});

void test('an empty target locale yields no sentinels — the vacuity case', () => {
  // This is precisely why specs/baseline.ts refuses to hand back an empty
  // locale: nothing downstream can tell this apart from a clean page.
  assert.deepEqual(buildSentinels(en, {}), []);
});

void test('sentinels are built from real divergences, not from nothing', () => {
  const sentinels = buildSentinels(en, fr);
  assert.ok(
    sentinels.length >= 3,
    `expected several sentinels from a normal catalogue, got ${String(sentinels.length)}`,
  );
});

// ── fragmentsOf ───────────────────────────────────────────────────────────

void test('a plain string is its own fragment', () => {
  assert.deepEqual(fragmentsOf('Ajouter au panier'), ['Ajouter au panier']);
});

void test('interpolation is stripped and the literals kept', () => {
  assert.deepEqual(fragmentsOf('{{ count }} avis'), ['avis']);
  assert.deepEqual(fragmentsOf('Livraison offerte dès {{ amount }} d’achat'), [
    'Livraison offerte dès',
    'd’achat',
  ]);
});

void test('every placeholder syntax the config declares is handled', () => {
  assert.deepEqual(fragmentsOf('Bestellung {number} folgt'), ['Bestellung', 'folgt']);
  assert.deepEqual(fragmentsOf('Pedido %{number} enviado'), ['Pedido', 'enviado']);
  assert.deepEqual(fragmentsOf('Ordine %s spedito'), ['Ordine', 'spedito']);
});

void test('fragments shorter than the floor are dropped', () => {
  assert.deepEqual(fragmentsOf('{{ n }} de {{ x }}'), []);
});

void test('a fragment of stopwords is dropped even when it clears the length bar', () => {
  // "de la" is five characters and appears all over a French page. Asserting
  // it would look like coverage and prove nothing.
  assert.deepEqual(fragmentsOf('{{ n }} de la {{ x }}'), []);
  assert.deepEqual(fragmentsOf('{{ n }} of the {{ x }}'), []);
});

void test('a fragment with one distinctive word is kept', () => {
  assert.deepEqual(fragmentsOf('{{ n }} de la commande'), ['de la commande']);
});

void test('absent and blank values produce nothing to assert', () => {
  assert.deepEqual(fragmentsOf(null), []);
  assert.deepEqual(fragmentsOf(undefined), []);
  assert.deepEqual(fragmentsOf('   '), []);
});

void test('CJK fragments survive the length floor', () => {
  assert.deepEqual(fragmentsOf('カートに追加'), ['カートに追加']);
  assert.deepEqual(fragmentsOf('장바구니에 담기'), ['장바구니에 담기']);
});

// ── showsEnglish ──────────────────────────────────────────────────────────

void test('an English string on the page is found', () => {
  assert.equal(showsEnglish('Panier · Accessories · Compte', 'Accessories'), true);
});

void test('a word boundary keeps "New" out of "Newsletter"', () => {
  assert.equal(showsEnglish('Newsletter abonnieren', 'News'), false);
  assert.equal(showsEnglish('Lesen Sie die News heute', 'News'), true);
});

void test('punctuation still counts as a boundary', () => {
  assert.equal(showsEnglish('Panier, Accessories.', 'Accessories'), true);
  assert.equal(showsEnglish('(Best Sellers)', 'Best Sellers'), true);
});

void test('a sentinel containing regex metacharacters is matched literally', () => {
  // Marketing copy contains these constantly; unescaped, this would either
  // throw or match something else entirely.
  assert.equal(showsEnglish('Save 20% (limited time) — shop now', '(limited time)'), true);
  assert.equal(showsEnglish('Need help?', 'Need help?'), true);
  assert.equal(showsEnglish('Free shipping + returns', 'shipping + returns'), true);
});

void test('CJK sentinels fall back to containment', () => {
  // \b means nothing useful next to Hangul, so these must not silently stop
  // matching.
  assert.equal(showsEnglish('무료 배송 안내', '무료 배송'), true);
  assert.equal(showsEnglish('カートに追加します', 'カートに追加'), true);
  assert.equal(showsEnglish('무료 배송 안내', '반품 및 교환'), false);
});

void test('a string absent from the page is not reported', () => {
  assert.equal(showsEnglish('Cheveux · Sommeil · Accessoires', 'Accessories'), false);
});
