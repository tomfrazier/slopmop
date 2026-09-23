// Every error and refused request in the chosen range, filterable and paged (the Overview only shows the latest few).
import { api, prefs } from "../api.js";
import { el } from "../dom.js";
import { fmt, rangeLabel } from "../format.js";
import { hooks } from "../hooks.js";
import { card, deviceCode } from "../widgets.js";
import { refusalName } from "./problems.js";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const KINDS = [["all", "Errors and refusals"], ["error", "Errors only"], ["limited", "Refusals only (limits, blocks)"]];

/** What the list is showing; kept outside the DOM so a redraw doesn't lose the filters. */
const V = { kind: "all", q: "", detail: "", device: "", offset: 0, data: null, seq: 0 };
let paint = () => {};

async function fetchPage() {
  const seq = ++V.seq;
  const data = await api("/events", { kind: V.kind === "all" ? "" : V.kind, q: V.q, detail: V.detail, device: V.device, range: prefs.range, network: prefs.network, limit: String(PAGE_SIZE), offset: V.offset ? String(V.offset) : "" });
  if (seq === V.seq) V.data = data;
  paint();
}
export const reloadErrors = () => fetchPage().catch((e) => alert(e.message));
const filter = (change) => { Object.assign(V, change, { offset: 0 }); void reloadErrors(); };

const what = (r) => el("span", { class: `pill ${r.kind}` }, r.kind === "limited" ? refusalName(r.detail) : "error");
/** A short line for the cause: the refusal's name, or the error text. */
const causeText = (f) => (f.kind === "limited" ? refusalName(f.detail) : f.detail || "error");

function results(container) {
  const d = V.data;
  if (!d) return container.replaceChildren(el("div", { class: "empty" }, "Loading…"));
  const chips = el("div", { class: "chips" },
    d.facets.map((f) => el("button", { class: "chip", "aria-pressed": String(V.detail === (f.detail ?? "") && V.detail !== ""), title: f.detail ?? "", onclick: () => filter({ detail: V.detail === f.detail ? "" : f.detail ?? "" }) }, el("span", { class: `pill ${f.kind}` }, f.kind === "limited" ? "refused" : "error"), ` ${causeText(f)} `, el("b", null, fmt.n(f.n)))),
  );
  if (!d.rows.length) return container.replaceChildren(d.facets.length ? chips : null, el("div", { class: "empty" }, "Nothing matches. " + (d.total === 0 && !V.q && !V.detail && !V.device && V.kind === "all" ? "No errors or refusals in this range. \u{1F389}" : "")));
  const from = d.offset + 1;
  const to = d.offset + d.rows.length;
  container.replaceChildren(
    chips,
    el("div", { class: "scroll" },
      el("table", null,
        el("thead", null, el("tr", null, ["When", "What", "Detail", "Device", "Network"].map((h) => el("th", null, h)))),
        el("tbody", null, d.rows.map((r) => el("tr", null, el("td", null, fmt.time(r.at)), el("td", null, what(r)), el("td", { class: "detail" }, r.detail || "-"), el("td", null, deviceCode(r)), el("td", null, r.network)))),
      ),
    ),
    el("div", { class: "tools mt-10" },
      el("span", { class: "sub" }, `${fmt.n(from)}–${fmt.n(to)} of ${fmt.n(d.total)} · ${rangeLabel(d.range)} · kept ${d.retentionDays} days`),
      el("button", { disabled: d.offset === 0, onclick: () => { V.offset = Math.max(0, V.offset - PAGE_SIZE); void reloadErrors(); } }, "Previous"),
      el("button", { disabled: to >= d.total, onclick: () => { V.offset += PAGE_SIZE; void reloadErrors(); } }, "Next"),
    ),
  );
}

/** The Errors page. */
export function errorsPage() {
  let timer = 0;
  const holder = el("div", null);
  paint = () => results(holder);
  const debounced = (key) => (e) => { clearTimeout(timer); timer = setTimeout(() => filter({ [key]: e.target.value.trim() }), SEARCH_DELAY_MS); };
  const text = el("input", { type: "search", class: "field field-device", placeholder: "Search the detail text", value: V.q, "aria-label": "Search the detail text", spellcheck: "false", autocomplete: "off", maxlength: "80", oninput: debounced("q") });
  const device = el("input", { type: "search", class: "field field-device", placeholder: "Device (id or name)", value: V.device, "aria-label": "Filter by device id or name", spellcheck: "false", autocomplete: "off", maxlength: "64", oninput: debounced("device") });
  const kind = el("select", { "aria-label": "Show", onchange: (e) => filter({ kind: e.target.value }) }, KINDS.map(([v, l]) => el("option", { value: v, selected: v === V.kind }, l)));
  paint();
  void reloadErrors();
  return card(
    "Errors and limit hits",
    el("div", null, el("div", { class: "tools" }, text, device, kind, el("button", { onclick: () => void reloadErrors() }, "Refresh")), el("div", { class: "mt-10" }, holder)),
    "Errors are failures on our side or upstream (Jev, the gateway); refusals are requests the server turned away (daily or hourly limits, a disabled device, a datacenter address). Click a cause to filter to it. The range and network are set at the top.",
  );
}

hooks.reloadErrors = reloadErrors;
