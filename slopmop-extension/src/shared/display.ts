import { DEFAULT_PARAMS } from "./decideParams";
import { live } from "./manifest";

/**
 * The 0-100 number people see. The raw score is small (a post flagged as likely slop at Moderate scores about 0.22, which
 * reads like "78% fine"), so it is stretched, for display only, so the thresholds sit at readable numbers: "possibly slop"
 * starts at 40 and the Moderate "likely slop" line is 70 (both set by the manifest). Nothing is decided from this number:
 * verdicts, hiding and outlines all come from the raw score and the sensitivity's threshold, so changing sensitivity moves
 * where the cutoff falls and never the number a post shows.
 */
export function displayScore(raw: number): number {
  const v = live.values;
  const moderate = live.thresholds?.moderate ?? DEFAULT_PARAMS.thresholds.moderate;
  const sane = v.displayPossibly < v.displayLikely && v.displayLikely < 100 && v.yellowFraction < 1 && v.displayFullMultiple > 1;
  // [raw score, shown score]: 0, where "possibly" starts, the Moderate threshold, and where the scale tops out.
  const stops: [number, number][] = sane
    ? [[0, 0], [v.yellowFraction * moderate, v.displayPossibly], [moderate, v.displayLikely], [v.displayFullMultiple * moderate, 100]]
    : [[0, 0], [0.6 * moderate, 40], [moderate, 70], [2 * moderate, 100]];
  const x = Math.min(Math.max(raw, 0), stops[3][0]);
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 100;
}

/**
 * Where the zone lines fall on the shown 0-100 scale for one person: "possibly slop" starts at the sensitivity's yellow line and
 * "likely slop" at its threshold. The menu meter and the Details bar both draw from this, so they can never disagree with
 * each other or with the verdict. With no decision to go on (nothing scored yet), the Moderate defaults from the manifest.
 */
export interface Zones {
  possibly: number;
  likely: number;
}
export function displayZones(explain: { yellowAt: number; threshold: number } | null | undefined): Zones {
  if (!explain) return { possibly: live.values.displayPossibly, likely: live.values.displayLikely };
  return { possibly: Math.min(100, displayScore(explain.yellowAt)), likely: Math.min(100, displayScore(explain.threshold)) };
}
