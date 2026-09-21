import type { Row } from "../db/types.js";
import { AI_LIKELY, num, parseJson, round, type Scope } from "./scope.js";

const MOST_FLAGGED_LIMIT = 15;
const DISAGREEMENT_LIMIT = 10;

/** Vote totals, and how well Jev's AI-likelihood lines up with what voters said. */
export async function communityStats(s: Scope) {
  const [[totals], calibrationRows] = await Promise.all([
    s.q(
      `SELECT COUNT(*) total, SUM(vote='no') n, SUM(vote='maybe') m, SUM(vote='probably') p, COUNT(DISTINCT install_hash) voters, SUM(at >= ?) in_range
       FROM votes WHERE 1=1${s.netSql()}`,
      [s.since, ...s.netArgs()],
    ),
    s.q(
      `SELECT v.vote, COUNT(*) n, AVG(c.ai_likelihood) ai_avg, SUM(c.ai_likelihood >= ${AI_LIKELY}) ai_hi
       FROM votes v JOIN content c ON c.network = v.network AND c.content_id = v.content_id
       WHERE c.ai_likelihood IS NOT NULL${s.netSql("v.network")} GROUP BY v.vote`,
      s.netArgs(),
    ),
  ]);
  return {
    votesTotal: num(totals?.total),
    votesInRange: num(totals?.in_range),
    voters: num(totals?.voters),
    no: num(totals?.n),
    maybe: num(totals?.m),
    probably: num(totals?.p),
    calibration: calibrationRows.map(toCalibration),
  };
}

/** "Jev agrees" = it leaned the same way as the voter: AI-likely for probably, not AI-likely for no. Maybe has no side. */
function toCalibration(r: Row) {
  const votes = num(r.n);
  const aiLikely = num(r.ai_hi);
  const vote = String(r.vote);
  const jevAgreesPct = vote === "probably" ? round(aiLikely / votes, 4) : vote === "no" ? round(1 - aiLikely / votes, 4) : null;
  return { vote, votes, avgAiLikelihood: round(num(r.ai_avg), 4), jevAgreesPct, aiLikely };
}

const postRow = (r: Row) => ({
  network: String(r.network),
  contentId: String(r.content_id),
  nativeId: (r.native_id as string | null) ?? null,
  aiLikelihood: r.ai_likelihood == null ? null : round(num(r.ai_likelihood), 4),
  engagement: parseJson(r.engagement),
  checks: num(r.checks),
  lastSeen: num(r.last_seen),
  votes: { no: num(r.n), maybe: num(r.m), probably: num(r.p) },
});

/** Posts that have votes, filtered and ordered by the given SQL (n/m/p are the no/maybe/probably counts). */
async function votedPosts(s: Scope, having: string, order: string, limit: number) {
  const rows = await s.q(
    `SELECT c.network, c.content_id, c.native_id, c.ai_likelihood, c.engagement, c.checks, c.last_seen,
            SUM(v.vote='no') n, SUM(v.vote='maybe') m, SUM(v.vote='probably') p
     FROM votes v JOIN content c ON c.network = v.network AND c.content_id = v.content_id
     WHERE 1=1${s.netSql("c.network")} GROUP BY c.network, c.content_id HAVING ${having} ORDER BY ${order} LIMIT ${limit}`,
    s.netArgs(),
  );
  return rows.map(postRow);
}

/** The most-flagged posts, and where Jev and the voters disagree: the most useful rows for tuning. */
export async function votedPostLists(s: Scope) {
  const [mostFlagged, jevMissed, jevOverreached] = await Promise.all([
    votedPosts(s, "p > 0", "p DESC, (n + m + p) DESC, c.last_seen DESC", MOST_FLAGGED_LIMIT),
    votedPosts(s, `p > n AND c.ai_likelihood < ${AI_LIKELY}`, "(p - n) DESC, c.ai_likelihood ASC", DISAGREEMENT_LIMIT),
    votedPosts(s, `n > p AND c.ai_likelihood >= ${AI_LIKELY}`, "(n - p) DESC, c.ai_likelihood DESC", DISAGREEMENT_LIMIT),
  ]);
  return { mostFlagged, jevMissed, jevOverreached };
}
