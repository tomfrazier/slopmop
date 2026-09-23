// The admin kill switch: a Disabled checkbox on every device (the Devices page can filter to the ones that are off).
import { api } from "./api.js";
import { el } from "./dom.js";
import { hooks } from "./hooks.js";

const REASON_PROMPT = "Reason (optional, only you see it):";

/** Turns a client off (or back on). The server refuses a disabled client's requests and stops counting its votes. */
export async function setClientDisabled(device, disabled, reason) {
  try {
    await api("/clients", {}, false, { device, disabled, reason: reason || undefined });
  } catch (e) {
    alert(e.message);
  }
  await hooks.refresh();
}

/** The checkbox in a device row. Disabling asks for confirmation and an optional reason. */
export function disableCheckbox(r) {
  return el("input", {
    type: "checkbox",
    checked: r.disabled,
    "aria-label": `Disable device ${r.device}`,
    title: r.disabled ? "This client is refused by the server. Untick to allow it again." : "Tick to make the server refuse this client",
    onchange: (e) => {
      const on = e.target.checked;
      if (on && !confirm(`Disable device ${r.device}? The server will refuse all of its requests and stop counting its votes.`)) {
        e.target.checked = false;
        return;
      }
      void setClientDisabled(r.device, on, on ? prompt(REASON_PROMPT) : null);
    },
  });
}
