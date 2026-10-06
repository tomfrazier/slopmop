import { live } from "../shared/manifest";
import { send } from "../shared/messages";
import { $ } from "../shared/pageDom";
import { dailyUsage, USAGE_KEYS, type UsageState } from "../shared/usage";


/** Hidden and flagged counts. */
export async function paintStats() {
  const r = await send({ type: "getStats" });
  $("s-today").textContent = String(r.hidden.today);
  $("s-week").textContent = String(r.hidden.week);
  $("s-month").textContent = String(r.hidden.month);
  $("s-total").textContent = String(r.hidden.total);
  $("flagged").textContent = r.flagged.total ? `${r.flagged.today} flagged today · ${r.flagged.total} all time (highlight mode)` : "";
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Checks used today out of the server's daily cap, from the counts every server answer carries. */
export async function paintUsage() {
  const state = (await chrome.storage.local.get([...USAGE_KEYS])) as UsageState;
  const { usage, blocked, dcIpPause } = state;
  const { shown, limit, full, disabled, dcPaused } = dailyUsage(state, Date.now(), live.values.defaultDailyLimit);

  $("usage-n").textContent = String(shown);
  $("usage-of").textContent = `of ${limit}`;
  ($("usage-bar") as HTMLElement).style.width = `${Math.min(100, (shown / limit) * 100)}%`;
  ($("usage-n").closest(".usage-box") as HTMLElement).classList.toggle("full", full);

  // Shown here (not just the 30-minute "last problem" note) so it's still visible whenever the popup is next opened,
  // even if the user scrolled straight past every refused post without looking.
  if (disabled) return void ($("usage-note").textContent = blocked!.message);
  if (dcPaused) return void ($("usage-note").textContent = dcIpPause!.message);
  const resets = usage ? timeOf(usage.resetsAt) : null;
  $("usage-note").textContent = full && resets ? `Daily limit reached. Checking resumes at ${resets}.` : `Each new post checked uses one. The count resets daily${resets ? ` (next: ${resets})` : ""}.`;
}
