import type { Ctx } from "../ctx.js";
import { HttpError, json } from "../http.js";
import { getNetwork } from "../networks.js";
import { computeStats, RANGES, type RangeKey } from "../stats/index.js";
import { scoreParts, type EngagementCounts } from "../scoring.js";
import { applyWeights } from "../weights.js";
import { requireAdmin, requireNetwork } from "./shared.js";

/** Everything the admin dashboard (public/admin) shows. */
export async function statsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const q = new URL(request.url).searchParams;
  const range = (q.get("range") ?? "7d") as RangeKey;
  if (!(range in RANGES)) throw new HttpError(400, "invalid_input", `range must be one of ${Object.keys(RANGES).join(", ")}.`);
  const network = q.get("network");
  if (network && !getNetwork(network)) requireNetwork(network); // throws the standard unsupported-network error
  return json(200, await computeStats(ctx.store, { range, network, limits: await ctx.limits.current() }));
}

/** NDJSON of what Jev said and what people said, for tuning thresholds offline. Disabled unless ADMIN_TOKEN is set. */
/** Stored engagement, if it has the three counts. */
const asCounts = (v: unknown): EngagementCounts | null => {
  const e = v as Partial<EngagementCounts> | null;
  return e && typeof e.reactions === "number" && typeof e.comments === "number" && typeof e.reposts === "number" ? (e as EngagementCounts) : null;
};

export async function exportRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const q = new URL(request.url).searchParams;
  const network = requireNetwork(q.get("network") ?? "linkedin");
  const sinceRaw = q.get("since");
  const since = sinceRaw ? (/^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw)) : 0;
  const rows = await ctx.store.exports.rows({
    network: network.id,
    since: Number.isFinite(since) ? since : 0,
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    minVotes: q.get("minVotes") ? Number(q.get("minVotes")) : undefined,
  });
  const weights = (await ctx.weights.current()).weights;
  const model = await ctx.scoring.current();
  const weighted = rows.map((r) => {
    if (!r.dimensions) return r;
    const w = applyWeights(r.dimensions, weights, model.formula.confidencePower);
    return { ...r, ...w, ...scoreParts({ tellMean: w.tellMean, dimensions: r.dimensions, engagement: asCounts(r.engagement) }, weights, model.engagement, model.corroboration, model.formula) };
  });
  return new Response(weighted.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
