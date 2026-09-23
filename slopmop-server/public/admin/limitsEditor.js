// The default limits every install follows unless it has its own (set per device on the Devices page).
import { api } from "./api.js";
import { el } from "./dom.js";
import { hooks } from "./hooks.js";
import { clock, fmt, tzName } from "./format.js";

export const L = { data: null };
export async function loadLimits() {
  L.data = await api("/limits");
}

const num = (input) => {
  const n = Number(input.value);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

async function save(body) {
  try {
    await api("/limits", {}, false, body);
    await hooks.refresh();
  } catch (e) {
    alert(e.message);
  }
}

export function limitsBody() {
  const { effective, defaults } = L.data;
  const daily = el("input", { type: "number", min: "1", step: "1", value: String(effective.dailyLimit), class: "field field-num", "aria-label": "Default checks per install per day" });
  const hourly = el("input", { type: "number", min: "1", step: "1", value: String(effective.ipHourlyLimit), class: "field field-num", "aria-label": "Default checks per IP per hour" });
  const same = effective.dailyLimit === defaults.dailyLimit && effective.ipHourlyLimit === defaults.ipHourlyLimit;
  return el(
    "div",
      null,
      el("div", { class: "sub note-y" }, `Every install follows these unless it has its own limit (set on the Devices page). Changes apply within seconds, and only to installs without their own limit. Daily counts reset at 00:00 UTC${tzName() === "UTC" ? "" : ` (${clock(Date.UTC(2026, 6, 1))} in summer, ${clock(Date.UTC(2026, 0, 1))} in winter)`}.`),
      el("div", { class: "tools" }, el("label", null, "Checks per install, per day ", daily), el("label", null, "Checks per IP address, per hour ", hourly)),
      el("div", { class: "tools editor-actions" },
        el("button", { class: "primary", onclick: () => {
          const d = num(daily), h = num(hourly);
          if (d === null || h === null) return alert("Both limits must be whole numbers of at least 1.");
          void save({ dailyLimit: d, ipHourlyLimit: h });
        } }, "Save"),
        el("button", { disabled: same, onclick: () => confirm("Go back to the server's built-in defaults?") && void save({ reset: true }) }, "Use the built-in defaults"),
        el("span", { class: "sub" }, `Built-in: ${fmt.n(defaults.dailyLimit)} per day, ${fmt.n(defaults.ipHourlyLimit)} per IP per hour`),
      ),
    );
}
