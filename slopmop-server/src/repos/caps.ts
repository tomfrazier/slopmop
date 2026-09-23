import { USAGE_KEEP_DAYS, DAY_MS } from "../constants.js";
import { deviceId } from "./clients.js";
import { dayKey, nextResetIso, num, type RepoDeps } from "./shared.js";
import type { Usage } from "./types.js";

/**
 * The daily cap: how many checks each install has used today. An install's own limit (installs.daily_limit) wins; without one it
 * follows `defaultLimit` (the live default, or the environment's when the caller doesn't say).
 */
export class CapRepo {
  constructor(private readonly d: RepoDeps) {}

  /**
   * Spends one check. A single atomic upsert: the increment only happens while the count is below the install's limit, so
   * concurrent requests can never overshoot it.
   */
  async consume(installId: string, defaultLimit: number = this.d.config.dailyLimit): Promise<{ ok: boolean; usage: Usage }> {
    const t = this.d.now();
    const h = this.d.hash(installId);
    const r = await this.d.db.execute(
      `INSERT INTO usage (install_hash, day, checks) VALUES (?, ?, 1)
       ON CONFLICT(install_hash, day) DO UPDATE SET checks = checks + 1 WHERE checks < COALESCE((SELECT daily_limit FROM installs WHERE install_hash = ?), ?)
       RETURNING checks`,
      [h, dayKey(t), h, defaultLimit],
    );
    if (!r.rows.length) return { ok: false, usage: this.usageFrom(await this.limitFor(h, defaultLimit), await this.checksToday(h), h, t) };
    const used = num(r.rows[0].checks);
    if (used === 1) await this.d.db.execute(`DELETE FROM usage WHERE day < ?`, [dayKey(t - USAGE_KEEP_DAYS * DAY_MS)]); // housekeeping, once per install per day
    return { ok: true, usage: this.usageFrom(await this.limitFor(h, defaultLimit), used, h, t) };
  }

  /** Gives a check back (a request that failed on our side shouldn't cost the user one). */
  async refund(installId: string): Promise<void> {
    await this.d.db.execute(`UPDATE usage SET checks = checks - 1 WHERE install_hash = ? AND day = ? AND checks > 0`, [this.d.hash(installId), dayKey(this.d.now())]);
  }

  async usage(installId: string, defaultLimit: number = this.d.config.dailyLimit): Promise<Usage> {
    const h = this.d.hash(installId);
    return this.usageFrom(await this.limitFor(h, defaultLimit), await this.checksToday(h), h, this.d.now());
  }

  private async checksToday(h: string): Promise<number> {
    const r = await this.d.db.execute(`SELECT checks FROM usage WHERE install_hash = ? AND day = ?`, [h, dayKey(this.d.now())]);
    return num(r.rows[0]?.checks);
  }

  private async limitFor(h: string, defaultLimit: number): Promise<number> {
    const r = await this.d.db.execute(`SELECT daily_limit FROM installs WHERE install_hash = ?`, [h]);
    return r.rows[0]?.daily_limit == null ? defaultLimit : num(r.rows[0].daily_limit);
  }

  private usageFrom(limit: number, used: number, hash: string, t: number): Usage {
    return { used, limit, remaining: Math.max(0, limit - used), resetsAt: nextResetIso(t), device: deviceId(hash) };
  }
}
