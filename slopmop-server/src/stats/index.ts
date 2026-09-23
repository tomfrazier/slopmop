import type { Store } from "../store.js";
import { eventTotals, hourOfDay, timeSeries } from "./activity.js";
import { communityStats, votedPostLists } from "./community.js";
import { aiHistogram, networkTable, tellAverages } from "./content.js";
import { latencySamples, recentProblems, storageSizes } from "./health.js";
import { deviceTable, installStats } from "./installs.js";
import { makeScope, type RangeKey } from "./scope.js";
import { summarize } from "./summary.js";

export { RANGES, type RangeKey } from "./scope.js";
export type { Bucket } from "./activity.js";

/**
 * Everything the admin dashboard shows, computed in SQL from the registry (content, votes, installs) and the activity
 * log (events). All times are UTC epoch milliseconds. No post text and no raw install ids ever appear here: devices are
 * shown by a short prefix of their salted hash. Each section lives in its own module; this only puts them together.
 */
export async function computeStats(store: Store, opts: { range: RangeKey; network?: string | null; limits?: import("../limitsStore.js").Limits }) {
  const s = makeScope(store, opts);
  const { config } = store;

  const [totals, series, hours, installs, devices, networks, histogram, tells, community, posts, latencies, problems, storage, disabledClients] = await Promise.all([
    eventTotals(s),
    timeSeries(s),
    hourOfDay(s),
    installStats(s),
    deviceTable(s),
    networkTable(s),
    aiHistogram(s),
    tellAverages(s),
    communityStats(s),
    votedPostLists(s),
    latencySamples(s),
    recentProblems(s),
    storageSizes(s),
    store.clients.listDisabled(),
  ]);

  return {
    generatedAt: s.now,
    range: opts.range,
    since: s.since,
    bucketMs: s.size,
    network: s.net,
    pricing: { inputUsdPerM: config.inputUsdPerM, outputUsdPerM: config.outputUsdPerM },
    limits: { dailyLimit: s.limits.dailyLimit, ipHourlyLimit: s.limits.ipHourlyLimit, storesText: config.storeText, eventRetentionDays: config.eventRetentionDays },
    summary: await summarize(s, totals, latencies),
    installs,
    community,
    series,
    hourOfDay: hours,
    networks,
    aiHistogram: histogram,
    tells,
    devices,
    disabledClients,
    posts,
    problems,
    latency: { samples: latencies.length },
    storage,
  };
}
