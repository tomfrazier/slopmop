// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fold } from "../src/content/fold";
import type { Decision } from "../src/shared/types";

const decision: Decision = { level: "red", hide: true, score: 0.9, slop: 0.9, shield: 0, aiLikelihood: 0.9, reasons: [], explain: null };

describe("fold()", () => {
  it("folds a post that's on the page: a strip goes in before it, and it is hidden", () => {
    document.body.innerHTML = '<div id="post">text</div>';
    const post = document.getElementById("post")!;
    const f = fold(post, decision, null, () => {});
    expect(f).not.toBeNull();
    expect(post.hasAttribute("data-slopmop-hidden")).toBe(true);
    expect(post.previousElementSibling?.hasAttribute("data-slopmop-fold")).toBe(true);
  });

  it("never hides a post with nothing in its place: a detached post (no parent to insert a strip before) folds to nothing, and stays visible", () => {
    const post = document.createElement("div"); // never appended anywhere
    const f = fold(post, decision, null, () => {});
    expect(f).toBeNull();
    expect(post.hasAttribute("data-slopmop-hidden")).toBe(false);
  });
});
