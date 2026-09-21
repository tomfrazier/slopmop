import { allLabels, normalizeRecord } from "../shared/labels";
import type { LabelRecord, Vote } from "../shared/types";

/** Your votes, keyed by post id. Loaded once, then kept current from storage so other tabs' votes show up too. */
const votes = new Map<string, LabelRecord>();

export const voteOf = (urn: string): Vote | null => votes.get(urn)?.label ?? null;
export const setVote = (rec: LabelRecord) => void votes.set(rec.urn, rec);
export const dropVote = (urn: string) => void votes.delete(urn);

export async function loadVotes(): Promise<void> {
  for (const r of await allLabels()) votes.set(r.urn, r);
}

export function watchVotes(onChange: (urn: string) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, ch] of Object.entries(changes)) {
      if (!key.startsWith("label:")) continue;
      const urn = key.slice("label:".length);
      const rec = normalizeRecord(ch.newValue);
      if (rec) votes.set(urn, rec);
      else votes.delete(urn);
      onChange(urn);
    }
  });
}
