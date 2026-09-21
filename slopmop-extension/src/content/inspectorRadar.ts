import { PALETTE } from "../shared/palette";
/** How the spider chart is laid out, and the tell strength at which an axis label is emphasised. */
export const HOT_TELL = 0.5;
const RADAR = { width: 340, height: 250, centerY: 124, radius: 74, rings: [1 / 3, 2 / 3, 1], minPoint: 0.03 };

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e as SVGElement;
}

/**
 * A spider chart of Jev's score for each tell: the further a point sits from the centre, the stronger that sign of AI
 * writing. Built with DOM APIs (LinkedIn enforces Trusted Types, so no innerHTML). Exported for tests.
 */
export function radarChart(axes: { label: string; value: number }[], color: string): SVGElement {
  const { width: W, height: H, centerY: cy, radius: R, rings, minPoint } = RADAR;
  const cx = W / 2;
  const n = axes.length;
  const svg = svgEl("svg", { class: "radar", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Tell strengths: ${axes.map((a) => `${a.label} ${Math.round(a.value * 100)}%`).join(", ")}` });
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, r: number) => ({ x: cx + Math.cos(angle(i)) * r, y: cy + Math.sin(angle(i)) * r });
  const points = (radiusOf: (i: number) => number) => axes.map((_, i) => `${at(i, radiusOf(i)).x.toFixed(1)},${at(i, radiusOf(i)).y.toFixed(1)}`).join(" ");
  const reach = (a: { value: number }) => R * Math.max(minPoint, Math.min(1, a.value));

  for (const ring of rings) svg.append(svgEl("polygon", { points: points(() => R * ring), fill: "none", stroke: PALETTE.ink200, "stroke-width": 1 }));
  axes.forEach((_, i) => svg.append(svgEl("line", { x1: cx, y1: cy, x2: at(i, R).x, y2: at(i, R).y, stroke: PALETTE.ink200, "stroke-width": 1 })));
  svg.append(svgEl("polygon", { points: points((i) => reach(axes[i])), fill: color, "fill-opacity": 0.22, stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
  axes.forEach((a, i) => {
    const tip = at(i, reach(a));
    svg.append(svgEl("circle", { cx: tip.x, cy: tip.y, r: 2.6, fill: color }));
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    const label = at(i, R + 9);
    svg.append(svgEl("text", { x: label.x, y: label.y + (sin > 0.5 ? 9 : sin < -0.5 ? -2 : 3.5), "text-anchor": cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle", class: a.value >= HOT_TELL ? "hot" : "" }, a.label));
  });
  return svg;
}
