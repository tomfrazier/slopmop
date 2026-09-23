import { HOUR_MS, IP_USAGE_KEEP_HOURS } from "../constants.js";
import { hourKey, num, type RepoDeps } from "./shared.js";

/**
 * A second, independent ceiling on /judge: this many checks per source IP per UTC hour. The install id in the cap
 * (CapRepo) costs a script nothing to change; an IP is at least somewhat harder to rotate. `ipHash` is already a salted
 * hash (Store.hashInstall("ip:" + address)) — this repo never sees or stores a raw address.
 */
export class IpCapRepo {
  constructor(private readonly d: RepoDeps) {}

  /**
   * Same atomic-upsert shape as CapRepo.consume: the increment only happens while under the limit, so concurrent requests can't
   * overshoot it. `installId`, when given, lets that install's own hourly limit (installs.hourly_limit) replace `limit`.
   */
  async consume(ipHash: string, limit: number, installId?: string): Promise<{ ok: boolean; count: number }> {
    const t = this.d.now();
    const hour = hourKey(t);
    const r = await this.d.db.execute(
      `INSERT INTO ip_usage (ip_hash, hour, checks) VALUES (?, ?, 1)
       ON CONFLICT(ip_hash, hour) DO UPDATE SET checks = checks + 1 WHERE checks < COALESCE((SELECT hourly_limit FROM installs WHERE install_hash = ?), ?)
       RETURNING checks`,
      [ipHash, hour, installId ? this.d.hash(installId) : null, limit],
    );
    if (!r.rows.length) return { ok: false, count: limit };
    const count = num(r.rows[0].checks);
    if (count === 1 && Math.random() < 0.1) await this.d.db.execute(`DELETE FROM ip_usage WHERE hour < ?`, [hourKey(t - IP_USAGE_KEEP_HOURS * HOUR_MS)]);
    return { ok: true, count };
  }

  /** Gives a check back (the request was refused for some other reason, or failed on our side). */
  async refund(ipHash: string): Promise<void> {
    await this.d.db.execute(`UPDATE ip_usage SET checks = checks - 1 WHERE ip_hash = ? AND hour = ? AND checks > 0`, [ipHash, hourKey(this.d.now())]);
  }
}
