/**
 * Hedged requests: if an attempt hasn't answered within `hedgeAfterMs`, start another and take whichever succeeds first
 * (the rest are aborted). A failed attempt is replaced immediately. This trims the slow tail without slowing the common
 * case, and the SDK's own retries (a 10s timeout per attempt, then backoff) are what this replaces: one stalled attempt
 * cost 10s, two cost 20s, three hit the function's 30s limit.
 */
export interface HedgeOptions {
  /** Start the next attempt if nothing has answered by then. */
  hedgeAfterMs: number;
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** false = fail straight away (a bad key or bad input won't get better by asking again). */
  retryable: (error: unknown) => boolean;
}

export async function hedged<T>(run: (signal: AbortSignal, attempt: number) => Promise<T>, o: HedgeOptions): Promise<{ value: T; attempts: number }> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    let launched = 0;
    let failed = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const c of controllers) c.abort();
      done();
    };

    const launch = () => {
      if (settled || launched >= o.maxAttempts) return;
      const n = ++launched;
      const controller = new AbortController();
      controllers.push(controller);
      run(controller.signal, n).then(
        (value) => finish(() => resolve({ value, attempts: launched })),
        (error) => {
          if (settled) return;
          failed++;
          if (!o.retryable(error)) return finish(() => reject(error));
          if (launched < o.maxAttempts) return launch(); // replace a failed attempt right away
          if (failed === launched) finish(() => reject(error)); // every attempt has failed
        },
      );
      clearTimeout(timer);
      if (launched < o.maxAttempts) timer = setTimeout(launch, o.hedgeAfterMs);
    };

    launch();
  });
}
