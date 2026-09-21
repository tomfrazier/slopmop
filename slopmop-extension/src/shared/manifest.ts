import type { Sensitivity } from "./types";

/**
 * The fixed values the extension runs on. The server publishes them as a manifest (see the server's manifest.ts) that the
 * extension keeps for a day and refreshes when an answer reports a newer version, so any of them can change without a new
 * release. These defaults are what applies before the first manifest arrives, and for any value the manifest leaves out.
 */
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface ManifestValues {
  // requests
  requestTimeoutMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxRetryPauseMs: number;
  maxRateLimitWaits: number;
  maxRateLimitPauseS: number;
  defaultRateLimitPauseS: number;
  blockedRecheckMs: number;
  // saved answers
  cacheTtlMs: number;
  engagementBandGrowth: number;
  // the feed
  lookaheadPx: number;
  dropBeyondPx: number;
  scrollHintMs: number;
  rescanDelayMs: number;
  postRetryDelaysMs: number[];
  minChars: number;
  minOwnChars: number;
  // finishing a decision
  yellowFraction: number;
  minMeanConfidence: number;
  aiDampen: number;
  strongSign: number;
  flaggedSign: number;
  // display
  displayPossibly: number;
  displayLikely: number;
  displayFullMultiple: number;
  defaultDailyLimit: number;
}

export const DEFAULT_MANIFEST: ManifestValues = {
  requestTimeoutMs: 15 * SECOND_MS,
  maxAttempts: 3,
  baseBackoffMs: 500,
  maxRetryPauseMs: 8 * SECOND_MS,
  maxRateLimitWaits: 5,
  maxRateLimitPauseS: 60,
  defaultRateLimitPauseS: 5,
  blockedRecheckMs: HOUR_MS,
  cacheTtlMs: 7 * DAY_MS,
  engagementBandGrowth: 1.25,
  lookaheadPx: 1500,
  dropBeyondPx: 200,
  scrollHintMs: 200,
  rescanDelayMs: 250,
  postRetryDelaysMs: [8 * SECOND_MS, 30 * SECOND_MS, 90 * SECOND_MS],
  minChars: 200,
  minOwnChars: 60,
  yellowFraction: 0.6,
  minMeanConfidence: 0.25,
  aiDampen: 0.35,
  strongSign: 0.4,
  flaggedSign: 0.2,
  displayPossibly: 40,
  displayLikely: 70,
  displayFullMultiple: 2,
  defaultDailyLimit: 250,
};

export type Thresholds = Record<Sensitivity, number>;

/** What the background worker keeps in chrome.storage.local. */
export interface StoredManifest {
  version: string;
  values: Partial<ManifestValues>;
  thresholds: Thresholds;
  /** When it was fetched, and how long the server said to keep it. */
  at: number;
  ttlMs: number;
}
export const MANIFEST_KEY = "manifest";

/** The values in force in this script. Read `live.values.x` where the value is used, never at import time. */
export const live: { values: ManifestValues; thresholds: Thresholds | null; version: string | null } = { values: { ...DEFAULT_MANIFEST }, thresholds: null, version: null };

const okThresholds = (t: unknown): t is Thresholds => {
  const x = t as Thresholds | undefined;
  const ok = (n: unknown) => typeof n === "number" && n > 0 && n <= 1;
  return !!x && ok(x.aggressive) && ok(x.moderate) && ok(x.mild) && x.aggressive <= x.moderate && x.moderate <= x.mild;
};

/** Keeps only values of the right kind, so a bad manifest can never break a setting. */
function sane(values: unknown): Partial<ManifestValues> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(DEFAULT_MANIFEST)) {
    const v = (values as Record<string, unknown> | undefined)?.[key];
    if (Array.isArray(def)) {
      if (Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) out[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out as Partial<ManifestValues>;
}

/** Makes a stored manifest the one in force (or the defaults, when there is none or it is unusable). */
export function applyManifest(stored: unknown) {
  const s = stored as StoredManifest | undefined;
  live.values = { ...DEFAULT_MANIFEST, ...sane(s?.values) };
  live.thresholds = okThresholds(s?.thresholds) ? s!.thresholds : null;
  live.version = typeof s?.version === "string" ? s.version : null;
}

/** Loads the saved manifest and follows changes to it. Call once when a script starts. */
export async function watchManifest() {
  applyManifest((await chrome.storage.local.get(MANIFEST_KEY))[MANIFEST_KEY]);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[MANIFEST_KEY]) applyManifest(changes[MANIFEST_KEY].newValue);
  });
}

/** The manifest's own validation of a fetched body, for the background worker. */
export function toStored(body: unknown, now: number): StoredManifest | null {
  const b = body as { version?: unknown; ttlSeconds?: unknown; thresholds?: unknown; values?: unknown } | null;
  if (!b || typeof b.version !== "string" || typeof b.ttlSeconds !== "number" || b.ttlSeconds <= 0 || !okThresholds(b.thresholds)) return null;
  return { version: b.version, values: sane(b.values), thresholds: b.thresholds, at: now, ttlMs: b.ttlSeconds * SECOND_MS };
}
