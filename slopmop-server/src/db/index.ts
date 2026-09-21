import { findTursoEnv, openLibsql } from "./libsql.js";
import { migrate } from "./migrate.js";
import { StorageNotConfigured, type Db } from "./types.js";

export type { Db } from "./types.js";
export { StorageNotConfigured } from "./types.js";

/**
 * Opens the registry database and makes sure the schema is current.
 *  - Turso (Vercel Marketplace): TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, or any prefix the integration was given.
 *  - Local: a SQLite file at SLOPMOP_DB_FILE (default data/slopmop.db), or :memory: for tests.
 * On Vercel there is no persistent disk, so a missing database is an error rather than a silent per-instance file.
 */
export async function openDb(env: Record<string, string | undefined>): Promise<Db> {
  const turso = findTursoEnv(env);
  let db: Db;
  if (turso) db = openLibsql(turso);
  else if (env.VERCEL) throw new StorageNotConfigured("No database is connected. Add Turso from the Vercel Marketplace (Storage tab) and redeploy.");
  else db = (await import("./nodesqlite.js")).openFileDb(env.SLOPMOP_DB_FILE || "data/slopmop.db");
  await migrate(db);
  return db;
}
