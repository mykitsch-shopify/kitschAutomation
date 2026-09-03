import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { ESLint } from 'eslint';

/**
 * Generated report directories must be invisible to git AND to eslint.
 *
 * Three places encode "this directory is generated output": `.gitignore`,
 * the `ignores` block in `eslint.config.js`, and `isReportDirectory` in
 * `tools/report-clean.ts`. Nothing made them agree, and twice now they have
 * not.
 *
 * The first time, the lint ignores named report directories one by one and a
 * new one walked into the lint run — 1,800 errors from a minified vendor
 * bundle. That was fixed by turning the list into the glob `*-report/`.
 *
 * The second time, the glob was the problem. Every audit takes a free-form
 * `--out`, so `npm run report -- --out allure-report-live` produces a
 * directory that `*-report/` does not match and `.gitignore` has never heard
 * of. A local run of `git commit` linted `allure-report-live/` and
 * `allure-report-selftest/` and reported 7,184 errors — none of them about
 * this repository's code, all of them blocking a commit.
 *
 * So this asks the two tools themselves, rather than reading their config as
 * text: git decides via `git check-ignore`, eslint via `isPathIgnored`. A
 * pattern that stops matching fails here instead of in front of somebody
 * trying to commit.
 */

/**
 * Names this repository's own tooling can produce.
 *
 * Not hypothetical: `allure-report` and `allure-results` are the defaults in
 * `tools/allure-report.ts`, `allure-*-live` is the worked example in
 * `tools/report-clean.ts`'s help text, `allure-report-selftest` came off a
 * real machine, and the rest are the `--out` defaults of the audits.
 */
const GENERATED = [
  'allure-results',
  'allure-report',
  'allure-results-live',
  'allure-report-live',
  'allure-report-selftest',
  'i18n-report',
  'playwright-report',
  'blob-report',
  'top-products-report',
  'translation-backlog-report',
  'a11y-report',
  'release-gate-report',
  'test-results',
] as const;

/**
 * Directories that must stay visible.
 *
 * Without these the suite passes just as well against `ignores: ['*']`, and a
 * check that cannot fail is the thing this repository exists to refuse.
 */
const SOURCE = ['tools', 'web', 'i18n', 'visual', 'core', 'config'] as const;

const gitIgnores = (path: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    // Exit 1 means "not ignored", which is an answer rather than a failure.
    return false;
  }
};

void test('git ignores every report directory this repo can generate', () => {
  for (const dir of GENERATED) {
    assert.ok(
      gitIgnores(`${dir}/index.html`),
      `.gitignore does not cover ${dir}/ — a run would offer thousands of generated ` +
        `files to the next "git add ."`,
    );
  }
});

void test('git does not ignore the source tree', () => {
  for (const dir of SOURCE) {
    assert.equal(gitIgnores(`${dir}/x.ts`), false, `.gitignore must not swallow ${dir}/`);
  }
});

void test('eslint ignores every report directory this repo can generate', async () => {
  const eslint = new ESLint();
  for (const dir of GENERATED) {
    assert.ok(
      await eslint.isPathIgnored(`${dir}/app.js`),
      `eslint.config.js does not ignore ${dir}/ — linting a generated Allure bundle ` +
        `reports minified vendor code as this repository's errors, and blocks the commit`,
    );
  }
});

void test('eslint still lints the source tree', async () => {
  const eslint = new ESLint();
  for (const dir of SOURCE) {
    assert.equal(
      await eslint.isPathIgnored(`${dir}/x.ts`),
      false,
      `eslint.config.js must not ignore ${dir}/`,
    );
  }
});
