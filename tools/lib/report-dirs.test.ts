import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

/**
 * What git says about a path: ignored, not ignored, or no answer.
 *
 * `git check-ignore -q` exits 0 for ignored and 1 for not — but 128 when there
 * is no repository to ask, which is the case in any build that unpacks a
 * tarball rather than cloning (Heroku CI among them). Collapsing that into
 * `false` is how the first version of this file reported ".gitignore does not
 * cover allure-results/" on a tree whose .gitignore was perfect. A harness that
 * could not look is not a finding, and this file of all files should not
 * confuse the two.
 */
const gitVerdict = (path: string): 'ignored' | 'not-ignored' | 'no-answer' => {
  const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (result.error !== undefined) return 'no-answer';
  if (result.status === 0) return 'ignored';
  if (result.status === 1) return 'not-ignored';
  return 'no-answer';
};

const gitCanAnswer = (): boolean => gitVerdict('.gitignore') !== 'no-answer';

const SKIP_NO_GIT = {
  skip: 'no git checkout here, so git has no opinion to check — not a passing .gitignore',
} as const;

void test('git ignores every report directory this repo can generate', (t) => {
  if (!gitCanAnswer()) {
    t.skip(SKIP_NO_GIT.skip);
    return;
  }
  for (const dir of GENERATED) {
    assert.equal(
      gitVerdict(`${dir}/index.html`),
      'ignored',
      `.gitignore does not cover ${dir}/ — a run would offer thousands of generated ` +
        `files to the next "git add ."`,
    );
  }
});

void test('git does not ignore the source tree', (t) => {
  if (!gitCanAnswer()) {
    t.skip(SKIP_NO_GIT.skip);
    return;
  }
  for (const dir of SOURCE) {
    assert.equal(gitVerdict(`${dir}/x.ts`), 'not-ignored', `.gitignore must not swallow ${dir}/`);
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

void test('eslint ignores what the build platform injects', async () => {
  // Heroku's Node buildpack writes .heroku/metrics/metrics_collector.cjs into
  // the app directory during the build. A CI run failed on it — "Parsing
  // error: ... was not found by the project service" — which is type-aware
  // linting complaining, correctly, that a file absent from the repository is
  // absent from tsconfig. Three gates passed and the run was still red over
  // somebody else's runtime.
  const eslint = new ESLint();
  for (const path of [
    '.heroku/metrics/metrics_collector.cjs',
    '.heroku/node/bin/whatever.js',
    '.cache/some-tool/index.js',
  ]) {
    assert.ok(await eslint.isPathIgnored(path), `eslint.config.js must ignore ${path}`);
  }
});

void test('no source of ours hides inside a dot-directory', () => {
  // The blanket dot-directory ignore above is only safe while this holds. If
  // somebody adds real code under one, it would silently stop being linted —
  // so the check is that they cannot do so without this failing first.
  const tracked = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  if (tracked.error !== undefined || tracked.status !== 0) {
    // No repository to ask; the eslint assertions above still ran.
    return;
  }
  const hidden = tracked.stdout
    .split('\0')
    .filter((path) => path.startsWith('.') && /\.(?:[cm]?js|tsx?)$/u.test(path));
  assert.deepEqual(
    hidden,
    [],
    'these are tracked source files inside a dot-directory, which eslint no longer reads. ' +
      'Either move them, or narrow the ".*/" ignore to the platform directories it is for.',
  );
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
