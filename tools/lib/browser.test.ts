import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BROWSER_NAMES,
  describeLaunch,
  readLaunchOptions,
  resolveBrowserName,
} from './browser.js';

const opts = (
  flags: Record<string, string> = {},
  bare: readonly string[] = [],
): ReturnType<typeof readLaunchOptions> =>
  readLaunchOptions(new Map(Object.entries(flags)), new Set(bare));

void test('resolveBrowserName: accepts the documented set, case and space insensitively', () => {
  for (const name of BROWSER_NAMES) {
    assert.equal(resolveBrowserName(name), name);
    assert.equal(resolveBrowserName(name.toUpperCase()), name);
    assert.equal(resolveBrowserName(`  ${name}  `), name);
  }
});

void test('resolveBrowserName: rejects anything else rather than falling back', () => {
  // "safari" is the trap: it is what a person types for WebKit, and silently
  // defaulting it to chromium would report a Chromium run as a Safari one.
  for (const value of ['safari', 'msedge', 'ie', '', 'chrom']) {
    assert.equal(resolveBrowserName(value), undefined, `expected undefined for "${value}"`);
  }
});

void test('readLaunchOptions: headless desktop chromium is the default', () => {
  // The default has to be safe to run unattended. A headed default fails on any
  // machine without a display, and that reads as a broken check.
  const options = opts();
  assert.equal(options.browserName, 'chromium');
  assert.equal(options.headed, false);
  assert.equal(options.slowMo, 0);
  assert.deepEqual(options.viewport, { width: 1440, height: 900 });
});

void test('readLaunchOptions: --headed opts in explicitly', () => {
  assert.equal(opts({}, ['headed']).headed, true);
});

void test('readLaunchOptions: an unknown browser throws and names the valid set', () => {
  assert.throws(() => opts({ browser: 'safari' }), /Unknown browser "safari"/u);
  assert.throws(() => opts({ browser: 'safari' }), /chromium, firefox, webkit, chrome, edge/u);
});

void test('readLaunchOptions: a viewport is parsed, and nonsense falls back to the default', () => {
  assert.deepEqual(opts({ viewport: '1280x720' }).viewport, { width: 1280, height: 720 });
  // Falling back rather than throwing: a mistyped viewport should not stop a
  // scheduled run, and the resolved size is printed either way.
  for (const value of ['wide', '1280', '1280*720', '12x12', '']) {
    assert.deepEqual(
      opts({ viewport: value }).viewport,
      { width: 1440, height: 900 },
      `expected the default for "${value}"`,
    );
  }
});

void test('readLaunchOptions: slow-mo takes positive numbers only', () => {
  assert.equal(opts({ 'slow-mo': '250' }).slowMo, 250);
  for (const value of ['0', '-5', 'fast', '']) {
    assert.equal(opts({ 'slow-mo': value }).slowMo, 0, `expected 0 for "${value}"`);
  }
});

void test('readLaunchOptions: flags win over environment', () => {
  process.env.KITSCH_BROWSER = 'firefox';
  try {
    assert.equal(opts({ browser: 'webkit' }).browserName, 'webkit');
    assert.equal(opts().browserName, 'firefox');
  } finally {
    delete process.env.KITSCH_BROWSER;
  }
});

void test('describeLaunch: names browser, mode and size so a report is never ambiguous', () => {
  assert.equal(describeLaunch(opts()), 'chromium headless 1440x900');
  assert.equal(
    describeLaunch(opts({ browser: 'firefox', viewport: '1280x720', 'slow-mo': '150' }, ['headed'])),
    'firefox headed 1280x720 slowMo=150ms',
  );
});
