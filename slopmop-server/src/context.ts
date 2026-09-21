import { loadConfig, type Env } from "./config.js";
import { openDb } from "./db/index.js";
import type { Ctx } from "./ctx.js";
import { createJev } from "./jev.js";
import { CRITERIA_VERSION } from "./questions.js";
import { ManifestStore } from "./manifest.js";
import { ScoringStore } from "./scoringStore.js";
import { Store } from "./store.js";
import { WeightStore } from "./weightStore.js";

export const VERSION = "1.0.0";

/** Builds the request context from the environment. */
export async function createContext(env: Env, now: () => number = Date.now): Promise<Ctx> {
  const config = loadConfig(env);
  const db = await openDb(env);
  return {
    config,
    store: new Store(db, config, now),
    weights: new WeightStore(db, { weights: config.tellWeights, custom: config.customWeights }, now),
    scoring: new ScoringStore(db, now),
    manifest: new ManifestStore(db, now),
    jev: createJev(env),
    criteriaVersion: CRITERIA_VERSION,
    version: VERSION,
  };
}

let cached: Promise<Ctx> | null = null;

/**
 * One context per warm function instance (the database connection and migrations are set up once). A failed setup
 * isn't cached, so a fixed environment variable takes effect on the next request without a redeploy of the code.
 */
export function getContext(env: Env = process.env): Promise<Ctx> {
  cached ??= createContext(env).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}
