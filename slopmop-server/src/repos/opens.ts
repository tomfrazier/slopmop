import { DAY_MS, EVENT_PRUNE_CHANCE, MINUTE_MS } from "../constants.js";
import { num, type RepoDeps } from "./shared.js";

/** How the post looked to the reader when they opened its panel: not flagged, possibly slop (yellow) or likely slop (red). */
export const OPEN_LEVELS = ["none", "yellow", "red"] as const;
export type OpenLevel = (typeof OPEN_LEVELS)[number];

/** More opens than this from one install in a minute are not recorded: no person opens panels that fast, so it's a script. */
export const OPENS_PER_MINUTE = 30;

/**
 * Each time someone opens the Slop Mop panel on a post, and whether that post was flagged. Only the network, the level and the
 * salted install hash are kept (no post, no text), and rows are pruned with the activity log.
 */
export class OpenRepo {
  constructor(private readonly d: RepoDeps) {}

  /** Records one open, unless this install is over the per-minute ceiling. Returns whether it was recorded. */
  async record(network: string, installId: string, level: OpenLevel): Promise<boolean> {
    const h = this.d.hash(installId);
    const t = this.d.now();
    const recent = await this.d.db.execute(`SELECT COUNT(*) n FROM panel_opens WHERE install_hash = ? AND at >= ?`, [h, t - MINUTE_MS]);
    if (num(recent.rows[0]?.n) >= OPENS_PER_MINUTE) return false;
    await this.d.db.execute(`INSERT INTO panel_opens (at, network, install_hash, level) VALUES (?, ?, ?, ?)`, [t, network, h, level]);
    if (Math.random() < EVENT_PRUNE_CHANCE) await this.d.db.execute(`DELETE FROM panel_opens WHERE at < ?`, [t - this.d.config.eventRetentionDays * DAY_MS]);
    return true;
  }
}
