import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { validateLimits } from "../limitsStore.js";
import { noteFrom, requireAdmin } from "./shared.js";

/**
 * The default limits every install follows unless it has its own: checks per install per UTC day, and checks per source IP per
 * UTC hour. GET returns them with the environment's values; POST {dailyLimit?, ipHourlyLimit?, note?} saves and {reset:true} goes
 * back to the environment's. Takes effect within seconds. Per-install overrides are set through /admin/clients.
 */
export async function limitsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  if (request.method === "POST") {
    const body = await readJson(request);
    const note = noteFrom(body.note);
    if (body.reset === true) await ctx.limits.reset(note);
    else {
      const limits = validateLimits(body, await ctx.limits.current());
      if (typeof limits === "string") throw new HttpError(422, "invalid_input", limits);
      await ctx.limits.save(limits, note);
    }
  }
  ctx.limits.invalidate();
  return json(200, { effective: await ctx.limits.current(), defaults: ctx.limits.fallback, history: await ctx.limits.history() });
}
