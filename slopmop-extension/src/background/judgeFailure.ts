import { SERVER_URL } from "../shared/config";
import { SECOND_MS, TRANSIENT_STATUSES } from "../shared/constants";
import { live } from "../shared/manifest";
import { learnPolicy } from "./policy";
import { DISABLED_MESSAGE, limitMessage, rememberBlocked, rememberCooldown, rememberDailyLimit } from "./serverState";
import type { Attempt, ServerBody } from "./judgeTypes";

/** The server's own explanation of an error, when it gave one (it always answers with {error, message}). */
async function serverMessage(res: Response): Promise<ServerBody> {
  try {
    return (await res.clone().json()) as ServerBody;
  } catch {
    return {};
  }
}

/** Seconds the server asked us to wait (Retry-After), or 0. */
const retryAfterSeconds = (res: Response) => {
  const asked = Number(res.headers.get("retry-after"));
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
};

/** A reply that should have been data but was something else (a web page): what answered is not our server. */
export class NotJsonError extends Error {
  constructor(readonly status: number) {
    super(`${SERVER_URL} returned a web page instead of data (HTTP ${status}). A VPN, network filter or login page (captive portal) may be intercepting it. Open ${SERVER_URL}/api/v1/health to see what is answering.`);
  }
}

/** Parses a reply as JSON; if it isn't JSON, says so plainly instead of surfacing "Unexpected token '<'". */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NotJsonError(res.status);
  }
}

const IP_LIMIT_DEFAULT_WAIT_S = 600;
const IP_LIMIT_MAX_WAIT_S = 3600;

/** "server 404" alone can't tell a wrong address from a server fault: say where we asked, and what a 404 usually means. */
export function describeServerError(status: number, message?: string): string {
  const where = `${SERVER_URL}/api/v1`;
  if (status === 404 && !message) return `server 404: ${where} has no such page. This copy of Slop Mop may be pointed at the wrong server address.`;
  return `server ${status}${message ? `: ${message}` : ""}`;
}

const looksLikeWebPage = (res: Response) => (res.headers.get("content-type") ?? "").includes("text/html");

export const describeNetworkError = (e: unknown) =>
  e instanceof NotJsonError ? e.message : e instanceof DOMException && e.name === "TimeoutError" ? `timed out after ${live.values.requestTimeoutMs / SECOND_MS}s (${SERVER_URL})` : `network: ${e instanceof Error ? e.message : String(e)} (${SERVER_URL})`;

/** Works out what a failed response means: stop, wait for the rate limit, or back off and retry. */
export async function interpretFailure(res: Response, backoffMs: number): Promise<Attempt> {
  const body = await serverMessage(res);
  if (res.status === 429 && body.error === "daily_limit" && body.usage) {
    const error = limitMessage(body.usage);
    await rememberDailyLimit(body.usage, error);
    return { kind: "stop", error };
  }
  if (res.status === 403 && body.error === "client_disabled") {
    const error = body.message ?? DISABLED_MESSAGE;
    await rememberBlocked(error);
    return { kind: "stop", error };
  }
  if (res.status === 403 && body.error === "datacenter_ip") {
    return { kind: "stop", error: "Slop Mop can't check posts from a VPN or cloud network. Turn the VPN off and try again." };
  }
  if (res.status === 429 && body.error === "ip_rate_limited") {
    // This network has used its hourly allowance: asking again sooner can't help, so wait as long as the server says.
    const seconds = Math.min(Math.max(retryAfterSeconds(res) || IP_LIMIT_DEFAULT_WAIT_S, 1), IP_LIMIT_MAX_WAIT_S);
    const error = `Too many checks from your network this hour. Checking resumes in about ${Math.ceil(seconds / 60)} min.`;
    await rememberCooldown(error, seconds);
    return { kind: "stop", error };
  }
  learnPolicy(body.policy);

  const error = looksLikeWebPage(res) ? new NotJsonError(res.status).message : describeServerError(res.status, body.message);
  const asked = retryAfterSeconds(res);
  // When the server says how long to wait (the scoring model is busy), wait at least that long.
  const pauseMs = asked ? Math.min(Math.max(backoffMs, asked * SECOND_MS), live.values.maxRetryPauseMs) : backoffMs;
  if (res.status === 429 && body.error === "rate_limited") {
    const waitMs = Math.min(Math.max(asked || live.values.defaultRateLimitPauseS, 1), live.values.maxRateLimitPauseS) * SECOND_MS;
    return { kind: "rate", error: `server ${res.status}: ${body.message ?? "rate limited"}`, waitMs, pauseMs };
  }
  return TRANSIENT_STATUSES.includes(res.status) ? { kind: "retry", error, pauseMs } : { kind: "stop", error };
}
