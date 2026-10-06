import { API_BASE, NETWORK } from "../shared/config";
import type { Level } from "../shared/types";
import { installId } from "./installId";

/**
 * Tells the server someone opened the panel on a post, and how that post was flagged, for the admin's "Panel opens" chart. Only
 * the level is sent (no post, no text). Best-effort: never retried, never shown as a problem, never costs a check.
 */
export async function reportPanelOpen(level: Level) {
  try {
    await fetch(`${API_BASE}/open`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-install-id": await installId() },
      body: JSON.stringify({ network: NETWORK, level }),
    });
  } catch {
    /* offline or blocked: it's only a count */
  }
}
