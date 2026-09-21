import { describe, expect, it } from "vitest";
import { queueHint, rootMarginPx, viewportDistance } from "../src/content/queueHints";

const ROOT_MARGIN_PX = rootMarginPx();
const VH = 800;
describe("viewport distance", () => {
  it("is 0 for anything overlapping the viewport, and the gap otherwise", () => {
    expect(viewportDistance({ top: 100, bottom: 500 }, VH)).toBe(0);
    expect(viewportDistance({ top: -300, bottom: 50 }, VH)).toBe(0);
    expect(viewportDistance({ top: -900, bottom: -400 }, VH)).toBe(400); // scrolled past
    expect(viewportDistance({ top: 1000, bottom: 1400 }, VH)).toBe(200); // still to come
  });
});

describe("queue hints", () => {
  it("ranks a waiting post by its current distance", () => {
    expect(queueHint({ top: 900, bottom: 1300 }, VH)).toBe(100);
    expect(queueHint({ top: -700, bottom: -100 }, VH)).toBe(100);
  });
  it("keeps posts anywhere inside the observer's range", () => {
    expect(queueHint({ top: VH + ROOT_MARGIN_PX, bottom: VH + ROOT_MARGIN_PX + 400 }, VH)).toBe(ROOT_MARGIN_PX);
    expect(queueHint({ top: -ROOT_MARGIN_PX - 400, bottom: -ROOT_MARGIN_PX }, VH)).toBe(ROOT_MARGIN_PX);
  });
  it("drops a post once it is beyond the observer's range, so it is reported again on the way back", () => {
    expect(queueHint({ top: -3000, bottom: -2600 }, VH)).toBeNull();
    expect(queueHint({ top: VH + ROOT_MARGIN_PX + 300, bottom: VH + ROOT_MARGIN_PX + 700 }, VH)).toBeNull();
  });
});
