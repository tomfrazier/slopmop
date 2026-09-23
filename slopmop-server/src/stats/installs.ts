import { DAY_MS } from "../constants.js";
import { deviceId } from "../repos/clients.js";
import { dayKey } from "../repos/shared.js";
import { num, round, type Scope } from "./scope.js";

/** A device counts as "near the cap" from this share of the daily limit. */
export const NEAR_CAP_FRACTION = 0.8;
export const DEVICE_TABLE_LIMIT = 25;

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
  return {
    total: num(inst?.total),
    active24h: num(inst?.a24),
    active7d: num(inst?.a7),
    active30d: num(inst?.a30),
    newInRange: num(inst?.fresh),
    todayAtCap: num(cap?.at_cap),
    todayNearCap: num(cap?.near_cap),
    todayActive: num(cap?.n),
    todayTopChecks: num(cap?.top),
  };
}

/** The most active devices in the range, with cost, limit hits, votes and whether each is disabled. */
export async function deviceTable(s: Scope) {
  const rows = await s.q(
    `SELECT e.install_hash h, SUM(e.kind IN ('scored','cached')) checks, SUM(e.kind='scored') scored, SUM(e.kind='limited') limited, SUM(e.kind='error') errors,
            SUM(e.input_tokens) tin, SUM(e.output_tokens) tout, MAX(e.at) last_at, COUNT(DISTINCT CAST(e.at / ${DAY_MS} AS INTEGER)) days,
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
