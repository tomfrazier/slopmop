import type { Dimension } from "../jev.js";
import { num, parseJson, type RepoDeps } from "./shared.js";
import type { Vote } from "./types.js";

/** A hand-labelled post: Jev's answers, its engagement, and the admin's call. No post text is ever stored. */
export interface CuratedLabel {
  key: string;
  label: Vote;
  aiLikelihood: number;
  dimensions: Record<string, Dimension>;
  engagement: { reactions: number; comments: number; reposts: number } | null;
  note: string | null;
}

/** The admin's own labelled posts, the ground truth for tuning thresholds. Separate from votes so no one else can move them. */
export class CuratedRepo {
  constructor(private readonly d: RepoDeps) {}

  /** Adds or updates labels (by key), returning how many were written. */
  async upsert(network: string, labels: CuratedLabel[]): Promise<number> {
    if (!labels.length) return 0;
    const now = this.d.now();
    await this.d.db.batch(
      labels.map((l) => ({
        sql: `INSERT INTO curated_labels (key, network, label, ai_likelihood, dimensions, engagement, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET label = excluded.label, ai_likelihood = excluded.ai_likelihood, dimensions = excluded.dimensions, engagement = excluded.engagement, note = excluded.note`,
        args: [l.key, network, l.label, l.aiLikelihood, JSON.stringify(l.dimensions), l.engagement ? JSON.stringify(l.engagement) : null, l.note, now],
      })),
    );
    return labels.length;
  }

  async all(network: string): Promise<CuratedLabel[]> {
    const r = await this.d.db.execute(`SELECT key, label, ai_likelihood, dimensions, engagement, note FROM curated_labels WHERE network = ? ORDER BY created_at, key`, [network]);
    return r.rows.flatMap((row) => {
      const dimensions = parseJson<Record<string, Dimension>>(row.dimensions);
      return dimensions ? [{ key: String(row.key), label: row.label as Vote, aiLikelihood: num(row.ai_likelihood), dimensions, engagement: parseJson<CuratedLabel["engagement"]>(row.engagement), note: (row.note as string | null) ?? null }] : [];
    });
  }

  async clear(network: string): Promise<void> {
    await this.d.db.execute(`DELETE FROM curated_labels WHERE network = ?`, [network]);
  }
}
