// Fills a LOCAL database with synthetic activity so the admin dashboard has something to show:
//   npm run seed:demo    then    ADMIN_TOKEN=demo npm run dev    and open http://127.0.0.1:8787/admin
// Refuses to run against a remote (Turso) database.
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { findTursoEnv } from "../src/db/libsql.js";
import { CRITERIA_VERSION, SCORE_TRAITS } from "../src/questions.js";
import { Store } from "../src/store.js";

if (findTursoEnv(process.env)) throw new Error("Refusing to seed demo data into a remote database.");
const env: Record<string, string | undefined> = { ...process.env, SLOPMOP_DB_FILE: process.env.SLOPMOP_DB_FILE ?? "data/slopmop.db" };
const db = await openDb(env);
const config = loadConfig({ ...env, INSTALL_ID_SALT: env.INSTALL_ID_SALT ?? "demo" });
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const now = Date.now();
const store = new Store(db, config, () => t);
let t = now;
const installs = Array.from({ length: 24 }, (_, i) => `demo-install-${i}`);
const started = new Map(installs.map((id) => [id, now - Math.floor(rnd() * 30) * 86400_000]));
const posts = Array.from({ length: 300 }, (_, i) => ({ id: `demo${String(i).padStart(4, "0")}`.padEnd(32, "0"), ai: Math.min(0.99, Math.max(0.01, rnd() ** 1.4 * 1.05)) }));

for (let n = 0; n < 2500; n++) {
  t = now - Math.floor(rnd() ** 0.7 * 30 * 86400_000);
  const install = pick(installs);
  if (t < started.get(install)!) continue;
  const post = pick(posts);
  const cached = rnd() < 0.3;
  const dims = Object.fromEntries(SCORE_TRAITS.map((tr) => [tr.id, { value: Math.min(1, Math.max(0, post.ai + (rnd() - 0.5) * 0.4)), confidence: 0.9 }]));
  const verdict = { model: "typesafe-ai/jev", aiLikelihood: post.ai, dimensions: dims };
  await store.content.record({ network: "linkedin", contentId: post.id, nativeId: rnd() < 0.5 ? `urn:li:activity:${7000000000000000000n + BigInt(n)}` : null, text: null, textLen: 400, surface: {}, engagement: { reactions: Math.floor(rnd() * 500), comments: Math.floor(rnd() * 40), reposts: Math.floor(rnd() * 10) }, scored: cached ? null : { verdict, criteriaVersion: CRITERIA_VERSION } });
  const roll = rnd();
  await store.events.record(
    roll < 0.02
      ? { network: "linkedin", installId: install, contentId: post.id, kind: "error", detail: "APIConnectionError", latencyMs: 30000 }
      : roll < 0.03
        ? { network: "linkedin", installId: install, contentId: post.id, kind: "limited" }
        : { network: "linkedin", installId: install, contentId: post.id, kind: cached ? "cached" : "scored", inputTokens: cached ? 0 : 3800 + Math.floor(rnd() * 800), outputTokens: cached ? 0 : 40, latencyMs: cached ? null : 700 + Math.floor(rnd() * 1800), aiLikelihood: post.ai },
  );
  if (rnd() < 0.08) {
    const truth = post.ai > 0.6 ? (rnd() < 0.8 ? "probably" : "no") : post.ai > 0.35 ? "maybe" : rnd() < 0.85 ? "no" : "probably";
    await store.votes.set("linkedin", post.id, install, truth as "no" | "maybe" | "probably");
  }
}
console.log("Seeded demo data into the local database.");
