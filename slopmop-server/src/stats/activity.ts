import { HOUR_MS } from "../constants.js";
import { num, round, type Scope } from "./scope.js";
import { bucketCte, partsIn } from "./zone.js";

export interface Bucket {
  t: number;
  /** Where the bucket stops (exclusive); the last one runs on past now. */
  end: number;
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
  /** Panels opened on posts, by how the post was flagged. */
  opens: { none: number; yellow: number; red: number };
}

const emptyBucket = (t: number): Bucket => ({ t, end: t, scored: 0, cached: 0, errors: 0, limited: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, activeInstalls: 0, newInstalls: 0, votes: { no: 0, maybe: 0, probably: 0 }, opens: { none: 0, yellow: 0, red: 0 } });

/**
 * Daily-limit hits only: requests refused because the install had used its checks for the UTC day. Every other refusal (the
 * per-minute rate limit, the per-IP hourly limit, a datacenter address, a disabled device) is counted on its own. Refusals
 * logged before they carried a detail were all daily-limit hits.
 */
const DAILY_LIMIT_HITS = `SUM(kind='limited' AND COALESCE(detail,'daily_limit') = 'daily_limit')`;

/** Whole-range totals over the activity log, plus the raw row the summary is built from. */
export async function eventTotals(s: Scope) {
  const [row] = await s.q(
    `SELECT SUM(kind='scored') scored, SUM(kind='cached') cached, SUM(kind='error') errors, ${DAILY_LIMIT_HITS} limited,
            SUM(kind='limited' AND detail = 'rate_limit') rate_limited, SUM(kind='limited' AND detail = 'ip_rate_limit') ip_limited, SUM(kind='limited' AND detail = 'datacenter_ip') datacenter, SUM(kind='limited' AND detail = 'disabled') blocked,
            SUM(input_tokens) tin, SUM(output_tokens) tout, COUNT(DISTINCT install_hash) active, SUM(detail = 'hedged') hedged,
            AVG(CASE WHEN kind='scored' THEN latency_ms END) lat_avg, MAX(CASE WHEN kind='scored' THEN latency_ms END) lat_max
     FROM events WHERE at >= ?${s.netSql()}`,
    [s.since, ...s.netArgs()],
  );
  return row;
}

/** One bucket per chart unit across the range (hours, or days, weeks or months in the admin's timezone), filled from the log, new installs and votes. */
export async function timeSeries(s: Scope): Promise<Bucket[]> {
  const cte = bucketCte(s.buckets);
  const [events, fresh, votes, opens] = await Promise.all([
    s.q(
      `${cte} SELECT b.t b, SUM(kind='scored') scored, SUM(kind='cached') cached, SUM(kind='error') errors, ${DAILY_LIMIT_HITS} limited,
              SUM(input_tokens) tin, SUM(output_tokens) tout, COUNT(DISTINCT install_hash) active
       FROM b JOIN events ON at >= b.t AND at < b.e WHERE 1 = 1${s.netSql()} GROUP BY b.t`,
      s.netArgs(),
    ),
    s.q(`${cte} SELECT b.t b, COUNT(*) n FROM b JOIN installs ON first_seen >= b.t AND first_seen < b.e GROUP BY b.t`),
    s.q(`${cte} SELECT b.t b, SUM(vote='no') n, SUM(vote='maybe') m, SUM(vote='probably') p FROM b JOIN votes ON at >= b.t AND at < b.e WHERE 1 = 1${s.netSql()} GROUP BY b.t`, s.netArgs()),
    s.q(`${cte} SELECT b.t b, SUM(level='none') n, SUM(level='yellow') y, SUM(level='red') r FROM b JOIN panel_opens ON at >= b.t AND at < b.e WHERE 1 = 1${s.netSql()} GROUP BY b.t`, s.netArgs()),
  ]);

  const byStart = new Map<number, Bucket>(s.buckets.map((x) => [x.t, { ...emptyBucket(x.t), end: x.end }]));
  for (const r of events) {
    const b = byStart.get(num(r.b));
    if (!b) continue;
    Object.assign(b, { scored: num(r.scored), cached: num(r.cached), errors: num(r.errors), limited: num(r.limited), inputTokens: num(r.tin), outputTokens: num(r.tout), activeInstalls: num(r.active) });
    b.costUsd = round(s.cost(b.inputTokens, b.outputTokens), 6);
  }
  for (const r of fresh) {
    const b = byStart.get(num(r.b));
    if (b) b.newInstalls = num(r.n);
  }
  for (const r of votes) {
    const b = byStart.get(num(r.b));
    if (b) b.votes = { no: num(r.n), maybe: num(r.m), probably: num(r.p) };
  }
  for (const r of opens) {
    const b = byStart.get(num(r.b));
    if (b) b.opens = { none: num(r.n), yellow: num(r.y), red: num(r.r) };
  }
  return [...byStart.values()];
}

/** Panels opened in the range, by how the post was flagged, and by how many installs. */
export async function openTotals(s: Scope) {
  const [r] = await s.q(`SELECT COUNT(*) total, SUM(level='none') n, SUM(level='yellow') y, SUM(level='red') red, COUNT(DISTINCT install_hash) people FROM panel_opens WHERE at >= ?${s.netSql()}`, [s.since, ...s.netArgs()]);
  return { total: num(r?.total), none: num(r?.n), yellow: num(r?.y), red: num(r?.red), installs: num(r?.people) };
}

/** Checks and spend by hour of the day in the admin's timezone: when people use it. */
export async function hourOfDay(s: Scope) {
  const slots = Array.from({ length: 24 }, (_, hour) => ({ hour, checks: 0, costUsd: 0 }));
  // Grouped by UTC hour, then each hour is placed by its local hour, so daylight saving is handled hour by hour.
  const rows = await s.q(
    `SELECT CAST(at / ${HOUR_MS} AS INTEGER) hb, SUM(kind IN ('scored','cached')) checks, SUM(input_tokens) tin, SUM(output_tokens) tout
     FROM events WHERE at >= ?${s.netSql()} GROUP BY hb`,
    [s.since, ...s.netArgs()],
  );
  const tokens = slots.map(() => ({ tin: 0, tout: 0 }));
  for (const r of rows) {
    const h = partsIn(num(r.hb) * HOUR_MS, s.tz).h;
    slots[h].checks += num(r.checks);
    tokens[h].tin += num(r.tin);
    tokens[h].tout += num(r.tout);
  }
  slots.forEach((slot, h) => (slot.costUsd = round(s.cost(tokens[h].tin, tokens[h].tout), 6)));
  return slots;
}
