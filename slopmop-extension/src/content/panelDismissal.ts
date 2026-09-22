/** Closes a floating panel on an outside press, a key its caller cares about, scrolling or resizing. Returns the function that stops listening. */
export function closeOnDismissal(panel: HTMLElement, anchor: HTMLElement, onKey: (e: KeyboardEvent) => void, close: (refocus: boolean) => void): () => void {
  const onDown = (e: Event) => {
    const path = e.composedPath();
    if (!path.includes(panel) && !path.includes(anchor)) close(false);
  };
  const onScroll = () => close(false);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  };
}
