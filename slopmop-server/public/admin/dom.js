// Tiny DOM helpers. Everything is built with DOM APIs, never innerHTML, so page data can't inject markup.
const SVG_NS = "http://www.w3.org/2000/svg";

/** An HTML element. `attrs.class` sets the class, `on*` attributes add listeners, false/null attributes are skipped. */
export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/** An SVG element. */
export function s(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/** The Slop Mop mark from the design system: handle and head in the current text colour, bristle gaps in the surface colour. */
export function mopMark(size = 24) {
  return s(
    "svg",
    { class: "mark", width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    s("rect", { x: 10.6, y: 2, width: 2.8, height: 12, rx: 1.4, fill: "currentColor" }),
    s("path", { d: "M5.2 13.6h13.6l-1.6 8.2H6.8z", fill: "currentColor" }),
    s("path", { d: "M8.6 16.6v4.6M12 16.6v4.6M15.4 16.6v4.6", stroke: "var(--surface-card)", "stroke-width": 1.15, "stroke-linecap": "round" }),
  );
}
