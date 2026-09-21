// The admin kill switch: a Disabled checkbox on every device, and a list of the clients that are off.
import { api } from "./api.js";
import { el } from "./dom.js";
import { fmt } from "./format.js";
import { hooks } from "./hooks.js";
import { deviceCode, table } from "./widgets.js";

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

/** The list of disabled clients (untick to re-enable), plus a box to disable a device that isn't in the table above. */
export function disabledClientsCard(d) {
  const input = el("input", { type: "text", placeholder: "device id (8 hex characters)", "aria-label": "Device id to disable", maxlength: "32", spellcheck: "false", class: "field field-device" });
  const reenable = (r) => el("input", { type: "checkbox", checked: true, "aria-label": `Re-enable device ${r.device}`, title: "Untick to allow this client again", onchange: (e) => !e.target.checked && void setClientDisabled(r.device, false) });
  const list = table(
    [
      { h: "Disabled", v: reenable },
      { h: "Device", v: deviceCode },
      { h: "Since", v: (r) => fmt.time(r.disabledAt) },
      { h: "Reason", v: (r) => r.reason || "-" },
      { h: "Lifetime checks", r: 1, v: (r) => fmt.n(r.checks) },
      { h: "Last seen", v: (r) => fmt.ago(r.lastSeen) },
    ],
    d.disabledClients,
    "No clients are disabled.",
  );
  const form = el(
    "form",
    {
      class: "tools mt-10",
      onsubmit: (e) => {
        e.preventDefault();
        const id = input.value.trim().toLowerCase();
        if (id && confirm(`Disable device ${id}?`)) void setClientDisabled(id, true, prompt(REASON_PROMPT));
      },
    },
    input,
    el("button", { type: "submit" }, "Disable device"),
  );
  return el("div", null, list, form);
}
