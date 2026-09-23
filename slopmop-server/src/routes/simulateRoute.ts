import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import type { Dimension } from "../jev.js";
import { simulate } from "../simulate.js";
import { TELL_IDS } from "../weights.js";
import { requireAdmin } from "./shared.js";
import { simLive, type Draft } from "./simLive.js";

const ANSWER_IDS = [...TELL_IDS, "humanVoice", "usefulness"];
const unit = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new HttpError(422, "invalid_input", `${what} must be a number from 0 to 1.`);
  return v;
};
const count = (v: unknown, what: string): number => {
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(422, "invalid_input", `${what} must be a count from 0 to 1,000,000,000.`);
  return v;
};

/**
 * POST /api/v1/admin/simulate {dimensions, aiLikelihood, engagement?, draft?}: what a post with these Jev answers would score,
 * step by step, under the live settings, or under `draft` ({weights?, scoring?, manifest?}: values in an editor that haven't
 * been saved), so a change can be previewed before it is made. Nothing is stored and no check is used.
 */
export async function simulateRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const body = await readJson(request);
  const dims = (body.dimensions ?? {}) as Record<string, { value?: unknown; confidence?: unknown }>;
  const dimensions: Record<string, Dimension> = {};
  for (const id of ANSWER_IDS) if (dims[id] !== undefined) dimensions[id] = { value: unit(dims[id].value, `${id} value`), confidence: unit(dims[id].confidence ?? 0.9, `${id} confidence`) };
  const e = (body.engagement ?? {}) as { reactions?: unknown; comments?: unknown; reposts?: unknown };
  const input = { dimensions, aiLikelihood: unit(body.aiLikelihood ?? 0.9, "aiLikelihood"), engagement: { reactions: count(e.reactions, "reactions"), comments: count(e.comments, "comments"), reposts: count(e.reposts, "reposts") } };

  const { live, used } = await simLive(ctx, (body.draft ?? {}) as Draft);
  return json(200, { result: simulate(input, live), used });
}
