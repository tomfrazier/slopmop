import { HOUR_MS, MINUTE_MS, DAY_MS } from "./constants.js";

/**
 * How long a Jev answer is reused before the post is scored again, with the engagement it has by then. The cadence follows
 * how fast the post is growing: the first answer is kept an hour; when a post has at least doubled since the last score, the
 * next wait is its doubling time (double in an hour and it is checked hourly, and so on while it keeps doubling); each time it
 * has not, the wait doubles (1h, 2h, 4h ...) until the curve has flattened. This is a server matter: many people see the same
 * post, and each of their requests carries a fresh count, so it is the server that decides when Jev is asked again.
 */
export interface RecheckConfig {
  /** How long a post's first score is kept. */
  initialMs: number;
  minMs: number;
  maxMs: number;
  /** Growth since the last score (a ratio) at or above which the post counts as still breaking out. */
  growth: number;
}
export const DEFAULT_RECHECK: RecheckConfig = { initialMs: HOUR_MS, minMs: 15 * MINUTE_MS, maxMs: 7 * DAY_MS, growth: 2 };
export const RECHECK_INITIAL_MS = DEFAULT_RECHECK.initialMs;
export const RECHECK_MIN_MS = DEFAULT_RECHECK.minMs;
export const RECHECK_MAX_MS = DEFAULT_RECHECK.maxMs;

export interface Schedule {
  /** Reactions + comments + reposts when the post was last scored. */
  total: number;
  /** When it was last scored. */
  at: number;
  /** How long that score was kept. */
  intervalMs: number;
}

export const engagementTotal = (e: { reactions: number; comments: number; reposts: number } | null): number => (e ? e.reactions + e.comments + e.reposts : 0);

const clamp = (ms: number, c: RecheckConfig) => Math.min(c.maxMs, Math.max(c.minMs, ms));

/** True when a stored score is due to be redone: it has no schedule (it predates this), or its wait is over. */
export const isDue = (prev: (Schedule & { nextAt: number | null }) | null, now: number) => !prev || prev.nextAt === null || now >= prev.nextAt;

/** How long to keep the score just made, given the one before it (null for a post's first score). */
export function nextInterval(prev: Schedule | null, now: number, total: number, c: RecheckConfig = DEFAULT_RECHECK): number {
  if (!prev) return c.initialMs;
  const growth = (total + 1) / (prev.total + 1);
  if (growth >= c.growth) return clamp((now - prev.at) / Math.log2(growth), c); // its doubling time
  return clamp(prev.intervalMs * 2, c);
}
