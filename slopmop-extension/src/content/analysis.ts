import { send } from "../shared/messages";
import { RECHECK_PRIORITY } from "../shared/constants";
import { live } from "../shared/manifest";
import { surfaceStats } from "../shared/surface";
import type { JudgeResponse } from "../shared/types";
import { engagementBand } from "../shared/engagement";
import { isAd } from "./extract";
import { active, hooks } from "./state";
import type { Tracked } from "./tracked";

/** Asks for a verdict on a post (once, unless forced) and records the answer. */
export function analyze(t: Tracked, priority: number, force = false): Promise<void> {
  if (t.pending) return t.pending;
  if (t.requested && !force) return Promise.resolve();
  if (!active() || isAd(t.el)) return Promise.resolve(); // the sponsored marker can render after the card first appears
  if (t.inspectOnly && !force) return Promise.resolve(); // short / non-English: only when you open the menu or vote
  t.requested = true;
  t.done = false;
  t.pending = (async () => {
    t.response = await send({
      type: "judge",
      urn: t.urn,
      text: t.text,
      stats: surfaceStats(t.text),
      priority,
      // Only a canonical id is worth sending: LinkedIn's modern feed card keys are specific to each viewer.
      nativeId: t.urn.startsWith("urn:li:") ? t.urn : undefined,
      engagement: t.engagement,
    });
    t.done = true;
    await recordOutcome(t);
    hooks.render(t);
  })().finally(() => (t.pending = undefined));
  return t.pending;
}

/**
 * Asks again for a post whose engagement has grown a step since it was checked: Jev's answer to the text is the same, but the
 * server's shield (its reader-response half) has moved. The old answer stays until the new one arrives, and stays if it can't.
 */
export function recheck(t: Tracked): Promise<void> {
  if (t.pending || !t.response || !active()) return Promise.resolve();
  t.pending = (async () => {
    const fresh = await send({ type: "judge", urn: t.urn, text: t.text, stats: surfaceStats(t.text), priority: RECHECK_PRIORITY, nativeId: t.urn.startsWith("urn:li:") ? t.urn : undefined, engagement: t.engagement });
    if (!fresh) return;
    t.response = fresh;
    t.community = fresh.community ?? t.community;
    hooks.render(t);
  })().finally(() => (t.pending = undefined));
  return t.pending;
}

/** What happens after a check: an answer is kept, a dropped post is asked for again later, a failure is explained and retried. */
async function recordOutcome(t: Tracked) {
  if (t.response) {
    t.cancelled = false; // it was answered after all
    t.failure = null;
    t.contentId = t.response.contentId;
    t.community = t.response.community;
  } else if (t.cancelled) {
    // Scrolled past before its turn: not a failure. It is asked for again if it comes back into range.
    t.cancelled = false;
    t.requested = false;
    t.done = false;
  } else {
    t.failure = ((await send({ type: "myDebug" }).catch(() => null))?.lastError ?? null) || "The Slop Mop server didn't answer.";
    scheduleRetry(t);
  }
}

/** A server that was briefly unreachable shouldn't leave a post unscored (no border) for the rest of the session. */
function scheduleRetry(t: Tracked) {
  const delays = live.values.postRetryDelaysMs;
  if (t.retries >= delays.length) return;
  const delay = delays[t.retries++];
  window.setTimeout(() => {
    if (!t.response && t.el.isConnected && active()) {
      t.requested = false;
      void analyze(t, 0, true);
    }
  }, delay);
}

/** Makes sure the post has a Jev verdict (scoring it now if it was never scored), so it can be shown and voted on. */
export async function ensureVerdict(t: Tracked): Promise<JudgeResponse | null> {
  if (t.response) return t.response;
  if (t.pending) await t.pending;
  if (!t.response) await analyze(t, 0, true);
  return t.response;
}
