import { send } from "../shared/messages";
import { decide, decideOwn } from "../shared/decide";
import { desiredView, type DesiredView } from "./view";
import type { Decision } from "../shared/types";
import { inspectFor } from "./decision";
import { isAd } from "./extract";
import { fold } from "./fold";
import { outline, ownOutline, refoldRing, voteOutline } from "./highlight";
import type { InspectData } from "./inspector";
import { active, posts, restored, scoringParams, state } from "./state";
import type { Tracked } from "./tracked";
import { ensureButton } from "./voting";
import { voteOf } from "./votes";

/** The things drawn on a post that can be added and removed independently. */
type Slot = "fold" | "outline" | "refold";

/** Removes one drawn thing from a post, if it is there. */
function drop(t: Tracked, slot: Slot) {
  t[slot]?.remove();
  t[slot] = undefined;
  if (slot === "outline") t.outlineKey = undefined;
}

/** Removes everything the extension drew on a post. */
export function clear(t: Tracked) {
  for (const slot of ["fold", "outline", "refold"] as const) drop(t, slot);
  t.vbtn?.remove();
  t.vbtn = undefined;
}

/** Counts a hidden or flagged post once, and refreshes the stats shown on every fold strip. */
async function count(t: Tracked, kind: "hidden" | "flagged") {
  if (t.counted === kind) return;
  t.counted = kind;
  state.lastStats = await send({ type: "record", kind, urn: t.urn });
  for (const p of posts.values()) p.fold?.updateStats(state.lastStats);
}

/** Runs UI work that must never break the page: a failure is logged and the post stays visible and untouched. */
function failOpen(what: string, t: Tracked, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.warn(`[slopmop] ${what} failed; leaving post visible`, e);
    t.el.removeAttribute("data-slopmop-hidden");
  }
}

/** Folds the post away. Unfolding keeps a red ring on it; "Hide post again" is in the mop menu. */
function showFold(t: Tracked, d: Decision, inspect: () => InspectData | null) {
  failOpen("fold", t, () => {
    drop(t, "refold");
    t.fold = fold(
      t.el,
      d,
      state.lastStats,
      () => {
        t.restored = true;
        restored.add(t.urn);
        t.fold = undefined;
        t.refold = refoldRing(t.el);
      },
      inspect,
    );
    void count(t, "hidden");
  });
}

/** Draws what `want` says, changing only what differs from what is there now. */
function reconcile(t: Tracked, want: DesiredView, d: Decision, inspect: () => InspectData | null) {
  if (!want.fold) drop(t, "fold");
  if (!want.refold) drop(t, "refold");
  if (!want.outline || t.outlineKey !== want.outline.key) drop(t, "outline");

  if (want.fold && !t.fold) showFold(t, d, inspect);
  if (want.refold && !t.refold && !t.fold) t.refold = refoldRing(t.el);
  if (want.outline && !t.outline) showOutline(t, want.outline);
}

/** Draws the border. A border from the score counts as a flagged post (once). */
function showOutline(t: Tracked, want: NonNullable<DesiredView["outline"]>) {
  try {
    t.outline = want.kind === "vote" ? voteOutline(t.el, want.vote!) : want.kind === "own" ? ownOutline(t.el, want.level!) : outline(t.el, want.decision!);
    t.outlineKey = want.key;
    if (want.kind === "score") void count(t, "flagged");
  } catch (e) {
    console.warn(`[slopmop] ${want.kind} outline failed`, e);
  }
}

/** Re-decides from cached raw answers; used after every settings change too (no re-inference). */
export function render(t: Tracked) {
  if (!t.el.isConnected) return;
  if (!active() || (!t.own && isAd(t.el))) return clear(t);
  ensureButton(t);
  const vote = voteOf(t.urn);
  t.vbtn?.setVote(vote);
  if (t.done && !t.response && !vote && !t.own) return; // unscored: nothing to show (the menu says why)

  const { settings } = state;
  const own = t.own ? decideOwn(t.response, settings.sensitivity, scoringParams()) : null;
  const decision = own ?? decide(t.response, t.engagement, settings.mode, settings.sensitivity, { params: scoringParams() });
  const want = desiredView({ decision, mode: settings.mode, vote, restored: t.restored, own: t.own, inspectOnly: t.inspectOnly, scored: !!t.response, ownLevel: own?.ownLevel });
  if (!want) {
    if (t.outlineKey?.startsWith("vote:")) drop(t, "outline"); // nothing to show: drop only a border a vote left behind
    return;
  }
  reconcile(t, want, decision, inspectFor(t));
}
