import js from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

import kitsch from './tools/eslint-plugin-kitsch/index.js';

/**
 * Static gate layer.
 *
 * Three blocks, in order: baseline TypeScript for everything, Playwright
 * standards for every spec, and the four Kitsch rules where each applies.
 *
 * The spec glob deliberately includes `i18n/specs/**`. The proposal's §14
 * notes that scoping the Playwright block to `web/**` and `mobile/**` alone
 * leaves the locale specs with the baseline TypeScript rules and none of the
 * Playwright ones — which is exactly where a conditional assertion or a hard
 * wait slips in unnoticed.
 */

const SPECS = ['web/specs/**/*.spec.ts', 'i18n/specs/**/*.spec.ts'];

export default tseslint.config(
  // Globs rather than a list of names: every audit writes a report directory,
  // and the Allure one ships a minified JS bundle. Naming them individually
  // meant a new report directory silently entered the lint run — the Allure
  // one added 1,800 errors before this became a glob.
  //
  // The trailing `*` is the second half of that lesson. `--out` is free-form on
  // every audit, so `npm run report -- --out allure-report-live` produces a
  // directory `*-report/` does not match; a local commit linted
  // `allure-report-live/` and `allure-report-selftest/` and reported 7,184
  // errors, every one of them about vendor code this repository did not write.
  //
  // Matches the rule in tools/report-clean.ts. Pinned by
  // tools/lib/report-dirs.test.ts, which asks eslint itself rather than
  // reading this list.
  //
  // Dot-directories are ignored wholesale for the same reason, one platform
  // further out. Heroku's Node buildpack drops
  // `.heroku/metrics/metrics_collector.cjs` into the app directory during the
  // build; `eslint .` found it, type-aware linting had no tsconfig entry for a
  // file that does not exist in the repository, and a CI run failed on
  // "Parsing error: ... was not found by the project service" — a file we did
  // not write, cannot fix, and should never have read.
  //
  // Not a special case for `.heroku/`: no tracked .js or .ts file in this
  // repository lives under a dot-directory, so descending into them can only
  // ever find somebody else's runtime. report-dirs.test.ts asserts that stays
  // true, so the day someone puts real source in one, they are told rather
  // than silently unlinted.
  {
    ignores: [
      'node_modules/',
      '*-report*/',
      '*-results*/',
      'allure-*/',
      '.*/',
      'fixtures/catalog/*.json',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Config and the lint plugin itself are plain JS and deliberately outside
    // tsconfig; type-aware rules have no program for them.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // ── Playwright standards, on every spec ────────────────────────────────
  {
    files: SPECS,
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,

      // Hard waits are the classic way to make a suite slow and still flaky.
      'playwright/no-wait-for-timeout': 'error',
      // An assertion inside an `if` does not run when the condition is false,
      // and a spec that silently asserts nothing is worse than a missing one.
      'playwright/no-conditional-expect': 'error',
      'playwright/no-conditional-in-test': 'error',
      // `force` clicks past the thing that would have caught the bug.
      'playwright/no-force-option': 'error',
      'playwright/expect-expect': 'error',

      // `test.skip(condition, reason)` is the documented pattern for "needs a
      // real store" — it reports as skipped with its reason attached rather
      // than passing while checking nothing. Unconditional `.skip` is still
      // caught by no-skipped-test's sibling rules in review.
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
    },
  },

  // ── Kitsch standing rules ─────────────────────────────────────────────
  {
    files: ['**/*.ts'],
    plugins: { kitsch },
    rules: {
      'kitsch/no-prod-target': 'error',
    },
  },
  {
    files: SPECS,
    rules: {
      'kitsch/no-hardcoded-price': 'error',
      'kitsch/require-spec-rationale': 'error',
    },
  },
  {
    files: ['collectors/**/*.ts'],
    rules: {
      'kitsch/no-write-operation': 'error',
    },
  },

  // ── Local exceptions, each with a reason ──────────────────────────────
  {
    // Unit-test corpora contain production URLs as *data* — sample strings
    // fed to the encoding detector — not as navigation targets.
    files: ['**/*.test.ts'],
    rules: { 'kitsch/no-prod-target': 'off' },
  },
  {
    // The fixture storefront and its content bundle carry market-formatted
    // prices as fixture data; that is the point of them.
    files: ['fixtures/**/*.ts'],
    rules: { 'kitsch/no-hardcoded-price': 'off' },
  },
  {
    // Config and CLI entry points legitimately read process.env and write to
    // stdout; they are not specs.
    files: ['*.config.ts', 'tools/**/*.ts', 'i18n/run-parity.ts', 'i18n/verify-detection.ts', 'fixtures/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
