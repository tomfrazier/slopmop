import type { Route } from "./ctx.js";

/**
 * Every endpoint by its path under /api/v1. The public ones each have a file in api/; the admin ones are all served by the one
 * function api/v1/admin/[route].ts (Vercel's Hobby plan allows 12 functions, and a function per admin page would use them up).
 * The local dev server reads this same table, so the two can't disagree.
 */
export const PATHS: Record<string, Route> = {
  judge: "judge",
  vote: "vote",
  usage: "usage",
  health: "health",
  manifest: "manifest",
  "admin/export": "export",
  "admin/stats": "stats",
  "admin/clients": "clients",
  "admin/weights": "weights",
  "admin/scoring": "scoring",
  "admin/manifest": "adminManifest",
  "admin/tuner": "tuner",
  "admin/simulate": "simulate",
};

/** The admin endpoint named by the last part of a request path, or null. */
export function adminRouteFor(pathname: string): Route | null {
  const name = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return Object.hasOwn(PATHS, `admin/${name}`) ? PATHS[`admin/${name}`] : null;
}
