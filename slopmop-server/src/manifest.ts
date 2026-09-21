import { createHash } from "node:crypto";
import { DAY_MS, HOUR_MS, SECOND_MS, WEIGHT_CACHE_MS } from "./constants.js";
import type { Db } from "./db/types.js";
import { historyInsert, readHistory } from "./settingHistory.js";
import type { Thresholds } from "./scoringStore.js";

/**
 * The client manifest: every fixed value the extension uses to talk to this server, watch the feed and finish a decision,
 * so any of them can be changed here without a new release of the extension. The extension keeps the last manifest for a day
 * and is told a new version exists by every answer it gets (`manifestVersion`), when it asks for the manifest again.
 * The defaults below are the values the extension ships with; the admin dashboard edits the ones that differ.
 */
export type ManifestValue = number | number[];
export type ManifestValues = Record<string, ManifestValue>;

export interface ManifestField {
  key: string;
  group: "requests" | "cache" | "feed" | "scoring" | "display";
  label: string;
  note: string;
  min: number;
  max: number;
  value: ManifestValue;
}

const f = (group: ManifestField["group"], key: string, label: string, value: ManifestValue, min: number, max: number, note: string): ManifestField => ({ group, key, label, note, min, max, value });

export const MANIFEST_FIELDS: readonly ManifestField[] = [
  // ---- requests: talking to this server ----
  f("requests", "requestTimeoutMs", "Give up on a request after (ms)", 15 * SECOND_MS, 1000, 120_000, "A hung request must not hold a slot forever."),
  f("requests", "maxAttempts", "Tries per post", 3, 1, 10, "A rate-limit wait doesn't count as a try."),
  f("requests", "baseBackoffMs", "First retry pause (ms)", 500, 50, 10_000, "Doubles on each try."),
  f("requests", "maxRetryPauseMs", "Longest retry pause (ms)", 8 * SECOND_MS, 500, 120_000, "However long the server asks for, never wait longer."),
  f("requests", "maxRateLimitWaits", "Rate-limit waits per post", 5, 0, 20, "How many times one post waits out a 'slow down'."),
  f("requests", "maxRateLimitPauseS", "Longest rate-limit wait (s)", 60, 1, 600, "The longest 'slow down' that is honoured."),
  f("requests", "defaultRateLimitPauseS", "Rate-limit wait when none is given (s)", 5, 1, 120, "A guess for when the server doesn't say."),
  f("requests", "blockedRecheckMs", "Look again after being disabled (ms)", HOUR_MS, 60_000, DAY_MS, "How often a disabled install checks whether it is back."),
  // ---- cache: what the extension remembers ----
  f("cache", "cacheTtlMs", "Trust a saved answer for (ms)", 7 * DAY_MS, HOUR_MS, 90 * DAY_MS, "After this the post is asked about again."),
  f("cache", "engagementBandGrowth", "Ask again when engagement grows by", 1.25, 1.05, 10, "A ratio: 1.25 = a quarter more reactions, comments and reposts together. The server decides whether Jev is re-run."),
  // ---- feed: watching LinkedIn ----
  f("feed", "lookaheadPx", "Check posts this far ahead of the viewport (px)", 1500, 0, 10_000, "Posts are scored before they scroll into view."),
  f("feed", "dropBeyondPx", "Drop queued posts this far past that (px)", 200, 0, 10_000, "Scrolled past while still waiting: never sent."),
  f("feed", "scrollHintMs", "Tell the queue where posts are every (ms)", 200, 50, 5000, "While scrolling."),
  f("feed", "rescanDelayMs", "Look for new posts after a page change (ms)", 250, 50, 5000, "A short pause so a burst of changes is handled once."),
  f("feed", "postRetryDelaysMs", "Retry a failed post after (ms, each)", [8000, 30_000, 90_000], 1000, 600_000, "One delay per retry."),
  f("feed", "minChars", "Shortest post to score (characters)", 200, 20, 5000, "Shorter posts are left alone."),
  f("feed", "minOwnChars", "Shortest post of your own to score", 60, 20, 5000, "Your own posts are scored from a shorter length."),
  // ---- scoring: finishing a decision ----
  f("scoring", "yellowFraction", "Where 'possibly' starts (share of the threshold)", 0.6, 0.1, 0.95, "0.6 = a post scoring 60% of the way to 'likely' is 'possibly slop'."),
  f("scoring", "minMeanConfidence", "Lowest average Jev confidence to act on", 0.25, 0, 1, "Below this the post is left alone."),
  f("scoring", "aiDampen", "Score reduction for posts that read human-written", 0.35, 0, 1, "0 = no reduction; 1 = a person-written post could never be flagged."),
  f("scoring", "strongSign", "A tell counts as a strong sign from", 0.4, 0, 1, "Used to name 'strongest signs' on posts that were not flagged."),
  f("scoring", "flaggedSign", "A tell counts as a sign on a flagged post from", 0.2, 0, 1, "Used to name 'strongest signs' on flagged posts."),
  // ---- display ----
  f("display", "displayPossibly", "Shown score where 'possibly slop' starts", 40, 5, 60, "The shown 0-100 score is stretched so the thresholds sit at readable numbers. The raw score and every verdict are unchanged."),
  f("display", "displayLikely", "Shown score at the Moderate 'likely slop' threshold", 70, 50, 95, "A post flagged at Moderate reads this or higher."),
  f("display", "displayFullMultiple", "Shown score reaches 100 at this many times the Moderate threshold", 2, 1.2, 10, "A ratio: 2 = twice the Moderate threshold."),
  f("display", "defaultDailyLimit", "Daily limit to show before the server has said (checks)", 250, 1, 100_000, "Only shown until the first answer arrives."),
];

export const MANIFEST_DEFAULTS: ManifestValues = Object.fromEntries(MANIFEST_FIELDS.map((x) => [x.key, x.value]));

/** How long the extension keeps a manifest before asking again. */
export const MANIFEST_TTL_SECONDS = DAY_MS / SECOND_MS;

const inRange = (v: unknown, x: ManifestField) => typeof v === "number" && Number.isFinite(v) && v >= x.min && v <= x.max;

/** The values to store from admin input (only what differs from the defaults), or a message saying what is wrong. */
export function validateManifest(input: unknown): ManifestValues | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "values must be an object of setting name to number.";
  const out: ManifestValues = {};
  for (const [key, v] of Object.entries(input)) {
    const field = MANIFEST_FIELDS.find((x) => x.key === key);
    if (!field) return `Unknown setting "${key}".`;
    if (Array.isArray(field.value)) {
      if (!Array.isArray(v) || v.length === 0 || v.length > 20 || !v.every((n) => inRange(n, field))) return `"${key}" must be a list of 1 to 20 numbers from ${field.min} to ${field.max}.`;
    } else if (!inRange(v, field)) return `"${key}" must be a number from ${field.min} to ${field.max}.`;
    if (JSON.stringify(v) !== JSON.stringify(field.value)) out[key] = v as ManifestValue;
  }
  const merged = { ...MANIFEST_DEFAULTS, ...out };
  if (!((merged.displayPossibly as number) < (merged.displayLikely as number))) return "displayPossibly must be lower than displayLikely.";
  return out;
}

/** What the client receives: the defaults with the overrides on top, the thresholds, and a version that changes when any of it does. */
export interface ClientManifest {
  version: string;
  ttlSeconds: number;
  thresholds: Thresholds;
  values: ManifestValues;
}

export function buildManifest(overrides: ManifestValues, thresholds: Thresholds): ClientManifest {
  const values = { ...MANIFEST_DEFAULTS, ...overrides };
  const version = createHash("sha256").update(JSON.stringify([Object.entries(values).sort(), Object.entries(thresholds).sort()])).digest("hex").slice(0, 12);
  return { version, ttlSeconds: MANIFEST_TTL_SECONDS, thresholds, values };
}

const KEY = "manifest";

/** The manifest overrides, kept in the database and read through a short cache like the weights. */
export class ManifestStore {
  private cache: { at: number; value: ManifestValues } | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = WEIGHT_CACHE_MS,
  ) {}

  async overrides(): Promise<ManifestValues> {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache.value;
    let value: ManifestValues = {};
    try {
      const row = (await this.db.execute(`SELECT value FROM settings WHERE key = ?`, [KEY])).rows[0];
      const parsed = row ? validateManifest(JSON.parse(String(row.value))) : {};
      if (typeof parsed !== "string") value = parsed;
    } catch (e) {
      console.error("[slopmop] could not read the client manifest", e instanceof Error ? e.name : String(e));
      if (this.cache) return this.cache.value;
    }
    this.cache = { at: t, value };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  async save(overrides: ManifestValues, note: string | null = null): Promise<void> {
    const t = this.now();
    await this.db.batch([
      { sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [KEY, JSON.stringify(overrides), t] },
      historyInsert(KEY, t, overrides, note, "admin"),
    ]);
    this.invalidate();
  }

  async reset(note: string | null = null): Promise<void> {
    await this.db.batch([{ sql: `DELETE FROM settings WHERE key = ?`, args: [KEY] }, historyInsert(KEY, this.now(), {}, note, "reset")]);
    this.invalidate();
  }

  history(limit?: number) {
    return readHistory(this.db, KEY, limit);
  }
}
