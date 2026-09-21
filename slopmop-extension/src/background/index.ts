import type { Msg } from "../shared/messages";
import { engagementBand } from "../shared/engagement";
import { getSettings } from "../shared/settings";
import type { JudgeResponse } from "../shared/types";
import { refreshBadge } from "./badge";
import { enqueue, prioritize } from "./queue";
import { blockedHold, dailyLimitHold } from "./serverState";
import { loadStats, recordStat, statsReply } from "./stats";
import { allTabs, blank, getTab, updateTab } from "./tabs";
import { watchManifest } from "../shared/manifest";
import { refreshManifestIfStale } from "./manifest";
import { tabKey } from "./tabStorage";
import { cacheKey, readCached } from "./verdictCache";
import { clearVote, flushVotes, labelSyncStatus, saveVote, syncLabels } from "./votes";


/** Answers a judge request from the saved verdict, or queues a check with the server. Any failure leaves the post alone (null). */
async function judge(m: Extract<Msg, { type: "judge" }>, tabId: number | undefined): Promise<JudgeResponse | null> {
  const s = await getSettings();
  if (!s.enabled || !s.acknowledged) return null;
  const key = await cacheKey(m.text);
  const cached = await readCached(key, m.engagement ? engagementBand(m.engagement) : undefined);
  if (cached) {
    void updateTab(tabId, (t) => ({ ...t, cached: t.cached + 1 }));
    return cached;
  }
  // Don't ask the server while it has said no: the daily counter hasn't reset, or the admin disabled this install.
  const held = (await blockedHold()) ?? (await dailyLimitHold());
  if (held) {
    void updateTab(tabId, (t) => ({ ...t, errors: t.errors + 1, lastError: held.message }));
    return null;
  }
  return enqueue({ key, urn: m.urn, text: m.text, stats: m.stats, priority: m.priority, tabId, nativeId: m.nativeId, engagement: m.engagement });
}

void watchManifest(); // the server's fixed values, kept for a day and refreshed when an answer reports a new version

type Handlers = { [K in Msg["type"]]: (m: Extract<Msg, { type: K }>, tabId: number | undefined) => unknown };

/** What the extension does for each message from the page and the popup. */
const handlers: Handlers = {
  judge: (m, tabId) => judge(m, tabId),
  prioritize: (m) => prioritize(m.items),
  record: (m) => recordStat(m.kind, m.urn),
  getStats: async () => statsReply(await loadStats()),
  pageStart: async (_m, tabId) => {
    await updateTab(tabId, () => blank());
    void refreshManifestIfStale(); // once a day at most: only asks when the saved manifest has expired
  },
  debug: (m, tabId) => updateTab(tabId, (s) => ({ ...s, detected: m.detected, ads: m.ads, own: m.own, skipped: m.skipped })),
  getDebug: (m) => (m.tabId === undefined ? allTabs() : getTab(m.tabId)),
  myDebug: (_m, tabId) => (tabId === undefined ? blank() : getTab(tabId)),
  vote: (m) => saveVote(m.record),
  unvote: (m) => clearVote(m.urn),
  syncLabels: () => syncLabels(),
  getLabelSync: () => labelSyncStatus(),
};

chrome.runtime.onMessage.addListener((m: Msg, sender, sendResponse) => {
  const handler = handlers[m.type] as (m: Msg, tabId: number | undefined) => unknown;
  Promise.resolve()
    .then(() => handler(m, sender.tab?.id))
    .then(sendResponse, () => sendResponse(m.type === "judge" ? null : undefined));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) void refreshBadge();
});
chrome.tabs.onRemoved.addListener((id) => void chrome.storage.session.remove(tabKey(id)));
chrome.runtime.onInstalled.addListener((d) => {
  void refreshBadge();
  if (d.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
});
chrome.runtime.onStartup.addListener(() => {
  void refreshBadge();
  flushVotes();
});
