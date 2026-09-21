import { el } from "./dom.js";

// ---- tooltip ----
const tip = () => document.getElementById("tip");
const TIP_OFFSET = 14;

export function showTip(e, rows) {
  const t = tip();
  t.replaceChildren(...rows);
  t.hidden = false;
  const x = Math.min(e.clientX + TIP_OFFSET, window.innerWidth - t.offsetWidth - 8);
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${e.clientY + TIP_OFFSET}px`;
}
export const hideTip = () => (tip().hidden = true);
export const tipRow = (label, value, color) => el("div", { class: "r" }, el("span", null, color ? el("span", { style: `color:${color}` }, "\u25A0 ") : null, label), el("b", null, value));
