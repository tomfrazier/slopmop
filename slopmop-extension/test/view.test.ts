import { describe, expect, it } from "vitest";
import type { Decision } from "../src/shared/types";
import { desiredView } from "../src/content/view";

const decision = (level: Decision["level"], hide = false): Decision => ({ level, hide, score: 0.3, slop: 0.3, shield: 0, aiLikelihood: 0.9, reasons: [], explain: null });
const base = { mode: "highlight" as const, vote: null, restored: false, own: false, inspectOnly: false, scored: true };
const view = (over: Partial<Parameters<typeof desiredView>[0]> & { level?: Decision["level"]; hide?: boolean }) => {
  const { level = "none", hide = false, ...rest } = over;
  return desiredView({ ...base, decision: decision(level, hide), ...rest });
};

describe("what should be drawn on a post", () => {
  it("someone else's post, no vote: outlined by score in Highlight mode, with the colour part of its identity", () => {
    expect(view({ level: "red" })?.outline).toMatchObject({ key: "score:red", kind: "score" });
    expect(view({ level: "yellow" })?.outline?.key).toBe("score:yellow"); // a different level is a different border
    expect(view({ level: "none" })?.outline).toBeNull();
    expect(view({ level: "red" })).toMatchObject({ fold: false, refold: false });
  });

  it("someone else's post, no vote: hidden in Hide mode, and ringed instead once the user unfolded it", () => {
    expect(view({ mode: "hide", level: "red", hide: true })).toMatchObject({ fold: true, refold: false, outline: null });
    expect(view({ mode: "hide", level: "red", hide: true, restored: true })).toMatchObject({ fold: false, refold: true });
    expect(view({ mode: "hide", level: "none" })).toMatchObject({ fold: false, refold: false });
  });

  it("too short or not English: never acted on by the score", () => {
    expect(view({ level: "red", inspectOnly: true })).toBeNull();
  });

  it("a vote replaces the score", () => {
    expect(view({ level: "none", vote: "probably" })?.outline).toMatchObject({ key: "vote:probably", kind: "vote" });
    expect(view({ level: "red", vote: "no" })?.outline?.key).toBe("vote:no"); // a "no" beats a red score
    expect(view({ level: "red", vote: "no", inspectOnly: true })?.outline?.key).toBe("vote:no"); // even for short posts
  });

  it("Hide mode: only 'probably' hides; 'no' and 'maybe' keep a scored-slop post visible", () => {
    expect(view({ mode: "hide", vote: "probably" })).toMatchObject({ fold: true, outline: null });
    expect(view({ mode: "hide", vote: "probably", restored: true })).toMatchObject({ fold: false, refold: true });
    expect(view({ mode: "hide", level: "red", hide: true, vote: "no" })).toMatchObject({ fold: false, refold: false });
    expect(view({ mode: "hide", level: "red", hide: true, vote: "maybe" })).toMatchObject({ fold: false });
  });

  it("your own post: always a border (your vote, else the score's level), never folded", () => {
    expect(view({ own: true, ownLevel: "green" })).toMatchObject({ fold: false, refold: false, outline: { key: "own:green", kind: "own" } });
    expect(view({ own: true, ownLevel: "red", mode: "hide" })?.outline?.key).toBe("own:red"); // Hide mode never hides your own
    expect(view({ own: true, ownLevel: "red", vote: "no" })?.outline?.key).toBe("vote:no");
    expect(view({ own: true, scored: false })?.outline).toBeNull(); // nothing until it has a score or a vote
  });
});
