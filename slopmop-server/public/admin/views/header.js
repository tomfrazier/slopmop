import { prefs, savePrefs, setToken } from "../api.js";
import { el } from "../dom.js";
import { fmt, rangeLabel } from "../format.js";
import { hooks } from "../hooks.js";
import { pageInfo } from "../nav.js";

const USES_RANGE = new Set(["overview", "posts"]); // the other sections aren't about a time range

const RANGE_CHOICES = [["24h", "24h"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"]];

/** A group of buttons that sets one preference and redraws. */
const segmented = (choices, key) =>
  el(
    "div",
    { class: "seg", role: "group" },
    choices.map(([value, label]) =>
      el("button", { type: "button", "aria-pressed": String(prefs[key] === value), onclick: () => { prefs[key] = value; savePrefs(); hooks.refresh(); } }, label),
    ),
  );

const networkSelect = (d) => {
  const networks = ["", ...new Set(d.networks.map((n) => n.network))];
  if (networks.length <= 2) return null; // one network: nothing to choose
  return el("select", { "aria-label": "Network", onchange: (e) => { prefs.network = e.target.value; savePrefs(); hooks.refresh(); } }, networks.map((n) => el("option", { value: n, selected: n === prefs.network }, n || "All networks")));
};

/** Title, range and network pickers, auto-refresh, refresh, sign out. */
export function header(d, page = "overview") {
  const info = pageInfo(page);
  return el(
    "div",
    { class: "top" },
    el("div", { class: "title" }, el("div", null, el("h1", null, info.label), el("div", { class: "sub" }, `${info.note} · updated ${fmt.time(d.generatedAt)} · all times UTC${USES_RANGE.has(page) ? ` · ${rangeLabel(d.range)}` : ""}`))),
    el("div", { class: "grow" }),
    USES_RANGE.has(page) ? segmented(RANGE_CHOICES, "range") : null,
    USES_RANGE.has(page) ? networkSelect(d) : null,
    el("label", null, el("input", { type: "checkbox", checked: prefs.refresh, onchange: (e) => { prefs.refresh = e.target.checked; savePrefs(); hooks.refresh(); } }), "Auto-refresh"),
    el("button", { onclick: () => hooks.refresh() }, "Refresh"),
    el("button", { onclick: () => { setToken(""); hooks.login(); } }, "Sign out"),
  );
}
