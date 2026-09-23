import { APIError, RateLimitError } from "@typesafe-ai/sdk";
import type { Env } from "./config.js";

export interface Tuning {
  /** Start a second request if the first hasn't answered by then. */
  hedgeAfterMs: number;
  /** Give up on a single request after this long. */
  attemptTimeoutMs: number;
  maxAttempts: number;
  /** When rate limited, wait (the upstream's Retry-After, kept between these bounds) and ask again this many times. */
  rateLimitRetries: number;
  minPauseMs: number;
  maxPauseMs: number;
  /** How many Jev calls one server instance runs at once; the rest wait up to `queueWaitMs`. */
  maxConcurrent: number;
  queueWaitMs: number;
}
/** How long to wait when the upstream rate-limits us without saying for how long, and the random extra so retries spread out. */
export const DEFAULT_RATE_LIMIT_PAUSE_MS = 1000;
export const RATE_LIMIT_JITTER_MS = 250;
export const DEFAULT_TUNING: Tuning = { hedgeAfterMs: 1500, attemptTimeoutMs: 5000, maxAttempts: 3, rateLimitRetries: 2, minPauseMs: 500, maxPauseMs: 2500, maxConcurrent: 6, queueWaitMs: 8000 };

const ms = (v: string | undefined, fallback: number, min: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};
export const tuningFrom = (env: Env): Tuning => ({
  hedgeAfterMs: ms(env.JEV_HEDGE_MS, DEFAULT_TUNING.hedgeAfterMs, 100),
  attemptTimeoutMs: ms(env.JEV_ATTEMPT_TIMEOUT_MS, DEFAULT_TUNING.attemptTimeoutMs, 500),
  maxAttempts: ms(env.JEV_MAX_ATTEMPTS, DEFAULT_TUNING.maxAttempts, 1),
  rateLimitRetries: ms(env.JEV_RATE_LIMIT_RETRIES, DEFAULT_TUNING.rateLimitRetries, 0),
  minPauseMs: DEFAULT_TUNING.minPauseMs,
  maxPauseMs: DEFAULT_TUNING.maxPauseMs,
  maxConcurrent: ms(env.JEV_MAX_CONCURRENT, DEFAULT_TUNING.maxConcurrent, 1),
  queueWaitMs: ms(env.JEV_QUEUE_WAIT_MS, DEFAULT_TUNING.queueWaitMs, 0),
});

/** A stall, a dropped connection or a 5xx is worth asking again; a rejected key, bad input or rate limit is not. */
export function retryable(e: unknown): boolean {
  if (e instanceof RateLimitError) return false;
  if (e instanceof APIError) return e.status === 408 || e.status >= 500;
  return true;
}
