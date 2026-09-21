export type SqlArg = string | number | null;
export interface Row {
  [column: string]: unknown;
}
export interface Stmt {
  sql: string;
  args?: SqlArg[];
}

/** The small slice of SQL access the store needs. Adapters: local SQLite file (dev/tests) and Turso/libSQL (Vercel). */
export interface Db {
  readonly kind: "file" | "memory" | "libsql";
  execute(sql: string, args?: SqlArg[]): Promise<{ rows: Row[]; changes: number }>;
  /** Runs statements atomically (all or nothing). */
  batch(stmts: Stmt[]): Promise<void>;
  close?(): void;
}

export class StorageNotConfigured extends Error {}
