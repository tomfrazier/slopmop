/**
 * The 0-100 number people see. The raw score is small (a post flagged as likely slop at Moderate scores about 0.18, which reads like
 * "82% fine"), so it is stretched for display only, so the zone lines sit at readable numbers: "possibly slop" starts at
 * `possibly` and the Moderate "likely slop" line is `likely` (both set in the client manifest). Nothing is decided from it.
 * The extension has the same function (src/shared/display.ts); a test in the extension checks the two agree.
 */
export interface DisplayAnchors {
  /** The Moderate threshold, which the scale is anchored to. */
  moderate: number;
  yellowFraction: number;
  possibly: number;
  likely: number;
  fullMultiple: number;
}

export function displayScore(raw: number, a: DisplayAnchors): number {
  const sane = a.possibly < a.likely && a.likely < 100 && a.yellowFraction < 1 && a.fullMultiple > 1;
  const stops: [number, number][] = sane
    ? [[0, 0], [a.yellowFraction * a.moderate, a.possibly], [a.moderate, a.likely], [a.fullMultiple * a.moderate, 100]]
    : [[0, 0], [0.6 * a.moderate, 40], [a.moderate, 70], [2 * a.moderate, 100]];
  const x = Math.min(Math.max(raw, 0), stops[3][0]);
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 100;
}
