import { DEVICE_ID_CHARS, DEVICE_PREFIX_MAX, DEVICE_PREFIX_MIN, DISABLED_LIST_LIMIT, MIN_RETRY_AFTER_MS } from "../constants.js";
import { num, type RepoDeps } from "./shared.js";
import type { DisabledClient } from "./types.js";

/** Per-install controls: the admin's kill switch and the requests-per-minute window. */
export class ClientRepo {
  constructor(private readonly d: RepoDeps) {}

  /** True when the admin has disabled this install. Unknown installs are enabled. */
  async isDisabled(installId: string): Promise<boolean> {
    const r = await this.d.db.execute(`SELECT disabled FROM installs WHERE install_hash = ?`, [this.d.hash(installId)]);
    return num(r.rows[0]?.disabled) === 1;
  }

  /** Requests this install has made in the last `windowMs`, and how long until the oldest one falls out of the window. */
  async recentRequests(installId: string, windowMs: number): Promise<{ n: number; freeInMs: number }> {
    const t = this.d.now();
    const r = await this.d.db.execute(`SELECT COUNT(*) n, MIN(at) oldest FROM events WHERE install_hash = ? AND at >= ? AND kind != 'limited'`, [this.d.hash(installId), t - windowMs]);
    const n = num(r.rows[0]?.n);
    return { n, freeInMs: n ? Math.max(MIN_RETRY_AFTER_MS, num(r.rows[0]?.oldest) + windowMs - t) : 0 };
  }

  /** Finds an install by the short device id the dashboard shows (a hash prefix). */
  async find(prefix: string): Promise<{ hash: string } | "ambiguous" | null> {
    if (!new RegExp(`^[0-9a-f]{${DEVICE_PREFIX_MIN},${DEVICE_PREFIX_MAX}}$`).test(prefix)) return null;
    const r = await this.d.db.execute(`SELECT install_hash FROM installs WHERE install_hash LIKE ? LIMIT 2`, [`${prefix}%`]);
    if (r.rows.length > 1) return "ambiguous";
    return r.rows[0] ? { hash: String(r.rows[0].install_hash) } : null;
  }

  async setDisabled(hash: string, disabled: boolean, reason: string | null): Promise<void> {
    await this.d.db.execute(`UPDATE installs SET disabled = ?, disabled_at = ?, disabled_reason = ? WHERE install_hash = ?`, [disabled ? 1 : 0, disabled ? this.d.now() : null, disabled ? reason : null, hash]);
  }

  async listDisabled(): Promise<DisabledClient[]> {
    const r = await this.d.db.execute(`SELECT install_hash, disabled_at, disabled_reason, checks, last_seen FROM installs WHERE disabled = 1 ORDER BY disabled_at DESC LIMIT ${DISABLED_LIST_LIMIT}`);
    return r.rows.map((row) => ({
      device: deviceId(String(row.install_hash)),
      disabledAt: row.disabled_at == null ? null : num(row.disabled_at),
      reason: (row.disabled_reason as string | null) ?? null,
      checks: num(row.checks),
      lastSeen: num(row.last_seen),
    }));
  }
}

/** The short id the dashboard shows for an install. */
export const deviceId = (installHash: string) => installHash.slice(0, DEVICE_ID_CHARS);
