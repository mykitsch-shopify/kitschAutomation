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
 *   npm run asana:close -- --comment    also comments on the ones it will NOT
 *                                       close, so the investigation is on the
 *                                       task rather than in a terminal
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
const comment = argv.includes('--comment');
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const reportPath = flag('--report') ?? 'translation-backlog-report/report.json';

type Entry = {
  readonly task: {
    readonly gid: string;
    readonly name: string;
    readonly assignee?: string | null;
  };
  readonly verdict: string;
  readonly note: string;
  readonly byLocale?: Readonly<Record<string, string>>;
};

type Report = {
  readonly target?: string;
  readonly results?: readonly Entry[];
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

/**
 * Whose tasks this run is allowed to touch.
 *
 * Required for `--confirm`, and the reason is a run that already happened: on
 * 2026-09-03 this tool closed 116 tasks in 146 seconds, every one of them
 * assigned to a colleague who had not asked for it and did not know it was
 * running. Nothing in the chain was wrong about the translations — the audit's
 * verdicts held up. What was wrong is that "this translation is finished" was
 * treated as sufficient reason to close somebody else's task.
 *
 * The export knew the assignee. The audit dropped it. This tool never had it
 * and never asked. So the guard lives here, where the write happens, and it is
 * mandatory rather than an option somebody has to remember at 10pm.
 */
const assignee = flag('--assignee') ?? process.env.ASANA_ASSIGNEE;

if (confirm && (assignee === undefined || assignee.trim() === '')) {
  write('');
  write('  Refusing to close anything without --assignee.');
  write('');
  write('  Closing a task is a statement about somebody else\'s work. This tool');
  write('  once closed 116 tasks belonging to a colleague because it never asked');
  write('  whose they were, so it now insists:');
  write('');
  write('    npm run asana:close -- --assignee "Your Name" --confirm');
  write('');
  write('  The name is matched against the assignee Asana reports, exactly as');
  write('  `npm run asana:pull -- --assignee` does.');
  write('');
  process.exit(2);
}

const belongsToUs = (entry: Entry): boolean =>
  assignee !== undefined &&
  (entry.task.assignee ?? '').trim().toLowerCase() === assignee.trim().toLowerCase();

const verdictCloseable = results.filter((entry) => entry.verdict === 'closeable');

/**
 * A report that predates the assignee field cannot be checked, and an
 * unanswerable question is not a pass. Re-run the audit rather than trusting a
 * file that has no opinion about whose work it describes.
 */
if (confirm && verdictCloseable.every((entry) => entry.task.assignee === undefined)) {
  write('');
  write(`  ${reportPath} carries no assignee for any task.`);
  write('');
  write('  That is the shape of report this tool produced before it learned to');
  write('  ask, so the --assignee guard would pass over it without checking');
  write('  anything. Re-run the audit to produce a report that can answer:');
  write('');
  write('    npm run asana:pull -- --assignee "Your Name" --project <gid>');
  write('    npm run audit:translation-backlog -- --base-url https://www.mykitsch.com');
  write('');
  process.exit(2);
}

const notOurs = confirm ? verdictCloseable.filter((entry) => !belongsToUs(entry)) : [];
const closeable = confirm ? verdictCloseable.filter(belongsToUs) : verdictCloseable;
const held = results.filter((entry) => entry.verdict !== 'closeable');

write('');
write('Asana — close verified translation tasks');
write('');
write(`  build    ${describeBuild()}`);
write('');
write(`  report   ${reportPath}`);
write(`  target   ${target === '' ? '(not recorded)' : target}`);
write(`  closeable ${String(closeable.length)} of ${String(results.length)}`);
if (assignee !== undefined) write(`  assignee  ${assignee}`);
write('');

if (notOurs.length > 0) {
  write(`  NOT CLOSING ${String(notOurs.length)} task(s) — verified done, but not ${assignee ?? '?'}'s:`);
  write('');
  for (const entry of notOurs) {
    write(`  skip     ${entry.task.name}`);
    write(`           assigned to ${entry.task.assignee ?? '(nobody)'}`);
  }
  write('');
  write('  The check passed on these; the decision to close them is not ours to');
  write('  make. Tell their assignee what the audit found and let them close.');
  write('');
}

for (const entry of held) {
  write(`  keep     ${entry.task.name}`);
  write(`           ${entry.verdict} — ${entry.note}`);
}
if (held.length > 0) write('');

/**
 * What a held task's comment says.
 *
 * The audit already knows why it is holding the task; leaving that in a
 * terminal means the next person to look at the board learns nothing. This puts
 * the finding where the work is.
 *
 * The marker line is load-bearing. A nightly run would otherwise post the same
 * paragraph every morning until somebody muted the task, and a task with thirty
 * identical comments is worse than one with none.
 */
const MARKER = 'kitsch-qa/translation-backlog';

const commentFor = (entry: Entry): string => {
  const locales = Object.entries(entry.byLocale ?? {})
    .map(([locale, verdict]) => `  ${locale}: ${verdict}`)
    .join('\n');
  return (
    `Automated translation check — ${entry.verdict}\n\n` +
    `${entry.note}\n\n` +
    (locales === '' ? '' : `Per locale:\n${locales}\n\n`) +
    `Checked against ${target} on the four markets this store sells in ` +
    `(es, fr, de, it). Japanese and Korean are named by this task but not ` +
    `served by the store, so they are not checked and do not hold it open.\n\n` +
    `If this looks wrong, the page may have changed since — or the check may ` +
    `be reading the wrong element, which is a bug in the automation rather ` +
    `than the translation.\n\n` +
    `${MARKER} verdict=${entry.verdict}`
  );
};

/** Has this exact verdict already been posted? */
const alreadySaid = async (gid: string, verdict: string, token: string): Promise<boolean> => {
  const response = await fetch(
    `https://app.asana.com/api/1.0/tasks/${gid}/stories?opt_fields=text&limit=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  ).catch(() => undefined);
  if (response?.ok !== true) return false;
  const body = (await response.json()) as { readonly data?: readonly { readonly text?: string }[] };
  return (body.data ?? []).some((story) =>
    (story.text ?? '').includes(`${MARKER} verdict=${verdict}`),
  );
};

if (comment && held.length > 0) {
  write(`  ${confirm ? 'commenting on' : 'would comment on'} ${String(held.length)} held task(s)`);
  write('');
  if (confirm) {
    const token = process.env.ASANA_TOKEN ?? '';
    if (token === '') {
      write('  No ASANA_TOKEN, so nothing was posted.');
      write('');
      process.exit(2);
    }
    let posted = 0;
    let skipped = 0;
    for (const entry of held) {
      if (await alreadySaid(entry.task.gid, entry.verdict, token)) {
        skipped += 1;
        write(`  said     ${entry.task.name} — same verdict already on the task`);
        continue;
      }
      const response = await fetch(
        `https://app.asana.com/api/1.0/tasks/${entry.task.gid}/stories`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ data: { text: commentFor(entry) } }),
        },
      ).catch(() => undefined);
      if (response?.ok === true) {
        posted += 1;
        write(`  posted   ${entry.task.name}`);
      } else {
        write(
          `  FAILED   ${entry.task.name} — ${response === undefined ? 'no response' : `HTTP ${String(response.status)}`}`,
        );
      }
    }
    write('');
    write(`  comments posted ${String(posted)} | already said ${String(skipped)}`);
    write('');
  } else {
    write('  DRY RUN — no comment was posted. Example, for the first held task:');
    write('');
    for (const line of commentFor(held[0] as Entry).split('\n')) write(`    ${line}`);
    write('');
  }
}

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
