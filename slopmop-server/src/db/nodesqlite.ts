import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db, Row, SqlArg, Stmt } from "./types.js";

/** Local development and tests: a plain SQLite file (or :memory:) via Node's built-in node:sqlite. No infrastructure needed. */
export function openFileDb(path: string): Db {
  // getBuiltinModule avoids a static import of an experimental builtin that some bundlers can't resolve.
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 3000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");

  const returnsRows = (sql: string) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);
  const run = (sql: string, args: SqlArg[] = []): { rows: Row[]; changes: number } => {
    const stmt = db.prepare(sql);
    if (returnsRows(sql)) {
      const rows = stmt.all(...args).map((r) => ({ ...r }) as Row);
      return { rows, changes: rows.length };
    }
    return { rows: [], changes: Number(stmt.run(...args).changes) };
  };

  return {
    kind: path === ":memory:" ? "memory" : "file",
    execute: async (sql, args) => run(sql, args),
    batch: async (stmts: Stmt[]) => {
      db.exec("BEGIN");
      try {
        for (const s of stmts) run(s.sql, s.args);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => db.close(),
  };
}
