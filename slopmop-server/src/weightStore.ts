import { createHash } from "node:crypto";
import { WEIGHT_CACHE_MS, WEIGHT_HISTORY_LIMIT } from "./constants.js";
import type { Db } from "./db/types.js";
import { validateWeights, type Weights } from "./weights.js";

export type WeightSource = "live" | "env" | "default";

export interface EffectiveWeights {
  weights: Weights;
  /** Changes whenever the weights do. Sent to clients so they can tell their saved answers are out of date. Not reversible. */
  version: string;
  /** live = edited in the admin dashboard; env = TELL_WEIGHTS; default = every tell 1. */
  source: WeightSource;
}

export interface WeightChange {
  at: number;
  weights: Weights;
  note: string | null;
  source: "admin" | "reset";
}

export const versionOf = (w: Weights) =>
  createHash("sha256")
    .update(JSON.stringify(Object.keys(w).sort().map((k) => [k, w[k]])))
    .digest("hex")
    .slice(0, 12);

/**
 * The weights in force. The admin dashboard can edit them live (stored in the database, shared by every server instance);
 * otherwise TELL_WEIGHTS, otherwise 1 for every tell. Read through a short in-memory cache (`ttlMs`), so an edit reaches
 * every instance within seconds and a request rarely pays for a database read. If the database can't be read, the last
 * known weights (or the environment's) are used: scoring never fails because of this.
 */
export class WeightStore {
  private cache: { at: number; value: EffectiveWeights } | null = null;

  constructor(
    private readonly db: Db,
    private readonly env: { weights: Weights; custom: boolean },
    private readonly now: () => number = Date.now,
    private readonly ttlMs = WEIGHT_CACHE_MS,
  ) {}

  baseline(): EffectiveWeights {
    return { weights: this.env.weights, version: versionOf(this.env.weights), source: this.env.custom ? "env" : "default" };
  }

  async current(): Promise<EffectiveWeights> {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache.value;
    let value = this.baseline();
    try {
      const row = (await this.db.execute(`SELECT value FROM settings WHERE key = 'tell_weights'`)).rows[0];
      if (row) {
        const parsed = validateWeights(JSON.parse(String(row.value)));
        if (typeof parsed !== "string") value = { weights: parsed, version: versionOf(parsed), source: "live" };
      }
    } catch (e) {
      console.error("[slopmop] could not read live weights", e instanceof Error ? e.name : String(e));
      if (this.cache) return this.cache.value;
    }
    this.cache = { at: t, value };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  async save(weights: Weights, note: string | null): Promise<void> {
    const t = this.now();
    const json = JSON.stringify(weights);
    await this.db.batch([
      { sql: `INSERT INTO settings (key, value, updated_at) VALUES ('tell_weights', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [json, t] },
      { sql: `INSERT INTO weight_history (at, weights, note, source) VALUES (?, ?, ?, 'admin')`, args: [t, json, note] },
    ]);
    this.invalidate();
  }

  /** Drops the live edit, so the environment's (or the default) weights apply again. */
  async reset(note: string | null): Promise<void> {
    const base = this.baseline();
    await this.db.batch([
      { sql: `DELETE FROM settings WHERE key = 'tell_weights'` },
      { sql: `INSERT INTO weight_history (at, weights, note, source) VALUES (?, ?, ?, 'reset')`, args: [this.now(), JSON.stringify(base.weights), note] },
    ]);
    this.invalidate();
  }

  async history(limit = WEIGHT_HISTORY_LIMIT): Promise<WeightChange[]> {
    const r = await this.db.execute(`SELECT at, weights, note, source FROM weight_history ORDER BY id DESC LIMIT ?`, [limit]);
    return r.rows.map((row) => ({ at: Number(row.at), weights: JSON.parse(String(row.weights)) as Weights, note: (row.note as string | null) ?? null, source: row.source as "admin" | "reset" }));
  }
}
