import { PALETTE } from "../shared/palette";
import { h, mopIcon, style } from "../shared/dom";
import { VOTE_COLOR, VOTE_NAME } from "../shared/vote";
import type { Vote } from "../shared/types";
import { SEL } from "./selectors";
import TOKENS from "../shared/tokens.css?inline";
import CSS from "./styles/voteButton.css?inline";

/** The greyscale mop icon that sits to the left of a post's "..." button and opens the vote menu. */
export interface VoteButton {
  host: HTMLElement;
  button: HTMLElement;
  setVote(v: Vote | null): void;
  remove(): void;
}

const GREY = PALETTE.ink500;

const glyph = (color: string): SVGElement => mopIcon(20, color, PALETTE.paper000);


/** Rectangles overlap or are on clearly different rows: the icon did not land beside the "..." button. */
function misplaced(a: DOMRect, b: DOMRect): boolean {
  if (!a.width || !b.width) return false; // no layout (e.g. hidden): can't tell, leave it
  const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return overlap || Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) > 20;
}

export function createVoteButton(post: HTMLElement, onOpen: (button: HTMLElement) => void): VoteButton {
  const host = document.createElement("div");
  host.setAttribute("data-slopmop-vote", "");
  const root = host.attachShadow({ mode: "open" });
  const button = h("button", { type: "button", "aria-haspopup": "menu", "aria-label": "Slop Mop: is this post slop?", title: "Is this post slop?" });
  button.append(glyph(GREY));
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
    menuBtn.before(host); // immediately left of the "..." button
    // On posts whose header row is the tall author block (long headlines), LinkedIn top-aligns the row and gives the "..."
    // button an 8px top margin. Mirror its vertical alignment so the two icons always sit on the same line.
    const cs = getComputedStyle(menuBtn);
    host.style.alignSelf = cs.alignSelf;
    host.style.marginTop = cs.marginTop;
    host.style.marginBottom = cs.marginBottom;
    requestAnimationFrame(() => {
      if (!host.isConnected) return;
      const h = host.getBoundingClientRect();
      const m = menuBtn.getBoundingClientRect();
      const dy = m.top - h.top; // whatever offset is left after copying the styles
      if (h.width && Math.abs(dy) > 0.5 && Math.abs(dy) <= 24) host.style.marginTop = `${(parseFloat(host.style.marginTop) || 0) + dy}px`;
      // If it still isn't beside the button (an unexpected header layout), float it in the corner instead.
      if (misplaced(host.getBoundingClientRect(), m)) floatInCorner();
    });
  } else floatInCorner();

  return {
    host,
    button,
    setVote(v) {
      const c = v ? VOTE_COLOR[v] : GREY;
      button.replaceChildren(glyph(c));
      const label = v ? `Slop Mop: you voted "${VOTE_NAME[v]}"` : "Slop Mop: is this post slop?";
      button.setAttribute("aria-label", label);
      button.title = v ? `Your vote: ${VOTE_NAME[v]}` : "Is this post slop?";
    },
    remove: () => host.remove(),
  };
}
