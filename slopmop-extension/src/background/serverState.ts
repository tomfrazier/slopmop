import { live } from "../shared/manifest";
import type { Usage } from "../shared/types";

/** A "don't ask until then" state kept in storage: the daily cap being used up, or the admin disabling this install. */
export interface Hold {
  until: number;
  message: string;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const limitMessage = (u: Usage) => `Daily limit of ${u.limit} checks reached. It resets at ${timeOf(u.resetsAt)}.`;
export const DISABLED_MESSAGE = "This install has been disabled by the Slop Mop server.";

async function activeHold(key: "dailyLimit" | "blocked"): Promise<Hold | null> {
  const hold = (await chrome.storage.local.get(key))[key] as Hold | undefined;
  return hold && Date.now() < hold.until ? hold : null;
}

export const dailyLimitHold = () => activeHold("dailyLimit");
export const blockedHold = () => activeHold("blocked");

/** The per-install daily cap: retrying can't help until it resets, so remember it and stop asking. */
export function rememberDailyLimit(usage: Usage, message: string) {
  return chrome.storage.local.set({ usage, dailyLimit: { until: Date.parse(usage.resetsAt), message } satisfies Hold });
}

/** The admin turned this install off. Remember it and stop asking for a while. */
export function rememberBlocked(message: string) {
  return chrome.storage.local.set({ blocked: { until: Date.now() + live.values.blockedRecheckMs, message } satisfies Hold });
}
