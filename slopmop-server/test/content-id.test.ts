import { describe, expect, it } from "vitest";
import { contentIdFor, normalizeText } from "../src/content-id.js";

describe("content ids", () => {
  const text = "We finally shipped the billing migration.\n\nBest thing all year!";
  it("are stable and hash-shaped", () => {
    expect(contentIdFor("linkedin", text)).toMatch(/^[a-f0-9]{32}$/);
    expect(contentIdFor("linkedin", text)).toBe(contentIdFor("linkedin", text));
  });
  it("ignore whitespace, case, zero-width characters and Unicode forms, so every view of a post agrees", () => {
    const variants = ["  We finally shipped   the billing migration. Best thing all year!  ", text.toUpperCase(), "We finally shipped the billing​ migration.\n\n\nBest thing all year!", "We finally shipped the billing migration.\r\nBest thing all year!"];
    for (const v of variants) expect(contentIdFor("linkedin", v)).toBe(contentIdFor("linkedin", text));
    expect(normalizeText("ｆｕｌｌｗｉｄｔｈ")).toBe("fullwidth");
  });
  it("differ for different text and for different networks", () => {
    expect(contentIdFor("linkedin", text)).not.toBe(contentIdFor("linkedin", text + " Edited."));
    expect(contentIdFor("linkedin", text)).not.toBe(contentIdFor("reddit", text));
  });
});
