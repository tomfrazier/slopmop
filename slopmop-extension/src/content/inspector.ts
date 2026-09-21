import { style } from "../shared/dom";
import type { InspectData } from "./inspectData";
import { buildPanel } from "./inspectorPanel";
import TOKENS from "../shared/tokens.css?inline";
import CSS from "./styles/inspector.css?inline";

export type { InspectData } from "./inspectData";
export { radarChart } from "./inspectorRadar";

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let panel: HTMLElement | null = null;
let hideTimer = 0;
let showTimer = 0;

function ensureHost(): ShadowRoot {
  if (host?.isConnected && root) return root;
  promoted = false; // a new host starts as an ordinary element
  host = document.createElement("div");
  host.setAttribute("data-slopmop-inspector", "");
  root = host.attachShadow({ mode: "open" });
  root.append(style(TOKENS + CSS));
  document.body.appendChild(host);
  return root;
}

function close() {
  clearTimeout(showTimer);
  panel?.remove();
  panel = null;
}
// The panel is a tooltip (pointer-events: none), so it can never catch a click meant for the post or its tabs.
const scheduleClose = () => {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(close, 60);
};
const cancelClose = () => clearTimeout(hideTimer);

let current: { anchor: Element; get: () => InspectData | null; side?: boolean; avoid?: DOMRect; modal?: Element } | null = null;
/** True while the panel host is shown as a popover (in the top layer). */
let promoted = false;

function render(data: InspectData) {
  if (!current) return;
  const r = ensureHost();
  panel?.remove();
  panel = buildPanel(data);
  r.append(panel);
  place(panel);
}

/** Puts a freshly built panel where it belongs, above a modal if the anchor is inside one. */
function place(el: HTMLElement) {
  if (!current) return;
  panel = el;
  promote(current.anchor, current.modal);
  position(current.anchor);
}

type Popoverable = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

/**
 * An open modal <dialog> (LinkedIn's post composer) sits in the browser's top layer, above anything else on the page whatever its
 * z-index. Panels for something inside one are promoted into the top layer too (a manual popover, styled to be invisible itself),
 * and returned to the ordinary page when they close.
 */
function promote(anchor: Element, modal?: Element) {
  const el = host as Popoverable | null;
  if (!el) return;
  if ((modal?.isConnected || openModalAround(anchor)) && typeof el.showPopover === "function") {
    if (!promoted) {
      el.setAttribute("popover", "manual");
      el.style.cssText = "position:fixed;inset:0;width:0;height:0;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none";
      // Showing it now, after the dialog opened, puts it above the dialog and its dimmed backdrop in the top layer.
      el.showPopover();
      promoted = true;
    }
  } else demote();
}

/** The open modal dialog around `node`, looking out through shadow roots (a button inside a shadow tree can't find it with closest()). */
function openModalAround(node: Node): boolean {
  for (let n: Node | null = node; n; n = n.parentNode ?? (n as ShadowRoot).host ?? null) {
    if (n instanceof Element && n.matches("dialog[open]")) return true;
  }
  return false;
}

function demote() {
  const el = host as Popoverable | null;
  if (!el || !promoted) return;
  promoted = false;
  try {
    el.hidePopover?.();
  } catch {
    /* already hidden */
  }
  el.removeAttribute("popover");
  el.style.cssText = "";
}

function position(anchor: Element) {
  if (!panel) return;
  const a = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (current?.avoid) {
    // Beside a modal (the composer) and never over it when there is room: right of it, else left, else tucked at its top right.
    const av = current.avoid;
    const left = av.right + 12 + pw <= vw - 8 ? av.right + 12 : av.left - 12 - pw >= 8 ? av.left - 12 - pw : Math.max(8, Math.min(av.right - pw - 16, vw - pw - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(Math.max(8, av.top), Math.max(8, vh - ph - 8))}px`;
    return;
  }
  if (current?.side) {
    // Beside the menu it belongs to: left of it if there is room (the menu sits near the right edge), else right.
    const left = a.left - pw - 10 >= 8 ? a.left - pw - 10 : a.right + 10 + pw <= vw - 8 ? a.right + 10 : Math.max(8, vw - pw - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(Math.max(8, a.top), Math.max(8, vh - ph - 8))}px`;
    return;
  }
  let top = a.bottom + 6;
  if (top + ph > vh - 8) top = Math.max(8, a.top - ph - 6);
  if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
  const left = Math.min(Math.max(8, a.left + a.width / 2 - pw / 2), vw - pw - 8);
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

/** Hover (or keyboard focus) on `target` opens the breakdown panel. `get` runs at open time so it reflects current settings. */
export function bindInspector(target: Element, get: () => InspectData | null) {
  const open = () => {
    cancelClose();
    clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      const data = get();
      if (!data?.decision.explain) return;
      current = { anchor: target, get };
      render(data);
    }, 120);
  };
  target.addEventListener("mouseenter", open);
  target.addEventListener("pointerdown", closeInspector); // pressing the tab/strip always dismisses the tooltip first
  target.addEventListener("focusin", open);
  target.addEventListener("mouseleave", scheduleClose);
  target.addEventListener("focusout", scheduleClose);
}

export function closeInspector() {
  current = null;
  close();
  demote();
}


/** Shows the breakdown beside `anchor` (the mop menu). Used by the menu's "Details" item; hide with closeInspector(). */
export function showInspectorBeside(anchor: Element, data: InspectData) {
  if (!data.decision.explain) return;
  cancelClose();
  current = { anchor, get: () => data, side: true };
  render(data);
}

/**
 * The breakdown for a draft in the composer: beside the dialog (not over the text being written), above it in the top layer,
 * and it stays until dismissed (a click, Escape, or the dialog closing), unlike the hover tooltip.
 */
export function showDraftInspector(anchor: Element, dialog: Element, data: InspectData) {
  if (!data.decision.explain) return;
  cancelClose();
  current = { anchor, get: () => data, avoid: dialog.getBoundingClientRect(), modal: dialog };
  render(data);
}

/** A short message beside the dialog (for example "write a little more first"), in the same style and place as the breakdown. */
export function showNotice(anchor: Element, dialog: Element, title: string, body: string) {
  cancelClose();
  current = { anchor, get: () => null, avoid: dialog.getBoundingClientRect(), modal: dialog };
  const r = ensureHost();
  panel?.remove();
  const el = document.createElement("div");
  el.className = "panel notice";
  const h5 = document.createElement("h4");
  h5.textContent = title;
  const p = document.createElement("p");
  p.className = "outcome";
  p.textContent = body;
  el.append(h5, p);
  r.append(el);
  place(el);
}
