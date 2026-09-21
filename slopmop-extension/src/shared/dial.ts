import { PALETTE } from "./palette";
import { s } from "./dom";
import type { Summary } from "./stats";

/** Half-moon dial: arc = 0..personal daily record, dot = today. Red dot at the far right = new record. */
export function dialEl(d: Pick<Summary, "dial" | "isNewRecord">, width = 64): SVGElement {
  const cx = 32, cy = 32, r = 26;
  const a = Math.PI * (1 - Math.min(1, Math.max(0, d.dial)));
  const dx = (cx + r * Math.cos(a)).toFixed(2);
  const dy = (cy - r * Math.sin(a)).toFixed(2);
  const hot = d.isNewRecord || d.dial >= 1;
  return s(
    "svg",
    { viewBox: "0 0 64 38", width, height: (width * 38) / 64, role: "img", "aria-label": "Today versus your daily record" },
    s("path", { d: "M6 32 A26 26 0 0 1 58 32", fill: "none", stroke: PALETTE.ink200, "stroke-width": 5, "stroke-linecap": "round" }),
    s("path", { d: `M6 32 A26 26 0 0 1 ${dx} ${dy}`, fill: "none", stroke: hot ? PALETTE.red500 : PALETTE.ink600, "stroke-width": 5, "stroke-linecap": "round", opacity: d.dial > 0 ? 1 : 0 }),
    s("circle", { cx: dx, cy: dy, r: 4.2, fill: hot ? PALETTE.red500 : PALETTE.ink900, stroke: PALETTE.paper000, "stroke-width": 1.5 }),
  );
}
