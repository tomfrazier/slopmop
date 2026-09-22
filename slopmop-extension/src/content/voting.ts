import { send } from "../shared/messages";
import type { Vote } from "../shared/types";
import { voteHides } from "../shared/vote";
import { ensureVerdict } from "./analysis";
import { decisionFor, panelState } from "./decision";
import { openVotePanel } from "./inspector";
import { active, hooks, restored, state } from "./state";
import type { Tracked } from "./tracked";
import { createVoteButton } from "./voteButton";
import { dropVote, setVote, voteOf } from "./votes";

/** Puts the mop icon beside a post's "…" menu (if it isn't there already), wired to its panel. */
export function ensureButton(t: Tracked) {
  if (!active() || t.vbtn?.host.isConnected) return;
  t.vbtn = createVoteButton(t.el, (button) =>
    openVotePanel(button, {
      getState: () => panelState(t),
      ensure: async () => void (await ensureVerdict(t)),
      onPick: (v) => castVote(t, v),
      onRefold: () => hideAgain(t),
    }),
  );
  t.vbtn.setVote(voteOf(t.urn));
}

/** Folds a post the user had unfolded back up. */
export function hideAgain(t: Tracked) {
  t.refolded = false;
  t.restored = false;
  restored.delete(t.urn);
  hooks.render(t);
}

/** Keeps the community line current right after you vote, without waiting for the server (which gets your vote in the background). */
function adjustCommunity(t: Tracked, before: Vote | null, after: Vote | null) {
  if (!t.community) return;
  const c = { ...t.community };
  if (before) c[before] = Math.max(0, c[before] - 1);
  if (after) c[after] += 1;
  c.total = c.no + c.maybe + c.probably;
  t.community = c;
}

/** Applies a vote (or clears it). Returns a message to show in the panel when it can't be recorded. */
export async function castVote(t: Tracked, vote: Vote | null): Promise<string | null> {
  const before = voteOf(t.urn);
  if (vote === null) {
    await send({ type: "unvote", urn: t.urn });
    dropVote(t.urn);
    adjustCommunity(t, before, null);
  } else {
    const response = await ensureVerdict(t);
    if (!response) return `Couldn't score this post, so the vote wasn't saved. ${t.failure ?? ""}`.trim();
    const d = decisionFor(t);
    const { settings } = state;
    const record = {
      urn: t.urn,
      network: response.network ?? "linkedin",
      contentId: response.contentId,
      label: vote,
      at: Date.now(),
      text: t.text,
      own: t.own,
      engagement: t.engagement,
      verdict: response,
      decided: { level: d.level, score: d.score, mode: settings.mode, sensitivity: settings.sensitivity },
    };
    await send({ type: "vote", record });
    setVote(record);
    adjustCommunity(t, before, vote);
    if (voteHides(vote)) hideAgain(t); // voting "probably" in Hide mode hides it again even if you had unfolded it
  }
  hooks.render(t);
  return null;
}
