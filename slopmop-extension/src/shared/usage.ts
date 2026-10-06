/**
 * Checks used today, out of the server's daily cap. Worked out from what the background worker keeps in chrome.storage.local
 * (the counts every server answer carries, and the holds set when the server refuses), so the popup and the post panel show
 * the same number.
 */
export interface UsageState {
  usage?: { used: number; limit: number; resetsAt: string };
  dailyLimit?: { until: number };
  blocked?: { until: number; message: string };
  dcIpPause?: { until: number; message: string };
}

export const USAGE_KEYS = ["usage", "dailyLimit", "blocked", "dcIpPause"] as const;

export interface DailyUsage {
  /** What to show as used: the whole limit while checking is held (limit reached, disabled, paused). */
  shown: number;
  limit: number;
  /** No more checks today, for whichever reason. */
  full: boolean;
  /** The server's admin has disabled this install. */
  disabled: boolean;
  /** This network's IP kept getting refused; see noteDatacenterRefusal. */
  dcPaused: boolean;
}

export function dailyUsage(s: UsageState, now: number, fallbackLimit: number): DailyUsage {
  const counterReset = !s.usage || Date.parse(s.usage.resetsAt) <= now; // the counter has reset since we last heard
  const used = counterReset ? 0 : s.usage!.used;
  const limit = s.usage?.limit ?? fallbackLimit; // shown until the server has told us the real one
  const disabled = !!s.blocked && s.blocked.until > now;
  const dcPaused = !!s.dcIpPause && s.dcIpPause.until > now;
  const full = disabled || dcPaused || (!!s.dailyLimit && s.dailyLimit.until > now);
  return { shown: full ? limit : used, limit, full, disabled, dcPaused };
}
