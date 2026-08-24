import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Negative control for the translation-backlog audit.
 *
 * Every verdict this tool can reach is exercised against a fixture that serves
 * a known answer, because the consequence of a wrong verdict is asymmetric: a
 * false "closeable" closes an Asana task on translation work that was never
 * done, and nobody finds out until a customer sees English copy in Spanish.
 *
 *   npm run test:translation-backlog-detection
 */

const PORT = 4201;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const REPORT = 'translation-backlog-report/verify';

/** handle -> the verdict the fixture is built to produce. */
const EXPECTED: Readonly<Record<string, string>> = {
  'fully-translated': 'closeable',
  'not-translated': 'still_open',
  'half-translated': 'partial',
  // Translated title, English description. The case the field-level comparison
  // exists for: one merged blob would call this done.
  'title-only-translated': 'still_open',
  'gone-product': 'stale_product',
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const startFixture = async (): Promise<ChildProcess> => {
  const already = await fetch(`${BASE}/`)
    .then(() => true)
    .catch(() => false);
  if (already) {
    throw new Error(
      `${BASE} is already serving. A leftover fixture may be running stale code, so ` +
        "nothing measured against it would mean anything. Stop it: pkill -f 'translation-backlog/server.ts'",
    );
  }
  const child = spawn('npx', ['tsx', 'fixtures/translation-backlog/server.ts'], {
    env: { ...process.env, KITSCH_BACKLOG_PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(250);
    const ok = await fetch(`${BASE}/`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return child;
  }
  child.kill('SIGKILL');
  throw new Error(`fixture did not come up on ${BASE}`);
};

type Report = {
  readonly results: readonly { readonly task: { readonly handle: string }; readonly verdict: string }[];
  readonly unresolved: readonly { readonly name: string }[];
};

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const fixture = await startFixture();
try {
  await new Promise<void>((resolve) => {
    const child = spawn(
      'npx',
      [
        'tsx',
        'tools/translation-backlog-audit.ts',
        '--base-url',
        BASE,
        '--tasks',
        'fixtures/translation-backlog/tasks.json',
        '--out',
        REPORT,
      ],
      { stdio: 'ignore', env: process.env },
    );
    child.on('exit', () => {
      resolve();
    });
  });
} finally {
  fixture.kill('SIGKILL');
  await wait(300);
}

const report = JSON.parse(readFileSync(`${REPORT}/report.json`, 'utf8')) as Report;
let failures = 0;

write('');
write('Translation backlog — detection control');
write('');

for (const [handle, expected] of Object.entries(EXPECTED)) {
  const actual = report.results.find((result) => result.task.handle === handle)?.verdict;
  if (actual === expected) write(`  correct   ${expected.padEnd(14)} ${handle}`);
  else {
    failures += 1;
    write(`  WRONG     expected ${expected.padEnd(14)} got ${String(actual)}   ${handle}`);
  }
}

// A translation task with no product link must be surfaced, not dropped.
if (report.unresolved.length === 1) write('  correct   reported a task with no product URL');
else {
  failures += 1;
  write(`  WRONG     expected 1 task with no product URL, got ${String(report.unresolved.length)}`);
}

write('');
write(
  `  verdicts checked ${String(Object.keys(EXPECTED).length + 1)} | ` +
    `correct ${String(Object.keys(EXPECTED).length + 1 - failures)}`,
);

if (failures > 0) {
  write('');
  write(`  detection: FAILED — ${String(failures)} wrong verdict(s)`);
  write('  A wrong verdict here closes an Asana task on work that was never done.');
  process.exit(1);
}
write('');
write('  detection: verified — every verdict matches a known fixture state.');
