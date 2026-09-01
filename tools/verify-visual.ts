import { existsSync, readdirSync } from 'node:fs';

import { loadVisualConfig, shotsFor } from '../visual/lib/visual.js';
import { runSync } from './lib/run.js';

/**
 * Negative control for visual regression.
 *
 * A screenshot suite is the easiest check in this repository to fool yourself
 * with. It passes when the baselines match, and baselines match most reliably
 * when nobody has looked at them — a re-blessed baseline is a check that has
 * been taught to agree with whatever it sees, and it goes on reporting green
 * forever.
 *
 * So this asks three questions the suite cannot answer about itself:
 *
 *   1. Are there baselines at all? A suite with none passes by writing them on
 *      the spot, which is a photograph, not a comparison.
 *   2. Is every configured shot actually blessed? A page added to the config
 *      and never blessed passes the same way.
 *   3. Does a real visual change fail? The seeded storefront profile shifts the
 *      German layout past the 390px viewport — a genuine, visible defect — and
 *      a comparison that cannot see that cannot see anything.
 *
 *   npm run visual:detection
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const PORT = '4196';
const config = loadVisualConfig();
const expected = shotsFor(config);

write('');
write('Visual regression — detection control');
write('');

let broken = 0;

// ── 1 & 2. Baselines exist, and cover every configured shot ──────────────
//
// Checked before anything is run, because both failures make the suite pass.
// Only the fixture baselines.
//
// A `live-*` directory is a photograph of mykitsch.com, blessed by somebody at
// a particular moment in the merchandising calendar. It is not this control's
// to judge: demanding that it hold every configured shot would fail the gate
// because a person had blessed four pages on a laptop and not the fifth, and
// that says nothing about whether the comparison works.
const roots = existsSync('visual/baselines')
  ? readdirSync('visual/baselines', { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('fixture-'))
      .map((entry) => entry.name)
  : [];

if (roots.length === 0) {
  broken += 1;
  write('  NO BASELINES   visual/baselines/ holds nothing.');
  write('');
  write('  With no baseline, `toHaveScreenshot` writes one and reports a pass.');
  write('  That is a photograph, not a comparison, and it would go on passing');
  write('  every morning while the page changed underneath it.');
  write('');
  write('    npm run visual:bless      then READ THE DIFF before committing');
  write('');
} else {
  for (const root of roots) {
    const held = new Set(readdirSync(`visual/baselines/${root}`));
    const missing = expected.filter((shot) => !held.has(shot.name));
    if (missing.length > 0) {
      broken += 1;
      write(`  INCOMPLETE     visual/baselines/${root}`);
      for (const shot of missing) {
        write(`                 no baseline for ${shot.name}  (${shot.page.why})`);
      }
      write('                 Each of these would pass by writing itself.');
    } else {
      write(`  complete       visual/baselines/${root}  (${String(held.size)} baselines)`);
    }
  }
  write('');
}

// ── 3. A real visual change must fail ────────────────────────────────────
//
// Only worth running if baselines exist: against none, this would "fail"
// because every shot is new, which proves nothing about the comparison.
if (roots.length > 0) {
  const result = runSync(
    'npx',
    ['playwright', 'test', '--project=visual', '--reporter=line'],
    {
      env: {
        KITSCH_FIXTURE_PROFILE: 'seeded',
        KITSCH_FIXTURE_PORT: PORT,
        KITSCH_BASE_URL: `http://127.0.0.1:${PORT}`,
      },
    },
  );

  if (result.notRun !== undefined) {
    broken += 1;
    write(`  COULD NOT RUN  ${result.notRun}`);
  } else if (result.status === 0) {
    broken += 1;
    write('  MISSED         the suite passed against the seeded storefront, whose');
    write('                 German layout overflows a 390px viewport. A visible');
    write('                 defect went unseen, so the comparison is not comparing.');
    write('');
    write('                 Usual cause: max_diff_ratio in config/visual.yaml is');
    write('                 wide enough to swallow a real change, or a mask covers');
    write('                 the region that moved.');
  } else {
    write('  caught         a seeded layout defect failed the comparison, as it must');
  }
  write('');
}

if (broken > 0) {
  write('  detection: FAILED');
  write('');
  write('  A visual suite that cannot fail reports a green screenshot of a broken');
  write('  page. It is the one check here that looks most like evidence and is');
  write('  easiest to hollow out, so this is treated as harness-critical.');
  write('');
  process.exit(1);
}

write('  detection: verified — baselines cover every configured shot, and a real');
write('  visual change fails the comparison.');
write('');
