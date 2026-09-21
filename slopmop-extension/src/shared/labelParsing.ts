import { normalizeRecord, normalizeVote } from "./labelNormalize";
import type { LabelEvent, LabelRecord } from "./types";

/**
 * A row of the server's community export (`GET /api/v1/admin/export`) as a label, so what many people voted can be
 * tuned against exactly like your own votes. Rows nobody has agreed on yet (no consensus) or that were never scored
 * are skipped. The server keeps no post text, so the content id stands in for it in reports.
 */
export function fromServerExport(r: unknown): LabelRecord | null {
  const row = r as { contentId?: unknown; consensus?: unknown; dimensions?: unknown; aiLikelihood?: unknown; model?: unknown; engagement?: unknown; lastSeen?: unknown; tellMean?: unknown; tellRank?: unknown; slop?: unknown; shield?: unknown; engagementNorm?: unknown; breakouts?: unknown } | null;
  const label = normalizeVote(row?.consensus);
  if (!row || !label || typeof row.contentId !== "string" || !row.dimensions || typeof row.aiLikelihood !== "number") return null;
  const e = (row.engagement ?? {}) as { reactions?: number; comments?: number; reposts?: number };
  return {
    urn: `server:${row.contentId}`,
    network: "linkedin",
    contentId: row.contentId,
    label,
    at: Number(row.lastSeen) || 0,
    text: `[community ${row.contentId.slice(0, 8)}]`,
    own: false,
    engagement: { reactions: e.reactions ?? 0, comments: e.comments ?? 0, reposts: e.reposts ?? 0 },
    verdict: {
      model: String(row.model ?? "server"),
      aiLikelihood: row.aiLikelihood,
      dimensions: row.dimensions as LabelRecord["verdict"]["dimensions"],
      // The export carries the server's weighted composite, so tuning reproduces production scoring without any weights here.
      ...(typeof row.tellMean === "number" && Array.isArray(row.tellRank) ? { tellMean: row.tellMean, tellRank: row.tellRank as string[] } : {}),
      ...(typeof row.slop === "number" && typeof row.shield === "number" ? { slop: row.slop, shield: row.shield } : {}),
      ...(typeof row.engagementNorm === "number" ? { engagementNorm: row.engagementNorm } : {}),
      ...(typeof row.breakouts === "number" ? { breakouts: row.breakouts } : {}),
    },
    decided: { level: "none", score: 0, mode: "hide", sensitivity: "moderate" },
  };
}

/** Parses a JSONL labels file (or a `{labels:[...]}` export, or the server's community export). Last vote per post wins; clears remove it. */
export function parseLabels(text: string): LabelRecord[] {
  const trimmed = text.trim();
  let events: unknown[];
  if (trimmed.startsWith("{") && !trimmed.includes("\n{")) {
    const one = JSON.parse(trimmed);
    events = Array.isArray(one.labels) ? one.labels : [one];
  } else {
    events = trimmed.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  const byUrn = new Map<string, LabelRecord>();
  for (const e of events as LabelEvent[]) {
    if (e && typeof e === "object" && "contentId" in e && "consensus" in e) {
      const l = fromServerExport(e);
      if (l) byUrn.set(l.urn, l);
      continue;
    }
    if (!e || typeof (e as { urn?: unknown }).urn !== "string") continue;
    if ((e as { label: unknown }).label === null) byUrn.delete(e.urn);
    else {
      const r = normalizeRecord(e);
      if (r) byUrn.set(r.urn, r);
    }
  }
  return [...byUrn.values()].sort((a, b) => a.at - b.at);
}
