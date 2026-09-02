import { readFileSync } from 'node:fs';

import { describeBuild } from './lib/build-stamp.js';

/**
 * Closes the translation tasks the audit proved are done.
 *
 * The backlog audit already decides this — `closeable` means every locale the
 * task named now shows localized copy. What it deliberately never did was act
 * on it, and the report says so in as many words: "Closing them is a person's
 * decision, not this tool's — it changes nothing in Asana." This is that
 * decision, made once, in a command somebody has to type.
 *
 *   npm run asana:close                 dry run — prints what it WOULD close
 *   npm run asana:close -- --confirm    actually closes them
 *
 * ── Why dry-run is the default ───────────────────────────────────────────
 * Closing somebody's task is outward-facing: it notifies watchers, it moves
 * work off a board other people are planning against, and undoing it is not
 * the same as never having done it. A flag is cheap; a hundred spurious
 * completion emails is not.
 *
 * ── What it refuses to close, and why ────────────────────────────────────
 *   partial        some locales still English. The work is not done.
 *   still_open     nothing has changed.
 *   unverified     we could not check. "Could not check" is never "passed" —
 *                  that distinction is the reason this repository exists.
 *   stale_product  the product 404s. The task outlived its subject, which is a
 *                  real thing to resolve and NOT the thing this task asked
 *                  for. Closing it as done would record a translation that
 *                  never happened. A person decides those.
 *
 * Only `closeable` is ever touched.
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const argv = process.argv.slice(2);
const confirm = argv.includes('--confirm');
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const reportPath = flag('--report') ?? 'translation-backlog-report/report.json';

type Report = {
  readonly target?: string;
  readonly results?: readonly {
    readonly task: { readonly gid: string; readonly name: string };
    readonly verdict: string;
    readonly note: string;
  }[];
};

let report: Report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
} catch {
  write('');
  write(`  No audit result at ${reportPath}.`);
  write('');
  write('  Nothing is closed on the strength of a report that was not read.');
  write('  Produce one first:');
  write('');
  write('    npm run audit:translation-backlog -- --base-url https://www.mykitsch.com \\');
  write('      --tasks data/asana/translation-tasks.json');
  write('');
  process.exit(2);
}

const results = report.results ?? [];
if (results.length === 0) {
  write('');
  write(`  ${reportPath} contains no results, so there is nothing to act on.`);
  write('');
  process.exit(2);
}

/**
 * A result about the fixture must never close a real task.
 *
 * The audit refuses to default to a fixture for this reason; this is the same
 * guard one step later, because a report file can be carried anywhere and this
 * tool has no idea how it was produced beyond what it says.
 */
const target = report.target ?? '';
if (/127\.0\.0\.1|localhost|\[::1\]/u.test(target)) {
  write('');
  write(`  That report was produced against ${target} — a local fixture.`);
  write('');
  write('  Refusing to close real Asana tasks on the strength of a fixture run.');
  write('  Re-run the audit against the storefront first.');
  write('');
  process.exit(2);
}

const closeable = results.filter((entry) => entry.verdict === 'closeable');
const held = results.filter((entry) => entry.verdict !== 'closeable');

write('');
write('Asana — close verified translation tasks');
write('');
write(`  build    ${describeBuild()}`);
write('');
write(`  report   ${reportPath}`);
write(`  target   ${target === '' ? '(not recorded)' : target}`);
write(`  closeable ${String(closeable.length)} of ${String(results.length)}`);
write('');

for (const entry of held) {
  write(`  keep     ${entry.task.name}`);
  write(`           ${entry.verdict} — ${entry.note}`);
}
if (held.length > 0) write('');

if (closeable.length === 0) {
  write('  Nothing to close. Every task still has work in it.');
  write('');
  process.exit(0);
}

for (const entry of closeable) {
  write(`  close    ${entry.task.name}  (${entry.task.gid})`);
  write(`           ${entry.note}`);
}
write('');

if (!confirm) {
  write('  DRY RUN — nothing was changed in Asana.');
  write('');
  write('  Read the list above. Closing a task notifies its watchers and moves');
  write('  work off a board other people plan against, so it is a deliberate act:');
  write('');
  write('    npm run asana:close -- --confirm');
  write('');
  process.exit(0);
}

const token = process.env.ASANA_TOKEN ?? '';
if (token === '') {
  write('  No ASANA_TOKEN, so nothing was closed. See npm run asana:pull for how');
  write('  to set one.');
  write('');
  process.exit(2);
}

let closed = 0;
let failed = 0;
for (const entry of closeable) {
  const response = await fetch(`https://app.asana.com/api/1.0/tasks/${entry.task.gid}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data: { completed: true } }),
  }).catch(() => undefined);

  if (response?.ok === true) {
    closed += 1;
    write(`  closed   ${entry.task.name}`);
  } else {
    failed += 1;
    const detail = response === undefined ? 'no response' : `HTTP ${String(response.status)}`;
    write(`  FAILED   ${entry.task.name} — ${detail}`);
  }
}

write('');
write(`  closed ${String(closed)} | failed ${String(failed)}`);
write('');

// A partial close is not a success. Somebody has to know which ones are still
// open, or the next run will try again and the board will drift.
process.exitCode = failed > 0 ? 1 : 0;
