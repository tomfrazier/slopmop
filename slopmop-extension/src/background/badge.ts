import { getSettings } from "../shared/settings";
import { BADGE } from "../shared/constants";
import type { DebugInfo } from "../shared/messages";
import { loadStats, statsReply } from "./statsStore";
import { getTab, knownTabs } from "./tabStorage";

/**
 * The toolbar badge. Normal: posts hidden today ("off" when disabled). Debug: posts sent to the server on this page load
 * (resets on reload), blue normally and red once a request has failed.
 */
export async function refreshBadge(tabId?: number, state?: DebugInfo) {
  const s = await getSettings();
  const hiddenToday = statsReply(await loadStats()).hidden.today;
  const normal = !s.enabled ? "off" : hiddenToday ? String(hiddenToday) : "";
  const normalColor = !s.enabled ? BADGE.off : BADGE.hidden;
  await chrome.action.setBadgeText({ text: normal });
  await chrome.action.setBadgeBackgroundColor({ color: normalColor });

  const debug = s.enabled && s.debug;
  for (const id of tabId !== undefined ? [tabId] : await knownTabs()) {
    const t = state && id === tabId ? state : await getTab(id);
    try {
      await chrome.action.setBadgeText({ tabId: id, text: debug ? String(t.sent) : normal });
      await chrome.action.setBadgeBackgroundColor({ tabId: id, color: debug ? (t.errors ? BADGE.error : BADGE.debug) : normalColor });
    } catch {
      /* tab closed */
    }
  }
}
