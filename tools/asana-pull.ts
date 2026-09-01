import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

const api = async (path: string): Promise<{ readonly data: readonly AsanaTask[] }> => {
  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Asana ${String(response.status)} on ${path}\n${body.slice(0, 400)}\n\n` +
        (response.status === 401
          ? '  A 401 is the token, not the query. Check ASANA_TOKEN is current.'
          : response.status === 403
            ? '  A 403 means the token is valid but has no access to that project.'
            : ''),
    );
  }
  return (await response.json()) as { readonly data: readonly AsanaTask[] };
};

const fields = 'gid,name,notes,completed,due_on,assignee.name';
const query =
  project !== ''
    ? `/tasks?project=${encodeURIComponent(project)}&completed_since=now&opt_fields=${fields}&limit=100`
    : `/tasks?workspace=${encodeURIComponent(workspace)}&assignee=${encodeURIComponent(assignee)}&completed_since=now&opt_fields=${fields}&limit=100`;

write('');
write('Asana — pull open translation tasks');
write('');
write(`  ${project !== '' ? `project  ${project}` : `workspace ${workspace}  assignee ${assignee}`}`);

const { data } = await api(query).catch((error: Error) => {
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
      tasks: open.map((task) => ({
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
