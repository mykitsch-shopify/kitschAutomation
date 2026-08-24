import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LOCALES,
  isProductTask,
  needsHandle,
  judgeLocale,
  judgeTask,
  parseHandle,
  parseLocales,
  parseTask,
  retainsEnglish,
  summarize,
  type BacklogTask,
  type LocaleObservation,
} from './translation-backlog.js';

/** The auto-created shape: explicit handle line, lowercase locale list. */
const AUTO_NOTES = `Bucket: Missing all 6 locales

----------------------------------------

Product handle: coconut-oil-shampoo-conditioner-combo-for-dry-damaged-hair

----------------------------------------

Shopify Admin: https://admin.shopify.com/store/mykitsch/products/10318931427509

----------------------------------------

Locales needing translation:
    es
    fr
    de
    it
    ja
    ko
Auto-created from translation audit on 2026-05-27.

Product page:
https://www.mykitsch.com/products/coconut-oil-shampoo-conditioner-combo-for-dry-damaged-hair`;

/** The hand-written shape: a URL and bare uppercase codes. */
const HAND_NOTES = `Translate product:
https://www.mykitsch.com/products/recycled-plastic-glitter-claw-clip-ghosts

    ES
    DE
    IT
    FR
`;

const task = (over: Partial<BacklogTask> = {}): BacklogTask => ({
  gid: '1',
  name: 'Translate Product: Something',
  handle: 'a-product',
  locales: ['es', 'fr'],
  dueOn: '2026-08-14',
  ...over,
});

const EN_TITLE = 'Self-Draining Soap Dish';
const EN_BODY = 'Keeps bars dry between uses and makes them last measurably longer';

/** One field pair, the common case: whole page in one language. */
const seen = (
  locale: string,
  localizedText: string | undefined,
  englishText = `${EN_TITLE}. ${EN_BODY}`,
  status = 200,
): LocaleObservation => ({
  locale,
  status,
  fields: { body: { localized: localizedText, english: englishText } },
});

/** Title and description observed separately, which is how the audit reads them. */
const seenFields = (
  locale: string,
  title: readonly [string | undefined, string],
  description: readonly [string | undefined, string],
): LocaleObservation => ({
  locale,
  status: 200,
  fields: {
    title: { localized: title[0], english: title[1] },
    description: { localized: description[0], english: description[1] },
  },
});

// ── parsing ──────────────────────────────────────────────────────────────

void test('parseHandle: reads the explicit handle line', () => {
  assert.equal(parseHandle(AUTO_NOTES), 'coconut-oil-shampoo-conditioner-combo-for-dry-damaged-hair');
});

void test('parseHandle: falls back to the product URL when there is no handle line', () => {
  // A third of the board is hand-written and carries only a URL. Reading one
  // shape would silently drop those tasks as unparseable.
  assert.equal(parseHandle(HAND_NOTES), 'recycled-plastic-glitter-claw-clip-ghosts');
});

void test('parseHandle: prefers the handle line over a URL that disagrees', () => {
  // This is real on the board: at least one task's URL points at a different
  // product than its handle line names. Trusting the URL checks the wrong page.
  const conflicting = `Product handle: the-real-one

Product page:
https://www.mykitsch.com/products/a-different-product`;
  assert.equal(parseHandle(conflicting), 'the-real-one');
});

void test('parseHandle: reads a handle written inline in parentheses', () => {
  // A re-work task on the board is written in a third format. Found by running
  // the parser against the real export, not by imagining formats.
  const rework =
    'Bucket: Missing all 6 locales\n' +
    '    Product: Repairing Argan Oil Combo (handle: repairing-argan-oil-shampoo-conditioner-combo)';
  assert.equal(parseHandle(rework), 'repairing-argan-oil-shampoo-conditioner-combo');
});

void test('parseHandle: reads a collection-scoped product URL', () => {
  // Newer tasks link through a collection. Requiring /products/ straight after
  // the domain dropped three real tasks.
  const scoped =
    'Product page:\nhttps://www.mykitsch.com/collections/tennis-collection/products/satin-bow-hair-clip-cream';
  assert.equal(parseHandle(scoped), 'satin-bow-hair-clip-cream');
});

void test('needsHandle: surfaces translation tasks that name no product', () => {
  // Dropping these silently makes the backlog look smaller than it is.
  assert.equal(needsHandle(task({ name: 'Translate the Updated Product Description', handle: undefined })), true);
  assert.equal(needsHandle(task({ name: '\u2705Translate to French', handle: undefined })), false);
  assert.equal(needsHandle(task({ name: '404 Errors', handle: undefined })), false);
  assert.equal(needsHandle(task()), false);
});

void test('parseHandle: ignores the Shopify admin URL', () => {
  // Admin URLs carry a numeric product id, not a handle. Matching them would
  // produce a storefront request for /products/10318931427509.
  const adminOnly = 'Shopify Admin: https://admin.shopify.com/store/mykitsch/products/10318931427509';
  assert.equal(parseHandle(adminOnly), undefined);
});

void test('parseHandle: returns undefined when notes name no product', () => {
  assert.equal(parseHandle('Translate the banners into the other languages.'), undefined);
});

void test('parseLocales: reads the lowercase list under its heading', () => {
  assert.deepEqual(parseLocales(AUTO_NOTES), ['es', 'fr', 'de', 'it', 'ja', 'ko']);
});

void test('parseLocales: reads bare uppercase codes', () => {
  assert.deepEqual(parseLocales(HAND_NOTES), ['es', 'de', 'it', 'fr']);
});

void test('parseLocales: does not pick two-letter words out of prose', () => {
  // "it" appears in ordinary English constantly. Scanning for codes anywhere
  // would claim Italian on nearly every task on the board.
  const prose = 'Please translate this product when you get to it, as the team needs it soon.';
  assert.deepEqual(parseLocales(prose), DEFAULT_LOCALES);
});

void test('parseLocales: defaults to all six when none are named', () => {
  assert.deepEqual(parseLocales('Product page:\nhttps://www.mykitsch.com/products/x'), DEFAULT_LOCALES);
});

void test('parseTask: assembles a task from either shape', () => {
  const auto = parseTask('1', 'Translate Product: Coconut Oil', AUTO_NOTES, '2026-08-14');
  assert.equal(auto.locales.length, 6);
  assert.equal(auto.dueOn, '2026-08-14');

  const hand = parseTask('2', 'Translate Product: Glitter Ghost Claw Clip', HAND_NOTES);
  assert.equal(hand.handle, 'recycled-plastic-glitter-claw-clip-ghosts');
  assert.equal(hand.dueOn, undefined);
});

void test('isProductTask: keeps product translations, drops banners and unrelated bugs', () => {
  // The board also holds "Translate Banners to other languages" and, via the
  // search, unrelated bugs. Treating those as products would fill the report
  // with findings about the filter rather than the backlog.
  assert.equal(isProductTask(task()), true);
  assert.equal(isProductTask(task({ name: 'Translate Banners to other languages', handle: undefined })), false);
  assert.equal(isProductTask(task({ name: '404 Errors', handle: undefined })), false);
  assert.equal(isProductTask(task({ name: 'bug: PDP Console Error', handle: 'x' })), false);
});

// ── judging one locale ───────────────────────────────────────────────────

void test('judgeLocale: localized copy that differs from English is translated', () => {
  assert.equal(
    judgeLocale(seen('es', 'Jabonera autodrenante que mantiene secas las pastillas')),
    'translated',
  );
});

void test('judgeLocale: a page serving the English copy is still missing', () => {
  // The failure this exists for: Shopify falls back to the source language when
  // a translation is absent, so an untranslated page is never empty — it is
  // English. Checking for "is there text" would mark the whole backlog done.
  assert.equal(judgeLocale(seen('es', `${EN_TITLE}. ${EN_BODY}`)), 'still_missing');
});

void test('judgeLocale: a translated title over an English description is still missing', () => {
  // The common half-done state, and the reason fields are compared separately.
  // One merged blob would differ from English overall and read as translated,
  // passing a product whose description was never touched.
  assert.equal(
    judgeLocale(
      seenFields(
        'fr',
        ['Porte-savon a drainage automatique', EN_TITLE],
        [EN_BODY, EN_BODY],
      ),
    ),
    'still_missing',
  );
});

void test('judgeLocale: every field translated is translated', () => {
  assert.equal(
    judgeLocale(
      seenFields(
        'fr',
        ['Porte-savon a drainage automatique', EN_TITLE],
        ['Garde les pains au sec et les fait durer nettement plus longtemps', EN_BODY],
      ),
    ),
    'translated',
  );
});

void test('retainsEnglish: a brand name kept in every locale is not untranslated copy', () => {
  // "Kitsch", "Bridgerton", "Star Wars" legitimately stay English everywhere.
  // Flagging them would report the whole catalogue as untranslated forever.
  assert.equal(
    retainsEnglish(
      'Funda de almohada de satén Bridgerton x Kitsch en Wisteria',
      'Bridgerton x Kitsch Satin Pillowcase in Wisteria',
    ),
    false,
  );
});

void test('retainsEnglish: falls back to whole-string matching for short copy', () => {
  // A bare product title has no clause long enough to judge by, and an
  // untranslated one must still be caught.
  assert.equal(retainsEnglish('Volumizing Roller Clips', 'Volumizing Roller Clips'), true);
  assert.equal(retainsEnglish('Pinces à rouleaux volumisantes', 'Volumizing Roller Clips'), false);
});

void test('judgeLocale: a 404 is a stale product, not a missing translation', () => {
  assert.equal(judgeLocale(seen('es', undefined, 'English', 404)), 'product_gone');
});

void test('judgeLocale: unreadable copy is never a verdict about the store', () => {
  assert.equal(judgeLocale(seen('es', undefined)), 'not_observed');
  assert.equal(judgeLocale(seen('es', '   ')), 'not_observed');
  assert.equal(judgeLocale(seen('es', 'algo', '')), 'not_observed');
  assert.equal(
    judgeLocale({ locale: 'es', status: 200, fields: {} }),
    'not_observed',
    'no fields at all must never read as translated',
  );
  assert.equal(judgeLocale(seen('es', 'algo', 'English', 500)), 'not_observed');
});

// ── judging a task ───────────────────────────────────────────────────────

const spanish = 'Jabonera autodrenante que mantiene secas las pastillas mucho mas tiempo';
const french = 'Porte-savon a drainage automatique pour garder les pains au sec plus longtemps';
/** Byte-identical to the source copy — what an untranslated page actually serves. */
const english = `${EN_TITLE}. ${EN_BODY}`;

void test('judgeTask: every locale translated makes the task closeable', () => {
  const result = judgeTask(task(), [seen('es', spanish), seen('fr', french)]);
  assert.equal(result.verdict, 'closeable');
  assert.match(result.note, /can be closed/u);
});

void test('judgeTask: nothing translated leaves the task still open', () => {
  const result = judgeTask(task(), [seen('es', english), seen('fr', english)]);
  assert.equal(result.verdict, 'still_open');
  assert.match(result.note, /es, fr/u);
});

void test('judgeTask: some done and some not is partial, and names which', () => {
  const result = judgeTask(task(), [seen('es', spanish), seen('fr', english)]);
  assert.equal(result.verdict, 'partial');
  assert.equal(result.byLocale.es, 'translated');
  assert.equal(result.byLocale.fr, 'still_missing');
  assert.match(result.note, /still English in fr/u);
});

void test('judgeTask: a 404 everywhere is a stale product, not done work', () => {
  const result = judgeTask(task(), [
    seen('es', undefined, english, 404),
    seen('fr', undefined, english, 404),
  ]);
  assert.equal(result.verdict, 'stale_product');
  assert.match(result.note, /outlived the product/u);
});

void test('judgeTask: one unreadable locale makes the whole verdict unverified', () => {
  // The false green this guards: reporting "closeable" from a partial read is
  // how a task gets closed on work that was never done.
  const result = judgeTask(task(), [seen('es', spanish), seen('fr', undefined)]);
  assert.equal(result.verdict, 'unverified');
  assert.match(result.note, /could not read copy in fr/u);
});

void test('judgeTask: checking no locales at all is unverified, never closeable', () => {
  const result = judgeTask(task(), []);
  assert.equal(result.verdict, 'unverified');
});

void test('summarize: counts every verdict', () => {
  const results = [
    judgeTask(task(), [seen('es', spanish)]),
    judgeTask(task(), [seen('es', english)]),
    judgeTask(task(), []),
  ];
  const counts = summarize(results);
  assert.equal(counts.closeable, 1);
  assert.equal(counts.still_open, 1);
  assert.equal(counts.unverified, 1);
});
