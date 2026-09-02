import { readFileSync } from 'node:fs';

import { isProductTask, needsHandle, parseTask } from '../web/lib/translation-backlog.js';
import { describeBuild } from './lib/build-stamp.js';

/**
 * Why the backlog audit sees the tasks it sees.
 *
 *   npm run asana:doctor
 *
 * The audit prints two numbers — "100 open task(s)" and "product tasks 3" —
 * and that pair has now been misread three times running. Both are true. What
 * they do not say is WHICH of the several possible causes produced them, and
 * without that the next step is a guess:
 *
 *   • the export was truncated at one page
 *   • the export holds the whole project rather than the translation board
 *   • the tasks are there but their notes carry no product handle
 *   • the tool that wrote the export predates the fix for any of the above
 *
 * This reads the export and says which. It makes no network calls and needs no
 * credentials, so it costs nothing to run before spending twenty minutes on a
 * live audit.
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const flags = new Map<string, string>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(token.slice(2), next);
      i += 1;
    }
  }
}

const path = flags.get('tasks') ?? 'data/asana/translation-tasks.json';

write('');
write('Asana export — doctor');
write('');
write(`  build    ${describeBuild()}`);
write(`  export   ${path}`);

type Raw = { readonly gid: string; readonly name: string; readonly notes?: string };

let parsedFile: { readonly captured?: string; readonly source?: string; readonly tasks: readonly Raw[] };
try {
  parsedFile = JSON.parse(readFileSync(path, 'utf8')) as typeof parsedFile;
} catch (cause) {
  write('');
  write(`  MISSING  cannot read ${path}`);
  write('           Run:  npm run asana:pull -- --project <gid>');
  write(`           (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)})`);
  write('');
  process.exit(2);
}

const tasks = parsedFile.tasks;
write(`  captured ${parsedFile.captured ?? 'unknown'}`);
write(`  source   ${parsedFile.source ?? 'unknown'}`);
write('');

const named = tasks.filter((task) => /translate/iu.test(task.name));
const parsed = named.map((task) => parseTask(task.gid, task.name, task.notes ?? ''));
const withHandle = parsed.filter(isProductTask);
const without = parsed.filter(needsHandle);

write(`  tasks in export            ${String(tasks.length)}`);
write(`  name a translation         ${String(named.length)}`);
write(`  ...and carry a handle      ${String(withHandle.length)}   ← the audit checks these`);
write(`  ...with no product handle  ${String(without.length)}`);
write('');

let problems = 0;

// ── 1. Truncation ────────────────────────────────────────────────────────
//
// A count equal to a page size is never a count. Asana's page maximum is 100,
// so exactly 100 is the signature of a single unpaginated request.
if (tasks.length === 100) {
  problems += 1;
  write('  TRUNCATED   the export holds exactly 100 tasks, which is Asana\'s page');
  write('              maximum. That is the signature of one unpaginated request,');
  write('              not a board that happens to have 100 tasks in it.');
  write('');
  write('              The pull follows next_page as of commit 8ed9c2f. If this');
  write('              export still stops at 100, it was written by an older build —');
  write('              git pull, then re-run asana:pull.');
  write('');
}

// ── 2. The export is the wrong thing ─────────────────────────────────────
if (named.length < tasks.length / 2 && tasks.length > 10) {
  problems += 1;
  write(`  WRONG SET   ${String(tasks.length - named.length)} of ${String(tasks.length)} tasks are not translation tasks.`);
  write('              This export is a slice of a whole project, not the translation');
  write('              board. As of commit 8ed9c2f the pull writes only translation');
  write('              tasks, so an export like this predates it.');
  write('');
}

// ── 3. Notes without a handle ────────────────────────────────────────────
//
// The real failure this distinguishes: tasks present but unparseable, versus
// tasks absent entirely. They look identical in the audit's summary.
if (without.length > 0) {
  problems += 1;
  write(`  NO HANDLE   ${String(without.length)} translation task(s) carry no product handle in their notes.`);
  write('              These are IN the export and cannot be checked. The auto-created');
  write('              tasks carry a "Product handle:" line; hand-written ones often do');
  write('              not. First three:');
  for (const task of without.slice(0, 3)) {
    write(`                ${task.name.slice(0, 68)}`);
  }
  write('');
}

if (withHandle.length > 0) {
  write('  checkable, first five:');
  for (const task of withHandle.slice(0, 5)) {
    write(`    ${task.handle?.padEnd(46) ?? ''} ${task.locales.join(' ')}`);
  }
  write('');
}

if (problems === 0 && withHandle.length > 0) {
  write(`  healthy — ${String(withHandle.length)} task(s) will be checked against the store.`);
  write('');
} else if (problems === 0) {
  write('  The export parses cleanly but contains nothing to check.');
  write('');
}

process.exit(problems > 0 ? 1 : 0);
