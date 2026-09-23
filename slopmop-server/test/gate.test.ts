import { APIError, RateLimitError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { Gate, QueueTimeout } from "../src/gate.js";
import { tuningFrom } from "../src/jevTuning.js";
import { describeUpstream, upstreamError } from "../src/upstream.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the Jev concurrency gate", () => {
  it("never runs more than the limit at once, and runs everything in order of arrival", async () => {
    const gate = new Gate(2, 1000);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        gate.run(async () => {
          order.push(n);
          peak = Math.max(peak, ++active);
          await sleep(10);
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("frees the slot when a task fails", async () => {
    const gate = new Gate(1, 1000);
    await expect(gate.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("makes a caller that waits too long give up, and turns that into a retry-later 503", async () => {
    const gate = new Gate(1, 20);
    const held = gate.run(() => sleep(80));
    const err = await gate.run(async () => "never").catch((e) => e);
    expect(err).toBeInstanceOf(QueueTimeout);
    const http = upstreamError(err);
    expect(http.status).toBe(503);
    expect(http.code).toBe("upstream_busy");
    expect(http.headers["Retry-After"]).toBeDefined();
    await held;
    await expect(gate.run(async () => "fine")).resolves.toBe("fine"); // a timed-out waiter leaves nothing behind
  });

  it("is configurable, with sane defaults", () => {
    expect(tuningFrom({})).toMatchObject({ maxConcurrent: 6, queueWaitMs: 8000 });
    expect(tuningFrom({ JEV_MAX_CONCURRENT: "3", JEV_QUEUE_WAIT_MS: "500" })).toMatchObject({ maxConcurrent: 3, queueWaitMs: 500 });
    expect(tuningFrom({ JEV_MAX_CONCURRENT: "0" }).maxConcurrent).toBe(6);
  });
});

describe("what an upstream failure writes to the activity log", () => {
  it("names the limit for a rate limit: status, the rate-limit headers and the message", () => {
    const e = new RateLimitError(429, { message: "Too many requests for this key" }, new Headers({ "retry-after": "2", "x-ratelimit-remaining": "0", "content-type": "json" }));
    const d = describeUpstream(e);
    expect(d).toMatch(/^RateLimitError 429 /);
    expect(d).toMatch(/retry-after=2/);
    expect(d).toMatch(/x-ratelimit-remaining=0/);
    expect(d).toMatch(/Too many requests for this key/);
    expect(d).not.toMatch(/content-type/);
  });

  it("gives an API error's status and message, kept to one short line", () => {
    const d = describeUpstream(new APIError(503, {}, new Headers(), "Service\nunavailable " + "x".repeat(500)));
    expect(d.startsWith("APIError 503 - Service unavailable")).toBe(true);
    expect(d).not.toMatch(/\n/);
    expect(d.length).toBeLessThanOrEqual(240);
  });

  it("falls back to the class name for anything else", () => {
    expect(describeUpstream(new TypeError("x"))).toBe("TypeError");
    expect(describeUpstream("weird")).toBe("unknown");
  });
});
