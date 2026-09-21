import { live } from "../shared/manifest";

/** How far the observer looks beyond the viewport, so posts are checked before they scroll into view. */
export const rootMarginPx = () => live.values.lookaheadPx;

/** 0 while any part of the post is in view, else how many pixels it is above or below the viewport. */
export function viewportDistance(rect: { top: number; bottom: number }, viewportHeight: number): number {
  if (rect.bottom < 0) return -rect.bottom;
  if (rect.top > viewportHeight) return rect.top - viewportHeight;
  return 0;
}

/**
 * What to tell the queue about a waiting post: its distance (nearest is served first), or null to drop it because the user
 * has scrolled well outside the range in which posts are requested. Dropping only beyond that range guarantees the
 * IntersectionObserver reports it again on the way back, so a dropped post is never stranded.
 */
export function queueHint(rect: { top: number; bottom: number }, viewportHeight: number): number | null {
  const d = viewportDistance(rect, viewportHeight);
  return d > rootMarginPx() + live.values.dropBeyondPx ? null : d;
}
