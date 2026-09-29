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
/** Shown for one refused post, before enough refusals have piled up to self-pause (see `noteDatacenterRefusal`). */
export const DATACENTER_IP_MESSAGE =
  "Slop Mop can't check this post: this network's IP looks like a cloud or hosting address (this happens on some VPNs, and on some corporate networks too). If it keeps happening, Slop Mop will pause itself here and try again later.";

async function activeHold(key: "dailyLimit" | "blocked" | "cooldown" | "dcIpPause"): Promise<Hold | null> {
  const hold = (await chrome.storage.local.get(key))[key] as Hold | undefined;
  return hold && Date.now() < hold.until ? hold : null;
}

export const dailyLimitHold = () => activeHold("dailyLimit");
export const blockedHold = () => activeHold("blocked");
export const cooldownHold = () => activeHold("cooldown");
export const dcIpPauseHold = () => activeHold("dcIpPause");

/** The per-install daily cap: retrying can't help until it resets, so remember it and stop asking. */
export function rememberDailyLimit(usage: Usage, message: string) {
  return chrome.storage.local.set({ usage, dailyLimit: { until: Date.parse(usage.resetsAt), message } satisfies Hold });
}

/** The admin turned this install off. Remember it and stop asking for a while. */
export function rememberBlocked(message: string) {
  return chrome.storage.local.set({ blocked: { until: Date.now() + live.values.blockedRecheckMs, message } satisfies Hold });
}

/** The server asked us to stop for a while (this network used its hourly allowance): remember it and don't ask until then. */
export function rememberCooldown(message: string, seconds: number) {
  return chrome.storage.local.set({ cooldown: { until: Date.now() + seconds * 1000, message } satisfies Hold });
}

/** How many datacenter-IP refusals in a row (since the last success), and when the first of them happened. */
interface DcIpStrikes {
  since: number;
  count: number;
}

/**
 * Records one datacenter-IP refusal and decides whether to pause checking here for a while. A user scrolling a full
 * feed may not notice a single failed-post message across many posts, so once the refusals look persistent the
 * extension stops asking instead of quietly failing open forever. The network gets the benefit of the doubt the first
 * time: it takes either a run of refusals (`dcIpStrikeLimit`) or a shorter run spread over a longer stretch of real
 * time (`dcIpStrikeWindowMin` over `dcIpStrikeWindowMs`), whichever comes first, and any success resets the count to
 * zero. Once a network has paused once, the very next refusal pauses it again immediately — the pattern is already
 * established, so there's no reason to spend dozens more refused requests re-confirming it. Returns the new hold once
 * one is triggered, or null while still just counting.
 */
export async function noteDatacenterRefusal(): Promise<Hold | null> {
  const now = Date.now();
  const { dcIpStrikes, dcIpEverPaused } = (await chrome.storage.local.get(["dcIpStrikes", "dcIpEverPaused"])) as { dcIpStrikes?: DcIpStrikes; dcIpEverPaused?: boolean };
  const strikes: DcIpStrikes = { since: dcIpStrikes?.since ?? now, count: (dcIpStrikes?.count ?? 0) + 1 };
  const persistent = strikes.count >= live.values.dcIpStrikeWindowMin && now - strikes.since >= live.values.dcIpStrikeWindowMs;
  if (!dcIpEverPaused && strikes.count < live.values.dcIpStrikeLimit && !persistent) {
    await chrome.storage.local.set({ dcIpStrikes: strikes });
    return null;
  }
  const until = now + live.values.dcIpPauseMs;
  const hold: Hold = { until, message: `Checking is paused here: this network's IP looks like a cloud or hosting address (this happens on some VPNs, and on some corporate networks too). Slop Mop will try again automatically at ${timeOf(new Date(until).toISOString())}.` };
  await chrome.storage.local.set({ dcIpPause: hold, dcIpEverPaused: true });
  await chrome.storage.local.remove("dcIpStrikes");
  return hold;
}

/** A check went through, so whatever this network is, it isn't blocking us right now: forgive any refusals building up. */
export async function clearDatacenterStrikes() {
  await chrome.storage.local.remove("dcIpStrikes");
  await chrome.storage.local.remove("dcIpEverPaused");
}
