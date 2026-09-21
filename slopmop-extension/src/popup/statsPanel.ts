import { live } from "../shared/manifest";
import { send } from "../shared/messages";
import { $ } from "../shared/pageDom";


/** Hidden and flagged counts. */
export async function paintStats() {
  const r = await send({ type: "getStats" });
  $("s-today").textContent = String(r.hidden.today);
  $("s-week").textContent = String(r.hidden.week);
  $("s-month").textContent = String(r.hidden.month);
  $("s-total").textContent = String(r.hidden.total);
  $("flagged").textContent = r.flagged.total ? `${r.flagged.today} flagged today · ${r.flagged.total} all time (highlight mode)` : "";
}

interface UsageState {
  usage?: { used: number; limit: number; resetsAt: string };
  dailyLimit?: { until: number };
  blocked?: { until: number; message: string };
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Checks used today out of the server's daily cap, from the counts every server answer carries. */
export async function paintUsage() {
  const { usage, dailyLimit, blocked } = (await chrome.storage.local.get(["usage", "dailyLimit", "blocked"])) as UsageState;
  const now = Date.now();
  const counterReset = !usage || Date.parse(usage.resetsAt) <= now; // the counter has reset since we last heard
  const used = counterReset ? 0 : usage!.used;
  const limit = usage?.limit ?? live.values.defaultDailyLimit // shown until the server has told us the real one;
  const disabled = !!blocked && blocked.until > now; // the server's admin has disabled this install
  const full = disabled || (!!dailyLimit && dailyLimit.until > now);
  const shown = full ? limit : used;

  $("usage-n").textContent = String(shown);
  $("usage-of").textContent = `of ${limit}`;
  ($("usage-bar") as HTMLElement).style.width = `${Math.min(100, (shown / limit) * 100)}%`;
  ($("usage-n").closest(".usage-box") as HTMLElement).classList.toggle("full", full);

  if (disabled) return void ($("usage-note").textContent = blocked!.message);
  const resets = usage ? timeOf(usage.resetsAt) : null;
  $("usage-note").textContent = full && resets ? `Daily limit reached. Checking resumes at ${resets}.` : `Each new post checked uses one. The count resets daily${resets ? ` (next: ${resets})` : ""}.`;
}
