import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { DEFAULT_SCORING, validateScoring } from "../scoringStore.js";
import { noteFrom, requireAdmin } from "./shared.js";

/**
 * The scoring settings in force, editable live: the thresholds for the three sensitivities and the reader-response model.
 * GET returns them with the defaults; POST {thresholds?, engagement?} saves (missing values keep the defaults) and POST
 * {reset:true} goes back to the defaults. Clients pick up new thresholds within a day.
 */
export async function scoringRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  if (request.method === "POST") {
    const body = await readJson(request);
    const note = noteFrom(body.note);
    if (body.reset === true) await ctx.scoring.reset(note);
    else {
      const scoring = validateScoring(body);
      if (typeof scoring === "string") throw new HttpError(422, "invalid_input", scoring);
      await ctx.scoring.save(scoring, note);
    }
  }
  ctx.scoring.invalidate();
  return json(200, { effective: await ctx.scoring.current(), defaults: DEFAULT_SCORING, history: await ctx.scoring.history() });
}
