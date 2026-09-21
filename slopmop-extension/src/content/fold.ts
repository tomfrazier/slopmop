import { PALETTE } from "../shared/palette";
import { dialEl } from "../shared/dial";
import { h, mopIcon, style } from "../shared/dom";
import type { Summary } from "../shared/stats";
import type { StatsReply } from "../shared/messages";
import { bindInspector, closeInspector, type InspectData } from "./inspector";
import type { Decision } from "../shared/types";
import PAGE_CSS from "./styles/page.css?inline";
import TOKENS from "../shared/tokens.css?inline";
import CSS from "./styles/fold.css?inline";

const PAGE_CSS_ID = "slopmop-page-css";
export const HIDDEN_ATTR = "data-slopmop-hidden";
const FOLD_H = 44;

export function ensurePageCss() {
  if (document.getElementById(PAGE_CSS_ID)) return;
  const s = document.createElement("style");
  s.id = PAGE_CSS_ID;
  s.textContent = PAGE_CSS;
  document.head.appendChild(s);
}


function statsNodes(r: StatsReply | null): Node[] {
  const t: Summary | undefined = r?.hidden;
  const cell = (n: number | undefined, l: string) => h("div", { class: "stat" }, h("b", {}, String(n ?? "–")), h("span", {}, l));
  return [
    cell(t?.today, "today"),
    cell(t?.week, "week"),
    cell(t?.month, "month"),
    cell(t?.total, "all time"),
    h("div", { class: "dial", title: t ? `Today ${t.today} · record ${t.record}` : "" }, dialEl(t ?? { dial: 0, isNewRecord: false }, DIAL_PX)),
  ];
}

export interface Fold {
  host: HTMLElement;
  updateStats(r: StatsReply): void;
  remove(): void;
}

const MEASURE_ATTR = "data-slopmop-measure";
const REVEAL_ATTR = "data-slopmop-reveal";
/** How long the unfold animation runs; matches the height transition in fold.css. */
const UNFOLD_MS = 640;
const DIAL_PX = 44;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** The folded-paper strip: two halves, a crease, the brand line and the stats. */
function buildStrip(statsEl: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "wrap", role: "button", tabindex: 0, "aria-label": "This post was hidden by Slop Mop. Activate to show it." },
    h("div", { class: "half top" }),
    h("div", { class: "half bot" }),
    h("div", { class: "crease" }),
    h("div", { class: "content" }, h("div", { class: "brand" }, mopIcon(18, PALETTE.ink400), h("span", { class: "label" }, "This post was hidden")), statsEl, h("span", { class: "show" }, "Show post")),
  );
}

/** The post's height at the strip's width, measured without disturbing the page's layout. */
function heightAtWidth(post: HTMLElement, width: number): number {
  post.removeAttribute(HIDDEN_ATTR);
  post.setAttribute(MEASURE_ATTR, "");
  post.style.width = `${width}px`;
  const height = post.offsetHeight;
  post.removeAttribute(MEASURE_ATTR);
  post.style.width = "";
  post.setAttribute(HIDDEN_ATTR, "");
  return height;
}

/** Runs `action` on click or Enter/Space. */
function onActivate(el: HTMLElement, action: () => void) {
  el.addEventListener("click", action);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  });
}

/** Inserts a folded-paper strip before `post` and hides the post. Click/Enter unfolds and restores it. */
export function fold(post: HTMLElement, d: Decision, stats: StatsReply | null, onRestore: () => void, inspect?: () => InspectData | null): Fold {
  ensurePageCss();
  const host = document.createElement("div");
  host.setAttribute("data-slopmop-fold", "");
  host.style.setProperty("--fold-h", `${FOLD_H}px`); // the folded height, shared with fold.css
  const statsEl = h("div", { class: "stats" }, ...statsNodes(stats));
  const wrap = buildStrip(statsEl);
  host.attachShadow({ mode: "open" }).append(style(TOKENS + CSS), wrap);
  // Insert and hide only once the strip is fully built, so a failure can never leave a post hidden with nothing in its place.
  post.parentElement?.insertBefore(host, post);
  post.setAttribute(HIDDEN_ATTR, "");
  if (inspect) bindInspector(wrap, inspect);

  const finish = () => {
    post.removeAttribute(HIDDEN_ATTR);
    post.setAttribute(REVEAL_ATTR, "");
    host.remove();
    onRestore();
  };
  let opened = false;
  onActivate(wrap, () => {
    if (opened) return;
    opened = true;
    closeInspector();
    const height = heightAtWidth(post, wrap.offsetWidth);
    if (matchMedia(REDUCED_MOTION).matches || height <= FOLD_H) return finish();
    wrap.classList.add("open");
    wrap.style.height = `${height}px`;
    setTimeout(finish, UNFOLD_MS);
  });

  return {
    host,
    updateStats: (r) => statsEl.replaceChildren(...statsNodes(r)),
    remove: () => {
      host.remove();
      post.removeAttribute(HIDDEN_ATTR);
    },
  };
}
