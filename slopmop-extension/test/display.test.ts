import { beforeEach, describe, expect, it } from "vitest";
import { decide } from "../src/shared/decide";
import { displayScore } from "../src/shared/display";
import { applyManifest } from "../src/shared/manifest";
import type { JudgeResponse } from "../src/shared/types";

beforeEach(() => applyManifest(undefined));

const T = 0.18; // the default Moderate threshold
describe("the shown score", () => {
  it("anchors 'possibly' at 40, the Moderate threshold at 70, and tops out at 100", () => {
    expect(displayScore(0)).toBe(0);
    expect(displayScore(0.6 * T)).toBeCloseTo(40, 9);
    expect(displayScore(T)).toBeCloseTo(70, 9);
    expect(displayScore(2 * T)).toBeCloseTo(100, 9);
    expect(displayScore(0.9)).toBe(100);
    expect(displayScore(-1)).toBe(0);
  });
  it("makes a post scoring 0.15 (a clear 'possibly slop') read in the high 50s", () => {
    expect(displayScore(0.15)).toBeGreaterThan(55);
    expect(displayScore(0.15)).toBeLessThan(70);
  });
  it("only ever goes up as the raw score does, and stays within 0-100", () => {
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.005) {
      const d = displayScore(s);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(100);
      prev = d;
    }
  });
  it("follows the manifest's anchors and the server's Moderate threshold, and ignores nonsense anchors", () => {
    applyManifest({ version: "v", values: { displayPossibly: 30, displayLikely: 60 }, thresholds: { aggressive: 0.1, moderate: 0.3, mild: 0.4 }, at: 0, ttlMs: 1 });
    expect(displayScore(0.3)).toBeCloseTo(60, 9);
    expect(displayScore(0.18)).toBeCloseTo(30, 9); // "possibly" starts at 0.6 x 0.3
    applyManifest({ version: "v", values: { displayPossibly: 80, displayLikely: 60 }, thresholds: { aggressive: 0.1, moderate: 0.3, mild: 0.4 }, at: 0, ttlMs: 1 });
    expect(displayScore(0.3)).toBeCloseTo(70, 9); // back to the built-in anchors
  });
  it("is the same for a post at every sensitivity: only the cutoff moves, not the number", () => {
    const dims = Object.fromEntries(["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait", "humanVoice", "usefulness"].map((id) => [id, { value: 0.115, confidence: 0.9 }]));
    const r: JudgeResponse = { model: "j", aiLikelihood: 1, dimensions: dims };
    const e = { reactions: 0, comments: 0, reposts: 0 };
    const [a, m, l] = (["aggressive", "moderate", "mild"] as const).map((s) => decide(r, e, "hide", s));
    expect(displayScore(a.score)).toBe(displayScore(m.score));
    expect(displayScore(m.score)).toBe(displayScore(l.score));
    expect([a.hide, m.hide, l.hide]).toEqual([true, true, false]); // ...but Mild's cutoff is higher, so it leaves this one
  });
});

// The admin console's simulator uses the server's copy of this function; the two must give the same number.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const serverDisplay = resolve(import.meta.dirname, "../../slopmop-server/src/display.ts");
describe.skipIf(!existsSync(serverDisplay))("agrees with the server's copy", () => {
  it("shows the same number for every raw score, at several thresholds and anchors", async () => {
    const { displayScore: server } = await import(/* @vite-ignore */ serverDisplay);
    for (const [moderate, yellowFraction, possibly, likely, fullMultiple] of [[0.18, 0.6, 40, 70, 2], [0.3, 0.5, 30, 60, 3], [0.1, 0.9, 20, 80, 1.5]] as const) {
      applyManifest({ version: "v", values: { yellowFraction, displayPossibly: possibly, displayLikely: likely, displayFullMultiple: fullMultiple }, thresholds: { aggressive: 0.05, moderate, mild: 0.9 }, at: 0, ttlMs: 1 });
      for (let s = -0.1; s <= 1.2; s += 0.013) expect(displayScore(s), `${moderate}/${s.toFixed(3)}`).toBeCloseTo(server(s, { moderate, yellowFraction, possibly, likely, fullMultiple }), 9);
    }
  });
});
