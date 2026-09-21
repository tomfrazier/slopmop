import { allLabels, clearAllLabels } from "../shared/labels";
import { send } from "../shared/messages";
import { getSettings } from "../shared/settings";
import { $ } from "../shared/pageDom";

const URL_LIFETIME_MS = 1000;

/** The vote count, and (in developer builds with a file collector) whether votes are waiting to be written. */
export async function paintLabels() {
  const ls = await allLabels();
  const count = (v: string) => ls.filter((l) => l.label === v).length;
  $("lbl-count").textContent = `${ls.length} (${count("no")} no · ${count("maybe")} maybe · ${count("probably")} probably)`;
  $<HTMLButtonElement>("lbl-export").disabled = ls.length === 0;
  $<HTMLButtonElement>("lbl-clear").disabled = ls.length === 0;

  const st = await send({ type: "getLabelSync" });
  const el = $("lbl-sync");
  // Without a developer collector there is no file to sync: hide that part of the panel.
  el.hidden = !st;
  $("lbl-sync-now").hidden = !st;
  $("lbl-note-main").textContent = st
    ? "Hover a post's mop icon and vote No / Maybe / Probably. Saved here, shared with the Slop Mop server, and appended to a file by the local collector."
    : "Vote No / Maybe / Probably from a post's mop icon. Votes are saved here and shared with the Slop Mop server. Export them to tune thresholds.";
  if (!st) return;
  const time = st.lastOk ? new Date(st.lastOk).toLocaleTimeString() : null;
  const waiting = st.pending !== 0;
  el.className = waiting ? "sync warn" : "sync ok";
  el.textContent = waiting ? `${st.pending} vote${st.pending === 1 ? "" : "s"} waiting to be written. ${st.lastError ?? ""}` : time ? `File up to date (last write ${time}).` : "Nothing to write yet.";
}

/** Saves the votes as a JSON file for `npm run tune`. */
async function exportLabels() {
  const labels = await allLabels();
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), labels }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `slopmop-labels-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), URL_LIFETIME_MS);
  $("lbl-note").textContent = `Exported ${labels.length}. Then: npm run tune -- <that file>`;
}

/** Export, sync and clear buttons for the saved votes. */
export function mountVotesPanel() {
  $("lbl-export").addEventListener("click", () => void exportLabels());
  $("lbl-sync-now").addEventListener("click", async () => {
    await send({ type: "syncLabels" });
    void paintLabels();
  });
  $("lbl-clear").addEventListener("click", async () => {
    if (!confirm("Delete all tuning labels stored in this browser?")) return;
    await clearAllLabels();
    void paintLabels();
  });
  void paintLabels();
}
