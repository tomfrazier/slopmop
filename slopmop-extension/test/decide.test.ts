import { describe, expect, it } from "vitest";
import { AI_DAMPEN, CORROBORATION, decide, DEFAULT_PARAMS, decideOwn, engagementNorm } from "../src/shared/decide";
import { engagementBand } from "../src/shared/engagement";
import type { JudgeResponse } from "../src/shared/types";

const dims = (v: number, extra: Record<string, number> = {}) => {
  const ids = ["contrastFraming","emptyEvaluation","tradeoffFreePromises","formalHedging","hypeMarketing","manneredProse","formulaicHook","manufacturedNarrative","engagementBait"];
  const d: JudgeResponse["dimensions"] = {};
  for (const id of ids) d[id] = { value: v, confidence: 0.8 };
  d.humanVoice = { value: extra.humanVoice ?? 0, confidence: 0.8 };
  d.usefulness = { value: extra.usefulness ?? 0, confidence: 0.8 };
  return d;
};
const resp = (v: number, ai = 0.95, extra = {}): JudgeResponse => ({ model: "jev", dimensions: dims(v, extra), aiLikelihood: ai });
const none = { reactions: 0, comments: 0, reposts: 0 };

describe("decide", () => {
  it("fails open without a response", () => {
    expect(decide(null, none, "hide", "aggressive").level).toBe("none");
  });
  it("flags hand-written slop: a person typing it is no free pass", () => {
    // Broetry with every tell high, no usefulness or engagement to shield it, and Jev sure a person typed it.
    const d = decide(resp(0.85, 0.2), none, "hide", "moderate");
    expect(d).toMatchObject({ level: "red", hide: true });
  });
  it("spares a marginal post that reads human-written, but flags the same tells when they look AI-drafted", () => {
    const tells = 0.1; // slop 0.2: just over moderate (0.18) at full weight, under it once dampened
    expect(decide(resp(tells, 1), none, "hide", "moderate").level).not.toBe("none");
    expect(decide(resp(tells, 1), none, "hide", "moderate").hide).toBe(true);
    expect(decide(resp(tells, 0.2), none, "hide", "moderate").hide).toBe(false);
  });
  it("leaves a confident AI draft's score exactly as it was before the dampener", () => {
    const d = decide(resp(0.6, 1), none, "hide", "moderate");
    expect(d.score).toBe(d.slop * (1 - d.shield));
    expect(d.explain!.aiDampen).toBe(1);
  });
  it("only ever lowers a score, more the more human it reads (monotonic in AI-likelihood)", () => {
    let prev = -1;
    let prevRank = -1;
    const rank = { none: 0, yellow: 1, red: 2 } as const;
    for (let ai = 0; ai <= 1.0001; ai += 0.05) {
      const d = decide(resp(0.3, Math.min(1, ai)), none, "highlight", "moderate");
      expect(d.score).toBeGreaterThanOrEqual(prev);
      expect(rank[d.level]).toBeGreaterThanOrEqual(prevRank);
      prev = d.score;
      prevRank = rank[d.level];
    }
  });
  it("keeps the factor within [1 - AI_DAMPEN, 1] and the score within [0, 1]", () => {
    for (const ai of [-1, 0, 0.3, 0.5, 1, 2]) {
      const d = decide(resp(1, ai, { humanVoice: 0 }), none, "hide", "moderate");
      expect(d.explain!.aiDampen).toBeGreaterThanOrEqual(1 - AI_DAMPEN - 1e-12);
      expect(d.explain!.aiDampen).toBeLessThanOrEqual(1);
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(1);
    }
  });
  it("has no veto: AI-likelihood alone never turns a score that clears the line into 'none'", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 500; n++) {
      const r = resp(rnd(), rnd(), { humanVoice: rnd(), usefulness: rnd() });
      const eng = { reactions: Math.floor(rnd() * 5000), comments: Math.floor(rnd() * 300), reposts: Math.floor(rnd() * 50) };
      const d = decide(r, eng, "highlight", "moderate");
      if (d.score >= DEFAULT_PARAMS.thresholds.moderate) expect(d.level).toBe("red");
      else if (d.score >= DEFAULT_PARAMS.yellowFraction * DEFAULT_PARAMS.thresholds.moderate) expect(d.level).not.toBe("none");
    }
  });
  it("still fails open on low confidence, at every AI-likelihood", () => {
    for (const ai of [0, 0.5, 1]) {
      const r = resp(0.9, ai);
      for (const d of Object.values(r.dimensions)) d.confidence = 0.05;
      expect(decide(r, none, "hide", "aggressive").level).toBe("none");
    }
  });
  it("dampens your own posts too (they skip the shield, not the dampener)", () => {
    expect(decideOwn(resp(0.3, 0.2), "moderate").score).toBeLessThan(decideOwn(resp(0.3, 1), "moderate").score);
  });
  it("takes slop and the shield from the server when it sends them, and shows them without any weights", () => {
    const r: JudgeResponse = { ...resp(0.3, 1), slop: 0.5, shield: 0.4, engagementNorm: 0.7 };
    const d = decide(r, { reactions: 999999, comments: 99999, reposts: 9999 }, "hide", "moderate"); // the client's own counts are not what decides
    expect(d).toMatchObject({ slop: 0.5, shield: 0.4 });
    expect(d.score).toBeCloseTo(0.5 * 0.6, 9);
    expect(d.explain).toMatchObject({ source: "server" });
    expect(d.explain!.humanOffset).toBeUndefined();
    expect(d.explain!.engagement.norm).toBe(0.7);
  });
  it("gives your own posts no shield, whatever the server sent", () => {
    const r: JudgeResponse = { ...resp(0.3, 1), slop: 0.5, shield: 0.4 };
    expect(decideOwn(r, "moderate").score).toBeCloseTo(0.5, 9);
  });
  it("works out slop and the shield itself for answers the server didn't (older cache, offline tuning)", () => {
    const d = decide(resp(0.3, 1), none, "hide", "moderate");
    expect(d.explain!.source).toBe("local");
    expect(d.slop).toBeCloseTo(0.6, 9);
    expect(decide({ ...resp(0.3, 1), slop: 0.5, shield: 0.4 }, none, "hide", "moderate", { params: { gain: 3 } }).explain!.source).toBe("local"); // trying other parameters means computing locally
  });
  it("uses the server's thresholds when they are passed in, and its own defaults otherwise", () => {
    const r = resp(0.12); // score ~0.24
    expect(decide(r, none, "hide", "moderate").hide).toBe(true); // default moderate 0.22
    expect(decide(r, none, "hide", "moderate", { params: { thresholds: { aggressive: 0.2, moderate: 0.3, mild: 0.4 } } }).hide).toBe(false);
    expect(decide(r, none, "hide", "aggressive", { params: { thresholds: { aggressive: 0.2, moderate: 0.3, mild: 0.4 } } }).hide).toBe(true);
  });
  it("counts a comment or a repost for more than a reaction, and discounts reactions with nothing behind them (the local fallback)", () => {
    const one = (k: "reactions" | "comments" | "reposts") => engagementNorm({ reactions: 0, comments: 0, reposts: 0, [k]: 100 });
    expect(one("comments")).toBeGreaterThan(one("reactions"));
    expect(one("reposts")).toBeGreaterThan(one("comments"));
    expect(engagementNorm({ reactions: 2000, comments: 3, reposts: 0 })).toBeLessThan(engagementNorm({ reactions: 2000, comments: 120, reposts: 40 }));
  });
  it("puts a post in a higher band each time its engagement grows about a quarter, and never a lower one", () => {
    const b = (n: number) => engagementBand({ reactions: n, comments: 0, reposts: 0 });
    expect(b(0)).toBe(0);
    expect(b(1000)).toBeGreaterThan(b(800));
    expect(b(101)).toBe(b(100));
    let prev = -1;
    for (let n = 0; n < 5000; n += 7) (expect(b(n)).toBeGreaterThanOrEqual(prev), (prev = b(n)));
  });
  it("does not mark down a sincere, useful post about what Slop Mop is not (one contrast tell, a strongly personal and useful text)", () => {
    // The author's own launch draft: it defines the product by negation ("...isn't just an AI detector") three times, and nothing else stands out.
    const d = (value: number, confidence: number) => ({ value, confidence });
    const draft: JudgeResponse = {
      model: "jev",
      aiLikelihood: 0.41,
      dimensions: {
        contrastFraming: d(0.687, 0.81), emptyEvaluation: d(0.217, 0.54), tradeoffFreePromises: d(0.167, 0.5), formalHedging: d(0.05, 0.85), hypeMarketing: d(0.153, 0.54),
        manneredProse: d(0.16, 0.52), formulaicHook: d(0.29, 0.86), manufacturedNarrative: d(0.183, 0.45), engagementBait: d(0.1, 0.7), humanVoice: d(0.913, 0.74), usefulness: d(0.827, 0.48),
      },
    };
    const own = decideOwn(draft, "moderate");
    expect(own.explain!.breakouts).toBe(1); // the contrast tell alone
    expect(own.shield).toBeGreaterThan(0.3); // usefulness counts for a draft, though nobody has reacted yet
    expect(own.level).toBe("none"); // it was "possibly slop" when a draft kept no shield at all
    expect(decideOwn(draft, "mild").level).toBe("none");
  });
  it("does not flag a joke that parodies LinkedIn-speak: Jev unsure of its signs, one of them standing out, and readers loving it", () => {
    // Kevin Roose's podcast announcement ("...reinvent talking from first principles...two men talking about AI"), 752 reactions, 57 comments, 18 reposts.
    const d = (value: number, confidence: number) => ({ value, confidence });
    const roose: JudgeResponse = {
      model: "jev",
      aiLikelihood: 0.46,
      dimensions: {
        contrastFraming: d(0.07, 0.79), emptyEvaluation: d(0.383, 0.42), tradeoffFreePromises: d(0.0067, 0.98), formalHedging: d(0.02, 0.94), hypeMarketing: d(0.583, 0.4),
        manneredProse: d(0.52, 0.55), formulaicHook: d(0.203, 0.6), manufacturedNarrative: d(0.0033, 0.99), engagementBait: d(0.543, 0), humanVoice: d(0.587, 0.6), usefulness: d(0.123, 0.6),
      },
    };
    const engaged = { reactions: 752, comments: 57, reposts: 18 };
    for (const s of ["aggressive", "moderate", "mild"] as const) expect(decide(roose, engaged, "hide", s).level, s).not.toBe("red"); // never "likely slop"
    for (const s of ["moderate", "mild"] as const) expect(decide(roose, engaged, "hide", s).level, s).toBe("none");
    const d1 = decide(roose, engaged, "hide", "moderate");
    expect(d1.explain!.breakouts).toBe(1); // hype was under 0.5 sure; the engagement-bait answer had no confidence at all
    // Before: every tell counted in full whatever Jev's confidence, and one standing-out tell was enough. That scored ~0.19: flagged at Aggressive's old line.
  });
  it("cuts the slop score when only one tell stands out, not when two do, and not when none does", () => {
    const run = (tells: Record<string, number>, alone = CORROBORATION.alone) => {
      const r = resp(0);
      for (const [id, v] of Object.entries(tells)) r.dimensions[id] = { value: v, confidence: 0.9 };
      return decide(r, none, "hide", "moderate", { params: { corroboration: { ...CORROBORATION, alone } } });
    };
    const shapes = {
      one: { hypeMarketing: 0.9 },
      two: { hypeMarketing: 0.9, manneredProse: 0.9 },
      broad: { contrastFraming: 0.45, emptyEvaluation: 0.45, hypeMarketing: 0.45, manneredProse: 0.45 }, // several, none past the breakout
    };
    expect(run(shapes.one).explain!.breakouts).toBe(1);
    expect(run(shapes.two).explain!.breakouts).toBe(2);
    expect(run(shapes.broad).explain!.breakouts).toBe(0);
    expect(run(shapes.one).slop).toBeCloseTo(run(shapes.one, 1).slop * CORROBORATION.alone, 9); // one alone: cut
    expect(run(shapes.two).slop).toBeCloseTo(run(shapes.two, 1).slop, 9); // two corroborate: kept in full
    expect(run(shapes.broad).slop).toBeCloseTo(run(shapes.broad, 1).slop, 9); // broad and mild: kept in full
  });
  it("ignores a tell Jev had no confidence in when averaging, and gives a fully unsure answer no tell mean at all", () => {
    const sure = resp(0.6);
    const guess = resp(0.6);
    guess.dimensions.engagementBait = { value: 1, confidence: 0 };
    expect(decide(guess, none, "hide", "moderate").explain!.mean).toBeCloseTo(decide(sure, none, "hide", "moderate").explain!.mean, 6);
    const none9 = resp(0.9);
    for (const id of Object.keys(none9.dimensions)) none9.dimensions[id].confidence = 0;
    expect(decide(none9, none, "hide", "moderate").level).toBe("none"); // the confidence gate as well
  });
  it("decides from a verdict cached before the dampener existed (no cache bump needed)", () => {
    const old = JSON.parse(JSON.stringify(resp(0.9, 0.95))) as JudgeResponse; // same shape the old client stored
    expect(decide(old, none, "hide", "moderate").hide).toBe(true);
  });
  it("hides blatant slop at every sensitivity in hide mode", () => {
    for (const s of ["aggressive", "moderate", "mild"] as const)
      expect(decide(resp(0.9), none, "hide", s).hide).toBe(true);
  });
  it("is more permissive as sensitivity drops", () => {
    const r = resp(0.1); // score ~0.2: between the moderate (0.18) and mild (0.22) thresholds
    expect(decide(r, none, "hide", "aggressive").hide).toBe(true);
    expect(decide(r, none, "hide", "moderate").hide).toBe(true);
    expect(decide(r, none, "hide", "mild").hide).toBe(false);
  });
  it("highlight mode never hides and uses yellow below red", () => {
    const red = decide(resp(0.9), none, "highlight", "moderate");
    expect(red).toMatchObject({ level: "red", hide: false });
    const mid = decide(resp(0.07), none, "highlight", "moderate"); // score ~0.14: the yellow band is 0.108-0.18
    expect(mid.level).toBe("yellow");
    expect(decide(resp(0.05), none, "highlight", "moderate").level).toBe("none"); // slop 0.1 < 0.15
  });
  it("hide mode has the same possibly band, but only likely posts are hidden", () => {
    const d = decide(resp(0.08), none, "hide", "moderate");
    expect(d).toMatchObject({ level: "yellow", hide: false });
    expect(decide(resp(0.02), none, "hide", "moderate").level).toBe("none");
  });
  it("useful, well-received AI-assisted posts are shielded", () => {
    const r = resp(0.5, 0.95, { usefulness: 1 });
    const hot = { reactions: 5000, comments: 800, reposts: 200 };
    expect(decide(r, none, "hide", "moderate").score).toBeGreaterThan(decide(r, hot, "hide", "moderate").score);
    expect(decide(r, hot, "hide", "moderate").shield).toBeLessThanOrEqual(0.6);
  });
  it("engagement norm is bounded", () => {
    expect(engagementNorm({ reactions: 1e9, comments: 1e9, reposts: 1e9 })).toBe(1);
    expect(engagementNorm(none)).toBe(0);
  });
  it("reports the top two contributing tells", () => {
    const r = resp(0.1);
    r.dimensions.contrastFraming.value = 1;
    r.dimensions.formulaicHook.value = 0.9;
    expect(decide(r, none, "hide", "moderate").reasons.map((x) => x.id)).toEqual(["contrastFraming", "formulaicHook"]);
  });
  it("low confidence fails open", () => {
    const r = resp(1);
    for (const k of Object.keys(r.dimensions)) r.dimensions[k].confidence = 0.05;
    expect(decide(r, none, "hide", "aggressive").level).toBe("none");
  });
});

describe("decideOwn", () => {
  it("is green for clean, human-sounding writing", () => {
    expect(decideOwn(resp(0.05, 0.1), "moderate").ownLevel).toBe("green");
  });
  it("is red for blatant slop and never hides", () => {
    const d = decideOwn(resp(0.9), "moderate");
    expect(d.ownLevel).toBe("red");
    expect(d.hide).toBe(false);
  });
  it("is yellow between the bands", () => {
    expect(decideOwn(resp(0.07), "moderate").ownLevel).toBe("yellow");
  });
  it("is green with no verdict (fail open)", () => {
    expect(decideOwn(null, "aggressive").ownLevel).toBe("green");
  });
  it("keeps the usefulness half of the shield but not reader response, so a useful draft isn't marked down for having no readers yet", () => {
    const useful = resp(0.9, 0.95, { usefulness: 1 });
    const useless = resp(0.9, 0.95, { usefulness: 0 });
    const hot = { reactions: 5000, comments: 800, reposts: 200 };
    expect(decideOwn(useful, "moderate").shield).toBeCloseTo(0.5, 9); // half from usefulness, capped at 60%
    expect(decideOwn(useless, "moderate").shield).toBe(0);
    expect(decideOwn(useful, "moderate").score).toBeLessThan(decideOwn(useless, "moderate").score);
    // Reader response is what an ordinary post gets on top of it.
    expect(decide(useful, hot, "highlight", "moderate").shield).toBeGreaterThan(decideOwn(useful, "moderate").shield);
    expect(decide(useful, none, "highlight", "moderate").shield).toBeCloseTo(decideOwn(useful, "moderate").shield, 9); // with no readers the two agree
  });
  it("takes the useful-only shield from the server when it sends one, and falls back to none for older answers", () => {
    const r: JudgeResponse = { ...resp(0.3, 1), slop: 0.5, shield: 0.4, usefulShield: 0.25 };
    expect(decideOwn(r, "moderate").score).toBeCloseTo(0.5 * 0.75, 9);
    expect(decideOwn({ ...r, usefulShield: undefined }, "moderate").score).toBeCloseTo(0.5, 9);
  });
});

describe("the server's private tell weights", () => {
  const ids = ["contrastFraming", "emptyEvaluation", "tradeoffFreePromises", "formalHedging", "hypeMarketing", "manneredProse", "formulaicHook", "manufacturedNarrative", "engagementBait"];
  const base = (over: Partial<JudgeResponse> = {}): JudgeResponse => ({ ...resp(0.1), ...over });

  it("ships equal public weights, so nothing tuned is in the repo", async () => {
    const { WEIGHTS } = await import("../src/shared/decide");
    expect(Object.keys(WEIGHTS).sort()).toEqual([...ids].sort());
    expect(Object.values(WEIGHTS).every((w) => w === 1)).toBe(true);
  });

  it("uses the server's weighted composite instead of computing one, and shows its ranking", () => {
    // All dimensions are 0.1 (mean 0.1), but the server says its weighted mean is 0.3: the server wins.
    const d = decide(base({ tellMean: 0.3, tellRank: ["formulaicHook", "emptyEvaluation", "contrastFraming"] }), none, "highlight", "moderate");
    expect(d.explain!.mean).toBeCloseTo(0.3, 6);
    expect(d.slop).toBeCloseTo(0.6, 6);
    expect(d.explain!.tells.map((t) => t.id)).toEqual(["formulaicHook", "emptyEvaluation", "contrastFraming"]);
    expect(d.reasons.map((r) => r.id)).toEqual(["formulaicHook", "emptyEvaluation"]);
  });

  it("never exposes a weight or contribution when the composite came from the server", () => {
    const d = decide(base({ tellMean: 0.3, tellRank: ids }), none, "hide", "moderate");
    for (const t of d.explain!.tells) {
      expect(t.weight).toBeUndefined();
      expect(t.contrib).toBeUndefined();
    }
  });

  it("falls back to the equal public weights for an answer saved before the server sent a composite", () => {
    const d = decide(base(), none, "hide", "moderate");
    expect(d.explain!.mean).toBeCloseTo(0.1, 6);
    expect(d.explain!.tells[0].weight).toBeCloseTo(Math.sqrt(0.8), 9); // weight 1 x the square root of Jev's confidence (0.8 in this fixture) in the answer
  });

  it("computes locally when weights are supplied to try (offline tuning), ignoring the server's composite", () => {
    const withW = decide(base({ tellMean: 0.9, tellRank: ids }), none, "hide", "moderate", { params: { weights: { formulaicHook: 1 } } });
    expect(withW.explain!.mean).toBeCloseTo(0.1, 6);
    expect(withW.explain!.tells).toHaveLength(1);
  });
});

