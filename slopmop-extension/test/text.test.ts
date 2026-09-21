import { describe, expect, it } from "vitest";
import { normalizeText } from "../src/shared/text";

describe("normalizeText (the local cache key's basis)", () => {
  it("treats the same post seen in different LinkedIn views as one", () => {
    const a = "We shipped it.\n\nBest week ever!";
    expect(normalizeText("  We  shipped it. Best week ever!  ")).toBe(normalizeText(a));
    expect(normalizeText("WE SHIPPED IT.\r\nBEST​ WEEK EVER!")).toBe(normalizeText(a));
    expect(normalizeText("We shipped it. Best week ever! (edited)")).not.toBe(normalizeText(a));
  });
});
