# Heroku CI

`app.json` configures Heroku CI. JSON holds no comments, so the reasoning is here.

## What it runs

```
npm run precommit
```

Four offline gates: TypeScript, ESLint (including the four Kitsch rules), the
reviewer + bugbot pass, and the unit tests. Around 25 seconds. It is the same
command the pre-commit hook runs locally and the same command the `guardrails`
job runs in GitHub Actions — pinned to each other by
`tools/lib/ci-parity.test.ts`, because a CI gate that checks something
different from the local one teaches people the local one is decorative.

## What it does not run, and why

Everything that needs a browser or the live store:

| tier | what it needs | where it runs |
|---|---|---|
| detection controls | Chromium | GitHub Actions, every push |
| nightly audits | Chromium + `SHOPIFY_ADMIN_READONLY_TOKEN` | GitHub Actions, 03:00 UTC |
| release gate | Chromium + live storefront | GitHub Actions, on tags |

Heroku dynos have no root, so `npx playwright install --with-deps chromium`
cannot install the system libraries Chromium links against. Getting browsers
onto a Heroku CI dyno means an `Aptfile` and the community apt buildpack,
maintained by hand against Playwright's dependency list. GitHub Actions
installs the same browser in one line and is already running these tiers, so
duplicating them here would buy nothing and add a second place for the browser
version to drift.

That split is the point rather than a limitation: Heroku CI answers "did this
commit break the harness?" in under a minute on every push, and GitHub Actions
answers "is the store still correct?" on a schedule, holding the credentials
that question needs.

## Settings that are not cosmetic

**`KITSCH_BASE_URL` is pinned to `http://127.0.0.1:4173`.** The suites read this
to decide fixture-or-live: unset or a loopback address means fixtures. Values in
`environments.test.env` take precedence over pipeline-level config vars, so
pinning it here means a Heroku CI run cannot be pointed at the live store by
someone adding a config var to the pipeline. README §9.2 — production is
read-only, always — is a property this file enforces, not a note.

**`NODE_ENV=test` and `NPM_CONFIG_PRODUCTION=false`.** Every dependency in this
repo is a `devDependency`; there is no runtime. Heroku's Node buildpack prunes
devDependencies when `NODE_ENV` is `production`, which would leave the test
script with no TypeScript, no ESLint and no test runner. The resulting failure
reads as a broken repository rather than a misconfigured build.

**No `formation` block.** This repo runs, reports and exits. A formation would
make it a long-running app and bill for a dyno with nothing to serve. The first
Heroku attempt failed at buildpack detection precisely because the repo looks,
from the outside, like something you deploy.

**No TAP.** Heroku CI offers TAP output for richer failure reporting, and the
Node test runner can emit it. It is off because `npm run precommit` is not one
test run: it is four gates, only one of which is a test runner. Emitting TAP
would report the unit tests in detail and render the other three — including
the lint rules that catch a spec targeting production — as a single opaque
line.

## Prerequisite

Heroku CI reads `app.json` from the **default branch**. `main` carried only
`README.md` for the life of this repository, which is the same reason the five
committed GitHub Actions workflows have never fired on their schedules: GitHub
runs `schedule:` triggers from the default branch only. Both systems needed the
same fix — the code has to be on `main`.
