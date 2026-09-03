import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

/**
 * Two CI systems now describe the same gate, and they must not drift.
 *
 * `app.json` tells Heroku CI what to run on a push; `.github/workflows/
 * pipeline.yml` tells GitHub Actions the same thing. The workflow says out
 * loud why they have to agree:
 *
 *   "Identical to `npm run precommit` on purpose. A CI gate that checks
 *    something different from the local one teaches people the local one is
 *    decorative."
 *
 * A third copy of that decision, in a different file format, is exactly how
 * the last six drifts in this repository started. So the copies are pinned to
 * each other here rather than to a hardcoded string.
 *
 * `app.json` cannot hold comments, which is the other reason this file exists:
 * it is where the reasoning for that JSON lives.
 */

type HerokuApp = {
  readonly stack?: string;
  readonly formation?: Record<string, unknown>;
  readonly environments?: {
    readonly test?: {
      readonly env?: Record<string, string>;
      readonly scripts?: Record<string, string>;
      readonly buildpacks?: readonly { readonly url: string }[];
    };
  };
};

type Workflow = {
  readonly jobs: Record<string, { readonly steps?: readonly { readonly run?: string }[] }>;
};

const app = JSON.parse(readFileSync('app.json', 'utf8')) as HerokuApp;
const workflow = parse(readFileSync('.github/workflows/pipeline.yml', 'utf8')) as Workflow;

const testEnv = app.environments?.test;

const runsIn = (job: string): readonly string[] =>
  (workflow.jobs[job]?.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run]));

void test('Heroku CI runs the same gate GitHub Actions runs on a push', () => {
  const heroku = testEnv?.scripts?.test;
  assert.ok(heroku !== undefined, 'app.json declares no environments.test.scripts.test');
  assert.ok(
    runsIn('guardrails').some((command) => command.trim() === heroku.trim()),
    `app.json runs "${heroku}", which is not a command the guardrails job runs. ` +
      'Two CI systems checking different things means one of them is lying about ' +
      'the state of the branch.',
  );
});

void test('no CI configuration points the harness at production', () => {
  // README §9.2: production is read-only, always. A base URL is the one setting
  // that can turn this suite from an observer into a shopper, and app.json's
  // env wins over pipeline-level config vars — so pinning it here is a lock,
  // not a default.
  const base = testEnv?.env?.KITSCH_BASE_URL;
  assert.ok(base !== undefined, 'app.json must pin KITSCH_BASE_URL rather than inherit one');
  assert.match(
    base,
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u,
    `app.json points Heroku CI at ${base}. The offline tier must run against the ` +
      'fixture; the live store is the nightly tier\'s job, on a runner that holds ' +
      'the credentials for it.',
  );
});

void test('the Heroku test environment keeps the dev dependencies it needs', () => {
  // Every dependency in this repo is a devDependency — there is no runtime.
  // Heroku's Node buildpack prunes devDependencies when NODE_ENV is
  // production, which would leave the test script with no typescript, no
  // eslint and no test runner, and the failure reads as a broken repo.
  assert.equal(testEnv?.env?.NODE_ENV, 'test');
  assert.equal(testEnv?.env?.NPM_CONFIG_PRODUCTION, 'false');
});

void test('app.json declares no dyno formation', () => {
  // This is a test harness: it runs, reports and exits. A `formation` block
  // would make it a long-running app and start billing for a dyno that has
  // nothing to serve — and the first Heroku attempt failed precisely because
  // somebody reasonably expected this repo to be deployable.
  assert.equal(app.formation, undefined);
});
