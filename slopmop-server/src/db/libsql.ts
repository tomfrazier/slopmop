import { createClient as createWebClient } from "@libsql/client/web";
import type { Db, Row, Stmt } from "./types.js";
import { StorageNotConfigured } from "./types.js";

type CreateClient = typeof createWebClient;

/** Production: Turso (libSQL over HTTP). The web build has no native code, so it bundles cleanly into a Vercel function. */
export function openLibsql(cfg: { url: string; authToken?: string }, createClient: CreateClient = createWebClient): Db {
  const client = createClient({ url: cfg.url, authToken: cfg.authToken });
  return {
    kind: "libsql",
    async execute(sql, args = []) {
      const r = await client.execute({ sql, args });
      const rows = r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i] as unknown])) as Row);
      return { rows, changes: r.rowsAffected };
    },
    async batch(stmts: Stmt[]) {
      await client.batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })), "write");
    },
    close: () => client.close(),
  };
}

export interface TursoEnv {
  url: string;
  authToken?: string;
}

/**
 * Finds the Turso database in the environment. The Vercel Marketplace integration lets you choose the variable
 * prefix, so besides the standard TURSO_* names this accepts DATABASE_URL and any <PREFIX>_URL / _DATABASE_URL whose
 * value is a libsql:// (or turso.io) URL, with its sibling <PREFIX>_AUTH_TOKEN / _DATABASE_AUTH_TOKEN / _TOKEN.
 */
export function findTursoEnv(env: Record<string, string | undefined>): TursoEnv | null {
  const isLibsql = (v: string | undefined): v is string => !!v && /^(libsql|wss?):\/\//i.test(v) || !!v && /^https:\/\/[^/]*turso\.io/i.test(v);
  if (isLibsql(env.TURSO_DATABASE_URL)) return { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN };
  if (isLibsql(env.DATABASE_URL)) return { url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN ?? env.DATABASE_TOKEN };
  for (const [key, value] of Object.entries(env)) {
    const m = /^(.*?)_(?:DATABASE_)?URL$/.exec(key);
    if (!m || !isLibsql(value)) continue;
    const prefix = m[1];
    const token = env[`${prefix}_DATABASE_AUTH_TOKEN`] ?? env[`${prefix}_AUTH_TOKEN`] ?? env[`${prefix}_TOKEN`];
    return { url: value, authToken: token };
  }
  return null;
}

export { StorageNotConfigured };
