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

  async exists(network: string, contentId: string): Promise<boolean> {
    return (await this.d.db.execute(`SELECT 1 AS x FROM content WHERE network = ? AND content_id = ?`, [network, contentId])).rows.length > 0;
  }
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
