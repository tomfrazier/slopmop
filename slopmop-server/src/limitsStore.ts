import { WEIGHT_CACHE_MS } from "./constants.js";
import type { Db } from "./db/types.js";
import { historyInsert, readHistory } from "./settingHistory.js";

/**
 * The default limits every install starts with. `dailyLimit`: checks per install per UTC day. `ipHourlyLimit`: checks per source
 * IP per UTC hour. Either can be overridden for one install (installs.daily_limit / hourly_limit); an install with no override
 * follows these, so changing them here changes every install that hasn't been given its own.
 */
export interface Limits {
  dailyLimit: number;
  ipHourlyLimit: number;
}

const KEY = "limits";
export const MAX_LIMIT = 1_000_000;
export const isLimit = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_LIMIT;

/** The limits from admin input (missing values keep the defaults), or a message saying what is wrong. */
export function validateLimits(input: unknown, defaults: Limits): Limits | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "limits must be an object.";
  const raw = input as Partial<Record<keyof Limits, unknown>>;
  const dailyLimit = raw.dailyLimit ?? defaults.dailyLimit;
  const ipHourlyLimit = raw.ipHourlyLimit ?? defaults.ipHourlyLimit;
  if (!isLimit(dailyLimit)) return `dailyLimit must be a whole number from 1 to ${MAX_LIMIT}.`;
  if (!isLimit(ipHourlyLimit)) return `ipHourlyLimit must be a whole number from 1 to ${MAX_LIMIT}.`;
  return { dailyLimit, ipHourlyLimit };
}

/** The live default limits: stored in the database, read through a short cache, falling back to the environment's values. */
export class LimitsStore {
  private cache: { at: number; value: Limits } | null = null;

  constructor(
    private readonly db: Db,
    readonly fallback: Limits,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = WEIGHT_CACHE_MS,
  ) {}

  async current(): Promise<Limits> {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache.value;
    let value = this.fallback;
    try {
      const row = (await this.db.execute(`SELECT value FROM settings WHERE key = ?`, [KEY])).rows[0];
      const parsed = row ? validateLimits(JSON.parse(String(row.value)), this.fallback) : null;
      if (parsed && typeof parsed !== "string") value = parsed;
    } catch (e) {
      console.error("[slopmop] could not read default limits", e instanceof Error ? e.name : String(e));
      if (this.cache) return this.cache.value;
    }
    this.cache = { at: t, value };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  async save(limits: Limits, note: string | null = null): Promise<void> {
    const t = this.now();
    await this.db.batch([
      { sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [KEY, JSON.stringify(limits), t] },
      historyInsert(KEY, t, limits, note, "admin"),
    ]);
    this.invalidate();
  }

  async reset(note: string | null = null): Promise<void> {
    await this.db.batch([{ sql: `DELETE FROM settings WHERE key = ?`, args: [KEY] }, historyInsert(KEY, this.now(), this.fallback, note, "reset")]);
    this.invalidate();
  }

  history(limit?: number) {
    return readHistory(this.db, KEY, limit);
  }
}
