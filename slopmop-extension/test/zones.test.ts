import { beforeEach, describe, expect, it } from "vitest";
import { decide } from "../src/shared/decide";
import { displayScore, displayZones } from "../src/shared/display";
import { applyManifest } from "../src/shared/manifest";
import type { JudgeResponse, Mode, Sensitivity } from "../src/shared/types";

beforeEach(() => applyManifest(undefined));

const IDS = ["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait", "humanVoice", "usefulness"];
const resp = (v: number, ai = 0.95): JudgeResponse => ({ model: "j", aiLikelihood: ai, dimensions: Object.fromEntries(IDS.map((id) => [id, { value: id === "humanVoice" || id === "usefulness" ? 0.1 : v, confidence: 0.9 }])) });
const none = { reactions: 0, comments: 0, reposts: 0 };
const SENS: Sensitivity[] = ["aggressive", "moderate", "mild"];

describe("the zone lines on the shown score", () => {
  it("sit lower for Aggressive than Moderate than Mild, because their cutoffs do", () => {
    const [a, m, l] = SENS.map((s) => displayZones(decide(resp(0.3), none, "highlight", s).explain));
    expect(a.likely).toBeLessThan(m.likely);
    expect(m.likely).toBeLessThan(l.likely);
    expect(a.possibly).toBeLessThan(m.possibly);
    for (const z of [a, m, l]) expect(z.possibly).toBeLessThan(z.likely);
  });
  it("are the Moderate defaults from the manifest when there is nothing scored yet", () => {
    expect(displayZones(null)).toEqual({ possibly: 40, likely: 70 });
    expect(displayZones(decide(resp(0.3), none, "highlight", "moderate").explain)).toEqual({ possibly: 40, likely: 70 });
  });
  it("always agree with the verdict: the score falls in the zone that the border, the word and the fold say", () => {
    // Sweep posts from clean to blatant at every sensitivity in both modes, and check the shown score against the zones drawn for that person.
    for (const mode of ["highlight", "hide"] as Mode[]) {
      for (const sens of SENS) {
        for (let v = 0; v <= 1.0001; v += 0.01) {
          const d = decide(resp(Math.min(1, v)), none, mode, sens);
          const zones = displayZones(d.explain);
          const shown = displayScore(d.score);
          const where = shown >= zones.likely - 1e-9 ? "red" : shown >= zones.possibly - 1e-9 ? "yellow" : "none";
          expect(d.level, `${mode}/${sens}/${v.toFixed(2)}: shown ${shown.toFixed(1)}, zones ${zones.possibly.toFixed(1)}/${zones.likely.toFixed(1)}`).toBe(where);
        }
      }
    }
  });
  it("still agree when the server has changed the thresholds, the 'possibly' fraction and the anchors", () => {
    const thresholds = { aggressive: 0.08, moderate: 0.15, mild: 0.3 };
    applyManifest({ version: "v", values: { yellowFraction: 0.5, displayPossibly: 30, displayLikely: 60 }, thresholds, at: 0, ttlMs: 1 });
    const params = { thresholds, yellowFraction: 0.5 };
    for (const sens of SENS) {
      for (let v = 0; v <= 1.0001; v += 0.01) {
        const d = decide(resp(Math.min(1, v)), none, "highlight", sens, { params });
        const zones = displayZones(d.explain);
        const shown = displayScore(d.score);
        const where = shown >= zones.likely - 1e-9 ? "red" : shown >= zones.possibly - 1e-9 ? "yellow" : "none";
        expect(d.level, `${sens}/${v.toFixed(2)}`).toBe(where);
      }
    }
    expect(displayZones(decide(resp(0.3), none, "highlight", "moderate", { params }).explain)).toEqual({ possibly: 30, likely: 60 });
  });
});
