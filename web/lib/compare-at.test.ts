import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  auditSheets,
  buildExpectations,
  clientFindings,
  formatCents,
  hasMoney,
  judge,
  parseCsv,
  readImportCsv,
  readRollbackCsv,
  tally,
  toCents,
  type Expectation,
  type ImportRow,
  type Observation,
  type RollbackRow,
} from './compare-at.js';

const kinds = (findings: readonly { readonly kind: string }[]): readonly string[] =>
  findings.map((finding) => finding.kind).sort();

const importRow = (over: Partial<ImportRow> = {}): ImportRow => ({
  handle: 'a-product',
  sku: 'SKU1',
  price: '12',
  compareAt: '',
  ...over,
});

const rollbackRow = (over: Partial<RollbackRow> = {}): RollbackRow => ({
  handle: 'a-product',
  status: 'ACTIVE',
  sku: 'SKU1',
  livePrice: '12',
  liveCompareAt: '20',
  ...over,
});

const expectation = (over: Partial<Expectation> = {}): Expectation => ({
  handle: 'a-product',
  priceCents: 1200,
  expectNoCompareAt: true,
  published: true,
  visiblyChanged: true,
  ...over,
});

const observation = (over: Partial<Observation> = {}): Observation => ({
  handle: 'a-product',
  status: 200,
  priceText: '$12.00',
  compareAtText: undefined,
  ...over,
});

void test('toCents: parses the money shapes a Shopify theme prints', () => {
  assert.equal(toCents('12'), 1200);
  assert.equal(toCents('49.99'), 4999);
  assert.equal(toCents('$79.99'), 7999);
  assert.equal(toCents('$1,299.00'), 129_900);
  assert.equal(toCents(' 6.24 '), 624);
});

void test('toCents: accepts the trailing currency code Shopify themes print', () => {
  // Refusing these would make every product unreadable on such a theme.
  assert.equal(toCents('$12.00 USD'), 1200);
  assert.equal(toCents('$49.99 CAD'), 4999);
});

void test('toCents: returns undefined rather than zero for anything unparseable', () => {
  // A blank read as 0 would report every such product as mispriced, which
  // is how a check earns a reputation for crying wolf.
  for (const value of ['', '   ', 'Sold out', 'Free', '1.234']) {
    assert.equal(toCents(value), undefined, `expected undefined for ${JSON.stringify(value)}`);
  }
});

void test('toCents: refuses a price range instead of reading its lower bound', () => {
  // "from $12" spans variants. Reading it as exactly $12.00 would let a
  // range pass as a verified single price; unreadable is the honest answer.
  for (const value of ['from $12', 'From $12.00', '$12.00 - $20.00']) {
    assert.equal(toCents(value), undefined, `expected undefined for ${JSON.stringify(value)}`);
  }
});

void test('toCents: avoids float drift', () => {
  assert.equal(toCents('19.99'), 1999);
  assert.equal(formatCents(toCents('19.99') ?? 0), '$19.99');
});

void test('parseCsv: handles quoted fields, doubled quotes and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'he said "hi"'],
  ]);
});

void test('parseCsv: strips a BOM so the first column name still matches', () => {
  // Excel writes one. Left in place it becomes part of the header text and
  // every lookup of that column misses.
  const rows = parseCsv('﻿Handle,Variant SKU\nx,y\n');
  assert.equal(rows[0]?.[0], 'Handle');
});

void test('parseCsv: drops blank lines rather than yielding empty rows', () => {
  assert.equal(parseCsv('a\n\n\nb\n').length, 2);
});

void test('readImportCsv / readRollbackCsv: reads the real column names', () => {
  const rows = readImportCsv(
    'Handle,Option1 Name,Variant SKU,Variant Price,Variant Compare At Price\n' +
      'thing,Title,SKU9,12,\n',
  );
  assert.deepEqual(rows, [{ handle: 'thing', sku: 'SKU9', price: '12', compareAt: '' }]);
});

void test('readImportCsv / readRollbackCsv: uppercases status so DRAFT matching is not case-sensitive', () => {
  const rows = readRollbackCsv(
    'handle,status,sku,live_price,live_compare_at\nthing,draft,S,5,9\n',
  );
  assert.equal(rows[0]?.status, 'DRAFT');
});

void test('readImportCsv / readRollbackCsv: fails loudly on a missing column instead of reading blanks', () => {
  // Silently treating an absent column as empty would make every row look
  // like it has no compare-at, which is the answer we are trying to verify.
  assert.throws(
    () => readImportCsv('Handle,Variant Price\nx,1\n'),
    /no "Variant SKU" column/u,
  );
});

void test('auditSheets: accepts sheets that agree', () => {
  assert.deepEqual(auditSheets([importRow()], [rollbackRow()]), []);
});

void test('auditSheets: flags an import handle with no rollback record as unrevertible', () => {
  const findings = auditSheets([importRow({ handle: 'orphan' })], []);
  assert.deepEqual(kinds(findings), ['rollback_record_missing']);
  assert.match(findings[0]?.detail ?? '', /cannot be reverted/u);
});

void test('auditSheets: flags a removal import that still carries a compare-at value', () => {
  const findings = auditSheets([importRow({ compareAt: '20' })], [rollbackRow()]);
  assert.ok(kinds(findings).includes('import_carries_compare_at'));
});

void test('auditSheets: flags sheets that disagree on price or SKU', () => {
  const price = auditSheets([importRow({ price: '12' })], [rollbackRow({ livePrice: '14' })]);
  assert.deepEqual(kinds(price), ['sheet_disagreement']);
  const sku = auditSheets([importRow({ sku: 'A' })], [rollbackRow({ sku: 'B' })]);
  assert.deepEqual(kinds(sku), ['sheet_disagreement']);
});

void test('auditSheets: flags a duplicated handle in either sheet', () => {
  const findings = auditSheets([importRow(), importRow()], [rollbackRow()]);
  assert.ok(kinds(findings).includes('duplicate_handle'));
});

void test('auditSheets: reports a blank SKU as minor, not as a blocker', () => {
  const findings = auditSheets([importRow({ sku: '' })], [rollbackRow()]);
  assert.equal(findings[0]?.kind, 'missing_sku');
  assert.equal(findings[0]?.severity, 'minor');
});

void test('buildExpectations: marks a row visibly changed only when compare-at exceeded price', () => {
  const visible = buildExpectations([importRow()], [rollbackRow({ liveCompareAt: '20' })]);
  assert.equal(visible[0]?.visiblyChanged, true);

  // compare-at == price renders no strikethrough, so clearing it changes
  // nothing a customer can see, and this row cannot confirm the removal.
  const equal = buildExpectations([importRow()], [rollbackRow({ liveCompareAt: '12' })]);
  assert.equal(equal[0]?.visiblyChanged, false);
});

void test('buildExpectations: marks DRAFT products unpublished so a 404 is not a defect', () => {
  const out = buildExpectations([importRow()], [rollbackRow({ status: 'DRAFT' })]);
  assert.equal(out[0]?.published, false);
});

void test('buildExpectations: treats an unknown status as published', () => {
  // Checking a page that turns out to be a draft costs one 404. Skipping a
  // live one hides a real defect.
  const out = buildExpectations([importRow()], []);
  assert.equal(out[0]?.published, true);
});

void test('buildExpectations: skips rows whose price cannot be parsed rather than expecting $0.00', () => {
  assert.deepEqual(buildExpectations([importRow({ price: '' })], [rollbackRow()]), []);
});

void test('judge: passes a product showing only its real price', () => {
  assert.deepEqual(judge(expectation(), observation()), []);
});

void test('judge: reports a leftover strikethrough as critical', () => {
  const findings = judge(expectation(), observation({ compareAtText: '$20.00' }));
  assert.deepEqual(kinds(findings), ['compare_at_still_rendered']);
  assert.equal(findings[0]?.severity, 'critical');
  assert.match(findings[0]?.detail ?? '', /\$20\.00/u);
});

void test('judge: does not read an empty compare-at element as a strikethrough', () => {
  // Themes commonly leave the element in the DOM as a placeholder. Treating
  // its presence as a finding would make every clean product a critical.
  for (const text of ['', '   ', '\n']) {
    assert.deepEqual(judge(expectation(), observation({ compareAtText: text })), []);
  }
});

void test('judge: reports a moved price as critical', () => {
  const findings = judge(expectation({ priceCents: 1200 }), observation({ priceText: '$14.00' }));
  assert.deepEqual(kinds(findings), ['price_mismatch']);
});

void test('judge: reports both when a product is mispriced and still struck through', () => {
  const findings = judge(
    expectation({ priceCents: 1200 }),
    observation({ priceText: '$14.00', compareAtText: '$20.00' }),
  );
  assert.deepEqual(kinds(findings), ['compare_at_still_rendered', 'price_mismatch']);
});

void test('judge: refuses to pass when the price could not be read', () => {
  // The false green this guards: an unmapped selector observes nothing, and
  // "no strikethrough found" is what a blind run reports too.
  const findings = judge(expectation(), observation({ priceText: undefined }));
  assert.deepEqual(kinds(findings), ['price_not_observed']);
  assert.equal(findings[0]?.severity, 'harness');
  assert.match(findings[0]?.detail ?? '', /Nothing about this product was verified/u);
});

void test('judge: blames the harness, not the store, for an unreadable page', () => {
  const findings = judge(expectation(), observation({ priceText: 'Sold out' }));
  assert.equal(findings[0]?.kind, 'price_not_observed');
  assert.deepEqual(clientFindings(findings), []);
});

void test('judge: reports a 404 on a published product but stays quiet on a draft', () => {
  assert.deepEqual(
    kinds(judge(expectation({ published: true }), observation({ status: 404 }))),
    ['product_unreachable'],
  );
  assert.deepEqual(judge(expectation({ published: false }), observation({ status: 404 })), []);
});

void test('judge: does not also report a price mismatch when the page never loaded', () => {
  // One cause, one finding. A 404 that produced three findings would triple
  // the apparent size of an outage.
  assert.equal(judge(expectation(), observation({ status: 500 })).length, 1);
});

void test('hasMoney: separates rendered amounts from placeholders and prose', () => {
  assert.equal(hasMoney('$12.00'), true);
  assert.equal(hasMoney('12'), true);
  assert.equal(hasMoney(undefined), false);
  assert.equal(hasMoney(''), false);
  assert.equal(hasMoney('Sale'), false);
  assert.equal(hasMoney('Sold out'), false);
});

void test('tally: counts by severity and keeps harness separate from client findings', () => {
  const findings = [
    ...judge(expectation(), observation({ compareAtText: '$20.00' })),
    ...judge(expectation(), observation({ priceText: undefined })),
  ];
  assert.deepEqual(tally(findings), { critical: 1, major: 0, minor: 0, harness: 1 });
  assert.equal(clientFindings(findings).length, 1);
});
