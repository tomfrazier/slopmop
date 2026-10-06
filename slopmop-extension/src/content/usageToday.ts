import { live } from "../shared/manifest";
import { dailyUsage, USAGE_KEYS, type DailyUsage, type UsageState } from "../shared/usage";

/** The page's copy of the usage counts the background worker stores, kept current so the panel can read it without waiting. */
let current: UsageState = {};

/** Loads the counts once and follows every change the background worker makes (each server answer updates them). */
export async function watchUsage() {
  current = (await chrome.storage.local.get([...USAGE_KEYS])) as UsageState;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of USAGE_KEYS) if (changes[k]) current = { ...current, [k]: changes[k].newValue };
  });
}

/** Checks used today out of the daily limit, the same figure the toolbar popup shows. */
export const checksToday = (now = Date.now()): DailyUsage => dailyUsage(current, now, live.values.defaultDailyLimit);
