import { decide, decideOwn } from "../shared/decide";
import type { Decision, OwnLevel } from "../shared/types";
import { displayScore, displayZones } from "../shared/display";
import { verdictLabel } from "../shared/verdict";
import type { InspectData } from "./inspector";
import { scoringParams, state } from "./state";
import type { Tracked } from "./tracked";
import type { MenuState } from "./voteMenu";
import { voteOf } from "./votes";

/** Fresh decision for a post under the current settings. */
export function decisionFor(t: Tracked): Decision & { ownLevel?: OwnLevel } {
  const { settings } = state;
  return t.own ? decideOwn(t.response, settings.sensitivity, scoringParams()) : decide(t.response, t.engagement, settings.mode, settings.sensitivity, { params: scoringParams() });
}

/** Getter handed to the fold strip's hover tooltip and the menu's Details item. Null until Jev has answered. */
export function inspectFor(t: Tracked): () => InspectData | null {
  return () => {
    if (!t.response) return null;
    const { settings } = state;
    return { urn: t.urn, text: t.text, own: t.own, engagement: t.engagement, response: t.response, decision: decisionFor(t), mode: settings.mode, sensitivity: settings.sensitivity, vote: voteOf(t.urn), advanced: settings.debug };
  };
}

/** What the menu shows for this post right now. */
export function menuState(t: Tracked): MenuState {
  const base = { current: voteOf(t.urn), canRefold: !!t.refold, inspect: inspectFor(t)(), community: t.community ?? null };
  if (!t.response) {
    const scoring = !!t.pending || !t.done;
    return { ...base, score: null, verdict: "", tone: "grey", zones: displayZones(null), scoring, problem: scoring ? null : `Couldn't score this post. ${t.failure ?? ""}`.trim() };
  }
  const d = decisionFor(t);
  const { text: verdict, tone } = verdictLabel(d, t.own);
  return { ...base, score: Math.round(displayScore(d.score)), verdict, tone, zones: displayZones(d.explain), scoring: false, problem: null };
}
