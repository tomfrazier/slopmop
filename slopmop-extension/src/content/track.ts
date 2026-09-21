import { send } from "../shared/messages";
import { engagementBand } from "../shared/engagement";
import { recheck } from "./analysis";
import { findOwnName, getUrn, inspectPost, readEngagement } from "./extract";
import { clear } from "./render";
import { observerFor } from "./observers";
import { byEl, counted, posts, restored, seen, state } from "./state";
import type { Tracked } from "./tracked";
import { ensureButton } from "./voting";

/** Counts something seen once, and tells the popup's debug panel. */
function tally(urn: string | null, key: keyof typeof seen) {
  const id = `${key}:${urn ?? Math.random()}`;
  if (counted.has(id)) return;
  counted.add(id);
  seen[key]++;
  void send({ type: "debug", ...seen });
}

/** Remembers the signed-in user's name (from the page), so their own posts are recognised. */
function learnOwnName() {
  state.ownName ??= findOwnName();
  if (state.ownName && !state.learnedName) {
    state.learnedName = true;
    void chrome.storage.local.set({ ownName: state.ownName });
  }
}

/** Reads the post's counts again; when they have grown a step, the server is asked for a fresh shield. */
function refreshEngagement(t: Tracked) {
  const now = readEngagement(t.el);
  if (engagementBand(now) <= engagementBand(t.engagement)) return; // only growth matters: a count that reads lower is a glitch
  t.engagement = now;
  void recheck(t);
}

export function track(el: HTMLElement) {
  const known = byEl.get(el);
  if (known) {
    // LinkedIn recycles nodes: if the same node now holds a different post, retrack it.
    if (getUrn(el) === known.urn) {
      refreshEngagement(known); // the counts move while a post sits in the feed
      return ensureButton(known); // LinkedIn may have re-rendered the header and dropped our icon
    }
    clear(known);
    byEl.delete(el);
  }
  learnOwnName();
  // Lenient: short and non-English posts are tracked too so they can be voted on. They are only scored on demand
  // (when you open the menu or vote), and are never hidden or outlined by the score.
  const r = inspectPost(el, state.ownName, true);
  if (r.status === "ad") return tally(getUrn(el), "ads"); // ads are never analysed, sent, hidden, outlined or given an icon
  if (r.status !== "ok") return tally(getUrn(el), "skipped");
  const x = r.post;
  tally(x.urn, "detected");
  if (x.own) tally(x.urn, "own");
  const t: Tracked = {
    el,
    urn: x.urn,
    engagement: x.engagement,
    text: x.text,
    own: x.own,
    inspectOnly: !!x.inspectOnly,
    done: false,
    failure: null,
    retries: 0,
    requested: false,
    response: null,
    restored: restored.has(x.urn),
  };
  byEl.set(el, t);
  posts.set(x.urn, t);
  observerFor(el).observe(el);
  ensureButton(t);
}
