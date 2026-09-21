/**
 * Runs async jobs one at a time, in the order they were asked for, so two writes to the same storage key can't lose an update.
 * A job that fails doesn't stop the ones behind it, and its caller still sees the failure.
 */
export function createSerial() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const result = chain.then(job);
    chain = result.catch(() => undefined);
    return result;
  };
}
