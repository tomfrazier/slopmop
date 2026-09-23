import { AuthenticationError, InternalServerError, RateLimitError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { hedged } from "../src/hedge.js";
import { DEFAULT_TUNING, judge, retryable, tuningFrom } from "../src/jev.js";
import { buildQuestions, SCORE_TRAITS } from "../src/questions.js";
import { judgeBody, stats } from "./helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = { hedgeAfterMs: 30, maxAttempts: 3, retryable: () => true };
/** Rejects when aborted, like a fetch would. */
const hangs = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

describe("hedged", () => {
  it("makes one request when the first answers quickly", async () => {
    let n = 0;
    const r = await hedged(async () => (n++, "ok"), opts);
    await sleep(60);
    expect(r).toEqual({ value: "ok", attempts: 1 });
    expect(n).toBe(1); // no hedge was started after the winner
  });

  it("starts a second request when the first stalls, uses the faster answer, and aborts the stalled one", async () => {
    const signals: AbortSignal[] = [];
    const r = await hedged((signal, attempt) => {
      signals.push(signal);
      return attempt === 1 ? hangs(signal) : sleep(5).then(() => "second");
    }, opts);
    expect(r).toEqual({ value: "second", attempts: 2 });
    expect(signals[0].aborted).toBe(true);
  });

  it("still takes the first answer if the stalled request recovers before the hedge finishes", async () => {
    const r = await hedged((_s, attempt) => (attempt === 1 ? sleep(45).then(() => "first") : sleep(200).then(() => "second")), opts);
    expect(r.value).toBe("first");
  });

  it("replaces a fast failure immediately instead of waiting for the hedge delay", async () => {
    const t = Date.now();
    const r = await hedged(async (_s, attempt) => { if (attempt === 1) throw new Error("boom"); return "ok"; }, { ...opts, hedgeAfterMs: 1000 });
    expect(r.attempts).toBe(2);
    expect(Date.now() - t).toBeLessThan(200);
  });

  it("fails straight away on an error that asking again cannot fix", async () => {
    let n = 0;
    await expect(hedged(async () => { n++; throw new Error("bad key"); }, { ...opts, retryable: () => false })).rejects.toThrow("bad key");
    expect(n).toBe(1);
  });

  it("gives up after the maximum attempts, with the last error", async () => {
    let n = 0;
    await expect(hedged(async () => { throw new Error(`fail ${++n}`); }, opts)).rejects.toThrow("fail 3");
    expect(n).toBe(3);
  });

  it("never starts more than the maximum, even if every attempt stalls", async () => {
    let n = 0;
    const p = hedged((signal) => (n++, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 80 + n * 10))), opts);
    await expect(p).rejects.toThrow("timeout");
    expect(n).toBe(3);
  });
});

describe("retryable errors", () => {
  it("retries stalls, dropped connections and 5xx, but not credentials, bad input or rate limits", () => {
    expect(retryable(new Error("socket hang up"))).toBe(true);
    expect(retryable(new InternalServerError(500, { message: "x" }, new Headers()))).toBe(true);
    expect(retryable(new AuthenticationError(401, { message: "x" }, new Headers()))).toBe(false);
    expect(retryable(new RateLimitError(429, { message: "x" }, new Headers()))).toBe(false); // handled by pausing, not hedging
  });
  it("reads its tuning from the environment", () => {
    expect(tuningFrom({})).toMatchObject({ hedgeAfterMs: 1500, attemptTimeoutMs: 5000, maxAttempts: 3, rateLimitRetries: 2 });
    expect(tuningFrom({ JEV_HEDGE_MS: "800", JEV_ATTEMPT_TIMEOUT_MS: "3000", JEV_MAX_ATTEMPTS: "2" })).toMatchObject({ hedgeAfterMs: 800, attemptTimeoutMs: 3000, maxAttempts: 2 });
    expect(tuningFrom({ JEV_HEDGE_MS: "nope", JEV_MAX_ATTEMPTS: "0" })).toMatchObject({ hedgeAfterMs: 1500, attemptTimeoutMs: 5000, maxAttempts: 3 });
  });
});

describe("judge() with a stalling Jev", () => {
  const answers = () => {
    const a: Record<string, unknown> = { aiLikelihood: { noul: 0.8 } };
    for (const t of SCORE_TRAITS) a[t.id] = { score: 1, confidence: 0.9 };
    return a;
  };
  const input = { postText: judgeBody().postText as string, surfaceStats: stats };

  it("answers from the hedge when the first request hangs, reports it, and turns the SDK's own retries off", async () => {
    const calls: { signal?: AbortSignal; retry?: unknown; timeout?: number }[] = [];
    const client = {
      systemOne: (_req: unknown, o: any) => {
        calls.push(o);
        return calls.length === 1 ? hangs(o.signal) : Promise.resolve({ model: "jev-x", answers: answers(), usage: { input_tokens: 4000, output_tokens: 20 } });
      },
    };
    const v = await judge(client as never, "jev-x", input, { ...DEFAULT_TUNING, hedgeAfterMs: 30, attemptTimeoutMs: 1234 });
    expect(v).toMatchObject({ model: "jev-x", aiLikelihood: 0.8, attempts: 2, usage: { inputTokens: 4000, outputTokens: 20 } });
    expect(calls).toHaveLength(2);
    expect(calls[0].retry).toEqual({ maxRetries: 0 });
    expect(calls[0].timeout).toBe(1234);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(Object.keys(buildQuestions()).length).toBeGreaterThan(5);
  });

  it("waits and asks again when rate limited, instead of failing at once", async () => {
    let n = 0;
    const client = {
      systemOne: () => {
        n++;
        if (n <= 2) return Promise.reject(new RateLimitError(429, { message: "slow down" }, new Headers({ "retry-after-ms": "5" })));
        return Promise.resolve({ model: "jev-x", answers: answers(), usage: { input_tokens: 1, output_tokens: 1 } });
      },
    };
    const tuning = { hedgeAfterMs: 1000, attemptTimeoutMs: 1000, maxAttempts: 3, rateLimitRetries: 2, minPauseMs: 1, maxPauseMs: 20, maxConcurrent: 6, queueWaitMs: 1000 };
    const v = await judge(client as never, "jev-x", input, tuning);
    expect(n).toBe(3);
    expect(v.attempts).toBe(1); // pausing is not hedging
  });

  it("gives up with the rate-limit error once the retries are used", async () => {
    let n = 0;
    const client = { systemOne: () => (n++, Promise.reject(new RateLimitError(429, { message: "no" }, new Headers()))) };
    const tuning = { hedgeAfterMs: 1000, attemptTimeoutMs: 1000, maxAttempts: 3, rateLimitRetries: 2, minPauseMs: 1, maxPauseMs: 5, maxConcurrent: 6, queueWaitMs: 1000 };
    await expect(judge(client as never, "jev-x", input, tuning)).rejects.toBeInstanceOf(RateLimitError);
    expect(n).toBe(3);
  });
});
