import type { Row } from "../db/types.js";
import { DAY_MS } from "../constants.js";
import { percentile } from "./health.js";
import { DAYS_PER_MONTH, num, PROJECTION_DAYS, round, type Scope } from "./scope.js";

/** The headline figures: volume, cache hits, errors, spend and latency. */
export async function summarize(s: Scope, totals: Row | undefined, latencies: number[]) {
  const scored = num(totals?.scored);
  const cached = num(totals?.cached);
  const errors = num(totals?.errors);
  const active = num(totals?.active);
  const checks = scored + cached;
  const costUsd = s.cost(num(totals?.tin), num(totals?.tout));

  const [recent] = await s.q(`SELECT SUM(input_tokens) tin, SUM(output_tokens) tout FROM events WHERE at >= ?${s.netSql()}`, [s.now - PROJECTION_DAYS * DAY_MS, ...s.netArgs()]);
  const recentCostPerDay = s.cost(num(recent?.tin), num(recent?.tout)) / PROJECTION_DAYS;

  return {
    checks,
    jevCalls: scored,
    cacheHitPct: checks ? round(cached / checks, 4) : null,
    errors,
    errorPct: checks + errors ? round(errors / (checks + errors), 4) : null,
    limitHits: num(totals?.limited),
    rateLimited: num(totals?.rate_limited),
    blocked: num(totals?.blocked),
    hedged: num(totals?.hedged),
    inputTokens: num(totals?.tin),
    outputTokens: num(totals?.tout),
    costUsd: round(costUsd, 6),
    costPerCheckUsd: checks ? round(costUsd / checks, 8) : null,
    costPerDayUsd: round(costUsd / (s.span / DAY_MS), 6),
    projectedMonthUsd: round(recentCostPerDay * DAYS_PER_MONTH, 4),
    activeInstallsInRange: active,
    avgChecksPerActiveInstall: active ? round(checks / active, 2) : null,
    latencyMs: { avg: totals?.lat_avg == null ? null : Math.round(num(totals.lat_avg)), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: totals?.lat_max == null ? null : num(totals.lat_max) },
  };
}
