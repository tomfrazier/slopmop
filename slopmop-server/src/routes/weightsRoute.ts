import { SUGGESTION_MAX_ROWS } from "../constants.js";
import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { MIN_PER_CLASS, suggestWeights } from "../tuning.js";
import { DEFAULT_WEIGHTS, validateWeights } from "../weights.js";
import { noteFrom, requireAdmin } from "./shared.js";

/**
 * The weights in force, editable live. GET returns them with the environment baseline and the change history (and, with
 * ?suggest=1, a suggestion from community votes: see tuning.ts). POST {weights, note?} saves new ones; POST {reset:true}
 * drops the live edit so TELL_WEIGHTS (or the default) applies again. Edits reach every server instance within seconds,
 * and each one is logged so it can be reviewed or restored.
 */
export async function weightsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const respond = async (extra: Record<string, unknown> = {}) => {
    ctx.weights.invalidate();
    return json(200, { effective: await ctx.weights.current(), baseline: ctx.weights.baseline(), defaults: DEFAULT_WEIGHTS, history: await ctx.weights.history(), ...extra });
  };
  if (request.method === "POST") {
    await applyWeightChange(ctx, await readJson(request));
    return respond();
  }
  const q = new URL(request.url).searchParams;
  if (q.get("suggest") !== "1") return respond();
  const minVotes = Math.max(1, Number(q.get("minVotes")) || 2);
  return respond({ suggestion: { ...(await suggestFromVotes(ctx, minVotes)), minVotes, minPerClass: MIN_PER_CLASS } });
}

/** Saves the posted weights, or (with `reset: true`) drops the live edit. */
async function applyWeightChange(ctx: Ctx, body: Record<string, unknown>): Promise<void> {
  const note = noteFrom(body.note);
  if (body.reset === true) return ctx.weights.reset(note);
  const weights = validateWeights(body.weights);
  if (typeof weights === "string") throw new HttpError(422, "invalid_input", weights);
  await ctx.weights.save(weights, note);
}

/** A weight suggestion from posts the community has reached a consensus on. Suggests only; nothing is applied. */
async function suggestFromVotes(ctx: Ctx, minVotes: number) {
  const rows = await ctx.store.exports.rows({ network: "linkedin", minVotes, limit: SUGGESTION_MAX_ROWS });
  const examples = rows.flatMap((r) => (r.dimensions && (r.consensus === "probably" || r.consensus === "no") ? [{ dimensions: r.dimensions, slop: r.consensus === "probably" }] : []));
  return suggestWeights(examples, (await ctx.weights.current()).weights);
}
