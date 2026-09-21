import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { buildManifest, MANIFEST_DEFAULTS, MANIFEST_FIELDS, validateManifest } from "../manifest.js";
import { noteFrom, requireAdmin } from "./shared.js";

/** The client manifest as the extension receives it. */
export const manifestOf = async (ctx: Ctx) => buildManifest(await ctx.manifest.overrides(), (await ctx.scoring.current()).thresholds);

/** GET /api/v1/manifest: the fixed values the extension runs on. Public: nothing in it is secret, and it never contains weights. */
export async function manifestRoute(_request: Request, ctx: Ctx): Promise<Response> {
  return json(200, await manifestOf(ctx));
}

/**
 * The admin's view: every setting with its default, range and current value. POST {values} saves the ones that differ from
 * the defaults; POST {reset:true} goes back to the defaults. The extension picks up a change the next time it hears the new
 * `manifestVersion` in an answer, or within a day.
 */
export async function adminManifestRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  if (request.method === "POST") {
    const body = await readJson(request);
    const note = noteFrom(body.note);
    if (body.reset === true) await ctx.manifest.reset(note);
    else {
      const overrides = validateManifest(body.values);
      if (typeof overrides === "string") throw new HttpError(422, "invalid_input", overrides);
      await ctx.manifest.save(overrides, note);
    }
  }
  ctx.manifest.invalidate();
  const manifest = await manifestOf(ctx);
  return json(200, { fields: MANIFEST_FIELDS, defaults: MANIFEST_DEFAULTS, values: manifest.values, version: manifest.version, history: await ctx.manifest.history() });
}
