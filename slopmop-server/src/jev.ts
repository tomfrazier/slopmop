import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Env } from "./config.js";
import { Gate } from "./gate.js";
import { askJev } from "./jevRequest.js";
import { chooseRoute } from "./jevRoute.js";
import { DEFAULT_TUNING, tuningFrom, type Tuning } from "./jevTuning.js";
import type { Verdict } from "./jevTypes.js";
import { toVerdict } from "./jevVerdict.js";
import type { JudgeInput } from "./questions.js";

export type { Dimension, Verdict } from "./jevTypes.js";
export { DEFAULT_TUNING, retryable, tuningFrom, type Tuning } from "./jevTuning.js";

export type Scorer = (input: JudgeInput) => Promise<Verdict>;

export interface JevBackend {
  /** "gateway" = Jev through Vercel AI Gateway (key kept in Vercel); "direct" = TypeSafe's own API. */
  via: "gateway" | "direct";
  model: string;
  score: Scorer;
}

/** One request to Jev, returned as a verdict. */
export async function judge(client: Pick<TypeSafeClient, "systemOne">, model: string, input: JudgeInput, tuning: Tuning = DEFAULT_TUNING): Promise<Verdict> {
  const { result, attempts } = await askJev(client, model, input, tuning);
  return toVerdict(result, attempts);
}

/** The scorer for the route the environment selects, or null when no Jev credentials are configured. */
export function createJev(env: Env): JevBackend | null {
  const route = chooseRoute(env);
  if (!route) return null;
  const client = new TypeSafeClient({ apiKey: route.apiKey, baseURL: route.baseURL, logLevel: "off", retry: { maxRetries: 0 } });
  const tuning = tuningFrom(env);
  const gate = new Gate(tuning.maxConcurrent, tuning.queueWaitMs);
  return { via: route.via, model: route.model, score: (input) => gate.run(() => judge(client, route.model, input, tuning)) };
}
