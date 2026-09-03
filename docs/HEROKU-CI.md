# Heroku CI

`app.json` configures Heroku CI. JSON holds no comments, so the reasoning is here.

## What it runs

```
npm run ci:offline
```

The whole offline tier, in cost order so a cheap failure surfaces first:

| stage | what it proves |
|---|---|
| `npm run precommit` | TypeScript, ESLint with the four Kitsch rules, reviewer + bugbot, unit tests |
| `parity:clean` | the locale gate passes against a clean catalogue |
| `test:i18n`, `test:kits` | the fixture storefront renders correctly in every locale |
| seven `*-detection` runs | each suite still FAILS against a known-broken fixture |

The detection controls are the reason any of this is evidence. A tier that runs
the suites and skips the controls reports green from checks nobody has shown can
go red.

`ci:offline` composes `npm run precommit` rather than restating typecheck,
eslint, reviewer and unit tests. One definition of the static gate, shared by
the local hook, the GitHub `guardrails` job and Heroku.

## How the browser gets there

`npx playwright install --with-deps chromium` cannot work on a dyno: the
`--with-deps` half shells out to apt-get and there is no root. So it is split.

- **`Aptfile` + `heroku-community/apt`** installs the shared libraries at build
  time. The list is Playwright's own, read out of `playwright-core`'s bundle
  rather than copied from a blog post, and `ci-parity.test.ts` fails if the two
  drift. Heroku-24 is Ubuntu 24.04, so the `t64` package names are the correct
  ones — the pre-t64 names do not resolve there at all.
- **`test-setup`** then runs `npx playwright install chromium`, which only
  downloads the browser.
- **`PLAYWRIGHT_BROWSERS_PATH=0`** puts it under `node_modules` so the path is
  stable between the setup and test steps.

Fonts are in the Aptfile too, though Playwright does not list them: its own CI
image already has them and a dyno does not. Without them Chromium falls back to
whatever it can find, text metrics shift, and rendered-page assertions become a
coin flip.

## What still does not run here

| tier | why not |
|---|---|
| visual regression | baselines live in `visual/baselines/fixture-linux/` and were blessed on a different Linux image. A Heroku dyno would diff against someone else's font rendering and report a layout regression that is nothing of the kind. Adding it means blessing a second baseline set from a Heroku run and maintaining both — a decision, not an oversight. |
| nightly audits | need `SHOPIFY_ADMIN_READONLY_TOKEN` and the live storefront |
| release gate | needs the live storefront |

Those stay on GitHub Actions, which already holds the credentials.

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
