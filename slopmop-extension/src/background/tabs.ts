import type { DebugInfo } from "../shared/messages";
import { createSerial } from "../shared/serial";
import { refreshBadge } from "./badge";
import { getTab, putTab } from "./tabStorage";

export { allTabs, blank, getTab } from "./tabStorage";

const serial = createSerial();

/** Changes one tab's debug counters. Updates are serialized so two at once can't lose one. */
export function updateTab(tabId: number | undefined, fn: (s: DebugInfo) => DebugInfo): Promise<void> {
  if (tabId === undefined) return Promise.resolve();
  return serial(async () => {
    const next = fn(await getTab(tabId));
    await putTab(tabId, next);
    await refreshBadge(tabId, next);
  });
}
