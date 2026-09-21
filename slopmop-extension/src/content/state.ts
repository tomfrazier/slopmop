import type { StatsReply } from "../shared/messages";
import type { Params } from "../shared/decideParams";
import { live } from "../shared/manifest";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";
import type { Tracked } from "./tracked";

/** What the content script knows right now. One page, one script, so this is plain shared state. */
export const state = {
  settings: DEFAULT_SETTINGS as Settings,
  lastStats: null as StatsReply | null,
  /** The signed-in user's name, so their own posts can be recognised. */
  ownName: null as string | null,
  learnedName: false,
};

/** The scoring parameters this page passes to decide(): what the server's manifest says (its thresholds only once it has sent them). */
export const scoringParams = (): Partial<Params> => ({
  ...(live.thresholds ? { thresholds: live.thresholds } : {}),
  yellowFraction: live.values.yellowFraction,
  minMeanConfidence: live.values.minMeanConfidence,
  aiDampen: live.values.aiDampen,
});

/** Posts by id, and by the element that holds them (LinkedIn recycles elements, so both are kept). */
export const posts = new Map<string, Tracked>();
export const byEl = new WeakMap<HTMLElement, Tracked>();
/** Posts the user unfolded (until they choose "Hide post again"). */
export const restored = new Set<string>();

/** Counts of what has been seen on this page load, for the popup's debug panel. */
export const seen = { detected: 0, ads: 0, own: 0, skipped: 0 };
export const counted = new Set<string>(); // post ids already tallied in `seen`

/** True while the extension is switched on and the user has accepted the research notice. */
export const active = () => state.settings.enabled && state.settings.acknowledged;

/**
 * Some modules must trigger a redraw but can't import the drawing code without importing each other in a circle (drawing
 * needs voting, voting needs analysis, analysis needs to redraw). index.ts sets this once at startup.
 */
export const hooks = {
  render: (_t: Tracked): void => {},
  /** Stops the script and takes down what it drew (the extension was reloaded or removed under this page). */
  shutdown: (): void => {},
};
