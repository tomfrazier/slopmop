import type { DebugInfo } from "../shared/messages";

// Per-tab debug counters live in session storage, so they survive service-worker restarts.
export const blank = (): DebugInfo => ({ detected: 0, ads: 0, own: 0, skipped: 0, sent: 0, cached: 0, errors: 0, lastError: null });
export const tabKey = (id: number) => `tab:${id}`;

export async function getTab(tabId: number): Promise<DebugInfo> {
  return ((await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] as DebugInfo | undefined) ?? blank();
}

export const putTab = (tabId: number, state: DebugInfo) => chrome.storage.session.set({ [tabKey(tabId)]: state });

/** The ids of every tab with saved counters. */
export async function knownTabs(): Promise<number[]> {
  return Object.keys(await chrome.storage.session.get(null))
    .filter((k) => k.startsWith("tab:"))
    .map((k) => Number(k.slice(4)));
}

/** The counters of every open tab added together (the settings page has no tab of its own to ask about). */
export async function allTabs(): Promise<DebugInfo> {
  const sum = blank();
  for (const id of await knownTabs()) {
    const t = await getTab(id);
    for (const k of ["detected", "ads", "own", "skipped", "sent", "cached", "errors"] as const) sum[k] += t[k];
    sum.lastError = t.lastError ?? sum.lastError;
  }
  return sum;
}
