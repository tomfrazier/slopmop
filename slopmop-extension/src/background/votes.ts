import { COLLECTOR_URL, SERVER_URL } from "../shared/config";
import { clearLabel, normalizeRecord, writeLabel } from "../shared/labels";
import type { LabelEvent, LabelRecord, LabelSync } from "../shared/types";
import { installId } from "./installId";
import { createLabelSync } from "./labelSync";

// Votes are saved in the browser first, then shared with the server and (in developer builds) mirrored to a local file.
const storageIo = { get: async (k: string) => (await chrome.storage.local.get(k))[k], set: (k: string, v: unknown) => chrome.storage.local.set({ [k]: v }) };

// Developer-only: appends every vote to a file on disk (`npm run collect`). Only exists in builds made with SLOPMOP_COLLECTOR_URL.
const fileSync = COLLECTOR_URL ? createLabelSync({ ...storageIo, fetch: (url, init) => fetch(url, init), endpoint: COLLECTOR_URL, unreachableHint: 'run "npm run collect"' }) : null;

// Shares your vote with the community: a post's vote counts are what other people see next to its score.
const serverSync = createLabelSync({
  ...storageIo,
  fetch: (url, init) => fetch(url, init),
  endpoint: SERVER_URL,
  path: "/api/v1/vote",
  outboxKey: "voteOutbox",
  statusKey: "voteSyncStatus",
  name: "Slop Mop server",
  headers: async () => ({ "x-install-id": await installId() }),
  toBody: (e) => (e.network && e.contentId ? { network: e.network, contentId: e.contentId, vote: e.label } : null),
});

/** Sharing is best-effort and never makes a vote wait on the network. */
const share = (event: LabelEvent) => void Promise.all([fileSync?.enqueue(event), serverSync.enqueue(event)]).catch(() => undefined);

/** Saves a vote in the browser, then shares it in the background. */
export async function saveVote(record: LabelRecord) {
  await writeLabel(record);
  share(record);
}

/** Clears a vote, telling the server which post it was (from the stored vote). */
export async function clearVote(urn: string) {
  const prev = normalizeRecord((await chrome.storage.local.get(`label:${urn}`))[`label:${urn}`]);
  await clearLabel(urn);
  share({ urn, label: null, at: Date.now(), network: prev?.network, contentId: prev?.contentId });
}

/** The developer file sync's queue and status; null in a normal build, where there is none. */
export const syncLabels = () => (fileSync ? fileSync.flush() : null);
export const labelSyncStatus = (): Promise<LabelSync> | null => (fileSync ? fileSync.status() : null);

/** Retry anything waiting from earlier (called when the browser starts). */
export function flushVotes() {
  void fileSync?.flush();
  void serverSync.flush();
}
