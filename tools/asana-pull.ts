import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describeBuild } from './lib/build-stamp.js';

/**
 * Pulls the open translation tasks off the Asana board into the export the
 * backlog audit reads.
 *
 * This is the missing half of an automation that was otherwise finished. The
 * audit can already tell you which of the ninety "Translate Product: X" tasks
 * are done — but `tools/daily.ts` names `data/asana/translation-tasks.json` as
 * an input, nothing ever wrote that file, and so the translation stage has
 * reported MISSING on every daily run since it was added. A stage that never
 * runs is not a gap in the store; it is a gap in the report that reads as
 * coverage.
 *
 *   ASANA_TOKEN=... npm run asana:pull
 *   ASANA_TOKEN=... npm run asana:pull -- --assignee me --project 12345
 *
 * ── Where the token lives is a decision, not a default ───────────────────
 * Read from the environment and never written anywhere. A personal access
 * token in a `.env` on a laptop sits outside device management, rotation and
 * revocation; prefer a CI secret. This tool only ever READS from Asana —
 * closing tasks is `tools/asana-close.ts`, deliberately a separate command.
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

const token = process.env.ASANA_TOKEN ?? '';
if (token === '') {
  write('');
  write('  No ASANA_TOKEN, so nothing was fetched.');
  write('');
  write('  Create a personal access token at');
  write('  https://app.asana.com/0/my-apps, then:');
  write('');
  write('    Windows:  set "ASANA_TOKEN=..."');
  write('    POSIX:    export ASANA_TOKEN=...');
  write('');
  write('  Prefer a CI secret over a .env file on a personal machine: a token');
  write('  there sits outside device management, rotation and revocation.');
  write('');
  process.exit(2);
}

const workspace = flags.get('workspace') ?? process.env.ASANA_WORKSPACE ?? '';
const project = flags.get('project') ?? process.env.ASANA_PROJECT ?? '';
const assignee = flags.get('assignee') ?? process.env.ASANA_ASSIGNEE ?? 'me';
const out = flags.get('out') ?? 'data/asana/translation-tasks.json';

if (project === '' && workspace === '') {
  write('');
  write('  Nothing to search. Pass --project <gid>, or --workspace <gid> with');
  write('  --assignee, so this asks Asana a question with an answer.');
  write('');
  write('  Refusing to fetch every task in the account and filter here: that is');
  write('  slow, it is rate-limited, and a filter written on this side is one');
  write('  more place the definition of "a translation task" can drift from the');
  write('  board.');
  write('');
  process.exit(2);
}

type AsanaTask = {
  readonly gid: string;
  readonly name: string;
  readonly notes?: string;
  readonly completed?: boolean;
  readonly due_on?: string | null;
  readonly assignee?: { readonly gid: string; readonly name: string } | null;
};

type Page = {
  readonly data: readonly AsanaTask[];
  readonly next_page?: { readonly offset: string } | null;
};

/**
 * Describes a token without printing it.
 *
 * A 401 is nearly always the token, and the fastest way to see why is to look
 * at its shape — but a diagnostic that echoes a live credential into a
 * terminal, a CI log or a pasted transcript has created a second problem while
 * explaining the first. So this reports the shape and nothing else.
 */
const describeToken = (value: string): string => {
  if (value === '') return 'empty';
  const wellFormed = /^2\/\d+\/\d+:[0-9a-f]{32}$/u.test(value);
  const notes: string[] = [`${String(value.length)} characters`];
  if (value !== value.trim()) notes.push('has leading or trailing whitespace');
  if (!value.startsWith('2/')) notes.push(`starts "${value.slice(0, 3).replace(/./gu, '?')}", not "2/"`);
  if (/["']/u.test(value)) notes.push('contains a quote character');
  return `${wellFormed ? 'the expected shape' : 'NOT the expected shape'} (${notes.join(', ')})`;
};

const api = async (path: string): Promise<Page> => {
  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Asana ${String(response.status)} on ${path}\n${body.slice(0, 400)}\n\n` +
        (response.status === 401
          ? '  A 401 is the token, not the query. Three things it usually is:\n\n' +
            `    shape     an Asana PAT looks like 2/<user gid>/<token gid>:<32 hex>.\n` +
            `              This one is ${describeToken(token)}.\n` +
            '    stray     characters copied in with it. On Windows,\n' +
            '              set "ASANA_TOKEN=...2/1234/5678:abcd" stores the leading\n' +
            '              dots too, and the request goes out with them.\n' +
            '    expired   PATs can be revoked from Asana > My Settings > Apps.\n\n' +
            '  Echo it back before assuming it is fine: echo %ASANA_TOKEN%'
          : response.status === 403
            ? '  A 403 means the token is valid but has no access to that project.'
            : ''),
    );
  }
  return (await response.json()) as Page;
};

/**
 * Every page, not the first one.
 *
 * This used to issue a single `limit=100` request and read `data`. Asana
 * returns `next_page.offset` when there is more, and ignoring it silently
 * truncates the board — which is precisely the failure
 * collectors/shopify-translations.ts was written to avoid ("sampling the first
 * page and calling the catalogue clean is the failure mode that makes a
 * translation gate worthless"). The same mistake was sitting here.
 *
 * A live pull made it visible: 100 tasks fetched, exactly the page size, and
 * only 3 of them translation tasks. A number equal to the limit is never a
 * count — it is a truncation until proven otherwise.
 */
const allPages = async (base: string): Promise<readonly AsanaTask[]> => {
  const collected: AsanaTask[] = [];
  let path: string | undefined = base;
  let pages = 0;

  while (path !== undefined) {
    const page: Page = await api(path);
    collected.push(...page.data);
    pages += 1;
    const offset = page.next_page?.offset;
    path = offset === undefined ? undefined : `${base}&offset=${encodeURIComponent(offset)}`;
    // A board cannot reasonably be this large, and an unbounded loop against a
    // paginated API is worse than a truncated read.
    if (pages >= 50) {
      write('  WARNING  stopped after 50 pages — the export may still be short.');
      break;
    }
  }

  write(`  pages    ${String(pages)}`);
  return collected;
};

const fields = 'gid,name,notes,completed,due_on,assignee.name';
const query =
  project !== ''
    ? `/tasks?project=${encodeURIComponent(project)}&completed_since=now&opt_fields=${fields}&limit=100`
    : `/tasks?workspace=${encodeURIComponent(workspace)}&assignee=${encodeURIComponent(assignee)}&completed_since=now&opt_fields=${fields}&limit=100`;

write('');
write('Asana — pull open translation tasks');
write('');
write(`  build    ${describeBuild()}`);
write('');
write(`  ${project !== '' ? `project  ${project}` : `workspace ${workspace}  assignee ${assignee}`}`);

const data = await allPages(query).catch((error: Error) => {
  write('');
  write(`  FAILED   ${error.message}`);
  write('');
  process.exit(2);
});

// `completed_since=now` asks for tasks completed after this instant, which is
// Asana's way of saying "incomplete only". Filtered again here because the
// parameter is easy to lose in an edit and a closed task in the export would
// be re-verified and reported as outstanding work.
const open = data.filter((task) => task.completed !== true);

write(`  fetched  ${String(data.length)} task(s), ${String(open.length)} still open`);

// Say how many of them the backlog audit will actually look at, HERE, rather
// than leaving it to be discovered one command later.
//
// A live pull reported "100 open task(s)" and the audit then reported
// "product tasks 3". Both numbers were true and the pair reads as a working
// pipeline; what it actually meant was that this query returns the whole
// project, and 97 of those tasks have nothing to do with translation. The
// export is the right place to say so, because it is the thing that decided.
const translationish = open.filter((task) => /translate/iu.test(task.name));

/**
 * Narrow to one person's tasks.
 *
 * The project query returns the whole board — 541 translation tasks across
 * several assignees — and "the translation tasks assigned to me" is the
 * question somebody actually asks each morning. Applied client-side because
 * the project endpoint has no assignee filter, and because it must work on the
 * paginated result rather than on one page of it.
 *
 * `--assignee me` resolves through the token's own user, so nobody has to look
 * up a gid.
 */
const wantAssignee = flags.get('assignee') ?? process.env.ASANA_ASSIGNEE;
const myName =
  wantAssignee === undefined || wantAssignee === ''
    ? undefined
    : wantAssignee === 'me'
      ? await api('/users/me')
          .then((page) => (page as unknown as { readonly data?: { readonly name?: string } }).data?.name)
          .catch(() => undefined)
      : wantAssignee;

const mine =
  myName === undefined
    ? translationish
    : translationish.filter(
        (task) => (task.assignee?.name ?? '').toLowerCase() === myName.toLowerCase(),
      );

if (myName !== undefined) {
  write(`  assignee  ${myName} — ${String(mine.length)} of ${String(translationish.length)} translation task(s)`);
  if (mine.length === 0) {
    write('');
    write(`  No translation task on this board is assigned to "${myName}". Check the`);
    write('  spelling against Asana, or drop --assignee to pull the whole board.');
    write('');
  }
}
write(
  `  of those  ${String(translationish.length)} name a translation; ${String(open.length - translationish.length)} are other work in this project`,
);

if (translationish.length === 0 && open.length > 0) {
  write('');
  write('  NONE of the tasks pulled are translation tasks. This query returns every');
  write('  task in the project, so the translation board is either elsewhere or');
  write('  past the pages fetched. Narrow it with --project <the translation board>');
  write('  before reading the audit that follows as "the backlog is clear".');
  write('');
}

if (open.length === 0) {
  write('');
  write('  Nothing open matched. That is a result, not an error — but check the');
  write('  project/assignee is the one carrying the translation board before');
  write('  reading it as "the backlog is clear".');
  write('');
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      captured: new Date().toISOString(),
      source: project !== '' ? `project:${project}` : `workspace:${workspace} assignee:${assignee}`,
      // Only the translation tasks.
      //
      // The export used to carry every open task in the project, and the audit
      // then filtered. That produced "100 open task(s)" followed by "product
      // tasks 3" one command later — two true numbers whose pair reads like a
      // working pipeline and means the opposite. The export is the artifact
      // somebody reads, so it holds what it claims to hold.
      tasks: mine.map((task) => ({
        gid: task.gid,
        name: task.name,
        notes: task.notes ?? '',
        due_on: task.due_on ?? null,
        assignee: task.assignee?.name ?? null,
      })),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

write(`  wrote    ${out}`);
write('');
write('  Next:  npm run audit:translation-backlog -- --base-url https://www.mykitsch.com \\');
write(`           --tasks ${out}`);
write('');
