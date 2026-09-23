import type { JudgeResponse, LabelRecord, LabelSync, SurfaceStats } from "./types";
import type { Summary } from "./stats";

export type Msg =
  | { type: "judge"; urn: string; text: string; stats: SurfaceStats; priority: number; nativeId?: string; engagement?: { reactions: number; comments: number; reposts: number } }
  /** Re-rank (a distance from the viewport) or, with null, drop posts still waiting in the queue: the user scrolled past them. */
  | { type: "prioritize"; items: { urn: string; priority: number | null }[] }
  | { type: "record"; kind: "hidden" | "flagged"; urn: string }
  | { type: "getStats" }
  | { type: "pageStart" }
  | ({ type: "debug" } & PageSeen)
  | { type: "getDebug"; tabId?: number }
  | { type: "myDebug" }
  /** Asks the server how many checks this install has left (and its device id) without spending one. */
  | { type: "refreshUsage" }
  | { type: "vote"; record: LabelRecord }
  | { type: "unvote"; urn: string }
  | { type: "syncLabels" }
  | { type: "getLabelSync" };

/** What the content script has seen on this page load. */
export interface PageSeen {
  detected: number;
  ads: number;
  own: number;
  skipped: number;
}

export interface DebugInfo extends PageSeen {
  /** Posts actually sent to the server this page load. */
  sent: number;
  cached: number;
  errors: number;
  lastError: string | null;
}

export interface StatsReply {
  hidden: Summary;
  flagged: Summary;
}

export type Reply<T extends Msg> = T extends { type: "judge" }
  ? JudgeResponse | null
  : T extends { type: "record" | "getStats" }
    ? StatsReply
    : T extends { type: "getDebug" | "myDebug" }
      ? DebugInfo
      : T extends { type: "syncLabels" | "getLabelSync" }
        ? LabelSync | null
        : void;

/**
 * False once the extension was reloaded, updated or removed while this page kept running its old script: from then on every
 * chrome.* call throws "Extension context invalidated". A page can't be given the new script without a refresh.
 */
export const extensionAlive = () => !!chrome.runtime?.id;

const isInvalidated = (e: unknown) => e instanceof Error && /context invalidated/i.test(e.message);
let onGone: () => void = () => {};
/** Registers what to do (once) when a message finds the extension gone. */
export const whenExtensionGone = (fn: () => void) => void (onGone = fn);

/** Sends a message to the background worker. If the extension has vanished it stops the page script quietly instead of throwing. */
export async function send<T extends Msg>(m: T): Promise<Reply<T>> {
  try {
    return await chrome.runtime.sendMessage(m);
  } catch (e) {
    if (!isInvalidated(e)) throw e;
    onGone();
    return undefined as Reply<T>;
  }
}
