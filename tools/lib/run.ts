import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Running `npm`, `npx` and `git` as child processes, on every platform we
 * support.
 *
 * The bug this exists to fix, reported from a Windows laptop rather than
 * imagined: `npm run precommit` failed all four gates in 0.0 seconds with no
 * error text at all. Nothing had run. On Windows there is no `npm` executable —
 * only `npm.cmd` — and since the fix for CVE-2024-27980 Node refuses to spawn a
 * `.cmd` without a shell. Every call site used a bare `spawnSync('npm', …)`, so
 * every one of them failed to start, and because none of them checked
 * `result.error`, a spawn that never happened was reported identically to a
 * gate that ran and failed.
 *
 * Two separate faults, and the second is the worse one. "Could not run this
 * check" was being rendered as "this check failed" — the exact collapse the
 * rest of this repo exists to prevent, sitting in the tool that guards every
 * commit. A Windows contributor would have concluded their code was broken.
 *
 * So: `notRun` is a distinct outcome here, and callers are expected to treat it
 * as "could not check" (exit 2) rather than as a failure.
 *
 * A third fault, found by running this on the Windows laptop rather than
 * reasoning about it: checking `result.error` is not enough there. Under
 * `shell: true` the process Node starts is cmd.exe, and cmd.exe starts
 * perfectly well — so a missing `npm` produces no spawn error at all, and the
 * missing launcher went straight back to reading as "this gate failed".
 *
 * The first attempt at that fixed it by asserting cmd.exe returns 9009 for a
 * command it cannot find. That was reasoned from a machine that cannot run
 * Windows, it was wrong, and the same test failed a second time on the same
 * laptop. So nothing here asserts anything about cmd.exe's exit codes now:
 * `findOnWindowsPath` asks whether the command exists at all, which is a
 * question with an answer we can check.
 *
 * Everything the Windows path turns on is reachable from a test on any
 * platform for that reason — `buildLaunch`, `explainNotStart` and
 * `findOnWindowsPath` all take what they need as arguments, and `run.test.ts`
 * exercises their Windows behaviour from Linux. Three rounds of this bug were
 * three rounds of shipping code nobody could execute.
 */

export type RunResult = {
  /** The command's exit code. Meaningless when `notRun` is set. */
  readonly status: number;
  readonly output: string;
  /**
   * Set when the command could not be started at all — wrong platform launcher,
   * missing binary, no node_modules. Never a statement about the code.
   */
  readonly notRun?: string;
};

/** Windows defaults, used when the environment does not say. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

/**
 * Finds what cmd.exe would run for `command`, or `undefined` if there is
 * nothing there to run. Windows semantics; safe to call anywhere.
 *
 * This exists because neither thing you would reach for first works. Under
 * `shell: true` the process Node starts is cmd.exe, which starts perfectly
 * well, so there is no spawn error to read. And the exit code cmd.exe returns
 * when it cannot find a command is not something this file should be asserting
 * from a machine that cannot run it — the previous attempt asserted 9009,
 * reasoned rather than measured, and it was wrong on the actual laptop.
 *
 * Looking along PATH ourselves depends on neither. It is also the only version
 * of this question that can be tested from any platform, which is the property
 * every Windows bug in this file's history has turned on.
 */
export const findOnWindowsPath = (
  command: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  // PATHEXT is conventionally uppercase (".CMD") while the file on disk is
  // lowercase ("npm.cmd"). Windows does not care, but a case-sensitive volume
  // does — and so does any machine running these tests. Try both spellings.
  const declared = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter((ext) => ext !== '');
  const extensions = [
    ...new Set(['', ...declared.flatMap((ext) => [ext, ext.toLowerCase(), ext.toUpperCase()])]),
  ];
  // A command with a directory in it is not searched for; it is just there or not.
  // Otherwise cmd.exe looks in the current directory first, then along PATH.
  const directories = /[\\/]/u.test(command)
    ? ['']
    : ['.', ...(env.PATH ?? '').split(';').filter((dir) => dir !== '')];

  for (const directory of directories) {
    for (const extension of extensions) {
      const name = `${command}${extension}`;
      const candidate = directory === '' ? name : join(directory, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
};

/**
 * Quotes an argument for cmd.exe.
 *
 * Windows needs `shell: true` to run `npm.cmd`, and a shell re-parses the
 * argument list — so an unquoted argument containing a space arrives as two.
 * That matters here: the Allure report title is a sentence, and paths on a
 * Windows laptop routinely sit under "C:\Users\...\Kitsch Automation\".
 */
export const quoteForWindows = (arg: string): string => {
  if (arg === '') return '""';
  // `%` is expanded by cmd.exe even inside double quotes, and there is no
  // reliable escape for it in an argument. None of our arguments contain one;
  // refusing loudly beats passing something silently different.
  if (arg.includes('%')) {
    throw new Error(
      `cannot pass "${arg}" to a command on Windows: % is expanded by cmd.exe ` +
        'and cannot be escaped inside an argument.',
    );
  }
  if (!/[\s"&|<>^]/u.test(arg)) return arg;
  // Backslashes are literal to cmd.exe except immediately before the closing
  // quote, where they would escape it.
  return `"${arg.replace(/(\\*)$/u, '$1$1').replace(/"/gu, '\\"')}"`;
};

export type Launch = {
  readonly command: string;
  readonly args: string[];
  readonly shell: boolean;
};

/**
 * Decides how a command has to be handed to the operating system.
 *
 * `platform` is a parameter rather than a module-level constant so the Windows
 * branch can be tested from a machine that is not Windows. That is not a
 * flourish: every Windows fault in this file's history was one nobody could
 * execute.
 *
 * On Windows the whole line goes into `command`, already quoted, and no args
 * array is passed. Node would otherwise concatenate the args itself without
 * escaping them — which is what DEP0190 warns about, and it printed a
 * deprecation notice on every Windows run of every tool in this repo.
 */
export const buildLaunch = (
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Launch =>
  platform === 'win32'
    ? { command: [command, ...args].map(quoteForWindows).join(' '), args: [], shell: true }
    : { command, args: [...args], shell: false };

/** The shape of a finished spawn, as much of it as the question needs. */
export type Outcome = {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null | undefined;
};

/**
 * Says why a command never ran, or `undefined` if it did run.
 *
 * The Windows clause is the one worth reading. There, `shell: true` means the
 * process Node launched was cmd.exe — which starts fine even when the command
 * it was asked for does not exist — so `error` stays unset and a missing `npm`
 * comes back looking like an ordinary failed gate. `onPath` is the evidence
 * that settles it, and it comes from `findOnWindowsPath` rather than from any
 * exit code.
 *
 * `onPath` is only consulted for a non-zero exit: if the command somehow ran
 * and succeeded, it plainly existed, and no amount of PATH-searching should be
 * able to talk us out of a result we watched happen.
 */
export const explainNotStart = (
  command: string,
  outcome: Outcome,
  platform: NodeJS.Platform = process.platform,
  onPath = true,
): string | undefined => {
  if (outcome.error !== undefined) return describe(command, outcome.error);
  // A null status with no error means the process was killed by a signal.
  if (outcome.status === null) {
    return `${command} was terminated by ${outcome.signal ?? 'a signal'} before it finished.`;
  }
  if (platform === 'win32' && outcome.status !== 0 && !onPath) return notFound(command);
  return undefined;
};

/**
 * Whether the command exists to be run. Only Windows needs asking.
 *
 * Asked against the environment the child will actually get, not this
 * process's — a caller that overrides PATH would otherwise be answered about a
 * PATH nobody is going to search.
 */
const onPathFor = (command: string, env: Readonly<Record<string, string | undefined>>): boolean =>
  process.platform !== 'win32' || findOnWindowsPath(command, env) !== undefined;

/**
 * Runs a command to completion and captures its output.
 *
 * Distinguishes "ran and failed" from "never started". Callers that conflate
 * the two turn an environment problem into a code problem.
 */
export const runSync = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> } = {},
): RunResult => {
  const spec = buildLaunch(command, args);
  const env = options.env === undefined ? process.env : { ...process.env, ...options.env };
  const result = spawnSync(spec.command, spec.args, {
    encoding: 'utf8',
    shell: spec.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.env === undefined ? {} : { env }),
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const notRun = explainNotStart(command, result, process.platform, onPathFor(command, env));

  if (notRun !== undefined) return { status: 1, output, notRun };
  return { status: result.status ?? 1, output };
};

/** Same, but the child's output goes straight to the terminal. */
export const runInherit = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> } = {},
): RunResult => {
  const spec = buildLaunch(command, args);
  const env = options.env === undefined ? process.env : { ...process.env, ...options.env };
  const result = spawnSync(spec.command, spec.args, {
    shell: spec.shell,
    stdio: 'inherit',
    ...(options.env === undefined ? {} : { env }),
  });

  const notRun = explainNotStart(command, result, process.platform, onPathFor(command, env));

  if (notRun !== undefined) return { status: 1, output: '', notRun };
  return { status: result.status ?? 1, output: '' };
};

/** Spawns a long-lived child. `detached` is honoured only where it works. */
export const spawnDetached = (
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess => {
  const spec = buildLaunch(command, args);
  return spawn(spec.command, spec.args, {
    ...options,
    shell: spec.shell,
    // Windows has no process groups to detach into; `detached` there opens a
    // console window instead, and killTree uses taskkill /T regardless.
    ...(process.platform === 'win32' ? { detached: false, windowsHide: true } : {}),
  });
};

/** The one remedy that fixes almost every "cannot find npm" on a dev machine. */
const notFound = (command: string): string =>
  `${command} could not be found. Either it is not on PATH, or dependencies ` +
  'are not installed — run `npm ci` in the repository root.';

/**
 * Turns a spawn error into something a person can act on.
 *
 * ENOENT on `npm` from a Node process is almost always one of two things, and
 * saying which saves an afternoon.
 */
const describe = (command: string, error: Error): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return notFound(command);
  }
  if (code === 'EINVAL') {
    return (
      `${command} could not be started on this platform. On Windows a .cmd ` +
      'launcher needs a shell; this is a harness bug, not a problem with your setup.'
    );
  }
  return `${command} could not be started: ${error.message}`;
};
