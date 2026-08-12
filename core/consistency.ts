/**
 * Async-node consistency helper.
 *
 * The distinction this exists to preserve: **most "bugs" in this stack are
 * propagation timing, not defects.** Constructor's catalog writes complete
 * asynchronously via task IDs. Filing timing as a defect burns engineering
 * trust; dismissing a real defect as flakiness ships wrong prices.
 *
 * So a timeout here is reported as an SLA breach carrying the elapsed time
 * and the declared budget — not as a bare assertion failure that triage has
 * to start from zero on.
 */

export class ConsistencySlaBreach extends Error {
  public readonly elapsedMs: number;
  public readonly slaMs: number;

  public constructor(label: string, elapsedMs: number, slaMs: number) {
    super(
      `SLA breach: "${label}" did not become consistent within ${String(slaMs)}ms (waited ${String(elapsedMs)}ms). ` +
        'This is a propagation-timing finding, not a UI failure.',
    );
    this.name = 'ConsistencySlaBreach';
    this.elapsedMs = elapsedMs;
    this.slaMs = slaMs;
  }
}

export type AwaitConsistencyOptions = {
  readonly check: () => Promise<boolean>;
  readonly timeout: number;
  readonly label: string;
  readonly intervalMs?: number;
};

export const awaitConsistency = async (options: AwaitConsistencyOptions): Promise<void> => {
  const interval = options.intervalMs ?? 1_000;
  const startedAt = Date.now();

  for (;;) {
    if (await options.check()) {
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= options.timeout) {
      throw new ConsistencySlaBreach(options.label, elapsed, options.timeout);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }
};
