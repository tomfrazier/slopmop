import { DAY_MS, HOUR_MS } from "../constants.js";
import type { Row, SqlArg } from "../db/types.js";
import { num, parseJson } from "../repos/shared.js";
import type { Limits } from "../limitsStore.js";
import type { Store } from "../store.js";
import { buckets, type Unit, type Zone } from "./zone.js";

export { num, parseJson };

export const RANGES = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS } as const;
export type RangeKey = keyof typeof RANGES;

/** AI-likelihood at or above this counts as "AI-likely" in the summary figures. */
export const AI_LIKELY = 0.5;
/** How each range is charted unless the admin picks otherwise, and which bucket sizes make sense for it. */
export const DEFAULT_UNIT: Record<RangeKey, Unit> = { "24h": "hour", "7d": "day", "30d": "week", "90d": "month" };
export const UNITS_FOR: Record<RangeKey, readonly Unit[]> = { "24h": ["hour"], "7d": ["hour", "day"], "30d": ["day", "week"], "90d": ["day", "week", "month"] };
/** The projection extrapolates the spend of this many recent days over a 30-day month. */
export const PROJECTION_DAYS = 7;
export const DAYS_PER_MONTH = 30;

export const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/** What every stats section needs: the time window, the optional network filter, and a way to ask the database. */
export interface Scope {
  store: Store;
  now: number;
  /** Start of the window: the range back from now, to the hour. */
  since: number;
  /** The admin's timezone: days, weeks and months start at its midnight. */
  tz: Zone;
  /** What the charts count by. */
  unit: Unit;
  /** The chart buckets, [t, end): the first starts at `since` (so it may be a partial unit), the rest on unit boundaries. */
  buckets: { t: number; end: number }[];
  /** Length of the whole range in ms. */
  span: number;
  net: string | null;
  /** The default limits in force now (an install may have its own, which the queries read from the installs table). */
  limits: Limits;
  cost: (inputTokens: number, outputTokens: number) => number;
  q: (sql: string, args?: SqlArg[]) => Promise<Row[]>;
  /** `AND <col> = ?` when a network is selected, else empty. `col` lets a query alias the table. */
  netSql: (col?: string) => string;
  netArgs: () => SqlArg[];
}

export function makeScope(store: Store, opts: { range: RangeKey; network?: string | null; limits?: Limits; tz?: Zone; unit?: Unit }): Scope {
  const { config } = store;
  const now = store.now();
  const span = RANGES[opts.range];
  const tz = opts.tz ?? "UTC";
  const unit = opts.unit && UNITS_FOR[opts.range].includes(opts.unit) ? opts.unit : DEFAULT_UNIT[opts.range];
  const since = Math.floor((now - span) / HOUR_MS) * HOUR_MS;
  const net = opts.network || null;
  return {
    store,
    limits: opts.limits ?? { dailyLimit: config.dailyLimit, ipHourlyLimit: config.ipHourlyLimit },
    now,
    span,
    since,
    tz,
    unit,
    buckets: buckets(since, now, unit, tz),
    net,
    cost: (tin, tout) => (tin * config.inputUsdPerM + tout * config.outputUsdPerM) / 1e6,
    q: async (sql, args = []) => (await store.db.execute(sql, args)).rows,
    netSql: (col = "network") => (net ? ` AND ${col} = ?` : ""),
    netArgs: () => (net ? [net] : []),
  };
}
