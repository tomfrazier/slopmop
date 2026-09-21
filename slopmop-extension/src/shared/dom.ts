/**
 * Tiny DOM builders. LinkedIn enforces Trusted Types, which turns `innerHTML` strings into escaped text,
 * so injected UI is built from real nodes (no HTML-string sinks).
 */
const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number | undefined>;
type Child = Node | string | null | undefined;

function fill<T extends Element>(el: T, attrs: Attrs, children: Child[]): T {
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export const h = (tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement =>
  fill(document.createElement(tag), attrs, children);

export const s = (tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement =>
  fill(document.createElementNS(SVG_NS, tag), attrs, children);

export function style(css: string): HTMLStyleElement {
  const el = document.createElement("style");
  el.textContent = css;
  return el;
}

/** The Slop Mop mark from the design system: handle and head in `color`, the bristle gaps in `knockout` (the surface behind it). */
export function mopIcon(size = 20, color = "currentColor", knockout = "#FFFFFF"): SVGElement {
  return s(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    s("rect", { x: 10.6, y: 2, width: 2.8, height: 12, rx: 1.4, fill: color }),
    s("path", { d: "M5.2 13.6h13.6l-1.6 8.2H6.8z", fill: color }),
    s("path", { d: "M8.6 16.6v4.6M12 16.6v4.6M15.4 16.6v4.6", stroke: knockout, "stroke-width": 1.15, "stroke-linecap": "round" }),
  );
}
