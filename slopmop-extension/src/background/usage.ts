import { API_BASE } from "../shared/config";
import { live } from "../shared/manifest";
import type { Usage } from "../shared/types";
import { installId } from "./installId";
import { readJson } from "./judgeFailure";

let asking: Promise<void> | null = null;
let lastProbe = 0;
const PROBE_EVERY_MS = 30_000;

/**
 * While a "don't ask until then" hold is in force, posts are refused without a request, so nothing would ever notice the server
 * had changed its mind. This asks the (free) usage endpoint at most every 30 seconds while held, and a yes clears the hold.
 */
export function probeSoon(): void {
  if (Date.now() - lastProbe < PROBE_EVERY_MS) return;
  lastProbe = Date.now();
  void refreshUsage();
}


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
        // The server answered, so this install is not disabled (a disabled one gets 403), and if it is under its limit the daily
        // hold is stale too (the admin raised the limit). Without this, a "don't ask until then" state kept from before would go on
        // refusing every post here for up to an hour, or until the daily reset, long after the server said yes.
        await chrome.storage.local.remove("blocked");
        if (body.used < body.limit) await chrome.storage.local.remove("dailyLimit");
      }
    } catch {
      /* offline, or something other than the server answered */
    }
  })().finally(() => (asking = null));
  return asking;
}
