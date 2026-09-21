import { API_BASE } from "../shared/config";
import { getSettings } from "../shared/settings";
import { applyManifest, live, MANIFEST_KEY, toStored, type StoredManifest } from "../shared/manifest";
import { installId } from "./installId";

/**
 * Keeps the manifest (the server's fixed values for this extension) fresh: it is fetched when there is none, when the saved
 * one is older than the server said to keep it, and whenever an answer reports a version different from the one held.
 */
let fetching: Promise<void> | null = null;

/** Fetches the manifest and saves it. Failures change nothing: the saved one (or the defaults) stays in force. */
export function refreshManifest(): Promise<void> {
  fetching ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/manifest`, { signal: AbortSignal.timeout(live.values.requestTimeoutMs), headers: { "x-install-id": await installId() } });
      if (!res.ok) return;
      const stored = toStored(await res.json(), Date.now());
      if (stored) {
        applyManifest(stored); // in force here at once; the pages follow through the storage change
        await chrome.storage.local.set({ [MANIFEST_KEY]: stored });
      }
    } catch {
      /* offline or the server is down */
    }
  })().finally(() => (fetching = null));
  return fetching;
}

/** Called with every answer's `manifestVersion`: a different one means the server's values have changed. */
export function learnManifestVersion(v: unknown) {
  if (typeof v === "string" && v !== live.version) void refreshManifest();
}

/** Asks for the manifest if there is none or it has expired, but only while the extension is on. */
export async function refreshManifestIfStale(): Promise<void> {
  const s = await getSettings();
  if (!s.enabled || !s.acknowledged) return;
  const saved = (await chrome.storage.local.get(MANIFEST_KEY))[MANIFEST_KEY] as StoredManifest | undefined;
  if (!saved || Date.now() - saved.at >= saved.ttlMs) await refreshManifest();
}

