import { API_BASE } from "../shared/config";
import { live } from "../shared/manifest";
import type { Usage } from "../shared/types";
import { installId } from "./installId";
import { readJson } from "./judgeFailure";

let asking: Promise<void> | null = null;

/**
 * Asks the server for this install's checks today, its limit and its device id (GET /usage never spends a check) and saves it
 * where the popup reads it. That is how the popup can show the device id, and a raised limit, before any post has been checked.
 * Best effort: a failure changes nothing.
 */
export function refreshUsage(): Promise<void> {
  asking ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/usage`, { signal: AbortSignal.timeout(live.values.requestTimeoutMs), headers: { "x-install-id": await installId() } });
      if (!res.ok) return;
      const body = await readJson<Partial<Usage>>(res);
      if (typeof body.used === "number" && typeof body.limit === "number" && typeof body.resetsAt === "string") {
        await chrome.storage.local.set({ usage: { used: body.used, limit: body.limit, remaining: body.remaining ?? body.limit - body.used, resetsAt: body.resetsAt, device: body.device } satisfies Usage });
      }
    } catch {
      /* offline, or something other than the server answered */
    }
  })().finally(() => (asking = null));
  return asking;
}
