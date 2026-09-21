import { normalizeRecord } from "./labelNormalize";
import type { LabelRecord } from "./types";

export { normalizeRecord, normalizeVote } from "./labelNormalize";

/** Votes live in this browser (chrome.storage.local), one key per post, and are mirrored to a file by the collector. */
const key = (urn: string) => `label:${urn}`;


export async function readLabel(urn: string): Promise<LabelRecord | null> {
  return normalizeRecord((await chrome.storage.local.get(key(urn)))[key(urn)]);
}
export const writeLabel = (rec: LabelRecord) => chrome.storage.local.set({ [key(rec.urn)]: rec });
export const clearLabel = (urn: string) => chrome.storage.local.remove(key(urn));

export async function allLabels(): Promise<LabelRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith("label:"))
    .map(([, v]) => normalizeRecord(v))
    .filter((r): r is LabelRecord => r !== null)
    .sort((a, b) => a.at - b.at);
}
export async function clearAllLabels(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("label:")));
}

export { fromServerExport, parseLabels } from "./labelParsing";
