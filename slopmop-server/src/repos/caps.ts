import { USAGE_KEEP_DAYS, DAY_MS } from "../constants.js";
import { dayKey, nextResetIso, num, type RepoDeps } from "./shared.js";
import type { Usage } from "./types.js";

/** The daily cap: how many checks each install has used today. */
export class CapRepo {
  constructor(private readonly d: RepoDeps) {}

  /**
   * Spends one check. A single atomic upsert: the increment only happens while the count is below the limit, so
   * concurrent requests can never overshoot it.
   */
  async consume(installId: string): Promise<{ ok: boolean; usage: Usage }> {
    const limit = this.d.config.dailyLimit;
    const t = this.d.now();
    const r = await this.d.db.execute(
      `INSERT INTO usage (install_hash, day, checks) VALUES (?, ?, 1)
       ON CONFLICT(install_hash, day) DO UPDATE SET checks = checks + 1 WHERE checks < ?
       RETURNING checks`,
      [this.d.hash(installId), dayKey(t), limit],
    );
    if (!r.rows.length) return { ok: false, usage: this.usageFrom(limit, t) };
    const used = num(r.rows[0].checks);
    if (used === 1) await this.d.db.execute(`DELETE FROM usage WHERE day < ?`, [dayKey(t - USAGE_KEEP_DAYS * DAY_MS)]); // housekeeping, once per install per day
    return { ok: true, usage: this.usageFrom(used, t) };
  }

  /** Gives a check back (a request that failed on our side shouldn't cost the user one). */
  async refund(installId: string): Promise<void> {
    await this.d.db.execute(`UPDATE usage SET checks = checks - 1 WHERE install_hash = ? AND day = ? AND checks > 0`, [this.d.hash(installId), dayKey(this.d.now())]);
  }

  async usage(installId: string): Promise<Usage> {
    const r = await this.d.db.execute(`SELECT checks FROM usage WHERE install_hash = ? AND day = ?`, [this.d.hash(installId), dayKey(this.d.now())]);
    return this.usageFrom(num(r.rows[0]?.checks), this.d.now());
  }

  private usageFrom(used: number, t: number): Usage {
    const limit = this.d.config.dailyLimit;
    return { used, limit, remaining: Math.max(0, limit - used), resetsAt: nextResetIso(t) };
  }
}
