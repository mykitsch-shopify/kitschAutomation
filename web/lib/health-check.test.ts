import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  draftTicket,
  evidenceFrom,
  isClean,
  resolveIssue,
  summarize,
  type Observation,
  type ReportedIssue,
} from './health-check.js';
import { findMarkers } from './page-markers.js';

/**
 * The distinction under test throughout: "we looked and it is gone" versus "we
 * did not look". Everything else here is bookkeeping; that one is the reason
 * the module exists, and it is the one a report under deadline pressure will
 * be tempted to blur.
 */

const issue = (over: Partial<ReportedIssue> = {}): ReportedIssue => ({
  id: 'HC-2026-04-28-1',
  title: 'Quick-view close button missing translation key',
  priority: 'P2',
  paths: ['/products/coastal-cottage-hair-perfume-duo'],
  needle: 'en.products.product.quick_view.close',
  source: 'Kitsch Top 20 PDP Health Check',
  reportedAt: '2026-04-28',
  ...over,
});

const seen = (over: Partial<Observation> = {}): Observation => ({
  environment: 'live',
  verdict: 'confirmed',
  checked: ['/products/a'],
  evidence: ['/products/a — aria-label on button.quick-view__close'],
  ...over,
});

void test('resolveIssue: confirmed on any environment is confirmed', () => {
  // A defect on Live is a defect whatever staging says.
  const outcome = resolveIssue(issue(), [
    seen({ environment: 'live', verdict: 'confirmed' }),
    seen({ environment: 'fuego', verdict: 'not_reproduced', evidence: [] }),
  ]);
  assert.equal(outcome.verdict, 'confirmed');
});

void test('resolveIssue: environments disagreeing is recorded, not resolved away', () => {
  // Present on Live and absent on Fuego usually means a fix is built and not
  // shipped — a different conversation from either half alone.
  const outcome = resolveIssue(issue(), [
    seen({ environment: 'live', verdict: 'confirmed' }),
    seen({ environment: 'fuego', verdict: 'not_reproduced', evidence: [] }),
  ]);
  assert.notEqual(outcome.divergence, undefined);
  assert.match(outcome.divergence ?? '', /present on live/u);
  assert.match(outcome.divergence ?? '', /absent on fuego/u);
});

void test('resolveIssue: agreement produces no divergence note', () => {
  const outcome = resolveIssue(issue(), [
    seen({ environment: 'live', verdict: 'confirmed' }),
    seen({ environment: 'fuego', verdict: 'confirmed' }),
  ]);
  assert.equal(outcome.divergence, undefined);
});

void test('resolveIssue: nobody could check it is unverified, never "not reproduced"', () => {
  // The regression that would matter most. "Not reproduced" reads as fixed.
  const outcome = resolveIssue(issue(), [
    seen({ environment: 'live', verdict: 'unverified', evidence: [], blocked: 'page did not load' }),
    seen({ environment: 'fuego', verdict: 'unverified', evidence: [], blocked: 'no credentials' }),
  ]);
  assert.equal(outcome.verdict, 'unverified');
});

void test('resolveIssue: one environment clear and one unchecked is not a clean bill', () => {
  // It is "not reproduced where we looked", which the ticket logic must not
  // upgrade into confidence — but it is still better evidence than nothing,
  // so it is not unverified either.
  const outcome = resolveIssue(issue(), [
    seen({ environment: 'live', verdict: 'not_reproduced', evidence: [] }),
    seen({ environment: 'fuego', verdict: 'unverified', evidence: [], blocked: 'unreachable' }),
  ]);
  assert.equal(outcome.verdict, 'not_reproduced');
});

void test('resolveIssue: priority maps onto the suite severity scale', () => {
  assert.equal(resolveIssue(issue({ priority: 'P0' }), []).severity, 'critical');
  assert.equal(resolveIssue(issue({ priority: 'P2' }), []).severity, 'major');
  assert.equal(resolveIssue(issue({ priority: 'P3' }), []).severity, 'minor');
  // An unrecognised priority is treated as major rather than dropped: a claim
  // nobody graded is not thereby harmless.
  assert.equal(resolveIssue(issue({ priority: 'urgent-ish' }), []).severity, 'major');
});

void test('draftTicket: only a confirmed issue earns one', () => {
  assert.equal(draftTicket(resolveIssue(issue(), [seen()])) !== undefined, true);
  assert.equal(
    draftTicket(resolveIssue(issue(), [seen({ verdict: 'not_reproduced', evidence: [] })])),
    undefined,
  );
  assert.equal(
    draftTicket(resolveIssue(issue(), [seen({ verdict: 'unverified', evidence: [] })])),
    undefined,
  );
});

void test('draftTicket: carries the evidence and where the claim came from', () => {
  const ticket = draftTicket(resolveIssue(issue(), [seen()]));
  assert.match(ticket?.title ?? '', /^\[P2\] /u);
  assert.match(ticket?.body ?? '', /Kitsch Top 20 PDP Health Check/u);
  assert.match(ticket?.body ?? '', /2026-04-28/u);
  assert.match(ticket?.body ?? '', /aria-label on button\.quick-view__close/u);
});

void test('draftTicket: names the environments it could not check', () => {
  // A ticket that says "confirmed" without saying "on one of two environments"
  // overstates what was established.
  const ticket = draftTicket(
    resolveIssue(issue(), [
      seen({ environment: 'live', verdict: 'confirmed' }),
      seen({ environment: 'fuego', verdict: 'unverified', evidence: [], blocked: 'unreachable' }),
    ]),
  );
  assert.match(ticket?.body ?? '', /Not checked everywhere/u);
  assert.match(ticket?.body ?? '', /fuego: unreachable/u);
});

void test('draftTicket: proposes no fix', () => {
  // The report's author suggested one and it is theirs. A harness inventing a
  // code change is how a one-line locale addition becomes an argument.
  const ticket = draftTicket(resolveIssue(issue(), [seen()]));
  assert.match(ticket?.body ?? '', /does not propose a fix/u);
});

void test('summarize + isClean: an unverified issue is not a clean run', () => {
  const outcomes = [
    resolveIssue(issue({ id: 'a' }), [seen({ verdict: 'not_reproduced', evidence: [] })]),
    resolveIssue(issue({ id: 'b' }), [seen({ verdict: 'unverified', evidence: [] })]),
  ];
  const summary = summarize(outcomes);
  assert.equal(summary.confirmed, 0);
  assert.equal(summary.notReproduced, 1);
  assert.equal(summary.unverified, 1);
  // Nothing confirmed, and still not clean. This is the false all-clear the
  // whole exercise exists to prevent, and it is most tempting here.
  assert.equal(isClean(summary), false);
});

void test('summarize + isClean: everything checked and gone is clean', () => {
  const summary = summarize([
    resolveIssue(issue({ id: 'a' }), [seen({ verdict: 'not_reproduced', evidence: [] })]),
  ]);
  assert.equal(isClean(summary), true);
  assert.equal(summary.tickets, 0);
});

void test('evidenceFrom: keeps only the marker the report named', () => {
  // A page can acquire an unrelated marker between the report and now. Reading
  // that as "the reported issue is confirmed" would raise a ticket describing
  // the wrong defect.
  const markers = findMarkers({
    url: 'https://example.test/products/a',
    text: '',
    attributes: [
      {
        selector: 'button.quick-view__close',
        attribute: 'aria-label',
        value: 'Translation missing: en.products.product.quick_view.close',
      },
      { selector: 'a.footer', attribute: 'title', value: 'Translation missing: en.footer.legal' },
    ],
  });
  const evidence = evidenceFrom('/products/a', markers, 'en.products.product.quick_view.close');
  assert.equal(evidence.length, 1);
  assert.match(evidence[0] ?? '', /quick_view\.close/u);
});
