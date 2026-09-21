import { PALETTE } from "../shared/palette";
import { h } from "../shared/dom";
import type { Zones } from "../shared/display";
import type { Community, Vote } from "../shared/types";
import { VOTE_COLOR, VOTE_HINT, VOTE_NAME } from "../shared/vote";
import { closeInspector, showInspectorBeside } from "./inspector";
import type { MenuState, Tone } from "./voteMenuTypes";

const TONE: Record<Tone, string> = { green: PALETTE.blue500, yellow: PALETTE.mop900, red: PALETTE.red500, grey: PALETTE.ink600 };

/** "3 flagged as slop · 1 maybe · 2 no", or a note that nobody has voted yet. */
function communityLine(c: Community): HTMLElement {
  if (c.total === 0) return h("div", { class: "community" }, "No community votes yet");
  return h("div", { class: "community" }, "Community: ", h("b", {}, `${c.probably} flagged as slop`), ` · ${c.maybe} maybe · ${c.no} no`);
}

/** A thin bar of the three zones (looks fine, possibly, likely) with a marker at the shown score. */
function meter(score: number, zones: Zones): HTMLElement {
  const { possibly: displayPossibly, likely: displayLikely } = zones;
  return h(
    "div",
    { class: "meter", role: "img", "aria-label": `Slop score ${score} out of 100` },
    h("i", { style: `width:${displayPossibly}%;background:${PALETTE.blue200}` }),
    h("i", { style: `width:${displayLikely - displayPossibly}%;background:${PALETTE.mop200}` }),
    h("i", { style: `flex:1;background:${PALETTE.red200}` }),
    h("b", { style: `left:${Math.min(100, Math.max(0, score))}%` }),
  );
}

/** The score at the top of the menu: three bouncing dots while scoring, then the number, the verdict and the community line. */
export function scoreSection(getState: () => MenuState) {
  const box = h("div", { class: "score", "aria-live": "polite" });
  const label = h("span", { class: "k" }, "Slop score");
  const paint = () => {
    const s = getState();
    box.replaceChildren();
    if (s.problem) return box.append(h("div", { class: "row" }, label), h("div", { class: "err" }, s.problem));
    if (s.score === null) {
      const dots = h("span", { class: "dots", role: "img", "aria-label": "Scoring" }, h("i", {}), h("i", {}), h("i", {}));
      return box.append(h("div", { class: "row" }, label, dots), h("div", { class: "verdict", style: "color:var(--text-faint)" }, "Scoring…"));
    }
    // The verdict leads; the number is supporting detail, with a meter that shows where it falls.
    box.append(
      h("div", { class: "verdict", style: `color:${TONE[s.tone]}` }, s.verdict),
      meter(s.score, s.zones),
      h("div", { class: "row" }, label, h("span", { class: "v" }, String(s.score))),
      ...(s.community ? [communityLine(s.community)] : []),
    );
  };
  return { box, paint };
}

/** "Details": shows the analysis card on hover or focus (not click), so it never gets in the way of the post underneath. */
export function detailsItem(getState: () => MenuState, menu: () => HTMLElement) {
  const button = h(
    "button",
    { type: "button", role: "menuitem", "aria-haspopup": "true", class: "quiet" },
    h("span", { class: "name" }, "Details"),
    h("span", { class: "chev", "aria-hidden": "true" }, "‹"),
  ) as HTMLButtonElement;
  const show = () => {
    const inspect = getState().inspect;
    if (inspect) showInspectorBeside(menu(), inspect);
  };
  for (const event of ["mouseenter", "focus", "click"]) button.addEventListener(event, show); // click is for touch, where there is no hover
  for (const event of ["mouseleave", "blur"]) button.addEventListener(event, closeInspector);
  const paint = () => {
    const ready = !!getState().inspect;
    button.setAttribute("aria-disabled", String(!ready));
    button.title = ready ? "" : "Available once the post has been scored";
  };
  return { button, paint };
}

/** One of the three vote choices. Choosing your current vote again clears it. */
export function voteRadio(v: Vote, current: Vote | null, pick: (vote: Vote | null, btn: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h(
    "button",
    { type: "button", role: "menuitemradio", "aria-checked": String(current === v), "data-v": v },
    h("span", { class: "dot", style: `background:${VOTE_COLOR[v]}` }),
    h("span", { class: "name" }, VOTE_NAME[v]),
    h("span", { class: "hint" }, VOTE_HINT[v]),
    current === v ? h("span", { class: "check", "aria-hidden": "true" }, "✓") : null,
  ) as HTMLButtonElement;
  b.addEventListener("click", () => pick(current === v ? null : v, b));
  return b;
}

/** A plain text item under the votes ("Clear my vote", "Hide post again"). */
export const quietItem = (label: string, onClick: (self: HTMLButtonElement) => void) => {
  const b = h("button", { type: "button", role: "menuitem", class: "quiet" }, label) as HTMLButtonElement;
  b.addEventListener("click", () => onClick(b));
  return b;
};
