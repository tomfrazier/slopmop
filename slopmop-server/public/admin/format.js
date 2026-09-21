import { LABELS } from "./labels.js";
// Number, money, time and label formatting. All times are UTC.
const nf = new Intl.NumberFormat("en-US");
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
  time: (t) => (t == null ? "-" : new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z"),
  ago: (t) => {
    if (t == null) return "-";
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  },
  day: (t) => new Date(t).toISOString().slice(5, 10),
  hour: (t) => new Date(t).toISOString().slice(5, 13).replace("T", " ") + ":00",
  /** The name people see for a tell or counter-tell (as on the extension's spider chart), else the id split into words. */
  human: (id) => LABELS[id] ?? id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
};

const RANGE_LABELS = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };
/** "last 7 days" for the range key the server used. */
export const rangeLabel = (range) => RANGE_LABELS[range];
