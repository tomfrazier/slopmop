/** Named values used across the extension, so no rule is an unexplained number in the middle of some logic. */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// ---- talking to the server ----
// (the timeouts, retry counts and waits live in the server's manifest: see shared/manifest.ts)
/** Statuses that are worth retrying: rate limited, upstream overloaded, bad gateway, unavailable. */
export const TRANSIENT_STATUSES: readonly number[] = [429, 502, 503, 529];

// ---- what the server tells us to do, until it has told us ----
/** A modest start; the server's policy replaces it as soon as any answer arrives. */
export const FALLBACK_POLICY = { maxConcurrent: 2, ratePerMinute: 30 };
export const POLICY_MAX_CONCURRENT = 32;
export const POLICY_MAX_RATE_PER_MINUTE = 10_000;
/** Extra wait added to a scheduled queue restart so it never fires a hair early. */
export const PUMP_SLACK_MS = 25;

// ---- watching the feed ----
/** Where a re-check for a post that gained engagement queues: right behind whatever is on screen. */
export const RECHECK_PRIORITY = 1;

// ---- toolbar badge colours ----
export const BADGE = { hidden: "#D93025", off: "#6E757D", debug: "#2F6FBF", error: "#D93025" };
