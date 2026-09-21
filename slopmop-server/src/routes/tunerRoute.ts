import { SUGGESTION_MAX_ROWS } from "../constants.js";
import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import type { CuratedLabel } from "../repos/curated.js";
import type { Community } from "../repos/types.js";
import { VOTES } from "../repos/types.js";
import { analyse, type Example, type Label } from "../tuner.js";
import { manifestOf } from "./manifestRoute.js";
import { requireAdmin } from "./shared.js";

const NETWORK = "linkedin";
const MAX_IMPORT = 2000;
const DEFAULT_MIN_VOTES = 3;
const DEFAULT_AGREEMENT = 0.67;

const isLabel = (v: unknown): v is Label => typeof v === "string" && (VOTES as readonly string[]).includes(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads the extension's saved votes (JSON lines, `{labels: [...]}` or an array) into labelled posts. Only Jev's answers and the counts are kept. */
export function parseCurated(input: unknown): CuratedLabel[] {
  let items: unknown[];
  if (typeof input === "string") {
    const text = input.trim();
    try {
      const one = JSON.parse(text);
      items = Array.isArray(one) ? one : Array.isArray(one?.labels) ? one.labels : [one];
    } catch {
      items = text.split("\n").flatMap((l) => (l.trim() ? [JSON.parse(l)] : []));
    }
  } else items = Array.isArray(input) ? input : [];
  if (items.length > MAX_IMPORT) throw new HttpError(413, "too_many", `At most ${MAX_IMPORT} labels per import.`);
  const latest = new Map<string, CuratedLabel | null>(); // the last event for a post wins; a clear removes it
  for (const raw of items) {
    const r = raw as { label?: unknown; urn?: unknown; contentId?: unknown; verdict?: { dimensions?: unknown; aiLikelihood?: unknown }; engagement?: unknown; note?: unknown };
    const key = typeof r?.contentId === "string" ? r.contentId : typeof r?.urn === "string" ? r.urn : null;
    if (!key) continue;
    if (r.label === null) {
      latest.set(key, null);
      continue;
    }
    const dims = r.verdict?.dimensions as Record<string, { value?: unknown; confidence?: unknown }> | undefined;
    if (!isLabel(r.label) || !dims || typeof dims !== "object" || !isNum(r.verdict?.aiLikelihood)) throw new HttpError(422, "invalid_input", `Label for "${key.slice(0, 40)}" needs a label of no/maybe/probably, verdict.dimensions and verdict.aiLikelihood.`);
    const dimensions: CuratedLabel["dimensions"] = {};
    for (const [id, d] of Object.entries(dims)) if (isNum(d?.value) && isNum(d?.confidence)) dimensions[id] = { value: d.value, confidence: d.confidence };
    const e = r.engagement as { reactions?: unknown; comments?: unknown; reposts?: unknown } | undefined;
    const engagement = e && isNum(e.reactions) && isNum(e.comments) && isNum(e.reposts) ? { reactions: e.reactions, comments: e.comments, reposts: e.reposts } : null;
    latest.set(key, { key, label: r.label, aiLikelihood: r.verdict!.aiLikelihood as number, dimensions, engagement, note: typeof r.note === "string" ? r.note.slice(0, 200) : null });
  }
  return [...latest.values()].filter((l): l is CuratedLabel => l !== null);
}

const toExample = (l: { label: Label; dimensions: CuratedLabel["dimensions"]; aiLikelihood: number; engagement: CuratedLabel["engagement"] }): Example => ({ label: l.label, dimensions: l.dimensions, aiLikelihood: l.aiLikelihood, engagement: l.engagement });

/** Share of a post's votes that went to the winning answer. */
const agreementOf = (c: Community) => (c.total ? Math.max(c.no, c.maybe, c.probably) / c.total : 0);

/** How concentrated the community's votes are: how many installs voted, and how much of it the single busiest one did. A high share means one person can steer the picture. */
async function voterSpread(ctx: Ctx) {
  const r = (await ctx.store.db.execute(`SELECT COUNT(*) AS voters, MAX(n) AS top, SUM(n) AS total FROM (SELECT install_hash, COUNT(*) AS n FROM counted_votes WHERE network = ? GROUP BY install_hash)`, [NETWORK])).rows[0];
  const total = Number(r?.total ?? 0);
  return { voters: Number(r?.voters ?? 0), votes: total, topVoterShare: total ? Number(r?.top ?? 0) / total : 0 };
}

/**
 * The threshold tuner. GET ?set=curated (the admin's own labelled posts: the ground truth) or ?set=community (posts the
 * community agrees on, at least `minVotes` voters and `agree` share; shown for comparison and never applied on its own) returns
 * what each threshold would catch and wrongly flag, scored the way production scores right now. POST {import} adds the admin's
 * labelled posts (the extension's saved votes, from its settings page); POST {clear:true} removes them. Nothing here changes a
 * setting: applying a suggestion is the admin loading it into the Scoring card and saving.
 */
export async function tunerRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  if (request.method === "POST") {
    const body = await readJson(request);
    if (body.clear === true) await ctx.store.curated.clear(NETWORK);
    else if (body.import !== undefined) await ctx.store.curated.upsert(NETWORK, parseCurated(body.import));
    else throw new HttpError(422, "invalid_input", "POST {import} or {clear:true}.");
  }
  const q = new URL(request.url).searchParams;
  const set = q.get("set") === "community" ? "community" : "curated";
  const minVotes = Math.max(1, Number(q.get("minVotes")) || DEFAULT_MIN_VOTES);
  const agree = Math.min(1, Math.max(0.34, Number(q.get("agree")) || DEFAULT_AGREEMENT));

  const [weights, scoring, manifest, curated] = await Promise.all([ctx.weights.current(), ctx.scoring.current(), manifestOf(ctx), ctx.store.curated.all(NETWORK)]);
  const live = { weights: weights.weights, scoring, aiDampen: Number(manifest.values.aiDampen), minMeanConfidence: Number(manifest.values.minMeanConfidence) };

  let examples: Example[];
  let dataset: Record<string, unknown>;
  if (set === "curated") {
    examples = curated.map(toExample);
    dataset = { set, posts: examples.length };
  } else {
    const rows = await ctx.store.exports.rows({ network: NETWORK, minVotes, limit: SUGGESTION_MAX_ROWS });
    examples = rows.flatMap((r) => (r.dimensions && r.aiLikelihood !== null && r.consensus && agreementOf(r.votes) >= agree ? [toExample({ label: r.consensus, dimensions: r.dimensions, aiLikelihood: r.aiLikelihood, engagement: (r.engagement as CuratedLabel["engagement"]) ?? null })] : []));
    dataset = { set, posts: examples.length, minVotes, agree, ...(await voterSpread(ctx)) };
    const spread = dataset as { voters: number; topVoterShare: number };
    (dataset as { warnings?: string[] }).warnings = [
      ...(spread.voters < 5 ? [`Only ${spread.voters} install(s) have voted, so this reflects very few people.`] : []),
      ...(spread.topVoterShare > 0.5 && spread.voters > 1 ? [`One install cast ${Math.round(spread.topVoterShare * 100)}% of the votes: a single person can steer this.`] : []),
    ];
  }
  return json(200, { dataset, curatedCount: curated.length, analysis: analyse(examples, live) });
}
