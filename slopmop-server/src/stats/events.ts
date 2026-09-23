import type { Store } from "../store.js";
import { deviceId, likeEscape } from "../repos/clients.js";
import { num } from "../repos/shared.js";
import type { SqlArg } from "../db/types.js";

export interface EventQuery {
  since: number;
  network: string | null;
  kind: "all" | "error" | "limited";
  /** Part of the detail text; empty = any. */
  q: string;
  /** Exactly this detail (an error class name, or a refusal such as daily_limit); empty = any. */
  detail: string;
  /** Part of a device id or alias; empty = any. */
  device: string;
  limit: number;
  offset: number;
}

const where = (o: EventQuery, skipDetail: boolean): { sql: string; args: SqlArg[] } => {
  const parts = [o.kind === "all" ? "e.kind IN ('error','limited')" : "e.kind = ?", "e.at >= ?"];
  const args: SqlArg[] = [];
  if (o.kind !== "all") args.push(o.kind);
  args.push(o.since);
  if (o.network) (parts.push("e.network = ?"), args.push(o.network));
  const q = o.q.trim().toLowerCase();
  if (!skipDetail && q) (parts.push("LOWER(COALESCE(e.detail, '')) LIKE ? ESCAPE '\\'"), args.push(`%${likeEscape(q)}%`));
  if (!skipDetail && o.detail) (parts.push("e.detail = ?"), args.push(o.detail));
  const dev = o.device.trim().toLowerCase();
  if (dev) {
    const hex = dev.replace(/[^0-9a-f]/g, "");
    parts.push(hex === dev ? "(substr(e.install_hash, 1, 8) LIKE ? OR LOWER(i.alias) LIKE ? ESCAPE '\\')" : "LOWER(i.alias) LIKE ? ESCAPE '\\'");
    if (hex === dev) args.push(`%${hex}%`);
    args.push(`%${likeEscape(dev)}%`);
  }
  return { sql: parts.join(" AND "), args };
};

/**
 * Every error and refused request in the window, filtered and paged (the overview shows only the latest few). `facets` counts
 * the same events by what happened, ignoring the detail filter, so the admin can see what is behind a burst and click one.
 */
export async function eventList(store: Store, o: EventQuery) {
  const w = where(o, false);
  const wf = where(o, true);
  const from = "FROM events e LEFT JOIN installs i ON i.install_hash = e.install_hash";
  const [total, rows, facets] = await Promise.all([
    store.db.execute(`SELECT COUNT(*) n ${from} WHERE ${w.sql}`, w.args),
    store.db.execute(`SELECT e.at, e.network, e.kind, e.detail, e.install_hash, e.latency_ms, i.alias ${from} WHERE ${w.sql} ORDER BY e.at DESC, e.id DESC LIMIT ? OFFSET ?`, [...w.args, o.limit, o.offset]),
    store.db.execute(`SELECT e.kind, e.detail, COUNT(*) n ${from} WHERE ${wf.sql} GROUP BY e.kind, e.detail ORDER BY n DESC LIMIT 12`, wf.args),
  ]);
  return {
    total: num(total.rows[0]?.n),
    rows: rows.rows.map((r) => ({ at: num(r.at), network: String(r.network), kind: String(r.kind), detail: (r.detail as string | null) ?? null, latencyMs: r.latency_ms == null ? null : num(r.latency_ms), device: deviceId(String(r.install_hash)), alias: (r.alias as string | null) ?? null })),
    facets: facets.rows.map((r) => ({ kind: String(r.kind), detail: (r.detail as string | null) ?? null, n: num(r.n) })),
  };
}
