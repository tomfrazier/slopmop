import { createHash } from "node:crypto";
import { WEIGHT_CACHE_MS } from "./constants.js";
import type { Db } from "./db/types.js";
import { DAY_MS } from "./constants.js";
import { historyInsert, readHistory } from "./settingHistory.js";
import { DEFAULT_RECHECK, type RecheckConfig } from "./recheck.js";
import { DEFAULT_CORROBORATION, DEFAULT_ENGAGEMENT, DEFAULT_FORMULA, type Corroboration, type EngagementModel, type Formula } from "./scoring.js";

/** The score at which a post is flagged "possibly" is set by the extension (a fraction of these); "likely" and hidden posts start at the threshold. */
export interface Thresholds {
  aggressive: number;
  moderate: number;
  mild: number;
}

export interface Scoring {
  thresholds: Thresholds;
  engagement: EngagementModel;
  corroboration: Corroboration;
  formula: Formula;
  recheck: RecheckConfig;
}

/** Fitted on the first 27 hand votes; see the extension's decideParams.ts. */
export const DEFAULT_THRESHOLDS: Thresholds = { aggressive: 0.1, moderate: 0.18, mild: 0.22 };
export const DEFAULT_SCORING: Scoring = { thresholds: DEFAULT_THRESHOLDS, engagement: DEFAULT_ENGAGEMENT, corroboration: DEFAULT_CORROBORATION, formula: DEFAULT_FORMULA, recheck: DEFAULT_RECHECK };

/** How long a client may keep the thresholds before asking again. */
export const THRESHOLD_TTL_SECONDS = 24 * 60 * 60;

const KEY = "scoring";
const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** The allowed range for each editable number, [min, max]. */
const RANGES: Record<"engagement" | "corroboration" | "formula" | "recheck", Record<string, [number, number]>> = {
  engagement: { reaction: [0, 1000], comment: [0, 1000], repost: [0, 1000], hollowFrom: [0, 1_000_000], hollowRatio: [0, 1], hollowFloor: [0, 1], logScale: [1, 10] },
  corroboration: { breakout: [0, 1], minConfidence: [0, 1], needed: [1, 9], alone: [0, 1] },
  formula: { gain: [0.1, 10], humanOffset: [0, 1], usefulShare: [0, 1], maxShield: [0, 1], confidencePower: [0, 3] },
  recheck: { initialMs: [60_000, 30 * DAY_MS], minMs: [60_000, 30 * DAY_MS], maxMs: [60_000, 90 * DAY_MS], growth: [1.1, 100] },
};

/** The scoring settings from admin input (missing values keep their defaults), or a message saying what is wrong. */
export function validateScoring(input: unknown): Scoring | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "scoring must be an object.";
  const raw = input as Partial<Record<keyof Scoring, Record<string, unknown>>>;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...raw.thresholds } as Thresholds;
  for (const [k, v] of Object.entries(thresholds)) if (!num(v, 0.01, 1)) return `Threshold "${k}" must be a number from 0.01 to 1.`;
  if (!(thresholds.aggressive <= thresholds.moderate && thresholds.moderate <= thresholds.mild)) return "Thresholds must go aggressive <= moderate <= mild.";
  const groups = {
    engagement: { ...DEFAULT_ENGAGEMENT, ...raw.engagement },
    corroboration: { ...DEFAULT_CORROBORATION, ...raw.corroboration },
    formula: { ...DEFAULT_FORMULA, ...raw.formula },
    recheck: { ...DEFAULT_RECHECK, ...raw.recheck },
  };
  for (const [group, ranges] of Object.entries(RANGES) as [keyof typeof groups, Record<string, [number, number]>][]) {
    for (const [key, [min, max]] of Object.entries(ranges)) {
      if (!num((groups[group] as Record<string, unknown>)[key], min, max)) return `${group} "${key}" must be a number from ${min} to ${max}.`;
    }
  }
  const { engagement, corroboration, recheck } = groups;
  if (engagement.reaction === 0 && engagement.comment === 0 && engagement.repost === 0) return "At least one engagement weight must be above 0.";
  if (!Number.isInteger(corroboration.needed)) return "corroboration \"needed\" must be a whole number from 1 to 9.";
  if (!(recheck.minMs <= recheck.initialMs && recheck.initialMs <= recheck.maxMs)) return "recheck times must go minMs <= initialMs <= maxMs.";
  return { thresholds, ...groups } as Scoring;
}

/** Changes whenever the engagement model does (thresholds don't change what the server computes). */
export const modelVersion = (weightsVersion: string, m: EngagementModel, c: Corroboration = DEFAULT_CORROBORATION, f: Formula = DEFAULT_FORMULA) =>
  createHash("sha256").update(`${weightsVersion}:${JSON.stringify(Object.entries(m).sort())}:${JSON.stringify(Object.entries(c).sort())}:${JSON.stringify(Object.entries(f).sort())}`).digest("hex").slice(0, 12);

/**
 * The live scoring settings: the "likely" thresholds for the three sensitivities (sent to every client, which keeps them for
 * a day) and the reader-response model. Stored in the database, read through a short cache like the weights, and the
 * defaults apply when nothing is stored or the database can't be read.
 */
export class ScoringStore {
  private cache: { at: number; value: Scoring } | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = WEIGHT_CACHE_MS,
  ) {}

  async current(): Promise<Scoring> {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache.value;
    let value = DEFAULT_SCORING;
    try {
      const row = (await this.db.execute(`SELECT value FROM settings WHERE key = ?`, [KEY])).rows[0];
      const parsed = row ? validateScoring(JSON.parse(String(row.value))) : null;
      if (parsed && typeof parsed !== "string") value = parsed;
    } catch (e) {
      console.error("[slopmop] could not read scoring settings", e instanceof Error ? e.name : String(e));
      if (this.cache) return this.cache.value;
    }
    this.cache = { at: t, value };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  async save(scoring: Scoring, note: string | null = null): Promise<void> {
    const t = this.now();
    await this.db.batch([
      { sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [KEY, JSON.stringify(scoring), t] },
      historyInsert(KEY, t, scoring, note, "admin"),
    ]);
    this.invalidate();
  }

  async reset(note: string | null = null): Promise<void> {
    await this.db.batch([{ sql: `DELETE FROM settings WHERE key = ?`, args: [KEY] }, historyInsert(KEY, this.now(), DEFAULT_SCORING, note, "reset")]);
    this.invalidate();
  }

  history(limit?: number) {
    return readHistory(this.db, KEY, limit);
  }
}
