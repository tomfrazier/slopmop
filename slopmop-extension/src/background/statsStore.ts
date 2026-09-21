import { emptyStats, summarize, type StatsData } from "../shared/stats";
import type { StatsReply } from "../shared/messages";

export async function loadStats(): Promise<StatsData> {
  return ((await chrome.storage.local.get("stats")).stats as StatsData | undefined) ?? emptyStats();
}

export function statsReply(d: StatsData): StatsReply {
  const now = new Date();
  return { hidden: summarize(d.hidden, now), flagged: summarize(d.flagged, now) };
}
