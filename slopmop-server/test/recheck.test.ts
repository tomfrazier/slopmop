import { describe, expect, it } from "vitest";
import { engagementTotal, isDue, nextInterval, RECHECK_INITIAL_MS, RECHECK_MAX_MS, RECHECK_MIN_MS } from "../src/recheck.js";
import { ADAPTERS, judgeBody, makeHarness } from "./helpers.js";

const HOUR = 3600_000;

describe("nextInterval", () => {
  const prev = (total: number, intervalMs: number) => ({ total, at: 0, intervalMs });
  it("keeps a first score for an hour", () => {
    expect(nextInterval(null, 0, 500)).toBe(RECHECK_INITIAL_MS);
  });
  it("follows the doubling time while a post keeps at least doubling", () => {
    expect(nextInterval(prev(100, HOUR), HOUR, 201)).toBe(HOUR); // doubled in an hour: check hourly
    expect(nextInterval(prev(100, HOUR), 2 * HOUR, 201)).toBe(2 * HOUR); // took two hours to double: two hours
    const fast = nextInterval(prev(100, HOUR), HOUR, 799); // almost three doublings in an hour: check more often than hourly
    expect(fast).toBeLessThan(HOUR / 2);
    expect(fast).toBeGreaterThanOrEqual(RECHECK_MIN_MS);
  });
  it("doubles the wait each time the post has not doubled, until it flattens out", () => {
    let interval = HOUR;
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      interval = nextInterval(prev(1000, interval), interval, 1010);
      waits.push(interval / HOUR);
    }
    expect(waits).toEqual([2, 4, 8, 16]);
  });
  it("stays between the minimum and the maximum", () => {
    expect(nextInterval(prev(1, HOUR), 1000, 1_000_000)).toBe(RECHECK_MIN_MS);
    expect(nextInterval(prev(1000, RECHECK_MAX_MS), 1, 1000)).toBe(RECHECK_MAX_MS);
  });
  it("counts reactions, comments and reposts together, and nothing for no counts", () => {
    expect(engagementTotal({ reactions: 3, comments: 2, reposts: 1 })).toBe(6);
    expect(engagementTotal(null)).toBe(0);
  });
  it("treats a score with no schedule (made before this existed) as due", () => {
    expect(isDue(null, 0)).toBe(true);
    expect(isDue({ total: 1, at: 0, intervalMs: HOUR, nextAt: null }, 0)).toBe(true);
    expect(isDue({ total: 1, at: 0, intervalMs: HOUR, nextAt: HOUR }, HOUR - 1)).toBe(false);
    expect(isDue({ total: 1, at: 0, intervalMs: HOUR, nextAt: HOUR }, HOUR)).toBe(true);
  });
});

describe("the schedule is configurable", () => {
  it("uses the configured first wait, floor, ceiling and growth ratio", () => {
    const cfg = { initialMs: 10 * 60_000, minMs: 5 * 60_000, maxMs: 2 * HOUR, growth: 3 };
    expect(nextInterval(null, 0, 10, cfg)).toBe(10 * 60_000);
    expect(nextInterval({ total: 100, at: 0, intervalMs: HOUR }, HOUR, 250, cfg)).toBe(2 * HOUR); // 2.5x is under the 3x that counts as breaking out: the wait doubles, up to the ceiling
    expect(nextInterval({ total: 100, at: 0, intervalMs: HOUR }, HOUR, 10_000, cfg)).toBeLessThan(HOUR / 4); // far more than 3x
  });
});

describe.each(ADAPTERS)("re-scoring by growth (%s)", (kind) => {
  const eng = (n: number) => ({ reactions: n, comments: 0, reposts: 0 });
  const check = (h: Awaited<ReturnType<typeof makeHarness>>, n: number, install = "install-aaaaaaaa") => h.call("judge", judgeBody({ engagement: eng(n) }), { install });

  it("reuses Jev's answer inside the wait, whoever asks and whatever the counts, and re-weighs the shield", async () => {
    const h = await makeHarness(kind);
    const first = await check(h, 10);
    expect(h.calls.n).toBe(1);
    h.clock.t += 30 * 60_000;
    const later = await check(h, 5000, "install-bbbbbbbb"); // a different person, 30 minutes on, a post that has taken off
    expect(h.calls.n).toBe(1); // Jev is not asked again yet
    expect(later.body.cached).toBe(true);
    expect(later.body.shield).toBeGreaterThan(first.body.shield); // but the shield already reflects the new counts
  });

  it("asks Jev again once the wait is over, giving it the engagement now and its previous answer", async () => {
    const h = await makeHarness(kind);
    await check(h, 10);
    h.clock.t += 61 * 60_000;
    const again = await check(h, 200, "install-bbbbbbbb");
    expect(h.calls.n).toBe(2);
    expect(again.body.cached).toBe(false);
    expect((h.calls.last as any).engagement).toEqual(eng(200));
    expect((h.calls.last as any).previousAssessment).toMatchObject({ usefulnessLevel: expect.any(Number) });
  });

  it("checks about as often as the post doubles, and less and less often once it flattens", async () => {
    const h = await makeHarness(kind);
    await check(h, 100); // scored, kept 1h
    h.clock.t += HOUR + 1;
    await check(h, 250); // more than doubled in an hour: kept about that long (a hair over an hour)
    expect(h.calls.n).toBe(2);
    h.clock.t += 30 * 60_000;
    await check(h, 300);
    expect(h.calls.n).toBe(2); // inside the wait
    h.clock.t += 31 * 60_000;
    await check(h, 310); // 1h on, barely grown: the wait doubles to 2h
    expect(h.calls.n).toBe(3);
    h.clock.t += HOUR + 1;
    await check(h, 312);
    expect(h.calls.n).toBe(3); // one hour into a two-hour wait
    h.clock.t += HOUR;
    await check(h, 312);
    expect(h.calls.n).toBe(4);
  });

  it("re-scores a stored verdict that has no schedule (an old row), once", async () => {
    const h = await makeHarness(kind);
    await check(h, 10);
    await h.db.execute("UPDATE content SET recheck_interval_ms = NULL, next_recheck_at = NULL");
    await check(h, 10, "install-bbbbbbbb");
    expect(h.calls.n).toBe(2);
    await check(h, 10, "install-cccccccc");
    expect(h.calls.n).toBe(2); // scheduled again now
  });
});
