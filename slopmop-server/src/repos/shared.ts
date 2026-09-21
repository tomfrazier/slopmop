import type { Config } from "../config.js";
import type { Db } from "../db/types.js";

/** What every repository needs: the database, the config, a clock (tests move it), and the salted install-id hash. */
export interface RepoDeps {
  db: Db;
  config: Config;
  now: () => number;
  hash: (installId: string) => string;
}

export const num = (v: unknown) => Number(v ?? 0);

export const parseJson = <T>(v: unknown): T | null => {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

/** The UTC calendar day a timestamp falls on, as YYYY-MM-DD. */
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The next UTC midnight after `t`, when the daily counter resets. */
export const nextResetIso = (t: number) => {
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};
