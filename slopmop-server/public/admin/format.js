import { prefs } from "./api.js";
import { LABELS } from "./labels.js";
// Number, money, time and label formatting. Times show in the chosen timezone (Pacific by default, or UTC).
const nf = new Intl.NumberFormat("en-US");

export const TIMEZONES = [["America/Los_Angeles", "Pacific"], ["UTC", "UTC"]];
const zone = () => (prefs.tz === "UTC" ? "UTC" : "America/Los_Angeles");
const partsOf = (t, opts) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone(), hourCycle: "h23", ...opts }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
const DATE_TIME = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" };
/** The zone's short name at an instant: "PDT" or "PST" for Pacific (it follows daylight saving), or "UTC". */
export const tzName = (t = Date.now()) => (zone() === "UTC" ? "UTC" : partsOf(t, { timeZoneName: "short" }).timeZoneName);
/** The hour of day (0-23) in the zone at the moment a UTC hour of today starts, for relabelling the hour-of-day chart. */
export const localHour = (utcHour) => {
  const t = new Date();
  t.setUTCHours(utcHour, 0, 0, 0);
  return Number(partsOf(t, { hour: "2-digit" }).hour) % 24;
};
/** A clock time in the zone, like "5:00 PM PDT", for a moment given in UTC. */
export const clock = (t) => new Intl.DateTimeFormat("en-US", { timeZone: zone(), hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(t));
export const fmt = {
  n: (v) => (v == null ? "-" : nf.format(Math.round(v))),
  compact: (v) => (v == null ? "-" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)),
  pct: (v, d = 1) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`),
  usd: (v) => {
    if (v == null) return "-";
    if (v === 0) return "$0.00";
    const a = Math.abs(v);
    return "$" + (a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toFixed(5));
  },
  ms: (v) => (v == null ? "-" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`),
  time: (t) => {
    if (t == null) return "-";
    const p = partsOf(t, DATE_TIME);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${tzName(t)}`;
  },
  ago: (t) => {
    if (t == null) return "-";
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  },
  /** A day label for an instant (the date where it falls in the zone). */
  day: (t) => {
    const p = partsOf(t, DATE_TIME);
    return `${p.month}-${p.day}`;
  },
  /** The UTC calendar date of a daily bucket (the server counts days from UTC midnight). */
  utcDay: (t) => new Date(t).toISOString().slice(5, 10),
  hour: (t) => {
    const p = partsOf(t, DATE_TIME);
    return `${p.month}-${p.day} ${p.hour}:00`;
  },
  hourOf: (t) => Number(partsOf(t, { hour: "2-digit" }).hour) % 24,
  /** The name people see for a tell or counter-tell (as on the extension's spider chart), else the id split into words. */
  human: (id) => LABELS[id] ?? id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
};

const RANGE_LABELS = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };
/** "last 7 days" for the range key the server used. */
export const rangeLabel = (range) => RANGE_LABELS[range];
