import { h, s, style } from "../shared/dom";
import { VOTE_NAME } from "../shared/vote";
import type { OwnLevel, Vote } from "../shared/types";
import { SEL } from "./selectors";
import TOKENS from "../shared/tokens.css?inline";
import CSS from "./styles/voteButton.css?inline";

export interface VoteButton {
  host: HTMLElement;
  button: HTMLElement;
  setVote(v: Vote | null): void;
  /** The dimmed background tint (no verdict yet = null); voteButton.css brightens it and reverses the icon on hover. */
  setTone(tone: OwnLevel | null): void;
  remove(): void;
}

/**
 * The mop mark, coloured entirely through the button's `--vb-fill`/`--vb-knock` custom properties (set by a `.tone-*` class in
 * voteButton.css) so a tone change or a hover never needs the icon rebuilt.
 */
const glyph = (size = 20): SVGElement =>
  s(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    s("rect", { x: 10.6, y: 2, width: 2.8, height: 12, rx: 1.4, style: "fill:var(--vb-fill)" }),
    s("path", { d: "M5.2 13.6h13.6l-1.6 8.2H6.8z", style: "fill:var(--vb-fill)" }),
    s("path", { d: "M8.6 16.6v4.6M12 16.6v4.6M15.4 16.6v4.6", style: "stroke:var(--vb-knock);stroke-width:1.15;stroke-linecap:round" }),
  );

function misplaced(a: DOMRect, b: DOMRect): boolean {
  if (!a.width || !b.width) return false;
  const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return overlap || Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) > 20;
}

export function createVoteButton(post: HTMLElement, onOpen: (button: HTMLElement) => void): VoteButton {
  const host = document.createElement("div");
  host.setAttribute("data-slopmop-vote", "");
  const root = host.attachShadow({ mode: "open" });
  const button = h("button", { type: "button", "aria-haspopup": "dialog", "aria-label": "Slop Mop: is this post slop?", title: "Is this post slop?" });
  button.append(glyph());
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(button);
  });
  root.append(style(TOKENS + CSS), button);

  const menuBtn = post.querySelector<HTMLElement>(SEL.authorAria);
  const floatInCorner = () => {
    host.style.cssText = "position:absolute;top:8px;right:104px;z-index:5";
    if (getComputedStyle(post).position === "static") post.style.position = "relative";
    post.appendChild(host);
  };
  if (menuBtn?.parentElement) {
    menuBtn.before(host);
    const cs = getComputedStyle(menuBtn);
    host.style.alignSelf = cs.alignSelf;
    host.style.marginTop = cs.marginTop;
    host.style.marginBottom = cs.marginBottom;
    requestAnimationFrame(() => {
      if (!host.isConnected) return;
      const h = host.getBoundingClientRect();
      const m = menuBtn.getBoundingClientRect();
      const dy = m.top - h.top;
      if (h.width && Math.abs(dy) > 0.5 && Math.abs(dy) <= 24) host.style.marginTop = `${(parseFloat(host.style.marginTop) || 0) + dy}px`;
      if (misplaced(host.getBoundingClientRect(), m)) floatInCorner();
    });
  } else floatInCorner();

  return {
    host,
    button,
    setVote(v) {
      const label = v ? `Slop Mop: you voted "${VOTE_NAME[v]}"` : "Slop Mop: is this post slop?";
      button.setAttribute("aria-label", label);
      button.title = v ? `Your vote: ${VOTE_NAME[v]}` : "Is this post slop?";
    },
    setTone(tone) {
      button.classList.remove("tone-green", "tone-yellow", "tone-red");
      if (tone) button.classList.add(`tone-${tone}`);
    },
    remove: () => host.remove(),
  };
}
