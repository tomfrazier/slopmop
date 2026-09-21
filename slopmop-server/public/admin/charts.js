import { niceInt, niceMax, seriesAxis } from "./axes.js";
import { el, s } from "./dom.js";
import { fmt } from "./format.js";
import { hideTip, showTip, tipRow } from "./tooltip.js";

export { seriesAxis } from "./axes.js";

const legend = (layers) => el("div", { class: "legend" }, layers.map((l) => el("span", null, el("i", { style: `background:${l.color}` }), l.label)));

// ---- the chart ----
const GEOMETRY = { width: 620, left: 38, right: 6, top: 8, bottom: 20 };
const GRID_LINES = 4;
const MAX_X_LABELS = 8;

/**
 * Stacked bar chart. `layers`: [{label, color, get(d)}]. `x(d)` labels the axis, `tipTitle(d)` titles the tooltip.
 * `money` uses fractional axis steps; otherwise the axis counts whole things.
 */
export function barChart(data, layers, { x, tipTitle, y = fmt.compact, ytip = fmt.n, height = 170, tickEvery, money = false } = {}) {
  const { width: W, left: L, right: R, top: T, bottom: B } = GEOMETRY;
  const H = height;
  const totals = data.map((d) => layers.reduce((n, l) => n + (l.get(d) || 0), 0));
  const max = Math.max(...totals, 0);
  if (!data.length || max === 0) return el("div", { class: "empty" }, "No data in this range yet.");

  const top = money ? niceMax(max) : niceInt(max);
  const barW = (W - L - R) / data.length;
  const yOf = (v) => T + (H - T - B) * (1 - v / top);
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });

  for (let i = 0; i <= GRID_LINES; i++) {
    const v = (top * i) / GRID_LINES;
    svg.append(s("line", { class: "gl", x1: L, x2: W - R, y1: yOf(v), y2: yOf(v) }), s("text", { x: L - 5, y: yOf(v) + 3, "text-anchor": "end" }, y(v)));
  }

  const labelEvery = tickEvery || Math.max(1, Math.ceil(data.length / MAX_X_LABELS));
  data.forEach((d, i) => {
    stackBars(svg, layers, d, { x: L + i * barW, barW, yOf });
    if (i % labelEvery === 0) svg.append(s("text", { x: L + i * barW + barW / 2, y: H - 5, "text-anchor": "middle" }, x(d)));
    svg.append(hoverTarget(d, { x: L + i * barW, y: T, width: barW, height: H - T - B }, layers, { x, tipTitle, ytip }));
  });
  return el("div", null, svg, layers.length > 1 || layers[0].legend ? legend(layers) : null);
}

/** One column's stacked segments. */
function stackBars(svg, layers, d, { x, barW, yOf }) {
  let acc = 0;
  for (const l of layers) {
    const v = l.get(d) || 0;
    if (!v) continue;
    const top = yOf(acc + v);
    const bottom = yOf(acc);
    svg.append(s("rect", { x: x + Math.min(1, barW * 0.12), y: top, width: Math.max(1, barW - Math.min(2, barW * 0.24)), height: Math.max(0.5, bottom - top), fill: l.color, rx: barW > 6 ? 1.5 : 0 }));
    acc += v;
  }
}

/** An invisible rectangle over a column that shows the tooltip. */
function hoverTarget(d, box, layers, { x, tipTitle, ytip }) {
  const hit = s("rect", { class: "hit", ...box, fill: "transparent" });
  hit.addEventListener("mousemove", (e) => showTip(e, [el("b", null, tipTitle ? tipTitle(d) : x(d)), ...layers.map((l) => tipRow(l.label, ytip(l.get(d) || 0), l.color))]));
  hit.addEventListener("mouseleave", hideTip);
  return hit;
}
