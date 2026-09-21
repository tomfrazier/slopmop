// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { outline, ownOutline, refoldRing, voteOutline } from "../src/content/highlight";
import type { Decision } from "../src/shared/types";

const d = (level: "red" | "yellow"): Decision => ({ level, hide: false, score: 0.5, slop: 0.5, shield: 0, aiLikelihood: 0.9, reasons: [], explain: null });
const post = () => {
  document.body.innerHTML = '<div id="p" style="border-radius:0"><p>hello</p></div>';
  return document.getElementById("p") as HTMLElement;
};

describe("borders", () => {
  it("are only a coloured border: no chip or any other node is added to the post", () => {
    const p = post();
    const before = p.innerHTML;
    for (const make of [() => outline(p, d("red")), () => ownOutline(p, "green"), () => voteOutline(p, "maybe"), () => refoldRing(p)]) {
      const o = make();
      expect(p.innerHTML).toBe(before);
      expect(p.style.boxShadow).not.toBe("");
      o.remove();
      expect(p.style.boxShadow).toBe("");
    }
  });
  it("use blue / yellow / red for own posts and votes", () => {
    const p = post();
    // jsdom may keep the hex form where browsers normalise to rgb(); accept either.
    const has = (hex: string, rgb: string) => [hex, rgb].some((c) => p.style.boxShadow.toLowerCase().includes(c.toLowerCase()));
    ownOutline(p, "green");
    expect(has("#2F6FBF", "rgb(47, 111, 191)")).toBe(true);
    voteOutline(p, "maybe");
    expect(has("#F5B400", "rgb(245, 180, 0)")).toBe(true);
    voteOutline(p, "probably");
    expect(has("#D93025", "rgb(217, 48, 37)")).toBe(true);
  });
  it("restore the post's own styling when removed", () => {
    const p = post();
    p.style.boxShadow = "0 0 0 1px black";
    p.style.borderRadius = "3px";
    const o = outline(p, d("yellow"));
    expect(p.style.borderRadius).toBe("3px");
    o.remove();
    expect(p.style.boxShadow).toBe("0 0 0 1px black");
  });
});
