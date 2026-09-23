import { api, prefs, savePrefs } from "./api.js";
import { el } from "./dom.js";
import { fmt } from "./format.js";

export const kpi = (label, value, detail, cls) => el("div", { class: "card kpi" }, el("div", { class: "l" }, label), el("div", { class: `v ${cls || ""}` }, value), detail ? el("div", { class: "d" }, detail) : null);
export const card = (title, body, sub) => el("div", { class: "card" }, el("h2", null, title), sub ? el("div", { class: "sub card-sub" }, sub) : null, body);
/** A card that just holds `body`, for sections that have no title of their own. */
export const panel = (body, style) => el("div", { class: "card", style }, body);

/** A table. `cols`: [{h: header, v: row => cell, r: right-aligned}]. */
export function table(cols, rows, empty = "Nothing yet.") {
  if (!rows.length) return el("div", { class: "empty" }, empty);
  return el(
    "div",
    { class: "scroll" },
    el(
      "table",
      null,
      el("thead", null, el("tr", null, cols.map((c) => el("th", { class: c.r ? "r" : "" }, c.h)))),
      el("tbody", null, rows.map((r) => el("tr", null, cols.map((c) => el("td", { class: [c.r ? "r" : "", c.c || ""].join(" ").trim() }, c.v(r)))))),
    ),
  );
}

/** A link to the post on its network when we know its id, else the short content id. */
export const postLink = (p) => {
  const urn = p.nativeId;
  const label = urn ? urn.replace(/^urn:li:/, "") : p.contentId.slice(0, 10);
  return urn && p.network === "linkedin" ? el("a", { href: `https://www.linkedin.com/feed/update/${urn}/`, target: "_blank", rel: "noreferrer noopener" }, label) : el("code", null, label);
};

/** "2 probably · 0 maybe · 1 no", coloured. */
export const votesCell = (v) =>
  el("span", null, el("span", { class: "c-red" }, `${v.probably} probably`), " \u00B7 ", el("span", { class: "c-amber" }, `${v.maybe} maybe`), " \u00B7 ", el("span", { class: "c-green" }, `${v.no} no`));

/** A device: its name (if the admin gave it one) and its short id. */
export const deviceCode = (r) => (r.alias ? el("span", null, el("b", null, r.alias), " ", el("code", null, r.device)) : el("code", null, r.device));

/** The columns every list of voted posts shares. */
export const postColumns = (extra = []) => [
  { h: "Post", v: postLink },
  { h: "Jev", r: 1, v: (p) => fmt.pct(p.aiLikelihood, 0) },
  { h: "Votes", v: (p) => votesCell(p.votes) },
  { h: "Reactions", r: 1, v: (p) => (p.engagement ? fmt.compact(p.engagement.reactions) : "-") },
  { h: "Checks", r: 1, v: (p) => fmt.n(p.checks) },
  ...extra,
];

/** Sections that start folded away, because they are long and rarely needed. Anything else starts open. */
const FOLDED_AT_FIRST = new Set(["score", "tuner"]);

/**
 * A section you can fold: a heading row that opens and closes its body. Whether it is open is remembered for the session, so a
 * refresh (or a visit to another section) doesn't undo it.
 */
export function fold(id, title, note, ...body) {
  const open = prefs.open[id] ?? !FOLDED_AT_FIRST.has(id);
  return el(
    "details",
    { class: "fold", open: open ? true : null, ontoggle: (e) => { if (prefs.open[id] !== e.target.open) { prefs.open[id] = e.target.open; savePrefs(); } } },
    el("summary", null, el("h2", null, title), note ? el("span", { class: "sub" }, note) : null),
    el("div", { class: "fold-body" }, body),
  );
}

const pageOffsets = {};

/**
 * A table that pages through a long list from the server. `fetchPage(offset, limit)` returns {total, rows}. The page you were on
 * is remembered by `id`, so the once-a-minute redraw doesn't send you back to the first page.
 */
export function pagedTable({ id, fetchPage, columns, empty, pageSize = 15 }) {
  const holder = el("div", null, el("div", { class: "empty" }, "Loading…"));
  const load = async () => {
    let data;
    try {
      data = await fetchPage(pageOffsets[id] ?? 0, pageSize);
    } catch (e) {
      return holder.replaceChildren(el("div", { class: "err" }, e.message));
    }
    if (!data.rows.length && data.total > 0 && (pageOffsets[id] ?? 0) > 0) {
      pageOffsets[id] = 0; // the list got shorter than where we were
      return load();
    }
    const from = (pageOffsets[id] ?? 0) + 1;
    const to = (pageOffsets[id] ?? 0) + data.rows.length;
    holder.replaceChildren(
      table(columns, data.rows, empty),
      data.total > pageSize
        ? el("div", { class: "tools mt-10" },
            el("span", { class: "sub" }, `${fmt.n(from)}–${fmt.n(to)} of ${fmt.n(data.total)}`),
            el("button", { disabled: (pageOffsets[id] ?? 0) === 0, onclick: () => { pageOffsets[id] = Math.max(0, (pageOffsets[id] ?? 0) - pageSize); void load(); } }, "Previous"),
            el("button", { disabled: to >= data.total, onclick: () => { pageOffsets[id] = (pageOffsets[id] ?? 0) + pageSize; void load(); } }, "Next"))
        : data.total ? el("div", { class: "sub mt-10" }, `${fmt.n(data.total)} in all`) : null,
    );
  };
  void load();
  return holder;
}

/** Fetches one voted-post list a page at a time. */
export const votedPostsPager = (list, columns, empty) =>
  pagedTable({ id: `posts:${list}`, columns, empty, fetchPage: (offset, limit) => api("/posts", { list, network: prefs.network, limit: String(limit), offset: offset ? String(offset) : "" }) });
