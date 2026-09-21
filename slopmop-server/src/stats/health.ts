import { deviceId } from "../repos/clients.js";
import { num, type Scope } from "./scope.js";

const LATENCY_SAMPLE_LIMIT = 5000;
const PROBLEMS_LIMIT = 25;

/** Latencies of the most recent Jev calls in the range, sorted ascending (percentiles are read from these). */
export async function latencySamples(s: Scope): Promise<number[]> {
  const rows = await s.q(`SELECT latency_ms FROM events WHERE kind = 'scored' AND latency_ms IS NOT NULL AND at >= ?${s.netSql()} ORDER BY at DESC LIMIT ${LATENCY_SAMPLE_LIMIT}`, [s.since, ...s.netArgs()]);
  return rows.map((r) => num(r.latency_ms)).sort((a, b) => a - b);
}

/** The value at fraction `p` (0-1) of an ascending list, or null when empty. */
export const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

/** The most recent errors and refused requests. */
export async function recentProblems(s: Scope) {
  const rows = await s.q(`SELECT at, network, kind, detail, install_hash FROM events WHERE kind IN ('error','limited') AND at >= ?${s.netSql()} ORDER BY at DESC LIMIT ${PROBLEMS_LIMIT}`, [s.since, ...s.netArgs()]);
  return rows.map((r) => ({ at: num(r.at), network: String(r.network), kind: String(r.kind), detail: (r.detail as string | null) ?? null, device: deviceId(String(r.install_hash)) }));
}

/** How much is stored, so the dashboard can show the database's footprint. */
export async function storageSizes(s: Scope) {
  const [row] = await s.q(
    `SELECT (SELECT COUNT(*) FROM content) content, (SELECT COUNT(*) FROM votes) votes, (SELECT COUNT(*) FROM events) events, (SELECT COUNT(*) FROM installs) installs,
            (SELECT MIN(at) FROM events) oldest_event`,
  );
  return {
    contentRows: num(row?.content),
    voteRows: num(row?.votes),
    eventRows: num(row?.events),
    installRows: num(row?.installs),
    oldestEvent: row?.oldest_event == null ? null : num(row.oldest_event),
  };
}
