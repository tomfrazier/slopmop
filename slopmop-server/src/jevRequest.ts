import { RateLimitError, type TypeSafeClient } from "@typesafe-ai/sdk";
import { hedged } from "./hedge.js";
import { DEFAULT_RATE_LIMIT_PAUSE_MS, RATE_LIMIT_JITTER_MS, retryable, type Tuning } from "./jevTuning.js";
import { buildQuestions, buildState, type JudgeInput } from "./questions.js";

type Client = Pick<TypeSafeClient, "systemOne">;
export type JevResult = Awaited<ReturnType<Client["systemOne"]>>;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to wait before asking again after a rate limit: what the upstream said, kept between the configured bounds. */
const rateLimitWait = (e: RateLimitError, t: Tuning) => Math.min(Math.max(e.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS, t.minPauseMs), t.maxPauseMs);

/**
 * One fan-out request to Jev, patiently. The SDK's own retries are off (`maxRetries: 0`); slow or failed attempts are handled
 * by `hedged` so a stall costs seconds rather than the SDK's 10s-per-attempt default. A rate limit isn't hedged (more requests
 * would make it worse): wait as the upstream asks, then ask again.
 */
export async function askJev(client: Client, model: string, input: JudgeInput, tuning: Tuning): Promise<{ result: JevResult; attempts: number }> {
  const request = { model, state: buildState(input), questions: buildQuestions() };
  for (let rateLimited = 0; ; rateLimited++) {
    try {
      const { value, attempts } = await hedged((signal) => client.systemOne(request, { signal, timeout: tuning.attemptTimeoutMs, retry: { maxRetries: 0 } }), {
        hedgeAfterMs: tuning.hedgeAfterMs,
        maxAttempts: tuning.maxAttempts,
        retryable,
      });
      return { result: value, attempts };
    } catch (e) {
      if (!(e instanceof RateLimitError) || rateLimited >= tuning.rateLimitRetries) throw e;
      await pause(rateLimitWait(e, tuning) + Math.random() * RATE_LIMIT_JITTER_MS);
    }
  }
}
