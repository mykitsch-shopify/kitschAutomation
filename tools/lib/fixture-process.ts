import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Starting and reliably stopping fixture servers for the detection controls.
 *
 * The bug this exists to fix, observed rather than imagined: the controls
 * launched fixtures with `spawn('npx', ['tsx', 'server.ts'])` and stopped them
 * with `child.kill('SIGKILL')`. That signals `npx` — not the `tsx` grandchild
 * that actually holds the port. npx exits, the server keeps listening, and the
 * next run finds the port held by a process running the previous build.
 *
 * Distinct ports per profile made it survivable but not fixed: a crashed run
 * still leaves a listener, and the next control run either measures stale code
 * or refuses to start. It surfaced as a release-gate failure with a stack
 * trace instead of a verdict.
 *
 * The fix is to put the child in its own process group (`detached`) and signal
 * the group, which reaches every descendant.
 */

export type Fixture = { readonly child: ChildProcess; readonly base: string };

/**
 * Spawns a fixture in its own process group so the whole tree can be killed.
 * stdio is ignored: a fixture's own logging is noise inside a control run.
 */
export const spawnFixture = (
  script: string,
  env: Readonly<Record<string, string>>,
): ChildProcess =>
  spawn('npx', ['tsx', script], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    // The whole point: a new process group, so the signal reaches the grandchild.
    detached: true,
  });

/**
 * Kills the fixture and everything it spawned.
 *
 * Negating the pid targets the process group. Falls back to signalling the
 * child alone if the group has already gone, which throws ESRCH rather than
 * failing silently.
 */
export const killTree = (child: ChildProcess): void => {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone. Nothing to do, and nothing worth reporting.
    }
  }
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits for a fixture to answer, and confirms it is the profile asked for.
 *
 * `expect` is matched against the probe body. Trusting "something responded"
 * is what let a stale fixture stand in for a fresh one and invalidate an entire
 * control run without a single error message.
 */
export const waitForFixture = async (
  base: string,
  probePath: string,
  expect: string,
  child: ChildProcess,
  attempts = 80,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(250);
    const body = await fetch(`${base}${probePath}`)
      .then(async (response) => (response.ok ? response.text() : ''))
      .catch(() => '');
    if (body.includes(expect)) return;
    if (body !== '') {
      killTree(child);
      throw new Error(
        `${base} answered but is not serving "${expect}". A stale fixture is holding ` +
          'this port; nothing measured against it would mean anything.',
      );
    }
  }
  killTree(child);
  throw new Error(`fixture did not come up on ${base}`);
};

/**
 * Refuses to start when a port is already held.
 *
 * Kept as a guard even though killTree makes leftovers rare: a control that
 * measures the previous build reports defects that were already fixed, and
 * that is indistinguishable from the code having regressed.
 */
export const assertPortFree = async (base: string, probePath: string): Promise<void> => {
  const held = await fetch(`${base}${probePath}`)
    .then(() => true)
    .catch(() => false);
  if (held) {
    throw new Error(
      `${base} is already serving. A previous fixture did not exit and may be running ` +
        'stale code. Stop it, then re-run.',
    );
  }
};
