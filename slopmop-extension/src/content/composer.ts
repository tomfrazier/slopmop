import { decideOwn } from "../shared/decide";
import { h, mopIcon, style } from "../shared/dom";
import { send } from "../shared/messages";
import { PALETTE } from "../shared/palette";
import { surfaceStats } from "../shared/surface";
import TOKENS from "../shared/tokens.css?inline";
import { closeInspector, showDraftInspector, showNotice } from "./inspector";
import { SEL } from "./selectors";
import { active, scoringParams, state } from "./state";
import CSS from "./styles/composer.css?inline";

/**
 * "Check this draft": a mop button in LinkedIn's post composer that scores what you have written so far, before you post it, and
 * shows the same breakdown a posted post gets. It is a manual button (nothing is sent until you press it) and each new text
 * costs one of the day's checks like any other post; the same text again is answered from this browser and costs nothing.
 */
const DRAFT_MIN_CHARS = 20;
const NO_ENGAGEMENT = { reactions: 0, comments: 0, reposts: 0 };

interface Mounted {
  host: HTMLElement;
  button: HTMLButtonElement;
  busy: boolean;
}
const mounted = new WeakMap<Element, Mounted>();
const openHosts = new Set<HTMLElement>();
/** Puts the draft's breakdown away; set while it is on screen. */
let dismissDraft: (() => void) | null = null;

const TITLE = "Check this draft with Slop Mop (uses one of your daily checks)";

function createButton(onPress: () => void): Mounted {
  const host = document.createElement("div");
  host.setAttribute("data-slopmop-composer", "");
  const root = host.attachShadow({ mode: "open" });
  const button = h("button", { type: "button", "aria-label": "Check this draft with Slop Mop", title: TITLE }) as HTMLButtonElement;
  button.append(mopIcon(24, "currentColor", PALETTE.paper000));
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPress();
  });
  root.append(style(TOKENS + CSS), button);
  return { host, button, busy: false };
}

const editorText = (editor: Element) => ((editor as HTMLElement).innerText ?? editor.textContent ?? "").replace(/\s+\n/g, "\n").trim();

/** Working: the mop turns into three bouncing dots until the answer comes back. */
function setBusy(m: Mounted, busy: boolean) {
  m.busy = busy;
  m.button.setAttribute("aria-busy", String(busy));
  m.button.replaceChildren(busy ? h("span", { class: "dots", role: "img", "aria-label": "Checking" }, h("i", {}), h("i", {}), h("i", {})) : mopIcon(24, "currentColor", PALETTE.paper000));
}

/** Closes the breakdown on a click anywhere, on Escape, or when the composer goes away. */
function dismissOnAnyInteraction(dialog: Element) {
  const off = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    observer.disconnect();
  };
  const close = () => {
    off();
    dismissDraft = null;
    closeInspector();
  };
  dismissDraft = close;
  const onDown = (e: Event) => {
    if ((e.target as Element | null)?.closest?.("[data-slopmop-composer]")) return; // the button toggles it itself
    close();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  const observer = new MutationObserver(() => !dialog.isConnected || !(dialog as HTMLDialogElement).open && dialog.tagName === "DIALOG" ? close() : undefined);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
}

async function check(dialog: Element, editor: Element, m: Mounted) {
  if (m.busy) return;
  if (dismissDraft) return dismissDraft(); // pressing it again puts the panel away
  const text = editorText(editor);
  if (text.length < DRAFT_MIN_CHARS) {
    showNotice(m.button, dialog, "Write a little more first", `Slop Mop needs at least ${DRAFT_MIN_CHARS} characters to judge a draft.`);
    return dismissOnAnyInteraction(dialog);
  }
  setBusy(m, true);
  try {
    const response = await send({ type: "judge", urn: `draft:${text.length}`, text, stats: surfaceStats(text), priority: 0, engagement: NO_ENGAGEMENT });
    if (!response) {
      const why = (await send({ type: "myDebug" }).catch(() => null))?.lastError;
      showNotice(m.button, dialog, "Couldn't check this draft", why || "The Slop Mop server didn't answer. Try again in a moment.");
      return dismissOnAnyInteraction(dialog);
    }
    const decision = decideOwn(response, state.settings.sensitivity, scoringParams());
    if (!decision.explain) {
      showNotice(m.button, dialog, "Nothing to judge yet", "Jev didn't return anything usable for this text.");
      return dismissOnAnyInteraction(dialog);
    }
    const used = response.usage;
    showDraftInspector(m.button, dialog, {
      urn: "draft",
      text,
      own: true,
      engagement: NO_ENGAGEMENT,
      response,
      decision,
      mode: state.settings.mode,
      sensitivity: state.settings.sensitivity,
      vote: null,
      advanced: state.settings.debug,
      draft: used ? { used: used.used, limit: used.limit } : true,
    });
    dismissOnAnyInteraction(dialog);
  } finally {
    setBusy(m, false);
  }
}

/** The composers on the page right now: an open dialog with an editor. */
function composers(): { dialog: HTMLElement; editor: Element }[] {
  const found: { dialog: HTMLElement; editor: Element }[] = [];
  for (const dialog of document.querySelectorAll<HTMLElement>(SEL.composer.dialog)) {
    const editor = dialog.querySelector(SEL.composer.editor);
    if (editor) found.push({ dialog, editor });
  }
  return found;
}

const BUTTON_PX = 48;
const GAP_PX = 8;
const FALLBACK_FROM_RIGHT_PX = 300;
/** The group of controls around Post is small; a parent wider than this is the whole footer, not that group. */
const MAX_GROUP_PX = 400;

/**
 * Floats the button inside the dialog, left of the row that holds the Post button, and follows that row as the dialog changes.
 * It is positioned, never inserted into LinkedIn's own layout, so it can't push, collapse or overlap anything there.
 */
function place(dialog: HTMLElement, host: HTMLElement) {
  const d = dialog.getBoundingClientRect();
  const post = [...dialog.querySelectorAll("button")].find((b) => SEL.composer.postLabel.test(b.textContent ?? ""));
  let left = d.width - FALLBACK_FROM_RIGHT_PX;
  let top = d.height - BUTTON_PX - GAP_PX * 2;
  if (post) {
    const p = post.getBoundingClientRect();
    // Post shares a small row with the schedule control (a clock and a count, which isn't a <button>): go left of that whole group.
    const group = post.parentElement?.getBoundingClientRect();
    const rowLeft = group && group.width >= p.width && group.width <= MAX_GROUP_PX ? Math.min(group.left, p.left) : p.left;
    left = rowLeft - d.left - BUTTON_PX - GAP_PX;
    top = p.top - d.top + (p.height - BUTTON_PX) / 2;
  }
  host.style.cssText = `position:absolute;left:${Math.max(0, Math.round(left))}px;top:${Math.max(0, Math.round(top))}px;z-index:5;width:${BUTTON_PX}px;height:${BUTTON_PX}px`;
}

/** Puts the mop button in every open composer (once each), keeps it beside Post, and takes it out of ones that have closed. Called on every page change. */
export function syncComposer() {
  const live = active() ? composers() : [];
  for (const { dialog, editor } of live) {
    let m = mounted.get(dialog);
    if (!m?.host.isConnected || m.host.parentElement !== dialog) {
      m?.host.remove();
      m = createButton(() => void check(dialog, editor, m!));
      mounted.set(dialog, m);
      openHosts.add(m.host);
      dialog.append(m.host);
    }
    place(dialog, m.host);
  }
  for (const host of [...openHosts]) {
    if (live.some(({ dialog }) => mounted.get(dialog)?.host === host)) continue;
    host.remove();
    openHosts.delete(host);
  }
}

/** Removes the buttons (the extension was switched off or reloaded). */
export function clearComposer() {
  for (const host of openHosts) host.remove();
  openHosts.clear();
}

// The dialog can resize (the window, the draft growing); keep the button beside Post.
window.addEventListener("resize", () => syncComposer());
