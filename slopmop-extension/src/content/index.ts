import { watchManifest } from "../shared/manifest";
import { send, whenExtensionGone } from "../shared/messages";
import { getSettings } from "../shared/settings";
import { watchScrolling } from "./scrollHints";
import { scan, stopFeed, watchFeed, watchSettings } from "./feed";
import { clearComposer } from "./composer";
import { closeInspector, closeVotePanel } from "./inspector";
import { stopObserving } from "./observers";
import { clear, render } from "./render";
import { hooks, posts, state } from "./state";
import { loadVotes, watchVotes } from "./votes";

/** The content script's entry point: it runs on LinkedIn pages, finds posts, and wires everything up. */
async function init() {
  state.settings = await getSettings();
  await watchManifest();
  state.ownName = ((await chrome.storage.local.get("ownName")).ownName as string | undefined) ?? null;
  state.learnedName = !!state.ownName;
  await loadVotes();
  watchVotes((urn) => {
    const t = posts.get(urn);
    if (t) render(t);
  });
  // Start looking at posts now. Nothing below may wait on the background worker: if it is slow to wake or fails, posts must
  // still get their mop icon and border, and the stats for the fold strip can simply arrive later.
  scan();
  watchFeed();
  watchSettings();
  void send({ type: "pageStart" }).catch(() => undefined);
  void send({ type: "getStats" })
    .then((stats) => (state.lastStats = stats ?? null))
    .catch(() => undefined);
}

/** The extension was reloaded or removed while this page kept running: stop, and leave the page as LinkedIn made it. */
function shutdown() {
  stopFeed();
  stopObserving();
  for (const t of posts.values()) clear(t);
  closeVotePanel();
  closeInspector();
  clearComposer();
}

hooks.render = render; // analysis and voting redraw through this, so they needn't import the drawing code
hooks.shutdown = shutdown;
whenExtensionGone(shutdown);
watchScrolling();
void init();
