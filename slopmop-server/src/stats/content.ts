import { SCORE_TRAITS } from "../questions.js";
import { AI_LIKELY, num, round, type Scope } from "./scope.js";

const HISTOGRAM_BUCKETS = 10;

/** Per network: posts seen, AI-likelihood, votes and spend. */
export async function networkTable(s: Scope) {
  const { since } = s;
  const [perNetwork, byEvents] = await Promise.all([
    s.q(
      `SELECT c.network, COUNT(*) posts_total,
              SUM(c.last_seen >= ?) seen, SUM(c.first_seen >= ?) fresh,
              SUM(c.last_seen >= ? AND c.ai_likelihood IS NOT NULL) scored, SUM(c.last_seen >= ? AND c.ai_likelihood >= ${AI_LIKELY}) ai_likely,
              AVG(CASE WHEN c.last_seen >= ? THEN c.ai_likelihood END) ai_avg,
              (SELECT COUNT(*) FROM votes v WHERE v.network = c.network AND v.at >= ?) votes_in_range,
              (SELECT COUNT(*) FROM votes v WHERE v.network = c.network) votes_total,
              (SELECT COUNT(*) FROM votes v WHERE v.network = c.network AND v.vote = 'probably') flagged_total
       FROM content c WHERE 1=1${s.net ? " AND c.network = ?" : ""} GROUP BY c.network ORDER BY posts_total DESC`,
      [since, since, since, since, since, since, ...s.netArgs()],
    ),
    s.q(
      `SELECT network, SUM(kind IN ('scored','cached')) checks, SUM(kind='scored') scored, SUM(input_tokens) tin, SUM(output_tokens) tout
       FROM events WHERE at >= ?${s.netSql()} GROUP BY network`,
      [since, ...s.netArgs()],
    ),
  ]);
  const events = new Map(byEvents.map((r) => [String(r.network), r]));
  return perNetwork.map((r) => {
    const e = events.get(String(r.network));
    const scored = num(r.scored);
    return {
      network: String(r.network),
      postsTotal: num(r.posts_total),
      postsSeen: num(r.seen),
      postsNew: num(r.fresh),
      checks: num(e?.checks),
      jevCalls: num(e?.scored),
      costUsd: round(s.cost(num(e?.tin), num(e?.tout)), 6),
      aiLikelyPct: scored ? round(num(r.ai_likely) / scored, 4) : null,
      avgAiLikelihood: r.ai_avg == null ? null : round(num(r.ai_avg), 4),
      votesInRange: num(r.votes_in_range),
      votesTotal: num(r.votes_total),
      flaggedTotal: num(r.flagged_total),
    };
  });
}

/** How Jev's AI-likelihood is distributed across posts seen in the range. */
export async function aiHistogram(s: Scope) {
  const bins = Array.from({ length: HISTOGRAM_BUCKETS }, (_, i) => ({ from: i / HISTOGRAM_BUCKETS, to: (i + 1) / HISTOGRAM_BUCKETS, posts: 0 }));
  const rows = await s.q(
    `SELECT CAST(MIN(ai_likelihood, 0.999) * ${HISTOGRAM_BUCKETS} AS INTEGER) b, COUNT(*) n FROM content WHERE ai_likelihood IS NOT NULL AND last_seen >= ?${s.netSql()} GROUP BY b`,
    [s.since, ...s.netArgs()],
  );
  for (const r of rows) {
    const bin = bins[num(r.b)];
    if (bin) bin.posts = num(r.n);
  }
  return bins;
}

/** The average strength of each tell across scored posts. */
export async function tellAverages(s: Scope) {
  const [row] = await s.q(
    `SELECT COUNT(dimensions) n, ${SCORE_TRAITS.map((t, i) => `AVG(json_extract(dimensions, '$.${t.id}.value')) d${i}`).join(", ")}
     FROM content WHERE dimensions IS NOT NULL AND last_seen >= ?${s.netSql()}`,
    [s.since, ...s.netArgs()],
  );
  return SCORE_TRAITS.map((t, i) => ({ id: t.id, avg: row?.[`d${i}`] == null ? null : round(num(row[`d${i}`]), 4) }));
}
