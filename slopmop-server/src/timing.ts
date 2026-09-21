/**
 * Where a request's time went, reported as a Server-Timing header (readable with `curl -i`, no logs needed):
 * `cap;dur=12, lookup;dur=8, jev;dur=420, total;dur=470`.
 */
export function serverTiming() {
  const marks: string[] = [];
  const started = performance.now();
  return {
    /** Awaits `p`, recording how long it took under `name`. */
    async timed<T>(name: string, p: Promise<T>): Promise<T> {
      const t = performance.now();
      try {
        return await p;
      } finally {
        marks.push(`${name};dur=${Math.round(performance.now() - t)}`);
      }
    },
    elapsedMs: () => Math.round(performance.now() - started),
    header: () => [...marks, `total;dur=${Math.round(performance.now() - started)}`].join(", "),
  };
}
export type Timing = ReturnType<typeof serverTiming>;
