import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { assertPortFree, killTree, spawnFixture, waitForFixture } from './lib/fixture-process.js';

/**
 * Negative control for the accessibility audit.
 *
 * Runs it against an accessible fixture and a broken one. The clean profile
 * must report nothing; the seeded profile must catch each planted defect,
 * including the two axe cannot express.
 *
 * An accessibility gate that has never been watched to fail is
 * indistinguishable from one whose scan silently stopped running — and the
 * second reports every market as accessible.
 *
 *   npm run test:a11y-detection
 */

const CONFIG = 'fixtures/a11y/config.yaml';
const REPORT = 'a11y-report/verify';

/** kind -> the market the fixture plants it in. */
const EXPECTED: readonly { readonly kind: string; readonly market: string; readonly why: string }[] = [
  {
    kind: 'html_lang_mismatch',
    market: 'DE',
    why: 'German page declaring lang="en" — passes every axe rule, unusable with a screen reader',
  },
  {
    kind: 'untranslated_alt',
    market: 'JP',
    why: 'image descriptions left in English, which is all a blind customer in Japan receives',
  },
  {
    kind: 'untranslated_aria_label',
    market: 'KR',
    why: 'control labels left in English',
  },
  {
    kind: 'wcag_violation',
    market: 'FR',
    why: 'an image with no alt attribute at all',
  },
  {
    kind: 'locale_only_violation',
    market: 'FR',
    why: 'a rule failing in one market and passing in the rest',
  },
];

const portFor = (profile: string): number => (profile === 'seeded' ? 4207 : 4206);

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const startFixture = async (profile: string): Promise<{ child: ChildProcess; base: string }> => {
  const base = `http://127.0.0.1:${String(portFor(profile))}`;
  await assertPortFree(base, '/__profile');
  const child = spawnFixture('fixtures/a11y/server.ts', {
    KITSCH_A11Y_PROFILE: profile,
    KITSCH_A11Y_PORT: String(portFor(profile)),
  });
  await waitForFixture(base, '/__profile', `(${profile})`, child);
  return { child, base };
};

type Report = {
  readonly findings: readonly {
    readonly kind: string;
    readonly market: string;
    readonly severity: string;
  }[];
};

const run = async (profile: string): Promise<Report> => {
  const { child: fixture, base } = await startFixture(profile);
  try {
    await new Promise<void>((resolve) => {
      const child = spawn(
        'npx',
        [
          'tsx',
          'tools/a11y-audit.ts',
          '--base-url',
          base,
          '--config',
          CONFIG,
          '--out',
          `${REPORT}/${profile}`,
        ],
        { stdio: 'ignore', env: process.env },
      );
      child.on('exit', () => {
        resolve();
      });
    });
  } finally {
    // The whole process group: SIGKILL to npx leaves the tsx grandchild
    // holding the port, which is what broke the release gate.
    killTree(fixture);
    await wait(300);
  }
  return JSON.parse(readFileSync(`${REPORT}/${profile}/report.json`, 'utf8')) as Report;
};

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
let failures = 0;

write('');
write('Accessibility — detection control');
write('');

const clean = await run('clean');
if (clean.findings.length === 0) {
  write('  clean profile   no findings in any market                    OK');
} else {
  failures += 1;
  write(`  clean profile   ${String(clean.findings.length)} unexpected finding(s)      FAILED`);
  for (const finding of clean.findings.slice(0, 8)) {
    write(`                    ${finding.kind} in ${finding.market}`);
  }
}

const seeded = await run('seeded');
write('');
for (const planted of EXPECTED) {
  const caught = seeded.findings.some(
    (finding) => finding.kind === planted.kind && finding.market.includes(planted.market),
  );
  if (caught) write(`  caught          ${planted.kind.padEnd(26)} ${planted.market}`);
  else {
    failures += 1;
    write(`  MISSED          ${planted.kind.padEnd(26)} ${planted.market}`);
    write(`                    planted: ${planted.why}`);
  }
}

write('');
write(
  `  planted ${String(EXPECTED.length)} | caught ${String(EXPECTED.length - failures)} | ` +
    `clean-run findings ${String(clean.findings.length)}`,
);

if (failures > 0) {
  write('');
  write(`  detection: FAILED — ${String(failures)} problem(s)`);
  write('  An accessibility defect this cannot see is one it reports every market as');
  write('  free of, in markets where the law says otherwise.');
  process.exit(1);
}
write('');
write('  detection: verified — accessible markets pass, broken ones fail by name.');
