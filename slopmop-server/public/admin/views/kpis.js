import { el } from "../dom.js";
import { clock, fmt, rangeLabel } from "../format.js";
import { refusalName } from "./problems.js";
import { kpi } from "../widgets.js";

/** Share of posts seen that Jev thinks are AI-written, weighted by how many posts each network saw. */
function aiLikelyShare(networks) {
  const scored = networks.filter((r) => r.aiLikelyPct != null);
  if (!scored.length) return null;
  const seen = networks.reduce((n, r) => n + r.postsSeen, 0);
  return networks.reduce((n, r) => n + (r.aiLikelyPct ?? 0) * r.postsSeen, 0) / Math.max(1, seen);
}

/** The other refusals, by name, leaving out any that didn't happen. */
const otherRefusals = (S) =>
  [["datacenter_ip", S.datacenterRefused], ["ip_rate_limit", S.ipLimited], ["rate_limit", S.rateLimited], ["disabled", S.blocked]]
    .filter(([, n]) => n)
    .map(([k, n]) => `${fmt.n(n)} ${refusalName(k)}`)
    .join(" · ");

/**
 * The headline cards. Each says what period it covers: the range picked at the top (`range`), or a fixed one (today, 30 days,
 * all time) for the few that don't follow it.
 */
export function kpiRow(d) {
  const S = d.summary;
  const I = d.installs;
  const C = d.community;
  const range = d.range;
  const seen = d.networks.reduce((n, r) => n + r.postsSeen, 0);
  const allTime = d.networks.reduce((n, r) => n + r.postsTotal, 0);
  const others = otherRefusals(S);
  return el(
    "div",
    { class: "grid kpis" },
    kpi("Posts seen", fmt.n(seen), `${fmt.n(allTime)} unique posts all time`, "", range),
    kpi("Checks", fmt.n(S.checks), `${fmt.n(S.jevCalls)} Jev calls · ${fmt.pct(S.cacheHitPct, 0)} from cache`, "", range),
    kpi("AI-likely posts", fmt.pct(aiLikelyShare(d.networks), 0), "Jev's AI-likelihood ≥ 50%", "", range),
    kpi("Installs", fmt.n(I.total), `${fmt.n(I.active24h)} active 24h · ${fmt.n(I.active7d)} 7d · ${fmt.n(I.active30d)} 30d`, "", "all time"),
    kpi("DAU", fmt.n(I.dau), `since ${clock(I.dayStart)} · yesterday ${fmt.n(I.dauYesterday)} · 30-day avg ${I.avgDau30.toFixed(1)}`, "", "today"),
    kpi("MAU", fmt.n(I.mau), `installs that checked something in the last 30 days${I.stickinessPct == null ? "" : ` · stickiness ${Math.round(I.stickinessPct)}%`}`, "", "30 days"),
    kpi("New installs", fmt.n(I.newInRange), "devices first seen", "", range),
    kpi("Jev cost", fmt.usd(S.costUsd), `${fmt.usd(S.costPerDayUsd)}/day · ~${fmt.usd(S.projectedMonthUsd)}/mo at the last-7-day pace`, "", range),
    kpi("Cost per 1,000 checks", S.costPerCheckUsd == null ? "-" : fmt.usd(S.costPerCheckUsd * 1000), `${fmt.compact(S.inputTokens)} input tokens`, "", range),
    kpi("Community flags", fmt.n(C.probably), `${fmt.n(C.votesTotal)} votes from ${fmt.n(C.voters)} people`, "", "all time"),
    kpi("Errors", fmt.n(S.errors), `failed checks${S.errorPct == null ? "" : ` · ${fmt.pct(S.errorPct, 1)} of requests`}`, S.errors ? "warn" : "", range),
    kpi(
      "Daily-limit hits",
      fmt.n(S.limitHits),
      `requests refused because the device had used its ${fmt.n(d.limits.dailyLimit)} checks for the day (resets ${clock(I.limitResetsAt)}) · ${fmt.n(I.todayAtCap)} device(s) at the cap now${others ? ` · also refused: ${others}` : ""}`,
      I.todayAtCap ? "warn" : "",
      range,
    ),
    kpi("Latency (Jev call)", fmt.ms(S.latencyMs.p50), `p95 ${fmt.ms(S.latencyMs.p95)} · max ${fmt.ms(S.latencyMs.max)} · ${fmt.n(S.hedged)} hedged`, "", range),
    kpi("Checks per active install", S.avgChecksPerActiveInstall == null ? "-" : S.avgChecksPerActiveInstall.toFixed(1), `${fmt.n(S.activeInstallsInRange)} active installs`, "", range),
  );
}
