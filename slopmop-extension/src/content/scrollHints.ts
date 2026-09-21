import { send } from "../shared/messages";
import { live } from "../shared/manifest";
import { queueHint } from "./queueHints";
import { posts } from "./state";

/**
 * While scrolling fast the queue can fall behind. Keep it honest: rank waiting posts by how near they are to the viewport
 * right now (not where they were when they were queued), and drop those left far behind or ahead so they don't use up
 * checks. Anything dropped is outside the observer's range, so it is requested again when it scrolls back into it.
 */
function reprioritize() {
  const items: { urn: string; priority: number | null }[] = [];
  for (const t of posts.values()) {
    if (!t.pending || !t.el.isConnected) continue;
    const priority = queueHint(t.el.getBoundingClientRect(), window.innerHeight);
    if (priority === null) t.cancelled = true;
    items.push({ urn: t.urn, priority });
  }
  if (items.length) void send({ type: "prioritize", items }).catch(() => undefined);
}

/** Tells the extension where the posts are as the user scrolls (throttled). */
export function watchScrolling() {
  let timer = 0;
  document.addEventListener(
    "scroll",
    () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        reprioritize();
      }, live.values.scrollHintMs);
    },
    { capture: true, passive: true }, // LinkedIn scrolls inside <main>, and scroll events don't bubble
  );
}
