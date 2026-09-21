import { fmt } from "./format.js";

// ---- axes ----
const DAY_MS = 86_400_000;

/** How time-series buckets are labelled: hourly charts label hours (and the day at midnight), daily charts label days. */
export function seriesAxis(d) {
  const hourly = d.bucketMs < DAY_MS;
  const hourOf = (t) => new Date(t).getUTCHours();
  return {
    hourly,
    x: (b) => (hourly ? (hourOf(b.t) === 0 ? fmt.day(b.t) : String(hourOf(b.t)).padStart(2, "0")) : fmt.day(b.t)),
    tipTitle: (b) => (hourly ? fmt.hour(b.t) : new Date(b.t).toISOString().slice(0, 10)) + " UTC",
  };
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
