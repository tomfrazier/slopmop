import { AuthenticationError, PermissionDeniedError, RateLimitError } from "@typesafe-ai/sdk";
import { UPSTREAM_BUSY_RETRY_AFTER_S } from "./constants.js";
import { HttpError } from "./http.js";

/** Jev failures become clear, retry-friendly errors instead of a bare 500. */
export function upstreamError(e: unknown): HttpError {
  if (e instanceof RateLimitError) {
    // Headers only (never the body): shows the real limit in the function logs.
    const limits = [...e.headers.entries()].filter(([k]) => /^(retry-after|x-ratelimit|ratelimit)/i.test(k));
    console.error("[slopmop] Jev rate limited:", e.status, e.retryAfterMs ?? "no retry-after", JSON.stringify(Object.fromEntries(limits)));
    return new HttpError(503, "upstream_busy", "The scoring model is busy. Try again shortly.", {}, { "Retry-After": String(UPSTREAM_BUSY_RETRY_AFTER_S) });
  }
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    console.error("[slopmop] Jev credentials rejected:", e.message);
    return new HttpError(500, "server_misconfigured", "The server's Jev credentials were rejected.");
  }
  console.error("[slopmop] Jev call failed:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  return new HttpError(502, "upstream_error", "The scoring model didn't answer.");
}
