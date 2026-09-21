import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/index.js";
import { findTursoEnv } from "../src/db/libsql.js";
import { migrate } from "../src/db/migrate.js";
import { StorageNotConfigured } from "../src/db/types.js";
import { ADAPTERS, makeDb } from "./helpers.js";

describe("finding the Turso database in the environment", () => {
  it("uses the standard TURSO_* names", () => {
    expect(findTursoEnv({ TURSO_DATABASE_URL: "libsql://db-org.turso.io", TURSO_AUTH_TOKEN: "tok" })).toEqual({ url: "libsql://db-org.turso.io", authToken: "tok" });
  });
  it("accepts DATABASE_URL", () => {
    expect(findTursoEnv({ DATABASE_URL: "libsql://x.turso.io", DATABASE_AUTH_TOKEN: "t" })).toEqual({ url: "libsql://x.turso.io", authToken: "t" });
  });
  it("finds the database under whatever prefix the Marketplace integration was given", () => {
    expect(findTursoEnv({ STORAGE_URL: "libsql://x.turso.io", STORAGE_AUTH_TOKEN: "t2", OTHER: "1" })).toEqual({ url: "libsql://x.turso.io", authToken: "t2" });
    expect(findTursoEnv({ SLOPMOP_DATABASE_URL: "libsql://y.turso.io", SLOPMOP_DATABASE_AUTH_TOKEN: "t3" })).toEqual({ url: "libsql://y.turso.io", authToken: "t3" });
  });
  it("ignores URLs that aren't libSQL (a Postgres DATABASE_URL must not be mistaken for Turso)", () => {
    expect(findTursoEnv({ DATABASE_URL: "postgres://u:p@host/db", REDIS_URL: "redis://x" })).toBeNull();
    expect(findTursoEnv({})).toBeNull();
  });
});

describe("opening the database", () => {
  it("falls back to a local SQLite file when not on Vercel", async () => {
    const db = await openDb({ SLOPMOP_DB_FILE: ":memory:" });
    expect(db.kind).toBe("memory");
    expect((await db.execute("SELECT COUNT(*) AS n FROM content")).rows[0].n).toBe(0);
  });
  it("refuses to run on Vercel without a database (there is no persistent disk to fall back on)", async () => {
    await expect(openDb({ VERCEL: "1" })).rejects.toBeInstanceOf(StorageNotConfigured);
  });
});

describe.each(ADAPTERS)("schema and adapter (%s)", (kind) => {
  it("migrates idempotently and records the schema version", async () => {
    const db = await makeDb(kind);
    await migrate(db);
    await migrate(db);
    expect((await db.execute("SELECT value FROM _meta WHERE key = 'schema_version'")).rows[0].value).toBe("8");
  });
  it("batches are atomic: a failing statement rolls the whole batch back", async () => {
    const db = await makeDb(kind);
    await expect(
      db.batch([
        { sql: "INSERT INTO usage (install_hash, day, checks) VALUES ('a','2026-01-01',1)" },
        { sql: "INSERT INTO votes (network, content_id, install_hash, vote, at) VALUES ('n','c','i','bogus',1)" }, // violates CHECK
      ]),
    ).rejects.toThrow();
    expect((await db.execute("SELECT COUNT(*) AS n FROM usage")).rows[0].n).toBe(0);
  });
  it("returns plain rows for RETURNING and reports changes for writes", async () => {
    const db = await makeDb(kind);
    const r = await db.execute("INSERT INTO usage (install_hash, day, checks) VALUES (?,?,1) RETURNING checks", ["h", "2026-01-01"]);
    expect(r.rows).toEqual([{ checks: 1 }]);
    const u = await db.execute("UPDATE usage SET checks = 5 WHERE install_hash = ?", ["h"]);
    expect(u.changes).toBe(1);
  });
});
