import { decide, decideOwn } from "../shared/decide";
import type { Decision, OwnLevel } from "../shared/types";
import type { InspectData } from "./inspector";
import { scoringParams, state } from "./state";
import type { Tracked } from "./tracked";
import type { PanelState } from "./votePanelTypes";
import { voteOf } from "./votes";

/** Fresh decision for a post under the current settings. */
export function decisionFor(t: Tracked): Decision & { ownLevel?: OwnLevel } {
  const { settings } = state;
  return t.own ? decideOwn(t.response, settings.sensitivity, scoringParams()) : decide(t.response, t.engagement, settings.mode, settings.sensitivity, { params: scoringParams() });
}

/** Getter handed to the fold strip's hover tooltip and the mop icon's panel. Null until Jev has answered. */
export function inspectFor(t: Tracked): () => InspectData | null {
  return () => {
    if (!t.response) return null;
    const { settings } = state;
    return { urn: t.urn, text: t.text, own: t.own, engagement: t.engagement, response: t.response, decision: decisionFor(t), mode: settings.mode, sensitivity: settings.sensitivity, vote: voteOf(t.urn), advanced: settings.debug, community: t.community ?? null };
  };
}

/** What the panel shows for this post right now. */
export function panelState(t: Tracked): PanelState {
  const current = voteOf(t.urn);
  const canRefold = !!t.refolded;
  if (!t.response) {
    const scoring = !!t.pending || !t.done;
    return { current, canRefold, inspect: null, scoring, problem: scoring ? null : `Couldn't score this post. ${t.failure ?? ""}`.trim() };
  }
  return { current, canRefold, inspect: inspectFor(t)(), scoring: false, problem: null };
}
