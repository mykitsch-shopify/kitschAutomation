import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadVisualConfig, shotName, shotsFor } from './visual.js';

/**
 * The config loader is where a visual suite quietly stops checking anything,
 * so every way it can do that is pinned here.
 */

const write = (body: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'kitsch-visual-')), 'visual.yaml');
  writeFileSync(path, body, 'utf8');
  return path;
};

const VALID = `
pages:
  - id: home
    path: /
    why: 'The page most traffic lands on.'
viewports:
  - id: mobile
    width: 390
    height: 844
masks:
  - selector: '[data-testid="promo-banner"]'
    why: 'Rotates on a timer.'
max_diff_ratio: 0.02
pixel_threshold: 0.2
`;

void test('a valid config loads', () => {
  const config = loadVisualConfig(write(VALID));
  assert.equal(config.pages.length, 1);
  assert.equal(config.viewports[0]?.width, 390);
  assert.equal(config.maxDiffRatio, 0.02);
});

void test('an empty page list is refused, not loaded', () => {
  // It would pass instantly, every time, having photographed nothing.
  assert.throws(
    () => loadVisualConfig(write(VALID.replace(/pages:[\s\S]*?viewports:/u, 'pages: []\nviewports:'))),
    /"pages" is empty/u,
  );
});

void test('an empty viewport list is refused', () => {
  assert.throws(
    () =>
      loadVisualConfig(
        write(VALID.replace(/viewports:[\s\S]*?masks:/u, 'viewports: []\nmasks:')),
      ),
    /"viewports" is empty/u,
  );
});

void test('a mask without a reason is refused', () => {
  // A mask is a declared blind spot. One added without a reason is
  // indistinguishable from one added to silence a failing check.
  assert.throws(
    () => loadVisualConfig(write(VALID.replace("    why: 'Rotates on a timer.'", ''))),
    /masks\[0\]\.why/u,
  );
});

void test('a threshold of 0 or 1 is refused, with the reason', () => {
  assert.throws(() => loadVisualConfig(write(VALID.replace('0.02', '0'))), /must sit between 0 and 1/u);
  assert.throws(() => loadVisualConfig(write(VALID.replace('0.02', '1'))), /nothing can fail/u);
});

void test('shot names are readable and stable', () => {
  // These are committed files a human reviews in a diff. A hash is not
  // reviewable.
  assert.equal(shotName('home', 'mobile'), 'home-mobile.png');
});

void test('every page is shot at every viewport', () => {
  const config = loadVisualConfig(
    write(
      VALID.replace(
        'viewports:\n  - id: mobile\n    width: 390\n    height: 844',
        'viewports:\n  - id: mobile\n    width: 390\n    height: 844\n  - id: desktop\n    width: 1280\n    height: 900',
      ),
    ),
  );
  assert.deepEqual(
    shotsFor(config).map((shot) => shot.name),
    ['home-mobile.png', 'home-desktop.png'],
  );
});
