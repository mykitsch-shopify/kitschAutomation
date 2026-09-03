import { describeBuild } from './lib/build-stamp.js';

/**
 * Reopens tasks this account closed in a given window.
 *
 * The undo for `asana:close`. It exists because the undo was needed: on
 * 2026-09-03, between 10:24:45Z and 10:27:11Z, `asana:close` completed 116
 * translation tasks in the backlog project. Every one of them was assigned to a
 * colleague. The audit's verdicts were sound — the translations really were
 * live in all four markets — but "the work is done" and "this task is mine to
 * close" are different claims, and only the first had been checked.
 *
 *   npm run asana:reopen -- --project <gid> \
 *     --closed-after 2026-09-03T10:24:00Z --closed-before 2026-09-03T10:28:00Z
 *
 *   ...and again with --confirm to actually reopen them.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 *   Reopen a task somebody else completed. Only completions by this token's
 *   own user are candidates. Undoing your own mistake is a correction; undoing
 *   a colleague's deliberate act is a second mistake.
 *
 *   Run without a window. There is no "reopen everything" — a bounded time
 *   range is required, because the blast radius of this command should be a
 *   decision rather than a default.
 *
 *   Reopen silently. Every task it touches is named before it is touched.
 *
 * Reopening does not erase the history. Asana keeps "Dinesh marked this
 * complete" in the task's activity feed, and it should: the record of what
 * happened is not the damage, and hiding it would be.
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

const project = flag('--project') ?? process.env.ASANA_PROJECT ?? '';
const after = flag('--closed-after');
const before = flag('--closed-before');
const onlyAssignee = flag('--assignee');

write('');
write('Asana — reopen tasks closed in error');
write('');
write(`  build    ${describeBuild()}`);
write('');

if (project === '' || after === undefined || before === undefined) {
  write('  Needs a project and a bounded window:');
  write('');
  write('    npm run asana:reopen -- --project <gid> \\');
  write('      --closed-after 2026-09-03T10:24:00Z --closed-before 2026-09-03T10:28:00Z');
  write('');
  write('  The window is required. A command that reopens "everything closed"');
  write('  has no safe default, and this one is reached for in a hurry.');
  write('');
  process.exit(2);
}

const token = process.env.ASANA_TOKEN ?? '';
if (token === '') {
  write('  No ASANA_TOKEN. See npm run asana:pull for how to set one.');
  write('');
  process.exit(2);
}

const api = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${path}`);
  return response.json();
};

type User = { readonly data?: { readonly gid?: string; readonly name?: string } };
type Task = {
  readonly gid: string;
  readonly name: string;
  readonly completed_at?: string | null;
  readonly completed_by?: { readonly gid?: string } | null;
  readonly assignee?: { readonly name?: string } | null;
};

const me = (await api('/users/me?opt_fields=gid,name')) as User;
const myGid = me.data?.gid ?? '';
if (myGid === '') {
  write('  Could not identify this token\'s user, so "closed by me" cannot be');
  write('  decided. Nothing was changed.');
  write('');
  process.exit(2);
}
write(`  acting as ${me.data?.name ?? myGid}`);
write(`  project   ${project}`);
write(`  window    ${after} .. ${before}`);
write('');

const fields = 'gid,name,completed_at,completed_by.gid,assignee.name';
const found = (await api(
  `/tasks/search?project=${encodeURIComponent(project)}` +
    `&completed=true&completed_at.after=${encodeURIComponent(after)}` +
    `&completed_at.before=${encodeURIComponent(before)}` +
    `&opt_fields=${fields}&limit=100`,
)) as { readonly data?: readonly Task[] };

const inWindow = found.data ?? [];
// Only our own completions, and only the assignee asked for when one was named.
const mine = inWindow.filter((task) => task.completed_by?.gid === myGid);
const targets =
  onlyAssignee === undefined
    ? mine
    : mine.filter(
        (task) =>
          (task.assignee?.name ?? '').trim().toLowerCase() === onlyAssignee.trim().toLowerCase(),
      );

const theirs = inWindow.length - mine.length;
if (theirs > 0) {
  write(`  leaving   ${String(theirs)} task(s) closed by somebody else, untouched`);
  write('');
}

if (targets.length === 0) {
  write('  Nothing in that window was closed by this account. Nothing to undo.');
  write('');
  process.exit(0);
}

const byAssignee = new Map<string, number>();
for (const task of targets) {
  const who = task.assignee?.name ?? '(unassigned)';
  byAssignee.set(who, (byAssignee.get(who) ?? 0) + 1);
}

for (const task of targets) {
  write(`  reopen   ${task.name}`);
  write(`           assigned to ${task.assignee?.name ?? '(nobody)'}, closed ${task.completed_at ?? '?'}`);
}
write('');
write(`  ${String(targets.length)} task(s), by assignee:`);
for (const [who, count] of [...byAssignee].sort((a, b) => b[1] - a[1])) {
  write(`    ${who}: ${String(count)}`);
}
write('');

if (!confirm) {
  write('  DRY RUN — nothing was changed in Asana.');
  write('');
  write('  Reopening notifies watchers a second time. The people above already');
  write('  received one round of completion mail they did not expect; this adds');
  write('  another. Worth telling them before, not after:');
  write('');
  write('    npm run asana:reopen -- ...same flags... --confirm');
  write('');
  process.exit(0);
}

let reopened = 0;
let failed = 0;
for (const task of targets) {
  try {
    await api(`/tasks/${task.gid}`, {
      method: 'PUT',
      body: JSON.stringify({ data: { completed: false } }),
    });
    reopened += 1;
    write(`  reopened ${task.name}`);
  } catch (cause) {
    failed += 1;
    write(`  FAILED   ${task.name} — ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

write('');
write(`  reopened ${String(reopened)} | failed ${String(failed)}`);
write('');
if (inWindow.length === 100) {
  // The search endpoint caps at 100 and does not paginate. A full page means
  // there may be more, and reporting "done" would be a guess.
  write('  NOTE: the search returned a full page (100). There may be more in this');
  write('  window than were listed. Narrow the window and run again to be sure.');
  write('');
}
process.exitCode = failed > 0 ? 1 : 0;
