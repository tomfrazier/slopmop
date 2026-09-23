import { el } from "./dom.js";
import { fmt } from "./format.js";

export const kpi = (label, value, detail, cls) => el("div", { class: "card kpi" }, el("div", { class: "l" }, label), el("div", { class: `v ${cls || ""}` }, value), detail ? el("div", { class: "d" }, detail) : null);
export const card = (title, body, sub) => el("div", { class: "card" }, el("h2", null, title), sub ? el("div", { class: "sub card-sub" }, sub) : null, body);
export const section = (title, note) => el("div", { class: "section" }, el("h2", null, title), note ? el("span", { class: "sub" }, note) : null);
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

/** A device id in a code style. */
export const deviceCode = (r) => el("code", null, r.device);

/** The columns every list of voted posts shares. */
export const postColumns = (extra = []) => [
  { h: "Post", v: postLink },
  { h: "Jev", r: 1, v: (p) => fmt.pct(p.aiLikelihood, 0) },
  { h: "Votes", v: (p) => votesCell(p.votes) },
  { h: "Reactions", r: 1, v: (p) => (p.engagement ? fmt.compact(p.engagement.reactions) : "-") },
  { h: "Checks", r: 1, v: (p) => fmt.n(p.checks) },
  ...extra,
];
