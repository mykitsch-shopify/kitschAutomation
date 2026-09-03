import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config.js';

/**
 * Real-device coverage — cloud grid (BrowserStack Automate or LambdaTest).
 *
 * This is the **only** config whose results may be reported as real-device
 * coverage. Emulated `mobile-safari` in the main config is WebKit on Linux:
 * close to iOS Safari, and not iOS Safari. A green run there says nothing
 * about an actual iPhone, and reporting it as though it did is how a coverage
 * claim quietly becomes false.
 *
 *   GRID_WS_ENDPOINT=wss://... npx playwright test --config=playwright.grid.config.ts --grep @smoke
 *
 * Blocked on the device-farm budget decision — framework proposal §12.6.
 */

const wsEndpoint = process.env.GRID_WS_ENDPOINT;

if (wsEndpoint === undefined || wsEndpoint === '') {
  // Fail loudly at load time. A grid config that silently falls back to local
  // browsers would report emulated runs as hardware runs, which is the one
  // thing this file exists to prevent.
  throw new Error(
    'GRID_WS_ENDPOINT is not set. Refusing to run the real-device config against local browsers — ' +
      'the results would be reported as real-device coverage and would not be.',
  );
}

const gridCapabilities = (device: string, os: string, osVersion: string): string =>
  JSON.stringify({
    'browserstack.username': process.env.BROWSERSTACK_USERNAME,
    'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
    project: 'kitsch-storefront',
    build: process.env.GITHUB_RUN_ID ?? 'local',
    name: `${device} ${os} ${osVersion}`,
    deviceName: device,
    osVersion,
    realMobile: 'true',
  });

const connect = (device: string, os: string, osVersion: string) => ({
  wsEndpoint: `${wsEndpoint}?caps=${encodeURIComponent(gridCapabilities(device, os, osVersion))}`,
});

// The fixture storefront is local to the runner and unreachable from a cloud
// device, so the inherited webServer block is dropped rather than overridden.
const { webServer, ...baseConfig } = base;
void webServer;

export default defineConfig({
  ...baseConfig,

  // Hardware is slower than a container, and a shared grid queues.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 1,

  reporter: [
    ['blob'],
    ['junit', { outputFile: 'test-results/junit-grid.xml' }],
    ['list'],
  ],

  projects: [
    {
      name: 'ios-safari-real',
      use: { ...devices['iPhone 14'], connectOptions: connect('iPhone 14', 'ios', '17') },
    },
    {
      name: 'android-chrome-real',
      use: { ...devices['Pixel 7'], connectOptions: connect('Google Pixel 7', 'android', '14') },
    },
    {
      name: 'android-lowend-real',
      // One low-end device on purpose: layout overflow from long German
      // strings shows up on a small, slow screen first.
      use: { ...devices['Galaxy S9+'], connectOptions: connect('Samsung Galaxy A51', 'android', '11') },
    },
  ],
});
