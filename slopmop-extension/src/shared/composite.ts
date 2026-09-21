import type { Level, JudgeResponse, Mode, TellRow } from "./types";
import type { DecideOpts } from "./decideOptions";
import type { Params } from "./decideParams";

/** The tells that count, their weighted mean, and each one's row for the explanation. */
interface Composite {
  mean: number;
  meanConfidence: number;
  tells: TellRow[];
}

/**
 * The weighted mean of the tell answers. The server's composite wins unless the caller supplied weights to try (offline
 * tuning), in which case it is computed here. Null when there is nothing to weigh.
 */
export function composite(r: JudgeResponse, P: Params, opts: DecideOpts): Composite | null {
  const server = opts.params?.weights === undefined && r.tellMean !== undefined && Array.isArray(r.tellRank) ? { mean: r.tellMean, rank: r.tellRank } : null;
  const ids = (server ? server.rank : Object.keys(P.weights)).filter((id) => r.dimensions[id]);
  if (ids.length === 0) return null;

  // Each tell counts in proportion to how sure Jev was of it (the server does the same).
  const weightOf = (id: string) => P.weights[id] * Math.max(0, r.dimensions[id].confidence) ** CONFIDENCE_POWER;
  const totalWeight = server ? 0 : ids.reduce((sum, id) => sum + weightOf(id), 0);
  const mean = server ? server.mean : totalWeight > 0 ? ids.reduce((sum, id) => sum + weightOf(id) * r.dimensions[id].value, 0) / totalWeight : 0;
  const tells: TellRow[] = ids.map((id) => ({
    id,
    value: r.dimensions[id].value,
    confidence: r.dimensions[id].confidence,
    ...(server ? {} : { weight: weightOf(id), contrib: totalWeight > 0 ? (weightOf(id) * r.dimensions[id].value) / totalWeight : 0 }),
  }));
  if (!server) tells.sort((a, b) => (b.contrib ?? 0) - (a.contrib ?? 0)); // with a server rank the order is already by contribution
  return { mean, meanConfidence: ids.reduce((sum, id) => sum + r.dimensions[id].confidence, 0) / ids.length, tells };
}

/** How much Jev's confidence counts toward a tell's weight: weight x confidence^0.5 (the server does the same). */
const CONFIDENCE_POWER = 0.5;

/** How many tells stand out: they reach the breakout value with enough confidence behind them. */
export const breakouts = (tells: TellRow[], c: { breakout: number; minConfidence: number }): number => tells.filter((t) => t.value >= c.breakout && t.confidence >= c.minConfidence).length;

/** True when some tell stands out but too few to corroborate each other (none standing out is broad and mild, and is left as it is). */
export const isAlone = (standing: number, c: { needed: number }): boolean => standing > 0 && standing < c.needed;

/** Where the score lands: nothing, "possibly" (yellow) or "likely" (red), and a plain-language sentence saying why. */
export function classify(input: { score: number; lowConfidence: boolean; threshold: number; yellowAt: number; mode: Mode }): { level: Level; outcome: string } {
  const { score, lowConfidence, threshold, yellowAt, mode } = input;
  if (lowConfidence) return { level: "none", outcome: "Jev wasn't confident enough to call this one, so it isn't flagged." };
  if (score >= threshold) return { level: "red", outcome: mode === "hide" ? "This reads like AI slop, so it was hidden." : "This reads like AI slop." };
  if (score >= yellowAt) return { level: "yellow", outcome: "This has some hallmarks of AI slop, but isn't clear-cut." };
  return { level: "none", outcome: "Nothing here stands out as AI slop." };
}
