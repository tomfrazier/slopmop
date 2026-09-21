import { live, MANIFEST_KEY } from "../shared/manifest";
import { extensionAlive } from "../shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";
import { syncComposer } from "./composer";
import { closeInspector } from "./inspector";
import { observerFor } from "./observers";
import { clear, render } from "./render";
import { POST_SELECTOR } from "./selectors";
import { active, hooks, posts, state } from "./state";
import { track } from "./track";
import { closeVoteMenu } from "./voteMenu";


/** Finds every post under `root` and starts tracking the new ones. */
export function scan(root: ParentNode = document) {
  if (!extensionAlive()) return hooks.shutdown(); // the extension was reloaded under this page
  syncComposer(); // the post composer's "check this draft" button (removed again when the extension is off)
  if (!active()) return;
  root.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(track);
  if (root instanceof HTMLElement && root.matches(POST_SELECTOR)) track(root);
}

/** Redraws every post (after a settings change). */
function renderAll() {
  for (const t of posts.values()) {
    if (!active()) {
      clear(t);
      continue;
    }
    if (!t.requested) {
      const io = observerFor(t.el);
      io.unobserve(t.el);
      io.observe(t.el);
    }
    render(t);
  }
}

/** Rescans (shortly after the page changes) so posts that load as the feed grows are picked up. */
let feedWatcher: MutationObserver | null = null;

export function stopFeed() {
  feedWatcher?.disconnect();
  feedWatcher = null;
}

export function watchFeed() {
  let queued = 0;
  feedWatcher = new MutationObserver(() => {
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      scan();
    }, live.values.rescanDelayMs);
  });
  feedWatcher.observe(document.body, { childList: true, subtree: true });
}

/** Follows settings changes made in the popup, with no reload. */
export function watchSettings() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[MANIFEST_KEY]) return renderAll(); // the server changed a value: redraw with it
    if (area !== "sync" || !changes.settings) return;
    const was = active();
    state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) };
    if (!active()) (closeVoteMenu(), closeInspector());
    if (!was && active()) scan();
    renderAll();
  });
}
