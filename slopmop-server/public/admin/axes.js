import { fmt, tzName } from "./format.js";

// ---- axes ----
/** What the Activity charts can count by, as the server names them. */
export const UNIT_LABELS = { hour: "Hour", day: "Day", week: "Week", month: "Month" };

/**
 * How time-series buckets are labelled. The server cuts days, weeks (from Monday) and months at midnight in the chosen timezone,
 * so every label is read in that zone. The first bucket starts where the range does, so it can be a partial one; the last runs
 * to now. Tooltips say exactly what each bar covers.
 */
export function seriesAxis(d) {
  const unit = d.unit;
  const last = d.series.length - 1;
  const upTo = (b) => Math.min(b.end, d.generatedAt) - 1;
  const partial = (b, i) => (i === 0 && d.series.length > 1 ? ` (from ${fmt.time(b.t)})` : i === last ? " (so far)" : "");
  const x = {
    hour: (b) => (fmt.hourOf(b.t) === 0 ? fmt.day(b.t) : String(fmt.hourOf(b.t)).padStart(2, "0")),
    day: (b) => fmt.date(b.t),
    week: (b) => fmt.date(b.t),
    month: (b) => fmt.month(b.t),
  }[unit];
  const tip = {
    hour: (b) => `${fmt.hour(b.t)} ${tzName(b.t)}`,
    day: (b, i) => `${fmt.longDate(b.t)}${partial(b, i)}`,
    week: (b, i) => `${fmt.date(b.t)} – ${fmt.date(upTo(b))}${partial(b, i)}`,
    month: (b, i) => `${fmt.month(b.t, true)}${partial(b, i)}`,
  }[unit];
  return { unit, hourly: unit === "hour", x, tipTitle: (b) => tip(b, d.series.indexOf(b)) };
}

/** A whole-number axis maximum, so the four gridlines never land on 2.5 of something. */
export function niceInt(max) {
  const raw = Math.max(1, max) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p) * 4;
}
/** A round axis maximum for money and other fractional values. */
export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
