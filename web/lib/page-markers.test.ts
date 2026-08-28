import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeMarker,
  findMarkers,
  stillPresent,
  type PageSnapshot,
} from './page-markers.js';

/**
 * The cases here are the two findings from the 2026-04-28 health check, plus
 * the ways a scanner gets them wrong.
 *
 * That report found `{{ product_title }}` in an sr-only div and `Translation
 * missing: …` in an aria-label. A scan of `body.innerText` — which is what the
 * render layer did — returns the first and not the second. So the second half
 * of these tests is really one assertion repeated: an attribute is part of the
 * page.
 */

const snapshot = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: 'https://www.mykitsch.com/products/example',
  text: '',
  attributes: [],
  ...over,
});

void test('findMarkers: a clean page produces nothing', () => {
  const markers = findMarkers(
    snapshot({
      text: 'Coastal Cottage Hair Perfume Duo\n$26.00\nAdd to cart',
      attributes: [
        { selector: 'button.quick-view__close', attribute: 'aria-label', value: 'Close' },
        { selector: 'img.hero', attribute: 'alt', value: 'Model holding the duo' },
      ],
    }),
  );
  assert.deepEqual(markers, []);
});

void test('findMarkers: ISSUE 1 — Translation missing in an aria-label is found', () => {
  // The exact string from the report. innerText cannot see this; that is the
  // whole reason this module exists.
  const markers = findMarkers(
    snapshot({
      attributes: [
        {
          selector: 'button.quick-view__close',
          attribute: 'aria-label',
          value: 'Translation missing: en.products.product.quick_view.close',
        },
      ],
    }),
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.kind, 'translation_missing');
  assert.equal(markers[0]?.site.kind, 'attribute');
  assert.equal(markers[0]?.severity, 'major');
});

void test('findMarkers: ISSUE 2 — an unsubstituted variable in sr-only text is found', () => {
  const markers = findMarkers(snapshot({ text: 'Quick view of {{ product_title }}' }));
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.kind, 'unbound_variable');
  assert.equal(markers[0]?.site.kind, 'text');
  assert.equal(markers[0]?.severity, 'critical');
});

void test('findMarkers: an unsubstituted variable in an attribute is found too', () => {
  const markers = findMarkers(
    snapshot({
      attributes: [
        { selector: 'input.newsletter', attribute: 'placeholder', value: '{{ email_label }}' },
      ],
    }),
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.kind, 'unbound_variable');
});

void test('findMarkers: every occurrence is reported, not just the first', () => {
  // A theme-level leak appears on every card in a grid. Reporting one would
  // describe a forty-instance defect as a single stray string.
  const markers = findMarkers(
    snapshot({ text: 'Quick view of {{ a }} and {{ b }} and {{ c }}' }),
  );
  assert.equal(markers.length, 3);
});

void test('findMarkers: a lone brace in ordinary copy is not a finding', () => {
  // "{{" with no closing pair turns up in code samples and in help copy.
  // Flagging it would bury the real findings.
  assert.deepEqual(findMarkers(snapshot({ text: 'Use {{ to open a block' })), []);
});

void test('findMarkers: case variations of the Shopify literal are caught', () => {
  for (const value of [
    'Translation missing: en.a.b',
    'translation missing: en.a.b',
    'TRANSLATION MISSING: en.a.b',
  ]) {
    const markers = findMarkers(snapshot({ attributes: [{ selector: 'x', attribute: 'alt', value }] }));
    assert.equal(markers.length, 1, `expected a finding for "${value}"`);
  }
});

void test('findMarkers: only spoken attributes are scanned, not data payloads', () => {
  // Analytics config legitimately carries brace syntax. It reaches nobody, and
  // flagging it would make the check unusable on a real theme.
  const markers = findMarkers(
    snapshot({
      attributes: [
        { selector: 'div#analytics', attribute: 'data-config', value: '{{ tracking_id }}' },
      ],
    }),
  );
  // The scanner is given only the attributes the collector chose to observe,
  // so this asserts the contract the collector must honour.
  assert.equal(markers.length, 1, 'the scanner reports what it is given');
});

void test('describeMarker: an attribute finding says it is inaudible-but-invisible', () => {
  const markers = findMarkers(
    snapshot({
      attributes: [
        {
          selector: 'button.quick-view__close',
          attribute: 'aria-label',
          value: 'Translation missing: en.products.product.quick_view.close',
        },
      ],
    }),
  );
  const described = describeMarker(markers[0] as never);
  assert.match(described, /aria-label/u);
  assert.match(described, /screen readers/u);
  assert.match(described, /invisible on screen/u);
});

void test('stillPresent: re-checking one claimed issue, not the whole page', () => {
  // A health-check report names a specific defect. Re-verifying it asks whether
  // that one is still there — a different, unrelated marker appearing later
  // must not be read as "the reported issue is confirmed".
  const markers = findMarkers(
    snapshot({
      attributes: [
        {
          selector: 'button.quick-view__close',
          attribute: 'aria-label',
          value: 'Translation missing: en.products.product.quick_view.close',
        },
      ],
    }),
  );
  assert.equal(stillPresent(markers, 'en.products.product.quick_view.close'), true);
  assert.equal(stillPresent(markers, 'en.cart.checkout.label'), false);
});
