import { DAY_MS, EVENT_PRUNE_CHANCE } from "../constants.js";
import type { RepoDeps } from "./shared.js";
import type { CheckEvent } from "./types.js";

/** The activity log behind the admin dashboard, and each install's lifetime row. */
export class EventRepo {
  constructor(private readonly d: RepoDeps) {}

  /**
   * Logs one /judge outcome and updates the install's lifetime row. Best effort: a failure here must never fail the
   * user's request, so it is swallowed (class name logged only).
   */
  async record(e: CheckEvent): Promise<void> {
    const t = this.d.now();
    const h = this.d.hash(e.installId);
    const counted = e.kind === "scored" || e.kind === "cached";
    try {
      await this.d.db.batch([
        {
          sql: `INSERT INTO events (at, network, install_hash, content_id, kind, input_tokens, output_tokens, latency_ms, ai_likelihood, detail) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [t, e.network, h, e.contentId ?? null, e.kind, e.inputTokens ?? 0, e.outputTokens ?? 0, e.latencyMs ?? null, e.aiLikelihood ?? null, e.detail ?? null],
        },
        {
          sql: `INSERT INTO installs (install_hash, first_seen, last_seen, checks, limit_hits) VALUES (?,?,?,?,?)
                ON CONFLICT(install_hash) DO UPDATE SET last_seen = excluded.last_seen, checks = checks + excluded.checks, limit_hits = limit_hits + excluded.limit_hits`,
          args: [h, t, t, counted ? 1 : 0, e.kind === "limited" ? 1 : 0],
        },
      ]);
      if (Math.random() < EVENT_PRUNE_CHANCE) await this.d.db.execute(`DELETE FROM events WHERE at < ?`, [t - this.d.config.eventRetentionDays * DAY_MS]);
    } catch (err) {
      console.error("[slopmop] could not record event", err instanceof Error ? err.name : String(err));
    }
  }
}
