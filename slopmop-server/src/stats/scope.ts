import { DAY_MS, HOUR_MS } from "../constants.js";
import type { Row, SqlArg } from "../db/types.js";
import { num, parseJson } from "../repos/shared.js";
import type { Limits } from "../limitsStore.js";
import type { Store } from "../store.js";

export { num, parseJson };

export const RANGES = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, "90d": 90 * DAY_MS } as const;
export type RangeKey = keyof typeof RANGES;

/** AI-likelihood at or above this counts as "AI-likely" in the summary figures. */
export const AI_LIKELY = 0.5;
/** Ranges up to this long are charted per hour; longer ones per day. */
export const HOURLY_UP_TO_MS = 7 * DAY_MS;
/** The projection extrapolates the spend of this many recent days over a 30-day month. */
export const PROJECTION_DAYS = 7;
export const DAYS_PER_MONTH = 30;

export const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/** What every stats section needs: the time window, the optional network filter, and a way to ask the database. */
export interface Scope {
  store: Store;
  now: number;
  /** Start of the window, aligned to a bucket boundary. */
  since: number;
  /** Bucket size in ms (an hour or a day). */
  size: number;
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

export function makeScope(store: Store, opts: { range: RangeKey; network?: string | null; limits?: Limits }): Scope {
  const { config } = store;
  const now = store.now();
  const span = RANGES[opts.range];
  const size = span <= HOURLY_UP_TO_MS ? HOUR_MS : DAY_MS;
  const net = opts.network || null;
  return {
    store,
    limits: opts.limits ?? { dailyLimit: config.dailyLimit, ipHourlyLimit: config.ipHourlyLimit },
    now,
    span,
    size,
    since: Math.floor((now - span) / size) * size,
    net,
    cost: (tin, tout) => (tin * config.inputUsdPerM + tout * config.outputUsdPerM) / 1e6,
    q: async (sql, args = []) => (await store.db.execute(sql, args)).rows,
    netSql: (col = "network") => (net ? ` AND ${col} = ?` : ""),
    netArgs: () => (net ? [net] : []),
  };
}
