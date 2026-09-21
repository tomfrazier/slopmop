// Dumps the registry as NDJSON for tuning: `npm run export -- --network linkedin --since 2026-09-01 > export.ndjson`
// Uses the same environment as the server, so `vercel env pull` first to read the production Turso database.
import { createContext } from "../src/context.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const since = arg("since");
const ctx = await createContext(process.env);
const rows = await ctx.store.exports.rows({
  network: arg("network") ?? "linkedin",
  since: since ? (/^\d+$/.test(since) ? Number(since) : Date.parse(since)) : 0,
  limit: arg("limit") ? Number(arg("limit")) : 10000,
  minVotes: arg("minVotes") ? Number(arg("minVotes")) : undefined,
});
for (const r of rows) process.stdout.write(JSON.stringify(r) + "\n");
console.error(`exported ${rows.length} record(s)`);
