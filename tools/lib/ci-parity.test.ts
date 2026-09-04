import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

const scripts = (
  JSON.parse(readFileSync('package.json', 'utf8')) as {
    readonly scripts?: Record<string, string>;
  }
).scripts;

void test('Heroku CI runs a script this repo actually defines', () => {
  const heroku = testEnv?.scripts?.test;
  assert.ok(heroku !== undefined, 'app.json declares no environments.test.scripts.test');
  const named = /^npm run ([\w:-]+)$/u.exec(heroku.trim())?.[1];
  assert.ok(
    named !== undefined && scripts?.[named] !== undefined,
    `app.json runs "${heroku}", which is not an npm script in package.json. ` +
      'Heroku would fail at the test step with "Missing script", after a full build.',
  );
});

void test('the Heroku tier covers the static gate, not a second copy of it', () => {
  // `ci:offline` composes `npm run precommit` rather than restating typecheck,
  // eslint, reviewer and unit tests. One definition of the static gate, used by
  // the local hook, the guardrails job and Heroku alike — restating it here
  // would be a fourth copy, and the last six drifts in this repository all
  // started as a second one.
  assert.match(scripts?.['ci:offline'] ?? '', /\bnpm run precommit\b/u);
  assert.ok(
    runsIn('guardrails').some((command) => command.trim() === 'npm run precommit'),
    'the guardrails job no longer runs npm run precommit, so the two CI systems ' +
      'have stopped sharing a definition of the static gate',
  );
});

void test('every detection control GitHub runs, Heroku runs too', () => {
  // The controls are the reason any of this is evidence: each proves its suite
  // still fails against a known-broken fixture. A CI tier that runs the suites
  // and skips the controls reports green from checks nobody has shown can go
  // red.
  const offline = scripts?.['ci:offline'] ?? '';
  const inWorkflow = [...runsIn('controls').join('\n').matchAll(/npm run ([\w:-]+-detection)/gu)].map(
    (match) => match[1] ?? '',
  );
  assert.ok(inWorkflow.length >= 5, `expected the controls job to run several; saw ${String(inWorkflow.length)}`);
  for (const control of inWorkflow) {
    assert.ok(offline.includes(control), `ci:offline does not run ${control}, but the controls job does`);
  }
});

void test('the Aptfile matches Playwright\'s own dependency list', () => {
  // Hand-maintained lists of shared libraries go stale silently: Chromium
  // gains a dependency, the dyno cannot launch it, and the failure surfaces as
  // a browser that will not start rather than as a missing package. So the
  // Aptfile is checked against the list inside the installed playwright-core
  // bundle — the same array `--with-deps` would install.
  //
  // Ubuntu 24.04 (which Heroku-24 is) renamed several of these with a t64
  // suffix during the 64-bit time_t transition; the pre-t64 names do not
  // resolve there at all.
  const bundle = readFileSync('node_modules/playwright-core/lib/coreBundle.js', 'utf8');
  const at = bundle.indexOf('libasound2t64');
  if (at === -1) return; // A future Playwright may reshape this; not a failure of ours.
  const slice = bundle.slice(at, at + 900);
  const wanted = `libasound2t64${slice.slice(13, slice.indexOf(']'))}`
    .replace(/["\s]/gu, '')
    .split(',')
    .filter((name) => name !== '');

  const declared = new Set(
    readFileSync('Aptfile', 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );

  const missing = wanted.filter((name) => !declared.has(name));
  assert.deepEqual(
    missing,
    [],
    'Aptfile is missing packages Playwright declares for ubuntu24.04 chromium. ' +
      'Chromium will install and then fail to launch on the dyno.',
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

void test('every CI runner uses a Node major this repo declares', () => {
  // `engines.node` was ">=22", and Heroku's build log said what that costs:
  //
  //   ! The requested Node.js version is using a wide range (>=22) that can
  //   ! resolve to a Node.js major version higher than you intended.
  //   ! The resolved Node.js version has been limited to the Active LTS (24.20.0)
  //
  // So Heroku ran 24 while every GitHub workflow pins 22, and neither number
  // was a decision anybody made. Both majors are known-good for the offline
  // gate — Heroku run #4 was green on 24.20.0, and Actions has been green on
  // 22 — so the range names both rather than pretending to one.
  //
  // What this test refuses is the silent version: a workflow moving to a major
  // package.json does not permit, or the range narrowing under a workflow
  // still pinned to the major it drops.
  const engines = JSON.parse(readFileSync('package.json', 'utf8')) as {
    readonly engines?: { readonly node?: string };
  };
  const declared = (engines.engines?.node ?? '')
    .split('||')
    .map((part) => part.trim().replace(/\.x$/u, ''));

  assert.ok(declared.length > 0 && declared[0] !== '', 'package.json must declare engines.node');
  assert.ok(
    !(engines.engines?.node ?? '').includes('>='),
    'engines.node must name majors, not an open range — Heroku silently clamps ">=" to Active LTS',
  );

  const workflows = readdirSync('.github/workflows').filter((name) => name.endsWith('.yml'));
  assert.ok(workflows.length > 0, 'no workflows found to check');

  for (const name of workflows) {
    const body = readFileSync(`.github/workflows/${name}`, 'utf8');
    for (const [, version] of body.matchAll(/node-version:\s*'?(\d+)/gu)) {
      assert.ok(
        declared.includes(version ?? ''),
        `${name} pins node-version ${version ?? '?'}, which engines.node ` +
          `("${engines.engines?.node ?? ''}") does not permit`,
      );
    }
  }
});

void test('app.json declares no dyno formation', () => {
  // This is a test harness: it runs, reports and exits. A `formation` block
  // would make it a long-running app and start billing for a dyno that has
  // nothing to serve — and the first Heroku attempt failed precisely because
  // somebody reasonably expected this repo to be deployable.
  assert.equal(app.formation, undefined);
});

void test('a workflow taking its target from a repo variable checks it arrived', () => {
  // `${{ vars.NAME }}` for a variable that does not exist resolves to an empty
  // string, and an empty KITSCH_BASE_URL is worse than a missing one: it is not
  // the fixture URL, so playwright.config.ts used to conclude it was pointed at
  // a real store, announce "results are evidence about this storefront", and
  // then fail 1,032 times on "Cannot navigate to invalid URL".
  //
  // The config refuses an empty value now. This pins the other half: a workflow
  // that sources the target from a repository variable must also verify one
  // arrived, so the failure costs seconds rather than six parallel jobs.
  const dir = '.github/workflows';
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const body = readFileSync(`${dir}/${name}`, 'utf8');
    if (!/KITSCH_BASE_URL:\s*\$\{\{\s*vars\./u.test(body)) continue;
    assert.match(
      body,
      /-z "\$\{KITSCH_BASE_URL\}"/u,
      `${name} takes KITSCH_BASE_URL from a repository variable but never checks that one ` +
        'arrived. An unset variable becomes an empty string and the run proves nothing.',
    );
  }
});
