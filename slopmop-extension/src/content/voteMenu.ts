import { h, style } from "../shared/dom";
import type { Vote } from "../shared/types";
import { closeInspector } from "./inspector";
import TOKENS from "../shared/tokens.css?inline";
import CSS from "./styles/voteMenu.css?inline";
import { closeOnDismissal, menuKeys, placeBelow } from "./voteMenuBehavior";
import { detailsItem, quietItem, scoreSection, voteRadio } from "./voteMenuParts";
import type { MenuOpts } from "./voteMenuTypes";

export type { MenuOpts, MenuState, Tone } from "./voteMenuTypes";

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let openState: { anchor: HTMLElement; close: () => void } | null = null;

function ensureHost(): ShadowRoot {
  if (host?.isConnected && root) return root;
  host = document.createElement("div");
  host.setAttribute("data-slopmop-menu", "");
  root = host.attachShadow({ mode: "open" });
  root.append(style(TOKENS + CSS));
  document.body.appendChild(host);
  return root;
}

export function closeVoteMenu() {
  openState?.close();
}

export function openVoteMenu(anchor: HTMLElement, opts: MenuOpts): void {
  if (openState?.anchor === anchor) return closeVoteMenu(); // clicking the icon again closes it
  closeVoteMenu();
  closeInspector();

  const shadow = ensureHost();
  const initial = opts.getState();
  const errMsg = h("div", { class: "err-msg", role: "alert" });
  let menu!: HTMLElement;
  let stopListening = () => {};

  const close = (refocus: boolean) => {
    stopListening();
    closeInspector();
    menu.remove();
    openState = null;
    if (refocus) anchor.focus();
  };

  const pick = async (v: Vote | null, btn: HTMLButtonElement) => {
    items.forEach((b) => (b.disabled = true));
    errMsg.textContent = "";
    const problem = await opts.onPick(v).catch(() => "Something went wrong saving that vote.");
    if (!problem) return close(true);
    errMsg.textContent = problem;
    items.forEach((b) => (b.disabled = false));
    btn.focus();
  };

  const score = scoreSection(opts.getState);
  const details = detailsItem(opts.getState, () => menu);
  const radios = (["no", "maybe", "probably"] as const).map((v) => voteRadio(v, initial.current, (vote, btn) => void pick(vote, btn)));
  const clearBtn = initial.current ? quietItem("Clear my vote", (self) => void pick(null, self)) : null;
  const refoldBtn = initial.canRefold ? quietItem("Hide post again", () => (close(false), opts.onRefold())) : null;
  const items = [...radios, ...(clearBtn ? [clearBtn] : []), ...(refoldBtn ? [refoldBtn] : []), details.button];

  menu = h(
    "div",
    { class: "menu", role: "menu", "aria-label": "Slop Mop" },
    score.box,
    h("hr"),
    h("div", { class: "title" }, "Is this post slop?"),
    ...radios,
    clearBtn,
    refoldBtn,
    errMsg,
    h("hr"),
    details.button,
  );
  score.paint();
  details.paint();
  shadow.append(menu);
  placeBelow(anchor, menu);

  // Score on demand: short / non-English posts aren't scored until you ask.
  if (initial.score === null && !initial.problem) {
    void opts.ensure().finally(() => {
      if (openState?.anchor !== anchor) return;
      score.paint();
      details.paint();
      placeBelow(anchor, menu);
    });
  }

  stopListening = closeOnDismissal(menu, anchor, menuKeys(items, shadow, close), close);
  openState = { anchor, close: () => close(false) };
  (radios.find((b) => b.getAttribute("data-v") === initial.current) ?? radios[0]).focus();
}
