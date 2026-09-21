import { analyze } from "./analysis";
import { rootMarginPx } from "./queueHints";
import { byEl } from "./state";

/** Analyze posts well before they scroll into view. */
const rootMargin = () => `${rootMarginPx()}px 0px ${rootMarginPx()}px 0px`;
/**
 * One IntersectionObserver per scroll container. LinkedIn scrolls inside <main> (overflow-y: scroll),
 * and a root-less observer can't see past that clip, so its rootMargin lookahead would do nothing.
 */
const observers = new Map<Element | null, IntersectionObserver>();

/** Stops watching every post. */
export function stopObserving() {
  for (const io of observers.values()) io.disconnect();
  observers.clear();
}

function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null; // document scroll
}

export function observerFor(el: Element): IntersectionObserver {
  const root = scrollParent(el);
  let io = observers.get(root);
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const t = byEl.get(e.target as HTMLElement);
          if (t) void analyze(t, Math.abs(e.boundingClientRect.top - (root?.getBoundingClientRect().top ?? 0)));
        }
      },
      { root, rootMargin: rootMargin() },
    );
    observers.set(root, io);
  }
  return io;
}
