import { APIError, AuthenticationError, PermissionDeniedError, RateLimitError } from "@typesafe-ai/sdk";
import { UPSTREAM_BUSY_RETRY_AFTER_S } from "./constants.js";
import { QueueTimeout } from "./gate.js";
import { HttpError } from "./http.js";

const DETAIL_MAX = 240;

/**
 * What to write in the activity log for a failed Jev call: the error class and, for an upstream API error, its status, the
 * rate-limit headers (names and values only) and the start of its message, so the admin shows which limit was hit.
 */
export function describeUpstream(e: unknown): string {
  if (!(e instanceof Error)) return "unknown";
  const parts = [e.name];
  if (e instanceof QueueTimeout) parts.push(`after ${e.waitedMs}ms`);
  if (e instanceof APIError) {
    if (e.status) parts.push(String(e.status));
    const limits = e instanceof RateLimitError ? [...e.headers.entries()].filter(([k]) => /^(retry-after|x-ratelimit|ratelimit)/i.test(k)).map(([k, v]) => `${k}=${v}`) : [];
    if (e instanceof RateLimitError && e.retryAfterMs !== undefined && !limits.length) limits.push(`retry-after=${e.retryAfterMs}ms`);
    if (limits.length) parts.push(`[${limits.join(" ")}]`);
    parts.push(`- ${e.message.replace(/\s+/g, " ").trim()}`);
  }
  return parts.join(" ").slice(0, DETAIL_MAX);
}

/** Jev failures become clear, retry-friendly errors instead of a bare 500. */
export function upstreamError(e: unknown): HttpError {
  if (e instanceof QueueTimeout) {
    return new HttpError(503, "upstream_busy", "The scoring model is busy. Try again shortly.", {}, { "Retry-After": String(UPSTREAM_BUSY_RETRY_AFTER_S) });
  }
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
