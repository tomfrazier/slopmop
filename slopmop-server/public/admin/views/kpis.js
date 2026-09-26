import { el } from "../dom.js";
import { fmt, rangeLabel } from "../format.js";
import { kpi } from "../widgets.js";

/** Share of posts seen that Jev thinks are AI-written, weighted by how many posts each network saw. */
function aiLikelyShare(networks) {
  const scored = networks.filter((r) => r.aiLikelyPct != null);
  if (!scored.length) return null;
  const seen = networks.reduce((n, r) => n + r.postsSeen, 0);
  return networks.reduce((n, r) => n + (r.aiLikelyPct ?? 0) * r.postsSeen, 0) / Math.max(1, seen);
}

/** The headline cards. */
export function kpiRow(d) {
  const S = d.summary;
  const I = d.installs;
  const C = d.community;
  const seen = d.networks.reduce((n, r) => n + r.postsSeen, 0);
  const allTime = d.networks.reduce((n, r) => n + r.postsTotal, 0);
  return el(
    "div",
    { class: "grid kpis" },
    kpi("Posts seen", fmt.n(seen), `${fmt.n(allTime)} unique posts all time`),
    kpi("Checks", fmt.n(S.checks), `${fmt.n(S.jevCalls)} Jev calls · ${fmt.pct(S.cacheHitPct, 0)} from cache`),
    kpi("AI-likely posts", fmt.pct(aiLikelyShare(d.networks), 0), "Jev's AI-likelihood ≥ 50%"),
    kpi("Installs", fmt.n(I.total), `${fmt.n(I.active24h)} active 24h · ${fmt.n(I.active7d)} 7d · ${fmt.n(I.active30d)} 30d`),
    kpi("DAU", fmt.n(I.dau), `today so far (UTC) · yesterday ${fmt.n(I.dauYesterday)} · 30-day avg ${I.avgDau30.toFixed(1)}`),
    kpi("MAU", fmt.n(I.mau), `installs active in the last 30 days${I.stickinessPct == null ? "" : ` · stickiness ${fmt.pct(I.stickinessPct, 0)}`}`),
    kpi("New installs", fmt.n(I.newInRange), rangeLabel(d.range)),
    kpi("Jev cost", fmt.usd(S.costUsd), `${fmt.usd(S.costPerDayUsd)}/day · ~${fmt.usd(S.projectedMonthUsd)}/mo at the last-7-day pace`),
    kpi("Cost per 1,000 checks", S.costPerCheckUsd == null ? "-" : fmt.usd(S.costPerCheckUsd * 1000), `${fmt.compact(S.inputTokens)} input tokens`),
    kpi("Community flags", fmt.n(C.probably), `${fmt.n(C.votesTotal)} votes from ${fmt.n(C.voters)} people`),
    kpi("Errors", fmt.n(S.errors), S.errorPct == null ? "" : `${fmt.pct(S.errorPct, 1)} of requests`, S.errors ? "warn" : ""),
    kpi("Daily-limit hits", fmt.n(S.limitHits), `${I.todayAtCap} device(s) at the cap today · ${fmt.n(S.rateLimited)} rate-limited · ${fmt.n(S.blocked)} blocked`, I.todayAtCap ? "warn" : ""),
    kpi("Latency (Jev call)", fmt.ms(S.latencyMs.p50), `p95 ${fmt.ms(S.latencyMs.p95)} · max ${fmt.ms(S.latencyMs.max)} · ${fmt.n(S.hedged)} hedged`),
    kpi("Checks per active install", S.avgChecksPerActiveInstall == null ? "-" : S.avgChecksPerActiveInstall.toFixed(1), `${fmt.n(S.activeInstallsInRange)} active installs in range`),
  );
}
