import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countDiacritics, findEncodingDefects, matchesScript } from './text-integrity.js';

/**
 * The corpus below is the point of this file. A mojibake detector is only
 * worth having if it fires on real damage and stays quiet on real French, and
 * the only way to know which it does is to hold examples of both.
 */

const kindsOf = (value: string): readonly string[] =>
  findEncodingDefects(value).map((defect) => defect.kind);

// ── Known-bad: UTF-8 read as Latin-1 ──────────────────────────────────────

const DAMAGED: readonly (readonly [string, string])[] = [
  ['German umlaut', 'KissenbezÃ¼ge'],
  ['German eszett', 'GrÃ¶ÃŸe'],
  ['French acute', 'BeautÃ© des cheveux'],
  ['Spanish enye', 'DiseÃ±o espaÃ±ol'],
  ['Spanish inverted', 'Â¿Necesitas ayuda?'],
  // C3 A0 read as CP1252 is "Ã" + U+00A0; written as an escape because the
  // difference from a plain space is the entire point.
  ['Italian grave', 'QualitÃ  superiore'],
  ['Italian grave, space normalised', 'QualitÃ superiore'],
  ['orphaned NBSP lead', 'Envio gratisÂ hoy'],
  ['smart quotes', 'the â€œbestâ€ sets'],
  ['apostrophe', 'itâ€™s here'],
  ['Japanese katakana', 'ã‚µã‚¤ã‚º'],
  ['Japanese hiragana', 'ãŠå±Šã‘'],
  ['Korean hangul', 'ë°°ì†¡'],
];

for (const [label, damaged] of DAMAGED) {
  void test(`mojibake detected — ${label}`, () => {
    assert.ok(
      kindsOf(damaged).includes('mojibake'),
      `expected mojibake in "${damaged}", got [${kindsOf(damaged).join(', ')}]`,
    );
  });
}

void test('replacement character is always a defect', () => {
  assert.deepEqual(kindsOf('배송 안내 �'), ['replacement_character']);
});

void test('question-mark substitution inside a word', () => {
  assert.ok(kindsOf('M?nchen').includes('question_mark_substitution'));
  assert.ok(kindsOf('Gr??e').includes('question_mark_substitution'));
  assert.ok(kindsOf('?????').includes('question_mark_substitution'));
});

void test('unrendered HTML entities are a defect', () => {
  assert.ok(kindsOf('Gr&ouml;&szlig;e').includes('unrendered_entity'));
  assert.ok(kindsOf('Kissenbez&#252;ge').includes('unrendered_entity'));
});

// ── Known-good: must stay quiet ───────────────────────────────────────────

const CLEAN: readonly (readonly [string, string])[] = [
  ['English', 'Satin Pillowcase Set'],
  ['German', 'Satin-Kissenbezüge für schönes Haar — Größe XL'],
  ['French', 'Taies d’oreiller en satin — livraison offerte !'],
  ['French spaced punctuation', 'Café : à très vite ! Prêt ?'],
  ['Spanish', '¿Necesitas ayuda? ¡Envío gratis! Diseño español'],
  ['Italian', 'Qualità superiore, però è più morbido'],
  ['Korean', '새틴 베개 커버 세트 — 무료 배송'],
  ['Japanese hiragana/katakana/kanji', 'サテンの枕カバー — お届けは無料です'],
  ['ordinary question', 'Need help with your order?'],
  ['URL with query string', 'https://mykitsch.com/search?q=satin&page=2'],
  ['price', '1.299,00 €'],
  ['emoji', 'Free shipping 🚚 on orders over $50'],
];

for (const [label, clean] of CLEAN) {
  void test(`clean text stays quiet — ${label}`, () => {
    assert.deepEqual(
      findEncodingDefects(clean),
      [],
      `false positive on "${clean}": [${kindsOf(clean).join(', ')}]`,
    );
  });
}

// ── Script expectation ────────────────────────────────────────────────────

const HANGUL = /\p{Script=Hangul}/u;
const JAPANESE = /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u;

void test('Hangul expectation', () => {
  assert.equal(matchesScript('무료 배송', HANGUL), true);
  assert.equal(matchesScript('Free shipping', HANGUL), false);
  // Japanese is not Korean — the check has to tell writing systems apart.
  assert.equal(matchesScript('サテンの枕カバー', HANGUL), false);
});

void test('Japanese expectation accepts any of the three scripts', () => {
  assert.equal(matchesScript('ひらがな', JAPANESE), true);
  assert.equal(matchesScript('カタカナ', JAPANESE), true);
  assert.equal(matchesScript('新着商品', JAPANESE), true);
  assert.equal(matchesScript('Nyuka shohin', JAPANESE), false);
});

void test('diacritic counting is per distinct character', () => {
  assert.equal(countDiacritics('Größe für schöne Haare', ['ü', 'ö', 'ä', 'ß']), 3);
  assert.equal(countDiacritics('Haare Schlafen Zubehor', ['ü', 'ö', 'ä', 'ß']), 0);
});
