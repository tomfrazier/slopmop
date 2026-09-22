import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient as createNodeClient } from "@libsql/client";
import { loadConfig, type Env } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { openLibsql } from "../src/db/libsql.js";
import { openFileDb } from "../src/db/nodesqlite.js";
import type { Db } from "../src/db/types.js";
import { handle, type Ctx, type Route } from "../src/handlers.js";
import type { JevBackend, Verdict } from "../src/jev.js";
import { buildQuestions, CRITERIA_VERSION, SCORE_TRAITS } from "../src/questions.js";
import { Store } from "../src/store.js";
import { DatacenterList } from "../src/datacenterRanges.js";
import { ManifestStore } from "../src/manifest.js";
import { ScoringStore } from "../src/scoringStore.js";
import { WeightStore } from "../src/weightStore.js";

export type Adapter = "sqlite" | "libsql";
export const ADAPTERS: Adapter[] = ["sqlite", "libsql"];

/** "sqlite" = the local node:sqlite adapter; "libsql" = the production Turso adapter driven through libSQL's own client. */
export async function makeDb(kind: Adapter): Promise<Db> {
  const db =
    kind === "sqlite"
      ? openFileDb(":memory:")
      : openLibsql({ url: `file:${join(mkdtempSync(join(tmpdir(), "slopmop-test-")), "t.db")}` }, createNodeClient as never);
  await migrate(db);
  return db;
}

export const stats = { wordCount: 60, sentenceCount: 5, sentenceLengthStdDev: 4, contractionsPer100Words: 2, exclamationCount: 0, emDashesPer1000Words: 0 };
export const POST = "We finally shipped the billing migration last Thursday and I think it is the best thing our team did all year.";

export function verdictOf(level = 0.5, ai = 0.9): Verdict {
  const dimensions = Object.fromEntries(SCORE_TRAITS.map((t) => [t.id, { value: level, confidence: 0.9 }]));
  return { model: "test-jev", dimensions, aiLikelihood: ai, usage: { inputTokens: 4000, outputTokens: 20 } };
}

export interface Harness {
  ctx: Ctx;
  db: Db;
  clock: { t: number };
  calls: { n: number; last?: unknown };
  failNext: { error?: unknown };
  call(route: Route, body?: unknown, opts?: { method?: string; install?: string | null; headers?: Record<string, string>; query?: string }): Promise<{ status: number; body: any; res: Response }>;
}

export async function makeHarness(kind: Adapter, env: Env = {}): Promise<Harness> {
  const db = await makeDb(kind);
  const config = loadConfig({ INSTALL_ID_SALT: "test-salt", ...env });
  const clock = { t: Date.UTC(2026, 8, 19, 15, 0, 0) };
  const calls: Harness["calls"] = { n: 0 };
  const failNext: Harness["failNext"] = {};
  const jev: JevBackend = {
    via: "direct",
    model: "test-jev",
    score: async (input) => {
      calls.n++;
      calls.last = input;
      if (failNext.error) {
        const e = failNext.error;
        failNext.error = undefined;
        throw e;
      }
      return verdictOf();
    },
  };
  // Tests must never reach the real network: this always "fails" the AWS/GCP fetch, so isDatacenter falls back to only
  // config.datacenterExtraCidrs (settable via the DATACENTER_CIDR_EXTRA env, like any other config value here).
  const neverFetch = (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch;
  const ctx: Ctx = { config, store: new Store(db, config, () => clock.t), weights: new WeightStore(db, { weights: config.tellWeights, custom: config.customWeights }, () => clock.t), scoring: new ScoringStore(db, () => clock.t), manifest: new ManifestStore(db, () => clock.t), datacenter: new DatacenterList(config.datacenterExtraCidrs, () => clock.t, 24 * 60 * 60 * 1000, neverFetch), jev, criteriaVersion: CRITERIA_VERSION, version: "test" };
  const METHOD: Record<Route, string> = { judge: "POST", vote: "POST", usage: "GET", health: "GET", export: "GET", stats: "GET", clients: "GET", weights: "GET", scoring: "GET", manifest: "GET", adminManifest: "GET", tuner: "GET", simulate: "POST" };
  return {
    ctx,
    db,
    clock,
    calls,
    failNext,
    async call(route, body, opts = {}) {
      const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
      if (opts.install !== null) headers["x-install-id"] = opts.install ?? "install-aaaaaaaa";
      const method = opts.method ?? METHOD[route];
      const req = new Request(`http://test/api/v1/${route}${opts.query ?? ""}`, { method, headers, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      const res = await handle(route, req, ctx);
      const text = await res.clone().text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ndjson or empty */
      }
      return { status: res.status, body: parsed, res };
    },
  };
}

export const judgeBody = (over: Record<string, unknown> = {}) => ({ network: "linkedin", postText: POST, surfaceStats: stats, ...over });
export { buildQuestions };
