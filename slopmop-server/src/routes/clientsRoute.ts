import type { Ctx } from "../ctx.js";
import { HttpError, json, readJson } from "../http.js";
import { isLimit, MAX_LIMIT } from "../limitsStore.js";
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
  const limitOf = (v: unknown) => (v === undefined || v === null ? v : isLimit(v) ? v : Symbol.for("bad"));
  const daily = limitOf(body.dailyLimit);
  const hourly = limitOf(body.hourlyLimit);
  const setsLimits = daily !== undefined || hourly !== undefined;
  if (typeof body.device !== "string" || (typeof body.disabled !== "boolean" && !setsLimits)) throw new HttpError(422, "invalid_input", "Send {device, disabled?: true|false, dailyLimit?: number|null, hourlyLimit?: number|null}.");
  if (typeof daily === "symbol" || typeof hourly === "symbol") throw new HttpError(422, "invalid_input", `A limit must be a whole number from 1 to ${MAX_LIMIT}, or null to follow the default.`);
  const found = await clients.find(body.device.trim().toLowerCase());
  if (found === "ambiguous") throw new HttpError(409, "ambiguous_device", "That device id matches more than one client; use a longer prefix.");
  if (!found) throw new HttpError(404, "unknown_device", "No client with that device id.");
  if (typeof body.disabled === "boolean") await clients.setDisabled(found.hash, body.disabled, noteFrom(body.reason));
  if (setsLimits) await clients.setLimits(found.hash, { dailyLimit: daily as number | null | undefined, hourlyLimit: hourly as number | null | undefined });
  return json(200, { device: deviceId(found.hash), ...(typeof body.disabled === "boolean" ? { disabled: body.disabled } : {}), ...(setsLimits ? { dailyLimit: daily ?? null, hourlyLimit: hourly ?? null } : {}) });
}
