import { send } from "../shared/messages";
import { $ } from "../shared/pageDom";

const DEBUG_COUNTERS = ["sent", "cached", "errors", "detected", "ads", "own", "skipped"] as const;

/** What the open LinkedIn tabs have sent and seen since they loaded (the Debug switch). */
export async function paintDebug(on: boolean) {
  $("debug-panel").hidden = !on;
  if (!on) return;
  const d = await send({ type: "getDebug" });
  if (!d) return;
  for (const k of DEBUG_COUNTERS) $(`d-${k}`).textContent = String(d[k]);
  $("d-error").textContent = d.lastError ? `Last error: ${d.lastError}` : "";
}
