import type { SqlArg } from "../db/types.js";
import type { Dimension } from "../jev.js";
import { RECHECK_INITIAL_MS } from "../recheck.js";
import { num, parseJson, type RepoDeps } from "./shared.js";
import type { ContentWrite, ReusableVerdict } from "./types.js";

/** The registry: which content has been seen, what Jev said about it, and how often it was checked. */
export class ContentRepo {
  constructor(private readonly d: RepoDeps) {}

  /** A previously stored verdict for identical content, if it is recent and was made with the current criteria. */
  async reusableVerdict(network: string, contentId: string, criteriaVersion: string): Promise<ReusableVerdict | null> {
    const r = await this.d.db.execute(`SELECT model, ai_likelihood, dimensions, criteria_version, scored_at, engagement_at_score, recheck_interval_ms, next_recheck_at FROM content WHERE network = ? AND content_id = ?`, [network, contentId]);
    const row = r.rows[0];
    if (!row || row.criteria_version !== criteriaVersion || row.ai_likelihood == null) return null;
    if (this.d.now() - num(row.scored_at) > this.d.config.verdictMaxAgeMs) return null;
    const dimensions = parseJson<Record<string, Dimension>>(row.dimensions);
    const schedule = row.recheck_interval_ms == null ? null : { total: num(row.engagement_at_score), at: num(row.scored_at), intervalMs: num(row.recheck_interval_ms), nextAt: row.next_recheck_at == null ? null : num(row.next_recheck_at) };
    return dimensions ? { model: String(row.model), aiLikelihood: num(row.ai_likelihood), dimensions, schedule } : null;
  }

  /** Records a check of this content (creating the row on first sight), and the new verdict when Jev was called. */
  async record(w: ContentWrite): Promise<void> {
    const t = this.d.now();
    const s = w.scored;
    const args: SqlArg[] = [
      w.network,
      w.contentId,
      w.nativeId,
      w.textLen,
      w.text,
      s?.verdict.model ?? null,
      s?.criteriaVersion ?? null,
      s?.verdict.aiLikelihood ?? null,
      s ? JSON.stringify(s.verdict.dimensions) : null,
      JSON.stringify(w.surface),
      w.engagement ? JSON.stringify(w.engagement) : null,
      s ? t : null,
      t,
      t,
      s ? (s.engagementTotal ?? 0) : null,
      s ? (s.intervalMs ?? RECHECK_INITIAL_MS) : null,
      s ? t + (s.intervalMs ?? RECHECK_INITIAL_MS) : null,
    ];
    await this.d.db.execute(UPSERT_CHECK, args);
  }

  /** One stored post by its full content id, or a prefix of it (null when none, "ambiguous" when a prefix matches several). */
  async find(network: string, idOrPrefix: string): Promise<StoredContent | "ambiguous" | null> {
    const r = await this.d.db.execute(
      `SELECT content_id, native_id, text_len, model, ai_likelihood, dimensions, surface, engagement, scored_at, first_seen, last_seen, checks, engagement_at_score, next_recheck_at FROM content WHERE network = ? AND content_id LIKE ? LIMIT 2`,
      [network, `${idOrPrefix}%`],
    );
    if (r.rows.length > 1) return "ambiguous";
    const row = r.rows[0];
    if (!row) return null;
    return {
      contentId: String(row.content_id),
      nativeId: (row.native_id as string | null) ?? null,
      textLen: num(row.text_len),
      model: (row.model as string | null) ?? null,
      aiLikelihood: row.ai_likelihood == null ? null : num(row.ai_likelihood),
      dimensions: parseJson<Record<string, Dimension>>(row.dimensions),
      surface: parseJson<Record<string, number>>(row.surface),
      engagement: parseJson<{ reactions: number; comments: number; reposts: number }>(row.engagement),
      scoredAt: row.scored_at == null ? null : num(row.scored_at),
      firstSeen: num(row.first_seen),
      lastSeen: num(row.last_seen),
      checks: num(row.checks),
      engagementAtScore: row.engagement_at_score == null ? null : num(row.engagement_at_score),
      nextRecheckAt: row.next_recheck_at == null ? null : num(row.next_recheck_at),
    };
  }

  /** Every scored post's answers, for asking "what would this setting change do to the rest?". */
  async corpus(network: string, limit: number): Promise<{ dimensions: Record<string, Dimension>; aiLikelihood: number; engagement: { reactions: number; comments: number; reposts: number } | null }[]> {
    const r = await this.d.db.execute(`SELECT ai_likelihood, dimensions, engagement FROM content WHERE network = ? AND dimensions IS NOT NULL AND ai_likelihood IS NOT NULL ORDER BY last_seen DESC LIMIT ?`, [network, limit]);
    const out = [];
    for (const row of r.rows) {
      const dimensions = parseJson<Record<string, Dimension>>(row.dimensions);
      if (dimensions) out.push({ dimensions, aiLikelihood: num(row.ai_likelihood), engagement: parseJson<{ reactions: number; comments: number; reposts: number }>(row.engagement) });
    }
    return out;
  }

  async exists(network: string, contentId: string): Promise<boolean> {
    return (await this.d.db.execute(`SELECT 1 AS x FROM content WHERE network = ? AND content_id = ?`, [network, contentId])).rows.length > 0;
  }
}

export interface StoredContent {
  contentId: string;
  nativeId: string | null;
  textLen: number;
  model: string | null;
  aiLikelihood: number | null;
  dimensions: Record<string, Dimension> | null;
  surface: Record<string, number> | null;
  engagement: { reactions: number; comments: number; reposts: number } | null;
  scoredAt: number | null;
  firstSeen: number;
  lastSeen: number;
  checks: number;
  engagementAtScore: number | null;
  nextRecheckAt: number | null;
}

/** A verdict column is only overwritten when this check actually scored (a reused verdict leaves the stored one alone). */
const keepUnlessScored = (column: string) => `${column} = CASE WHEN excluded.scored_at IS NOT NULL THEN excluded.${column} ELSE ${column} END`;

const UPSERT_CHECK = `INSERT INTO content (network, content_id, native_id, text_len, text, model, criteria_version, ai_likelihood, dimensions, surface, engagement, scored_at, first_seen, last_seen, engagement_at_score, recheck_interval_ms, next_recheck_at, checks)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(network, content_id) DO UPDATE SET
    native_id = COALESCE(excluded.native_id, native_id),
    text = COALESCE(excluded.text, text),
    engagement = COALESCE(excluded.engagement, engagement),
    surface = excluded.surface,
    ${["model", "criteria_version", "ai_likelihood", "dimensions", "scored_at", "engagement_at_score", "recheck_interval_ms", "next_recheck_at"].map(keepUnlessScored).join(",\n    ")},
    last_seen = excluded.last_seen,
    checks = checks + 1`;
