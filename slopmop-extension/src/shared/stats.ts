/** Per-day hide counters, deduped by post URN. Pure functions; storage lives in the background worker. */

export interface StatsData {
  /** {YYYY-MM-DD: count} of posts hidden (hide mode). */
  hidden: Record<string, number>;
  /** {YYYY-MM-DD: count} of posts flagged (highlight mode). */
  flagged: Record<string, number>;
  /** URNs already counted, so scroll-back and reloads don't double count. */
  seen: Record<string, string>;
}

export const emptyStats = (): StatsData => ({ hidden: {}, flagged: {}, seen: {} });

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Returns a new StatsData; unchanged if the urn was already counted for this kind. */
export function record(data: StatsData, kind: "hidden" | "flagged", urn: string, now: Date): StatsData {
  const seenKey = `${kind}:${urn}`;
  if (data.seen[seenKey]) return data;
  const key = dayKey(now);
  return {
    ...data,
    [kind]: { ...data[kind], [key]: (data[kind][key] ?? 0) + 1 },
    seen: { ...data.seen, [seenKey]: key },
  };
}

export interface Summary {
  today: number;
  week: number;
  month: number;
  total: number;
  /** Highest single-day count ever (including today). */
  record: number;
  /** 0-1 position of today's count on the dial (today / record). */
  dial: number;
  isNewRecord: boolean;
}

export function summarize(counts: Record<string, number>, now: Date): Summary {
  const todayKey = dayKey(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6); // rolling 7 days
  const monthKey = todayKey.slice(0, 7);
  let today = 0, week = 0, month = 0, total = 0, best = 0, bestBeforeToday = 0;

  for (const [key, n] of Object.entries(counts)) {
    total += n;
    best = Math.max(best, n);
    if (key === todayKey) today += n;
    else bestBeforeToday = Math.max(bestBeforeToday, n);
    if (key.startsWith(monthKey)) month += n;
    const [y, m, d] = key.split("-").map(Number);
    if (new Date(y, m - 1, d) >= weekStart && key <= todayKey) week += n;
  }
  const dial = best === 0 ? 0 : today / best;
  return { today, week, month, total, record: best, dial, isNewRecord: today > 0 && today >= best && today > bestBeforeToday };
}
