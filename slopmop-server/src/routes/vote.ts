import { CONTENT_ID_RE } from "../content-id.js";
import type { Ctx } from "../ctx.js";
import { HttpError, installIdOf, json, readJson } from "../http.js";
import { SUPPORTED_NETWORKS } from "../networks.js";
import { VOTES, type Vote } from "../store.js";
import { manifestOf } from "./manifestRoute.js";
import { disabledError, policyOf, requireNetwork } from "./shared.js";

/** POST /api/v1/vote: set, change or clear (null) this install's vote on a post the server has scored. */
export async function voteRoute(request: Request, ctx: Ctx): Promise<Response> {
  const installId = installIdOf(request);
  const body = await readJson(request);
  const network = requireNetwork(body.network);
  if (typeof body.contentId !== "string" || !CONTENT_ID_RE.test(body.contentId)) throw new HttpError(422, "invalid_input", "contentId must be the id returned by /judge.");
  const v = body.vote;
  if (v !== null && !VOTES.includes(v as Vote)) throw new HttpError(422, "invalid_input", 'vote must be "no", "maybe", "probably" or null (to clear).');

  if (await ctx.store.clients.isDisabled(installId)) throw disabledError();
  // Votes attach to content the server has scored, so nobody can invent entries.
  if (!(await ctx.store.content.exists(network.id, body.contentId))) throw new HttpError(404, "unknown_content", "That content hasn't been checked yet.");
  const community = await ctx.store.votes.set(network.id, body.contentId, installId, v as Vote | null);
  return json(200, { community, yourVote: v });
}

/** GET /api/v1/usage: this install's checks used today, plus the server's policy for clients. */
export async function usageRoute(request: Request, ctx: Ctx): Promise<Response> {
  const installId = installIdOf(request);
  if (await ctx.store.clients.isDisabled(installId)) throw disabledError();
  return json(200, { ...(await ctx.store.caps.usage(installId, (await ctx.limits.current()).dailyLimit)), policy: policyOf(ctx), manifestVersion: (await manifestOf(ctx)).version });
}

/** GET /api/v1/health: setup status with no secrets (which storage and Jev route, and where the weights come from, never their values). */
export async function healthRoute(_request: Request, ctx: Ctx): Promise<Response> {
  let storage: string = ctx.store.db.kind;
  try {
    await ctx.store.db.execute("SELECT 1 AS ok");
  } catch {
    storage = "unreachable";
  }
  return json(200, {
    ok: storage !== "unreachable" && !!ctx.jev,
    version: ctx.version,
    storage,
    jev: ctx.jev ? { via: ctx.jev.via, model: ctx.jev.model } : null,
    networks: SUPPORTED_NETWORKS,
    dailyLimit: (await ctx.limits.current()).dailyLimit,
    storesText: ctx.config.storeText,
    weights: (await ctx.weights.current()).source,
  });
}
