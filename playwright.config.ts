import { defineConfig, devices } from '@playwright/test';

/**
 * Kitsch storefront — Playwright configuration.
 *
 * Project selection is weighted to real traffic (80% mobile / 18% desktop /
 * 2% other), not to convenience. PR runs execute the mobile projects only;
 * the desktop and real-device matrix runs nightly and at the launch gate.
 *
 * Tags:
 *   @smoke   — must pass on every PR
 *   @launch  — runs at the T-4h launch gate, blocking
 *   @i18n    — locale parity, render layer
 */

const isCI = process.env.CI !== undefined && process.env.CI !== '';

const fixturePort = process.env.KITSCH_FIXTURE_PORT ?? '4173';
const fixtureProfile = process.env.KITSCH_FIXTURE_PROFILE ?? 'clean';
const fixtureURL = `http://127.0.0.1:${fixturePort}`;

// Never default to production. A harness that can reach prod eventually will.
// Absent an explicit target, the local storefront fixture is the safe default:
// it is deterministic, it is offline, and it cannot take a real store's
// analytics or rate limits with it.
const baseURL = process.env.KITSCH_BASE_URL ?? fixtureURL;
const usingFixture = baseURL === fixtureURL;

/**
 * Escape hatch for images that ship a pre-baked Chromium whose build number
 * does not match the pinned @playwright/test version, and where downloading
 * the matching one is blocked. Set KITSCH_CHROMIUM_PATH to that binary.
 *
 * Applies to the Chromium-backed projects only. `desktop-edge` is deliberately
 * excluded: it pins `channel: 'msedge'`, and an executablePath override there
 * would quietly run Chromium while the report said Edge.
 *
 * Not a default: silently falling back to whatever browser is lying around
 * would mean the version we report as tested is not the version we tested.
 */
const chromiumPath = process.env.KITSCH_CHROMIUM_PATH;
const chromiumLaunch = chromiumPath === undefined ? {} : { launchOptions: { executablePath: chromiumPath } };

export default defineConfig({
  testDir: '.',
  testMatch: ['web/specs/**/*.spec.ts', 'i18n/specs/**/*.spec.ts'],

  timeout: 30_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: isCI,

  // One retry absorbs infrastructure noise. Two is a way of not fixing
  // flakiness — and on an async node it deletes an SLA-breach finding.
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : 2,

  reporter: isCI
    ? [['blob'], ['github'], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [
        ['html', { open: 'never' }],
        ['list'],
      ],

  use: {
    baseURL,
    testIdAttribute: 'data-testid',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    extraHTTPHeaders: {
      // Identifies harness traffic in Shopify/Constructor logs so analytics
      // and rate-limit investigations can exclude it.
      'X-Kitsch-QA': 'playwright',
    },
  },

  // Only started when we are actually testing the fixture. Pointed at a real
  // store, the harness must not silently boot a second storefront alongside it.
  ...(usingFixture
    ? {
        webServer: {
          command: 'npx tsx fixtures/storefront/server.ts',
          url: `${fixtureURL}/`,
          reuseExistingServer: !isCI,
          timeout: 30_000,
          env: {
            KITSCH_FIXTURE_PORT: fixturePort,
            KITSCH_FIXTURE_PROFILE: fixtureProfile,
          },
        },
      }
    : {}),

  projects: [
    // ── Tier 1: mobile web — 80% of traffic, runs on every PR ──────────
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },

    // ── Tier 2: desktop — nightly and pre-launch ──────────────────────
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'desktop-firefox',
      // Named in the Translations test plan §3. Under 1% of this store's
      // traffic, so it is nightly rather than on the PR gate — but it is in
      // the matrix, because "we don't test Firefox" and "Firefox is covered"
      // are different statements and only one of them is true.
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'desktop-edge',
      // Edge is a named requirement from the QA scorecard, and it is a
      // distinct channel rather than plain Chromium.
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },

    // ── Locale parity, render layer ───────────────────────────────────
    // Content-layer parity runs headless via `npm run i18n:parity`; this
    // project covers only what the DOM can show that the API cannot:
    // formatting, hreflang wiring, meta tags, encoding and layout overflow.
    //
    // Chromium at an explicit 390px rather than the iPhone descriptor, so the
    // locale suite runs anywhere a single browser is installed. WebKit
    // coverage of these same routes comes from the nightly `mobile-safari`
    // project — see the note at the foot of this file.
    {
      name: 'i18n-mobile',
      testMatch: 'i18n/specs/**/*.spec.ts',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        ...chromiumLaunch,
      },
    },
  ],

  outputDir: 'test-results',
});

/**
 * Real-device coverage (iOS Safari on hardware, Android Chrome on hardware)
 * runs through a separate config that sets `connectOptions.wsEndpoint` to the
 * cloud grid. Emulated `mobile-safari` is WebKit on Linux — close, but it is
 * not iOS Safari, and it must never be reported as real-device coverage.
 */
