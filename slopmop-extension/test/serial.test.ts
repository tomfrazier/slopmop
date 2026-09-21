import { describe, expect, it } from "vitest";
import { createSerial } from "../src/shared/serial";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSerial", () => {
  it("runs jobs one at a time, in order, even when a later one would be quicker", async () => {
    const run = createSerial();
    const log: string[] = [];
    const slow = run(async () => (log.push("slow start"), await tick(30), log.push("slow end"), "a"));
    const fast = run(async () => (log.push("fast"), "b"));
    expect(await Promise.all([slow, fast])).toEqual(["a", "b"]);
    expect(log).toEqual(["slow start", "slow end", "fast"]);
  });

  it("does not lose a read-modify-write when two happen at once", async () => {
    const run = createSerial();
    let stored = 0;
    const add = () => run(async () => {
      const seen = stored;
      await tick(5);
      stored = seen + 1;
    });
    await Promise.all([add(), add(), add()]);
    expect(stored).toBe(3);
  });

  it("keeps going after a failure, and still reports it to the caller who asked", async () => {
    const run = createSerial();
    const failing = run(async () => { throw new Error("boom"); });
    const next = run(async () => "still runs");
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("still runs");
  });
});
