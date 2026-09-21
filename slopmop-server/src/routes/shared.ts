import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_NOTE_CHARS } from "../constants.js";
import type { Ctx } from "../ctx.js";
import { HttpError } from "../http.js";
import { getNetwork, SUPPORTED_NETWORKS, type NetworkProfile } from "../networks.js";

/** The server decides how a client behaves; the extension only obeys. Sent with judge/usage responses and rate-limit errors. */
export const policyOf = (ctx: Ctx) => ({ maxConcurrent: ctx.config.clientMaxConcurrent, ratePerMinute: ctx.config.clientRatePerMinute });

/** The response to a request from a client the admin has disabled. */
export const disabledError = () => new HttpError(403, "client_disabled", "This install has been disabled by the Slop Mop server.");

/** The network named in a request, or a 400 that lists the supported ones. */
export function requireNetwork(value: unknown): NetworkProfile {
  const network = getNetwork(value);
  if (!network) throw new HttpError(400, "unsupported_network", `Unsupported network. Supported: ${SUPPORTED_NETWORKS.join(", ")}.`, { supported: SUPPORTED_NETWORKS });
  return network;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Admin endpoints are off unless ADMIN_TOKEN is set; the token is compared in constant time. */
export function requireAdmin(request: Request, ctx: Ctx): void {
  const expected = ctx.config.adminToken;
  if (!expected) throw new HttpError(404, "not_found", "Not found.");
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!timingSafeEqual(digest(given), digest(expected))) throw new HttpError(401, "unauthorized", "Bad or missing admin token.");
}

/** A short free-text note from the admin: trimmed, cut to length, or null when empty. */
export const noteFrom = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_NOTE_CHARS) : null);
