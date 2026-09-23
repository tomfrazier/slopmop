import { CONTENT_ID_RE, contentIdFor } from "../content-id.js";
import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { shieldRecipes, solveLevers } from "../review.js";
import { simulate } from "../simulate.js";
import { requireNetwork, requireAdmin } from "./shared.js";
import { simLive } from "./simLive.js";

const CORPUS_LIMIT = 5000;
const MIN_ID_PREFIX = 8;

/**
 * POST /api/v1/admin/review {text} or {contentId} (a full id or a prefix of at least 8 characters): finds the stored record for
 * a post (the server keeps a hash of the text, never the text, so the post is found by hashing what is pasted the same way the
 * judge does), rescores it step by step under the live settings, and solves every setting that could change its verdict.
 * Nothing is stored and no check is used.
 */
export async function reviewRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const body = await readJson(request);
  const network = requireNetwork(body.network ?? "linkedin");
  let id: string;
  let by: "text" | "id";
  if (typeof body.text === "string" && body.text.trim()) {
    if (body.text.trim().length < network.minChars) throw new HttpError(422, "invalid_input", `Paste the whole post: at least ${network.minChars} characters.`);
    id = contentIdFor(network.id, body.text);
    by = "text";
  } else if (typeof body.contentId === "string" && /^[a-f0-9]+$/i.test(body.contentId.trim()) && body.contentId.trim().length >= MIN_ID_PREFIX) {
    id = body.contentId.trim().toLowerCase();
    by = "id";
  } else throw new HttpError(422, "invalid_input", "Send {text} (the post's text) or {contentId} (at least 8 characters of its id).");

  const stored = await ctx.store.content.find(network.id, id);
  if (stored === "ambiguous") throw new HttpError(409, "ambiguous_content", "That id matches more than one post; use more of it.");
  if (!stored) return json(200, { found: false, contentId: by === "text" ? id : null, by });
  if (!stored.dimensions || stored.aiLikelihood == null) return json(200, { found: true, scored: false, contentId: stored.contentId, by, record: stored });

  const { live, manifestOverrides } = await simLive(ctx);
  const input = { dimensions: stored.dimensions, aiLikelihood: stored.aiLikelihood, engagement: stored.engagement ?? { reactions: 0, comments: 0, reposts: 0 } };
  const result = simulate(input, live);
  const corpus = await ctx.store.content.corpus(network.id, CORPUS_LIMIT);
  const community = await ctx.store.votes.community(network.id, stored.contentId);

  const notes: string[] = [];
  const e = input.engagement;
  if (e.reactions === 0 && e.comments + e.reposts > 0) notes.push(`Reactions were stored as 0 but it has ${e.comments} comments and ${e.reposts} reposts. The reaction count may not have been captured, which would understate reader response and so the shield.`);
  else if (e.comments + e.reposts >= 10 && e.reactions < e.comments) notes.push(`Only ${e.reactions} reactions were stored against ${e.comments} comments. That is unusual on LinkedIn (reactions normally far outnumber comments), so the reaction count may have been read from the wrong element. Compare it with the live post.`);
  if (e.reactions + e.comments + e.reposts === 0) notes.push("No engagement counts were stored for this post, so reader response is 0 and only usefulness can shield it.");
  if (result.gated) notes.push(`Jev's average confidence (${result.meanConfidence.toFixed(2)}) is under the minimum (${live.minMeanConfidence}), so the post is left alone ("Not sure").`);
  if (result.steps.cutAlone) notes.push("Only one tell stood out, so the slop score was cut (Scoring → Corroboration).");

  return json(200, { found: true, scored: true, contentId: stored.contentId, by, record: stored, community, input, live: { ...live, manifestOverrides }, result, levers: solveLevers(input, live, corpus), recipes: shieldRecipes(input, live, corpus), notes });
}
