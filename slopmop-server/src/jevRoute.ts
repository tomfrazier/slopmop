import type { Env } from "./config.js";

/** How to reach Jev: through Vercel AI Gateway, or straight to TypeSafe. */
export interface JevRoute {
  /** "gateway" = Jev through Vercel AI Gateway (key kept in Vercel); "direct" = TypeSafe's own API. */
  via: "gateway" | "direct";
  model: string;
  apiKey: string;
  /** Unset for the direct route (the SDK's own default). */
  baseURL?: string;
}

const GATEWAY_URL = "https://ai-gateway.vercel.sh/typesafe";
const GATEWAY_MODEL = "typesafe-ai/jev";
const DIRECT_MODEL = "jev-latest";

/**
 * Picks how to reach Jev. On Vercel, set AI_GATEWAY_API_KEY (an AI Gateway key; Jev is served as typesafe-ai/jev
 * and billed through Vercel). For local development you can instead set TYPESAFE_API_KEY to call TypeSafe directly.
 * Both speak the same TypeSafe request/response format, so it is one client with a different base URL and model.
 * JEV_PROVIDER=gateway|direct forces the choice when both keys are present. Null when the chosen route has no key.
 */
export function chooseRoute(env: Env): JevRoute | null {
  const provider = env.JEV_PROVIDER;
  const gateway = provider === "gateway" || (provider !== "direct" && !!env.AI_GATEWAY_API_KEY);
  if (gateway) return env.AI_GATEWAY_API_KEY ? { via: "gateway", model: GATEWAY_MODEL, apiKey: env.AI_GATEWAY_API_KEY, baseURL: env.AI_GATEWAY_BASE_URL || GATEWAY_URL } : null;
  return env.TYPESAFE_API_KEY ? { via: "direct", model: DIRECT_MODEL, apiKey: env.TYPESAFE_API_KEY } : null;
}
