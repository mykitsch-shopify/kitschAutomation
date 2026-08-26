import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';

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

const isWindows = process.platform === 'win32';

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

const launch = (
  command: string,
  args: readonly string[],
): { readonly command: string; readonly args: string[]; readonly shell: boolean } =>
  isWindows
    ? { command: quoteForWindows(command), args: args.map(quoteForWindows), shell: true }
    : { command, args: [...args], shell: false };

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
  const spec = launch(command, args);
  const result = spawnSync(spec.command, spec.args, {
    encoding: 'utf8',
    shell: spec.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.error !== undefined) {
    return { status: 1, output, notRun: describe(command, result.error) };
  }
  // A null status with no error means the process was killed by a signal.
  if (result.status === null) {
    return {
      status: 1,
      output,
      notRun: `${command} was terminated by ${result.signal ?? 'a signal'} before it finished.`,
    };
  }
  return { status: result.status, output };
};

/** Same, but the child's output goes straight to the terminal. */
export const runInherit = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> } = {},
): RunResult => {
  const spec = launch(command, args);
  const result = spawnSync(spec.command, spec.args, {
    shell: spec.shell,
    stdio: 'inherit',
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
  });

  if (result.error !== undefined) {
    return { status: 1, output: '', notRun: describe(command, result.error) };
  }
  if (result.status === null) {
    return {
      status: 1,
      output: '',
      notRun: `${command} was terminated by ${result.signal ?? 'a signal'} before it finished.`,
    };
  }
  return { status: result.status, output: '' };
};

/** Spawns a long-lived child. `detached` is honoured only where it works. */
export const spawnDetached = (
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess => {
  const spec = launch(command, args);
  return spawn(spec.command, spec.args, {
    ...options,
    shell: spec.shell,
    // Windows has no process groups to detach into; `detached` there opens a
    // console window instead, and killTree uses taskkill /T regardless.
    ...(isWindows ? { detached: false, windowsHide: true } : {}),
  });
};

/**
 * Turns a spawn error into something a person can act on.
 *
 * ENOENT on `npm` from a Node process is almost always one of two things, and
 * saying which saves an afternoon.
 */
const describe = (command: string, error: Error): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return (
      `${command} could not be found. Either it is not on PATH, or dependencies ` +
      'are not installed — run `npm ci` in the repository root.'
    );
  }
  if (code === 'EINVAL') {
    return (
      `${command} could not be started on this platform. On Windows a .cmd ` +
      'launcher needs a shell; this is a harness bug, not a problem with your setup.'
    );
  }
  return `${command} could not be started: ${error.message}`;
};
