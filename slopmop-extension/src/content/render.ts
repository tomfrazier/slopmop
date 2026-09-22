import { send } from "../shared/messages";
import { decide, decideOwn } from "../shared/decide";
import { desiredView, type DesiredView } from "./view";
import type { Decision, OwnLevel } from "../shared/types";
import { voteLevel } from "../shared/vote";
import { inspectFor } from "./decision";
import { isAd } from "./extract";
import { fold } from "./fold";
import type { InspectData } from "./inspector";
import { active, posts, restored, scoringParams, state } from "./state";
import type { Tracked } from "./tracked";
import { ensureButton } from "./voting";
import { voteOf } from "./votes";

/** Removes everything the extension drew on a post. */
export function clear(t: Tracked) {
  t.fold?.remove();
  t.fold = undefined;
  t.refolded = false;
  t.vbtn?.setTone(null);
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

/** Folds the post away. Unfolding leaves it refoldable ("Hide post again" is in the panel), with a red icon tint. */
function showFold(t: Tracked, d: Decision, inspect: () => InspectData | null) {
  failOpen("fold", t, () => {
    t.refolded = false;
    const f = fold(
      t.el,
      d,
      state.lastStats,
      () => {
        t.restored = true;
        restored.add(t.urn);
        t.fold = undefined;
        t.refolded = true;
      },
      inspect,
    );
    // Null means the post had no parent to insert a strip before (LinkedIn detached it mid-flight): try again next render
    // rather than counting a hide that never visibly happened.
    if (!f) return void console.warn(`[slopmop] couldn't fold ${t.urn}: post has no parent element`);
    t.fold = f;
    void count(t, "hidden");
  });
}

/** The tone the mop icon shows for what `want.outline` says: a vote beats the score; your own posts always have one. */
function toneFor(outline: NonNullable<DesiredView["outline"]>): OwnLevel {
  if (outline.kind === "vote") return voteLevel(outline.vote!);
  if (outline.kind === "own") return outline.level!;
  return outline.decision!.level as OwnLevel; // "score" is only set when level isn't "none"
}

/** Draws what `want` says, changing only what differs from what is there now. */
function reconcile(t: Tracked, want: DesiredView, d: Decision, inspect: () => InspectData | null) {
  if (!want.fold) {
    t.fold?.remove();
    t.fold = undefined;
  }
  t.refolded = want.refold;
  if (want.fold && !t.fold) showFold(t, d, inspect);
  t.vbtn?.setTone(want.outline ? toneFor(want.outline) : null);
  if (want.outline?.kind === "score") void count(t, "flagged"); // idempotent: count() only records the first time
}

/** Re-decides from cached raw answers; used after every settings change too (no re-inference). */
export function render(t: Tracked) {
  if (!t.el.isConnected) return;
  if (!active() || (!t.own && isAd(t.el))) return clear(t);
  ensureButton(t);
  const vote = voteOf(t.urn);
  t.vbtn?.setVote(vote);
  if (t.done && !t.response && !vote && !t.own) return; // unscored: nothing to show (the panel says why)

  const { settings } = state;
  const own = t.own ? decideOwn(t.response, settings.sensitivity, scoringParams()) : null;
  const decision = own ?? decide(t.response, t.engagement, settings.mode, settings.sensitivity, { params: scoringParams() });
  const want = desiredView({ decision, mode: settings.mode, vote, restored: t.restored, own: t.own, inspectOnly: t.inspectOnly, scored: !!t.response, ownLevel: own?.ownLevel });
  if (!want) return; // leave what is there alone
  reconcile(t, want, decision, inspectFor(t));
}
