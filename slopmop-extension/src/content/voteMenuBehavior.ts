/** Where the menu goes, and how it closes: placement, keyboard and dismissal. */
const MENU_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/** Right-aligned under the icon, like the native "..." menu; flips above if there is no room below. */
export function placeBelow(anchor: HTMLElement, menu: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const top = a.bottom + MENU_GAP_PX + mh > window.innerHeight - VIEWPORT_MARGIN_PX ? Math.max(VIEWPORT_MARGIN_PX, a.top - mh - MENU_GAP_PX) : a.bottom + MENU_GAP_PX;
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.min(Math.max(VIEWPORT_MARGIN_PX, a.right - mw), window.innerWidth - mw - VIEWPORT_MARGIN_PX)}px`;
}

/** Arrow keys, Home/End move between items; Escape and Tab close. */
export function menuKeys(items: HTMLButtonElement[], shadow: ShadowRoot, close: (refocus: boolean) => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") return void (e.preventDefault(), close(true));
    const i = items.indexOf(shadow.activeElement as HTMLButtonElement);
    const move = (n: number) => (e.preventDefault(), items[(n + items.length) % items.length].focus());
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "Tab") close(true);
  };
}

/** Closes the menu on an outside press, Escape/Tab, scrolling or resizing. Returns the function that stops listening. */
export function closeOnDismissal(menu: HTMLElement, anchor: HTMLElement, onKey: (e: KeyboardEvent) => void, close: (refocus: boolean) => void): () => void {
  const onDown = (e: Event) => {
    const path = e.composedPath();
    if (!path.includes(menu) && !path.includes(anchor)) close(false);
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
