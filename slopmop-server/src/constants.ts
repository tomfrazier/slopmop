/** Named values used across the server, so no rule is an unexplained number in the middle of some logic. */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// ---- limits on what clients may send ----
/** Largest request body accepted (a post is at most a few thousand characters). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Engagement counts above this are treated as garbage and ignored. */
export const MAX_ENGAGEMENT_COUNT = 1e10;
/** Admin notes and reasons are cut to this many characters. */
export const MAX_NOTE_CHARS = 200;

// ---- per-install rate limit and the daily cap ----
/** The window the per-install requests-per-minute limit is counted over. */
export const RATE_WINDOW_MS = MINUTE_MS;
/** How many days of per-day usage counters to keep (only today's matters for the cap). */
export const USAGE_KEEP_DAYS = 3;
/** Retry-After (seconds) sent when the scoring model is busy. */
export const UPSTREAM_BUSY_RETRY_AFTER_S = 3;
/** Never tell a client to retry sooner than this. */
export const MIN_RETRY_AFTER_MS = SECOND_MS;

// ---- per-IP protection (independent of the install id, which a script can make up freely) ----
/** How many days of hourly per-IP usage counters to keep. */
export const IP_USAGE_KEEP_HOURS = 72;
/** How often the AWS/GCP datacenter range lists are refreshed. */
export const DATACENTER_LIST_TTL_MS = 24 * HOUR_MS;
/** How long a range-list fetch may take before it's treated as failed (never blocks a request longer than this). */
export const DATACENTER_LIST_TIMEOUT_MS = 5 * SECOND_MS;

// ---- the activity log ----
/** Each write to the log has this chance of also pruning old rows, so no separate cleanup job is needed. */
export const EVENT_PRUNE_CHANCE = 0.01;

// ---- admin ----
/** Devices are shown, and can be addressed, by this many leading characters of the salted install hash. */
export const DEVICE_ID_CHARS = 8;
/** Shortest and longest prefix accepted when looking a device up. */
export const DEVICE_PREFIX_MIN = 6;
export const DEVICE_PREFIX_MAX = 32;
/** Most disabled clients listed. */
export const DISABLED_LIST_LIMIT = 200;
/** Export rows: default and hard maximum. */
export const EXPORT_DEFAULT_LIMIT = 1000;
export const EXPORT_MAX_LIMIT = 10_000;
/** Most labelled posts read when suggesting weights. */
export const SUGGESTION_MAX_ROWS = 5000;
/** How many weight changes the history shows. */
export const WEIGHT_HISTORY_LIMIT = 15;

// ---- tell weights ----
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 100;
/** How long a server instance reuses the weights it read, so an edit reaches every instance within about this long. */
export const WEIGHT_CACHE_MS = 10 * SECOND_MS;
