import type { SqlArg } from "../db/types.js";
import { DAY_MS, DEVICE_ID_CHARS, DEVICE_PREFIX_MAX, DEVICE_PREFIX_MIN, DISABLED_LIST_LIMIT, MIN_RETRY_AFTER_MS } from "../constants.js";
import { dayKey, num, type RepoDeps } from "./shared.js";
import type { DisabledClient } from "./types.js";

export interface DeviceQuery {
  /** Part of a device id (or a longer prefix of the full hash); empty = everyone. */
  q: string;
  status: "all" | "disabled" | "custom" | "limited" | "active";
  sort: "lastSeen" | "firstSeen" | "checks" | "today" | "errors" | "votes" | "limitHits";
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}

export interface DeviceRow {
  device: string;
  firstSeen: number;
  lastSeen: number;
  /** Lifetime checks. */
  checks: number;
  /** Checks used today (UTC). */
  today: number;
  limitHits: number;
  errors: number;
  votes: number;
  disabled: boolean;
  disabledReason: string | null;
  /** This install's own limits; null = following the default. */
  dailyLimit: number | null;
  hourlyLimit: number | null;
  /** The admin's name for this device, if it has one. */
  alias: string | null;
}

/** Per-install controls: the admin's kill switch and the requests-per-minute window. */
export class ClientRepo {
  constructor(private readonly d: RepoDeps) {}

  /** True when the admin has disabled this install. Unknown installs are enabled. */
  async isDisabled(installId: string): Promise<boolean> {
    const r = await this.d.db.execute(`SELECT disabled FROM installs WHERE install_hash = ?`, [this.d.hash(installId)]);
    return num(r.rows[0]?.disabled) === 1;
  }

  /** Requests this install has made in the last `windowMs`, and how long until the oldest one falls out of the window. */
  async recentRequests(installId: string, windowMs: number): Promise<{ n: number; freeInMs: number }> {
    const t = this.d.now();
    const r = await this.d.db.execute(`SELECT COUNT(*) n, MIN(at) oldest FROM events WHERE install_hash = ? AND at >= ? AND kind != 'limited'`, [this.d.hash(installId), t - windowMs]);
    const n = num(r.rows[0]?.n);
    return { n, freeInMs: n ? Math.max(MIN_RETRY_AFTER_MS, num(r.rows[0]?.oldest) + windowMs - t) : 0 };
  }

  /** Finds an install by the short device id the dashboard shows (a hash prefix). */
  async find(prefix: string): Promise<{ hash: string } | "ambiguous" | null> {
    if (!new RegExp(`^[0-9a-f]{${DEVICE_PREFIX_MIN},${DEVICE_PREFIX_MAX}}$`).test(prefix)) return null;
    const r = await this.d.db.execute(`SELECT install_hash FROM installs WHERE install_hash LIKE ? LIMIT 2`, [`${prefix}%`]);
    if (r.rows.length > 1) return "ambiguous";
    return r.rows[0] ? { hash: String(r.rows[0].install_hash) } : null;
  }

  async setDisabled(hash: string, disabled: boolean, reason: string | null): Promise<void> {
    await this.d.db.execute(`UPDATE installs SET disabled = ?, disabled_at = ?, disabled_reason = ? WHERE install_hash = ?`, [disabled ? 1 : 0, disabled ? this.d.now() : null, disabled ? reason : null, hash]);
  }

  /** Sets an install's own limits: a number overrides the default, null goes back to it, undefined leaves that one alone. */
  async setLimits(hash: string, limits: { dailyLimit?: number | null; hourlyLimit?: number | null }): Promise<void> {
    if (limits.dailyLimit !== undefined) await this.d.db.execute(`UPDATE installs SET daily_limit = ? WHERE install_hash = ?`, [limits.dailyLimit, hash]);
    if (limits.hourlyLimit !== undefined) await this.d.db.execute(`UPDATE installs SET hourly_limit = ? WHERE install_hash = ?`, [limits.hourlyLimit, hash]);
  }

  /** Every install, filtered, sorted and paged, for the admin's device list. */
  async list(o: DeviceQuery): Promise<{ total: number; devices: DeviceRow[] }> {
    const q = o.q.toLowerCase().replace(/[^0-9a-f]/g, "");
    const where: string[] = [];
    const args: SqlArg[] = [];
    const text = o.q.trim().toLowerCase();
    if (text) {
      // A device id is the first 8 characters of the hash: a short search matches anywhere in it, a longer one is a prefix of the hash.
      // Whatever was typed is also looked for in the alias.
      const asId = q === text && q.length > 0;
      const idTest = q.length > DEVICE_ID_CHARS ? `i.install_hash LIKE ?` : `substr(i.install_hash, 1, ${DEVICE_ID_CHARS}) LIKE ?`;
      where.push(asId ? `(${idTest} OR LOWER(i.alias) LIKE ? ESCAPE '\\')` : `LOWER(i.alias) LIKE ? ESCAPE '\\'`);
      if (asId) args.push(q.length > DEVICE_ID_CHARS ? `${q}%` : `%${q}%`);
      args.push(`%${likeEscape(text)}%`);
    }
    const t = this.d.now();
    const filters: Record<DeviceQuery["status"], string> = {
      all: "1",
      disabled: "i.disabled = 1",
      custom: "(i.daily_limit IS NOT NULL OR i.hourly_limit IS NOT NULL)",
      limited: "i.limit_hits > 0",
      active: `i.last_seen >= ${t - DAY_MS}`,
    };
    where.push(filters[o.status] ?? "1");
    const cond = where.join(" AND ");
    const order = { lastSeen: "i.last_seen", firstSeen: "i.first_seen", checks: "i.checks", today: "today", errors: "errors", votes: "votes", limitHits: "i.limit_hits" }[o.sort] ?? "i.last_seen";
    const total = num((await this.d.db.execute(`SELECT COUNT(*) n FROM installs i WHERE ${cond}`, args)).rows[0]?.n);
    const r = await this.d.db.execute(
      `SELECT i.install_hash h, i.first_seen, i.last_seen, i.checks, i.limit_hits, i.disabled, i.disabled_reason, i.daily_limit, i.hourly_limit, i.alias,
              COALESCE(u.checks, 0) today,
              (SELECT COUNT(*) FROM events e WHERE e.install_hash = i.install_hash AND e.kind = 'error') errors,
              (SELECT COUNT(*) FROM votes v WHERE v.install_hash = i.install_hash) votes
       FROM installs i LEFT JOIN usage u ON u.install_hash = i.install_hash AND u.day = ?
       WHERE ${cond} ORDER BY ${order} ${o.dir === "asc" ? "ASC" : "DESC"}, i.install_hash LIMIT ? OFFSET ?`,
      [dayKey(t), ...args, o.limit, o.offset],
    );
    return {
      total,
      devices: r.rows.map((row) => ({
        device: deviceId(String(row.h)),
        firstSeen: num(row.first_seen),
        lastSeen: num(row.last_seen),
        checks: num(row.checks),
        today: num(row.today),
        limitHits: num(row.limit_hits),
        errors: num(row.errors),
        votes: num(row.votes),
        disabled: num(row.disabled) === 1,
        disabledReason: (row.disabled_reason as string | null) ?? null,
        dailyLimit: row.daily_limit == null ? null : num(row.daily_limit),
        hourlyLimit: row.hourly_limit == null ? null : num(row.hourly_limit),
        alias: (row.alias as string | null) ?? null,
      })),
    };
  }

  /** Names an install (or, with null, removes the name). */
  async setAlias(hash: string, alias: string | null): Promise<void> {
    await this.d.db.execute(`UPDATE installs SET alias = ? WHERE install_hash = ?`, [alias, hash]);
  }

  async listDisabled(): Promise<DisabledClient[]> {
    const r = await this.d.db.execute(`SELECT install_hash, disabled_at, disabled_reason, checks, last_seen FROM installs WHERE disabled = 1 ORDER BY disabled_at DESC LIMIT ${DISABLED_LIST_LIMIT}`);
    return r.rows.map((row) => ({
      device: deviceId(String(row.install_hash)),
      disabledAt: row.disabled_at == null ? null : num(row.disabled_at),
      reason: (row.disabled_reason as string | null) ?? null,
      checks: num(row.checks),
      lastSeen: num(row.last_seen),
    }));
  }
}

/** A search term made safe to use inside LIKE: % and _ match themselves. */
export const likeEscape = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The short id the dashboard shows for an install. */
export const deviceId = (installHash: string) => installHash.slice(0, DEVICE_ID_CHARS);
