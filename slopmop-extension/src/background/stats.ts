import { createSerial } from "../shared/serial";
import { record } from "../shared/stats";
import type { StatsReply } from "../shared/messages";
import { refreshBadge } from "./badge";
import { loadStats, statsReply } from "./statsStore";

export { loadStats, statsReply } from "./statsStore";

const serial = createSerial();

/** Counts a hidden or flagged post. Writes are serialized to avoid lost updates. */
export function recordStat(kind: "hidden" | "flagged", urn: string): Promise<StatsReply> {
  return serial(async () => {
    const next = record(await loadStats(), kind, urn, new Date());
    await chrome.storage.local.set({ stats: next });
    await refreshBadge();
    return statsReply(next);
  });
}
