import type { Ctx } from "../ctx.js";
import { HttpError, json } from "../http.js";
import { getNetwork } from "../networks.js";
import { POST_LISTS, votedPostPage, type PostList } from "../stats/community.js";
import { eventList } from "../stats/events.js";
import { makeScope, RANGES, type RangeKey } from "../stats/scope.js";
import { requireAdmin, requireNetwork } from "./shared.js";

const MAX_PAGE = 200;
const whole = (v: string | null, fallback: number, max: number) => {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/**
 * GET /admin/events ?kind=all|error|limited &q= (detail text) &detail= (exact) &device= (part of an id or alias) &range=24h|7d|30d|90d
 * &network= &limit= &offset=: every error and refused request in the range, newest first, with counts by what happened.
 */
export async function eventsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const p = new URL(request.url).searchParams;
  const range = pick(p.get("range"), Object.keys(RANGES) as RangeKey[], "7d");
  const network = p.get("network");
  if (network && !getNetwork(network)) requireNetwork(network);
  const limit = Math.max(1, whole(p.get("limit"), 50, MAX_PAGE));
  const offset = whole(p.get("offset"), 0, 1_000_000);
  const result = await eventList(ctx.store, {
    since: ctx.store.now() - RANGES[range],
    network: network || null,
    kind: pick(p.get("kind"), ["all", "error", "limited"] as const, "all"),
    q: (p.get("q") ?? "").slice(0, 80),
    detail: (p.get("detail") ?? "").slice(0, 120),
    device: (p.get("device") ?? "").slice(0, 64),
    limit,
    offset,
  });
  return json(200, { ...result, offset, limit, range, retentionDays: ctx.config.eventRetentionDays });
}

/** GET /admin/posts ?list=flagged|missed|overreached &network= &limit= &offset=: one page of a list of voted posts, and how many there are. */
export async function postsRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const p = new URL(request.url).searchParams;
  const list = p.get("list") as PostList;
  if (!Object.hasOwn(POST_LISTS, list ?? "")) throw new HttpError(400, "invalid_input", `list must be one of ${Object.keys(POST_LISTS).join(", ")}.`);
  const network = p.get("network");
  if (network && !getNetwork(network)) requireNetwork(network);
  const s = makeScope(ctx.store, { range: "7d", network });
  return json(200, { list, ...(await votedPostPage(s, list, Math.max(1, whole(p.get("limit"), 15, MAX_PAGE)), whole(p.get("offset"), 0, 1_000_000))), offset: whole(p.get("offset"), 0, 1_000_000) });
}
