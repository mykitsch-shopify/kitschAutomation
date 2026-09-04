import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectUniformFailures, type UniformCandidate } from './uniform-failure.js';

const fail = (check: string, kind: string, target: string): UniformCandidate => ({
  check,
  kind,
  target,
});

const ten = (check: string, kind: string): UniformCandidate[] =>
  Array.from({ length: 10 }, (_unused, index) => fail(check, kind, `product-${String(index)}`));

void test('a check that failed on everything is reported once', () => {
  // The 2026-09-04 top-10 run: ten criticals, "clicking add-to-cart did not put
  // a line in the cart", one per product, on all ten products.
  const found = detectUniformFailures(ten('add_to_cart', 'no_cart_line'), () => 10);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.affected, 10);
  assert.equal(found[0]?.total, 10);
});

void test('the finding names both explanations and refuses to choose', () => {
  // The whole point. A rule that picked one would be guessing, and the two
  // answers lead to completely different mornings.
  const detail = detectUniformFailures(ten('add_to_cart', 'no_cart_line'), () => 10)[0]?.detail ?? '';
  assert.match(detail, /the store/u);
  assert.match(detail, /the harness/u);
  assert.match(detail, /cannot tell them apart/u);
  assert.match(detail, /preflight/u, 'it should say how to settle the harness half');
});

void test('a check that failed on some targets is not uniform', () => {
  // Three of ten is an ordinary result and has ordinary explanations.
  const some = ten('add_to_cart', 'no_cart_line').slice(0, 3);
  assert.deepEqual(detectUniformFailures(some, () => 10), []);
});

void test('one lucky pass does not hide the pattern', () => {
  // 9 of 10 says the same thing as 10 of 10. Demanding unanimity means a
  // single fluke suppresses the finding.
  const nine = ten('add_to_cart', 'no_cart_line').slice(0, 9);
  assert.equal(detectUniformFailures(nine, () => 10).length, 1);
});

void test('a tiny run is never called uniform', () => {
  // 2 of 2 is a coincidence, not a cause.
  const two = ten('add_to_cart', 'no_cart_line').slice(0, 2);
  assert.deepEqual(detectUniformFailures(two, () => 2), []);
});

void test('a check is judged against its own targets, not the whole run', () => {
  // The BYOB check only visits the nine builder pages. Judged against the
  // twenty-nine pages in the run it never looks uniform, and the nine
  // identical criticals stay nine separate mysteries.
  const byob = Array.from({ length: 9 }, (_u, i) => fail('byob_flow', 'byob_no_options', `b-${String(i)}`));
  assert.equal(detectUniformFailures(byob, () => 9).length, 1, 'judged against its own nine');
  assert.deepEqual(detectUniformFailures(byob, () => 29), [], 'judged against the whole run it vanishes');
});

void test('different checks are counted separately', () => {
  const mixed = [...ten('add_to_cart', 'no_cart_line'), ...ten('variations', 'not_observed')];
  const found = detectUniformFailures(mixed, () => 10);
  assert.deepEqual(found.map((f) => f.check).sort(), ['add_to_cart', 'variations']);
});

void test('the same target failing twice is counted once', () => {
  // Otherwise a check that emits two findings per page looks uniform on half a
  // run, and the threshold stops meaning anything.
  const doubled = [
    ...ten('add_to_cart', 'no_cart_line'),
    ...ten('add_to_cart', 'no_cart_line'),
  ];
  assert.equal(detectUniformFailures(doubled, () => 20).length, 0, '10 distinct targets of 20 is not uniform');
});
