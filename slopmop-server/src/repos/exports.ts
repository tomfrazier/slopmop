import { EXPORT_DEFAULT_LIMIT, EXPORT_MAX_LIMIT } from "../constants.js";
import type { Dimension } from "../jev.js";
import { num, parseJson, type RepoDeps } from "./shared.js";
import type { ExportRow } from "./types.js";
import { consensus, toCommunity } from "./votes.js";

/** Scores plus what people said, for tuning thresholds and weights offline. */
export class ExportRepo {
  constructor(private readonly d: RepoDeps) {}

  async rows(opts: { network: string; since?: number; limit?: number; minVotes?: number }): Promise<ExportRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? EXPORT_DEFAULT_LIMIT, 1), EXPORT_MAX_LIMIT);
    const r = await this.d.db.execute(
      `SELECT c.*, v.no AS v_no, v.maybe AS v_maybe, v.probably AS v_probably FROM content c
       LEFT JOIN (
         SELECT network, content_id, SUM(vote = 'no') AS no, SUM(vote = 'maybe') AS maybe, SUM(vote = 'probably') AS probably
         FROM counted_votes GROUP BY network, content_id
       ) v ON v.network = c.network AND v.content_id = c.content_id
       WHERE c.network = ? AND c.last_seen >= ?
       ORDER BY c.last_seen DESC LIMIT ?`,
      [opts.network, opts.since ?? 0, limit],
    );
    return r.rows.map((row) => {
      const votes = toCommunity([
        { vote: "no", n: row.v_no },
        { vote: "maybe", n: row.v_maybe },
        { vote: "probably", n: row.v_probably },
      ]);
      return {
        network: String(row.network),
        contentId: String(row.content_id),
        nativeId: (row.native_id as string | null) ?? null,
        textLen: num(row.text_len),
        text: (row.text as string | null) ?? null,
        model: (row.model as string | null) ?? null,
        criteriaVersion: (row.criteria_version as string | null) ?? null,
        aiLikelihood: row.ai_likelihood == null ? null : num(row.ai_likelihood),
        dimensions: parseJson<Record<string, Dimension>>(row.dimensions),
        surface: parseJson(row.surface),
        engagement: parseJson(row.engagement),
        scoredAt: row.scored_at == null ? null : num(row.scored_at),
        firstSeen: num(row.first_seen),
        lastSeen: num(row.last_seen),
        checks: num(row.checks),
        votes,
        consensus: consensus(votes, opts.minVotes ?? 2),
      };
    });
  }
}
