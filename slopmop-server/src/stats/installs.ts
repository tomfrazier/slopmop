import { DAY_MS } from "../constants.js";
import { deviceId } from "../repos/clients.js";
import { dayKey, nextResetIso } from "../repos/shared.js";
import { num, round, type Scope } from "./scope.js";
import { bucketCte, offsetAt, partsIn, zoned } from "./zone.js";

/** A device counts as "near the cap" from this share of the daily limit. */
export const NEAR_CAP_FRACTION = 0.8;
export const DEVICE_TABLE_LIMIT = 25;
/** MAU looks back this many days (in the admin's timezone), today included. */
export const ACTIVE_WINDOW_DAYS = 30;

/** How many installs exist and are active, and how many are at or near today's cap. */
export async function installStats(s: Scope) {
  const { now } = s;
  const dailyLimit = s.limits.dailyLimit;
  const [inst] = await s.q(`SELECT COUNT(*) total, SUM(last_seen >= ?) a24, SUM(last_seen >= ?) a7, SUM(last_seen >= ?) a30, SUM(first_seen >= ?) fresh FROM installs`, [
    now - DAY_MS,
    now - 7 * DAY_MS,
    now - 30 * DAY_MS,
    s.since,
  ]);
  // Each install is measured against its own limit when it has one, else the default.
  const [cap] = await s.q(
    `SELECT COUNT(*) n, SUM(u.checks >= COALESCE(i.daily_limit, ?)) at_cap, SUM(u.checks * 100 >= COALESCE(i.daily_limit, ?) * ${Math.round(NEAR_CAP_FRACTION * 100)}) near_cap, MAX(u.checks) top
     FROM usage u LEFT JOIN installs i ON i.install_hash = u.install_hash WHERE u.day = ?`,
    [dailyLimit, dailyLimit, dayKey(now)],
  );
  // DAU/MAU the usual way: an active user is an install that made at least one check (from the events log, which keeps 90 days;
  // refused requests don't count). DAU is a calendar day in the admin's timezone, MAU the distinct installs over the trailing 30
  // such days including today, and stickiness is the 30-day average DAU over MAU.
  const p = partsIn(now, s.tz);
  const days = Array.from({ length: ACTIVE_WINDOW_DAYS }, (_, i) => ({ t: zoned(p.y, p.m, p.d - i, 0, s.tz), end: zoned(p.y, p.m, p.d - i + 1, 0, s.tz) }));
  const windowStart = days[days.length - 1].t;
  const perDay = await s.q(`${bucketCte(days)} SELECT b.t day, COUNT(DISTINCT install_hash) n FROM b JOIN events ON at >= b.t AND at < b.e WHERE kind IN ('scored','cached') GROUP BY b.t`);
  const dauOn = (i: number) => num(perDay.find((r) => num(r.day) === days[i].t)?.n);
  const [mauRow] = await s.q(`SELECT COUNT(DISTINCT install_hash) n FROM events WHERE kind IN ('scored','cached') AND at >= ?`, [windowStart]);
  const mau = num(mauRow?.n);
  const avgDau = days.reduce((n, _, i) => n + dauOn(i), 0) / ACTIVE_WINDOW_DAYS;
  return {
    dau: dauOn(0),
    dauYesterday: dauOn(1),
    /** When "today" started for DAU, in the admin's timezone. */
    dayStart: days[0].t,
    mau,
    avgDau30: round(avgDau, 1),
    stickinessPct: mau ? round((avgDau / mau) * 100, 1) : null,
    total: num(inst?.total),
    active24h: num(inst?.a24),
    active7d: num(inst?.a7),
    active30d: num(inst?.a30),
    newInRange: num(inst?.fresh),
    todayAtCap: num(cap?.at_cap),
    todayNearCap: num(cap?.near_cap),
    todayActive: num(cap?.n),
    todayTopChecks: num(cap?.top),
    /** The daily limit counts UTC days whatever the admin's timezone; this is when today's counts reset. */
    limitResetsAt: Date.parse(nextResetIso(now)),
  };
}

/** The most active devices in the range, with cost, limit hits, votes and whether each is disabled. */
export async function deviceTable(s: Scope) {
  const rows = await s.q(
    `SELECT e.install_hash h, SUM(e.kind IN ('scored','cached')) checks, SUM(e.kind='scored') scored, SUM(e.kind='limited') limited, SUM(e.kind='error') errors,
            SUM(e.input_tokens) tin, SUM(e.output_tokens) tout, MAX(e.at) last_at, COUNT(DISTINCT CAST((e.at + ${offsetAt(s.now, s.tz)}) / ${DAY_MS} AS INTEGER)) days,
            i.first_seen first_seen, COALESCE(i.disabled, 0) disabled, i.alias alias, COALESCE(i.daily_limit, ?) daily_limit, i.daily_limit own_limit, (SELECT COUNT(*) FROM votes v WHERE v.install_hash = e.install_hash) votes
     FROM events e LEFT JOIN installs i ON i.install_hash = e.install_hash
     WHERE e.at >= ?${s.netSql("e.network")} GROUP BY e.install_hash ORDER BY checks DESC, e.install_hash LIMIT ${DEVICE_TABLE_LIMIT}`,
    [s.limits.dailyLimit, s.since, ...s.netArgs()],
  );
  return rows.map((r) => ({
    device: deviceId(String(r.h)),
    alias: (r.alias as string | null) ?? null,
    dailyLimit: num(r.daily_limit),
    ownLimit: r.own_limit != null,
    checks: num(r.checks),
    scored: num(r.scored),
    limitHits: num(r.limited),
    errors: num(r.errors),
    costUsd: round(s.cost(num(r.tin), num(r.tout)), 6),
    activeDays: num(r.days),
    firstSeen: r.first_seen == null ? null : num(r.first_seen),
    lastSeen: num(r.last_at),
    votes: num(r.votes),
    disabled: num(r.disabled) === 1,
  }));
}
