/** An element of popup.html by id. */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How often the developer panels refresh while the popup is open. */
export const POLL_INTERVAL_MS = 1000;
