import { DAY_MS, HOUR_MS } from "../constants.js";
import { num, round, type Scope } from "./scope.js";

export interface Bucket {
  t: number;
  scored: number;
  cached: number;
  errors: number;
  limited: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  activeInstalls: number;
  newInstalls: number;
  votes: { no: number; maybe: number; probably: number };
}

const emptyBucket = (t: number): Bucket => ({ t, scored: 0, cached: 0, errors: 0, limited: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, activeInstalls: 0, newInstalls: 0, votes: { no: 0, maybe: 0, probably: 0 } });

/** Daily-limit hits only: rate-limit refusals and disabled-client blocks are counted separately. */
const DAILY_LIMIT_HITS = `SUM(kind='limited' AND COALESCE(detail,'') NOT IN ('rate_limit','disabled'))`;

/** Whole-range totals over the activity log, plus the raw row the summary is built from. */
export async function eventTotals(s: Scope) {
  const [row] = await s.q(
    `SELECT SUM(kind='scored') scored, SUM(kind='cached') cached, SUM(kind='error') errors, ${DAILY_LIMIT_HITS} limited,
            SUM(detail = 'rate_limit') rate_limited, SUM(detail = 'disabled') blocked,
            SUM(input_tokens) tin, SUM(output_tokens) tout, COUNT(DISTINCT install_hash) active, SUM(detail = 'hedged') hedged,
            AVG(CASE WHEN kind='scored' THEN latency_ms END) lat_avg, MAX(CASE WHEN kind='scored' THEN latency_ms END) lat_max
     FROM events WHERE at >= ?${s.netSql()}`,
    [s.since, ...s.netArgs()],
  );
  return row;
}

/** One bucket per hour or day across the range, filled from the log, new installs and votes. */
export async function timeSeries(s: Scope): Promise<Bucket[]> {
  const { since, size } = s;
  const bucket = `CAST(at / ${size} AS INTEGER) * ${size}`;
  const [events, fresh, votes] = await Promise.all([
    s.q(
      `SELECT ${bucket} b, SUM(kind='scored') scored, SUM(kind='cached') cached, SUM(kind='error') errors, ${DAILY_LIMIT_HITS} limited,
              SUM(input_tokens) tin, SUM(output_tokens) tout, COUNT(DISTINCT install_hash) active
       FROM events WHERE at >= ?${s.netSql()} GROUP BY b`,
      [since, ...s.netArgs()],
    ),
    s.q(`SELECT CAST(first_seen / ${size} AS INTEGER) * ${size} b, COUNT(*) n FROM installs WHERE first_seen >= ? GROUP BY b`, [since]),
    s.q(`SELECT ${bucket} b, SUM(vote='no') n, SUM(vote='maybe') m, SUM(vote='probably') p FROM votes WHERE at >= ?${s.netSql()} GROUP BY b`, [since, ...s.netArgs()]),
  ]);

  const buckets = new Map<number, Bucket>();
  for (let t = since; t <= s.now; t += size) buckets.set(t, emptyBucket(t));
  for (const r of events) {
    const b = buckets.get(num(r.b));
    if (!b) continue;
    Object.assign(b, { scored: num(r.scored), cached: num(r.cached), errors: num(r.errors), limited: num(r.limited), inputTokens: num(r.tin), outputTokens: num(r.tout), activeInstalls: num(r.active) });
    b.costUsd = round(s.cost(b.inputTokens, b.outputTokens), 6);
  }
  for (const r of fresh) {
    const b = buckets.get(num(r.b));
    if (b) b.newInstalls = num(r.n);
  }
  for (const r of votes) {
    const b = buckets.get(num(r.b));
    if (b) b.votes = { no: num(r.n), maybe: num(r.m), probably: num(r.p) };
  }
  return [...buckets.values()];
}

/** Checks and spend by hour of the day (UTC): when people use it. */
export async function hourOfDay(s: Scope) {
  const slots = Array.from({ length: 24 }, (_, hour) => ({ hour, checks: 0, costUsd: 0 }));
  const rows = await s.q(
    `SELECT CAST((at % ${DAY_MS}) / ${HOUR_MS} AS INTEGER) h, SUM(kind IN ('scored','cached')) checks, SUM(input_tokens) tin, SUM(output_tokens) tout
     FROM events WHERE at >= ?${s.netSql()} GROUP BY h`,
    [s.since, ...s.netArgs()],
  );
  for (const r of rows) {
    const slot = slots[num(r.h)];
    if (slot) Object.assign(slot, { checks: num(r.checks), costUsd: round(s.cost(num(r.tin), num(r.tout)), 6) });
  }
  return slots;
}
