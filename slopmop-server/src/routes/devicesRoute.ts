import type { Ctx } from "../ctx.js";
import { json } from "../http.js";
import type { DeviceQuery } from "../repos/clients.js";
import { requireAdmin } from "./shared.js";

const STATUSES = ["all", "disabled", "custom", "limited", "active"] as const;
const SORTS = ["lastSeen", "firstSeen", "checks", "today", "errors", "votes", "limitHits"] as const;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const whole = (v: string | null, fallback: number, max: number) => {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

/**
 * The admin's full device list. GET ?q= (part of a device id) &status=all|disabled|custom|limited|active &sort= &dir=asc|desc
 * &limit= &offset= returns one page of installs, with how many matched, plus the default limits each one falls back to.
 */
export async function devicesRoute(request: Request, ctx: Ctx): Promise<Response> {
  requireAdmin(request, ctx);
  const p = new URL(request.url).searchParams;
  const query: DeviceQuery = {
    q: (p.get("q") ?? "").trim().slice(0, 64),
    status: pick(p.get("status"), STATUSES, "all"),
    sort: pick(p.get("sort"), SORTS, "lastSeen"),
    dir: p.get("dir") === "asc" ? "asc" : "desc",
    limit: Math.max(1, whole(p.get("limit"), DEFAULT_PAGE, MAX_PAGE)),
    offset: whole(p.get("offset"), 0, 1_000_000),
  };
  const { total, devices } = await ctx.store.clients.list(query);
  return json(200, { total, offset: query.offset, limit: query.limit, devices, defaults: await ctx.limits.current() });
}
