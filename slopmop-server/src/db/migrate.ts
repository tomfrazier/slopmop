import { MIGRATIONS } from "./migrations.js";
import type { Db } from "./types.js";

export async function migrate(db: Db): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const version = async () => Number((await db.execute(`SELECT value FROM _meta WHERE key = 'schema_version'`)).rows[0]?.value ?? 0);
  for (let v = await version(); v < MIGRATIONS.length; v++) {
    try {
      await db.batch(MIGRATIONS[v].map((sql) => ({ sql })));
    } catch (e) {
      // ALTER TABLE isn't idempotent: if another cold start applied this step first, ours fails harmlessly.
      if ((await version()) > v) continue;
      throw e;
    }
    await db.execute(`INSERT INTO _meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(v + 1)]);
  }
}
