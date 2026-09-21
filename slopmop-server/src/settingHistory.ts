import { WEIGHT_HISTORY_LIMIT } from "./constants.js";
import type { Db } from "./db/types.js";

/** One saved change to a setting group (the scoring settings or the client manifest). */
export interface SettingChange {
  at: number;
  /** What was saved, or for a reset what it went back to. */
  value: unknown;
  note: string | null;
  source: "admin" | "reset";
}

export const historyInsert = (key: string, at: number, value: unknown, note: string | null, source: "admin" | "reset") => ({
  sql: `INSERT INTO setting_history (key, at, value, note, source) VALUES (?, ?, ?, ?, ?)`,
  args: [key, at, JSON.stringify(value), note, source],
});

export async function readHistory(db: Db, key: string, limit = WEIGHT_HISTORY_LIMIT): Promise<SettingChange[]> {
  const r = await db.execute(`SELECT at, value, note, source FROM setting_history WHERE key = ? ORDER BY id DESC LIMIT ?`, [key, limit]);
  return r.rows.map((row) => ({ at: Number(row.at), value: JSON.parse(String(row.value)), note: (row.note as string | null) ?? null, source: row.source as "admin" | "reset" }));
}
