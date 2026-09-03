import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passed, severityFor, summarize, triage } from './bugbot.js';
import type { ReviewFinding } from './bugbot.js';

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  source: 'eslint',
  rule: 'no-unused-vars',
  file: 'i18n/lib/config.ts',
  line: 1,
  message: 'unused',
  severity: 'minor',
  ...overrides,
});

void test('a customer-facing rule is major', () => {
  assert.equal(severityFor('kitsch', 'kitsch/no-prod-target'), 'major');
  assert.equal(severityFor('playwright', 'playwright/no-conditional-expect'), 'major');
});

void test('a style rule is minor', () => {
  assert.equal(severityFor('eslint', '@typescript-eslint/no-unused-vars'), 'minor');
});

void test('a type error is major — nothing downstream of it is trustworthy', () => {
  assert.equal(severityFor('typescript', 'TS2322'), 'major');
});

void test('harness findings never route to the client', () => {
  const result = triage(finding({ severity: 'harness' }));
  assert.equal(result.reportToClient, false);
  assert.equal(result.route, 'our-backlog');
});

void test('critical goes to Slack within the hour, with an owner', () => {
  const result = triage(finding({ severity: 'critical' }));
  assert.equal(result.route, 'slack-immediate');
  assert.match(result.sla, /hour/u);
});

void test('the gate fails on a major and passes on minors', () => {
  assert.equal(passed(summarize([finding({ severity: 'major' })])), false);
  assert.equal(passed(summarize([finding(), finding(), finding()])), true);
});

void test('harness findings alone do not block the merge', () => {
  // Our tooling breaking is our problem, and burying it in the client's
  // pass/fail number is how it stops getting fixed.
  assert.equal(passed(summarize([finding({ severity: 'harness' })])), true);
});

void test('summarize counts every severity', () => {
  const summary = summarize([
    finding({ severity: 'critical' }),
    finding({ severity: 'major' }),
    finding({ severity: 'minor' }),
    finding({ severity: 'harness' }),
  ]);
  assert.deepEqual(summary, { critical: 1, major: 1, minor: 1, harness: 1 });
});
