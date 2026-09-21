import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { deviceId } from "../repos/clients.js";
import { noteFrom, requireAdmin } from "./shared.js";

/**
 * The admin's kill switch. GET lists disabled clients; POST {device, disabled, reason?} disables or re-enables one. `device`
 * is the short id the dashboard shows (a prefix of the salted install hash); a disabled client is refused by /judge, /vote and
 * /usage, and its votes stop counting toward what the community has said.
 */
export async function clientsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const { clients } = ctx.store;
  if (request.method === "GET") return json(200, { disabled: await clients.listDisabled() });
  const body = await readJson(request);
  if (typeof body.device !== "string" || typeof body.disabled !== "boolean") throw new HttpError(422, "invalid_input", "Send {device, disabled: true|false}.");
  const found = await clients.find(body.device.trim().toLowerCase());
  if (found === "ambiguous") throw new HttpError(409, "ambiguous_device", "That device id matches more than one client; use a longer prefix.");
  if (!found) throw new HttpError(404, "unknown_device", "No client with that device id.");
  await clients.setDisabled(found.hash, body.disabled, noteFrom(body.reason));
  return json(200, { device: deviceId(found.hash), disabled: body.disabled });
}
