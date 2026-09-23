// The full device list: search by device id, filter, sort, page, and act on one device (its limits, the kill switch).
import { api } from "../api.js";
import { disableCheckbox } from "../clients.js";
import { el } from "../dom.js";
import { fmt } from "../format.js";
import { hooks } from "../hooks.js";
import { card } from "../widgets.js";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const STATUSES = [["all", "All devices"], ["active", "Active in the last 24h"], ["disabled", "Disabled"], ["custom", "With their own limits"], ["limited", "Have hit a limit"]];
const COLUMNS = [
  ["Device", null],
  ["Today", "today"],
  ["Lifetime checks", "checks"],
  ["Errors", "errors"],
  ["Limit hits", "limitHits"],
  ["Votes", "votes"],
  ["First seen", "firstSeen"],
  ["Last seen", "lastSeen"],
];
const RIGHT = new Set(["today", "checks", "errors", "limitHits", "votes"]);

/** What the list is showing; kept outside the DOM so a redraw (a refresh, a change) doesn't lose the search. */
const V = { q: "", status: "all", sort: "lastSeen", dir: "desc", offset: 0, data: null, open: null, seq: 0 };
let paint = () => {};

async function fetchPage() {
  const seq = ++V.seq;
  const data = await api("/devices", { q: V.q, status: V.status === "all" ? "" : V.status, sort: V.sort, dir: V.dir, limit: String(PAGE_SIZE), offset: V.offset ? String(V.offset) : "" });
  if (seq === V.seq) V.data = data; // ignore an answer that a newer search has overtaken
  paint();
}

/** Re-fetches the current page (used by the once-a-minute refresh and after a change). */
export const reloadDevices = () => fetchPage().catch((e) => alert(e.message));

async function setLimits(device, body) {
  try {
    await api("/clients", {}, false, { device, ...body });
    V.open = null;
    await fetchPage();
  } catch (e) {
    alert(e.message);
  }
}

const orNull = (input) => (input.value.trim() === "" ? null : Number(input.value));

function limitsEditor(r, defaults) {
  const daily = el("input", { type: "number", min: "1", step: "1", class: "field field-num", placeholder: String(defaults.dailyLimit), value: r.dailyLimit ?? "", "aria-label": `Daily limit for ${r.device}` });
  const hourly = el("input", { type: "number", min: "1", step: "1", class: "field field-num", placeholder: String(defaults.ipHourlyLimit), value: r.hourlyLimit ?? "", "aria-label": `Hourly limit for ${r.device}` });
  const valid = (n) => n === null || (Number.isInteger(n) && n >= 1);
  return el(
    "div",
    { class: "tools" },
    el("label", null, "Checks per day ", daily),
    el("label", null, "Checks per hour (per IP) ", hourly),
    el("span", { class: "sub" }, "Leave empty to follow the default."),
    el("button", { class: "primary", onclick: () => {
      const d = orNull(daily), h = orNull(hourly);
      if (!valid(d) || !valid(h)) return alert("A limit must be a whole number of at least 1, or empty.");
      void setLimits(r.device, { dailyLimit: d, hourlyLimit: h });
    } }, "Save"),
    el("button", { onclick: () => void setLimits(r.device, { dailyLimit: null, hourlyLimit: null }) }, "Use the defaults"),
    el("button", { onclick: () => { V.open = null; paint(); } }, "Cancel"),
  );
}

function statusPills(r) {
  return [r.disabled ? el("span", { class: "pill error", title: r.disabledReason || "" }, "disabled") : null, r.dailyLimit != null || r.hourlyLimit != null ? el("span", { class: "pill limited" }, "own limits") : null];
}

function row(r, defaults) {
  const daily = r.dailyLimit ?? defaults.dailyLimit;
  const pct = Math.min(100, Math.round((r.today / Math.max(1, daily)) * 100));
  return [
    el("tr", null,
      el("td", null, el("code", null, r.device), " ", statusPills(r)),
      el("td", { class: "r" }, el("div", { class: "today" }, `${fmt.n(r.today)} / ${fmt.n(daily)}`, el("div", { class: "bar", title: r.dailyLimit != null ? "This device's own daily limit" : "The default daily limit" }, el("span", { style: `width:${pct}%;background:${pct >= 100 ? "var(--red)" : "var(--blue)"}` })))),
      el("td", { class: "r" }, fmt.n(r.checks)),
      el("td", { class: "r" }, r.errors ? el("span", { class: "warn" }, fmt.n(r.errors)) : "0"),
      el("td", { class: "r" }, r.limitHits ? el("span", { class: "warn" }, fmt.n(r.limitHits)) : "0"),
      el("td", { class: "r" }, fmt.n(r.votes)),
      el("td", null, fmt.time(r.firstSeen)),
      el("td", null, fmt.ago(r.lastSeen)),
      el("td", { class: "acts" }, el("button", { "aria-expanded": String(V.open === r.device), onclick: () => { V.open = V.open === r.device ? null : r.device; paint(); } }, "Limits"), " ", el("label", { class: "inline" }, disableCheckbox(r), " Off")),
    ),
    V.open === r.device ? el("tr", { class: "editrow" }, el("td", { colspan: String(COLUMNS.length + 1) }, limitsEditor(r, defaults))) : null,
  ];
}

function results(container) {
  const d = V.data;
  if (!d) return container.replaceChildren(el("div", { class: "empty" }, "Loading…"));
  if (!d.devices.length) return container.replaceChildren(el("div", { class: "empty" }, V.q || V.status !== "all" ? "No device matches." : "No devices yet."));
  const head = COLUMNS.map(([label, key]) =>
    key
      ? el("th", { class: RIGHT.has(key) ? "r" : "", "aria-sort": V.sort === key ? (V.dir === "asc" ? "ascending" : "descending") : "none" },
          el("button", { class: "sortbtn", onclick: () => { V.dir = V.sort === key && V.dir === "desc" ? "asc" : "desc"; V.sort = key; V.offset = 0; void reloadDevices(); } }, label, V.sort === key ? (V.dir === "asc" ? " ↑" : " ↓") : ""))
      : el("th", null, label),
  );
  const from = d.offset + 1;
  const to = d.offset + d.devices.length;
  container.replaceChildren(
    el("div", { class: "scroll" }, el("table", null, el("thead", null, el("tr", null, head, el("th", null, "Actions"))), el("tbody", null, d.devices.flatMap((r) => row(r, d.defaults))))),
    el("div", { class: "tools mt-10" },
      el("span", { class: "sub" }, `${fmt.n(from)}–${fmt.n(to)} of ${fmt.n(d.total)}`),
      el("button", { disabled: d.offset === 0, onclick: () => { V.offset = Math.max(0, V.offset - PAGE_SIZE); void reloadDevices(); } }, "Previous"),
      el("button", { disabled: to >= d.total, onclick: () => { V.offset += PAGE_SIZE; void reloadDevices(); } }, "Next"),
    ),
  );
}

/** The Devices page. */
export function devicesPage() {
  let timer = 0;
  const holder = el("div", null);
  paint = () => results(holder);
  const search = el("input", {
    type: "search", class: "field field-device", placeholder: "Find a device id (any part)", value: V.q, "aria-label": "Find a device by id", spellcheck: "false", autocomplete: "off", maxlength: "64",
    oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { V.q = e.target.value.trim(); V.offset = 0; void reloadDevices(); }, SEARCH_DELAY_MS); },
  });
  const status = el("select", { "aria-label": "Show", onchange: (e) => { V.status = e.target.value; V.offset = 0; void reloadDevices(); } }, STATUSES.map(([v, l]) => el("option", { value: v, selected: v === V.status }, l)));
  paint();
  void reloadDevices();
  return card(
    "Devices",
    el("div", null, el("div", { class: "tools" }, search, status, el("button", { onclick: () => void reloadDevices() }, "Refresh")), el("div", { class: "mt-10" }, holder)),
    "A device id is the short code the extension's popup shows, so a user can tell you which one is theirs. Limits set here override the defaults for that device only.",
  );
}

hooks.reloadDevices = reloadDevices;
