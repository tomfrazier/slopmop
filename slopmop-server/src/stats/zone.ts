import { HOUR_MS } from "../constants.js";

/**
 * Calendar arithmetic in the admin's chosen timezone, so the dashboard's days, weeks and months start at their midnight rather
 * than UTC's. Only zones with whole-hour offsets are offered, so an hour bucket is the same instant range in every zone.
 */
export const ZONES = ["UTC", "America/Los_Angeles"] as const;
export type Zone = (typeof ZONES)[number];

export const UNITS = ["hour", "day", "week", "month"] as const;
export type Unit = (typeof UNITS)[number];

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** 0 = Monday ... 6 = Sunday. */
  dow: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatters = new Map<Zone, Intl.DateTimeFormat>();
const formatter = (tz: Zone) => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formatters.set(tz, f);
  }
  return f;
};

/** The wall-clock date and time at instant `t` in `tz`. */
export function partsIn(t: number, tz: Zone): Parts {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), dow: WEEKDAYS.indexOf(p.weekday) };
}

/** How far `tz` is ahead of UTC at instant `t`, in ms (negative west of Greenwich). */
export function offsetAt(t: number, tz: Zone): number {
  const p = partsIn(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - (t - (((t % 60_000) + 60_000) % 60_000));
}

/** The instant a wall-clock time in `tz` happens. Days and months may overflow (day 0, month 13) as with Date.UTC. */
export function zoned(y: number, m: number, d: number, h: number, tz: Zone): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz); // right across a daylight-saving change
  return second;
}

/** The start of the hour, day, week (Monday) or month that contains `t`, in `tz`. */
export function startOf(t: number, unit: Unit, tz: Zone): number {
  if (unit === "hour") return Math.floor(t / HOUR_MS) * HOUR_MS;
  const p = partsIn(t, tz);
  if (unit === "day") return zoned(p.y, p.m, p.d, 0, tz);
  if (unit === "week") return zoned(p.y, p.m, p.d - p.dow, 0, tz);
  return zoned(p.y, p.m, 1, 0, tz);
}

/** The start of the unit after the one starting at `start`. */
export function nextStart(start: number, unit: Unit, tz: Zone): number {
  if (unit === "hour") return start + HOUR_MS;
  const p = partsIn(start, tz);
  if (unit === "day") return zoned(p.y, p.m, p.d + 1, 0, tz);
  if (unit === "week") return zoned(p.y, p.m, p.d + 7, 0, tz);
  return zoned(p.y, p.m + 1, 1, 0, tz);
}

/** "2026-09-19": the calendar date of `t` in `tz`. */
export function dayKeyIn(t: number, tz: Zone): string {
  const p = partsIn(t, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Consecutive [t, end) buckets covering `since` to `now`: the first starts at `since`, the rest on `unit` boundaries in `tz`. */
export function buckets(since: number, now: number, unit: Unit, tz: Zone): { t: number; end: number }[] {
  const out: { t: number; end: number }[] = [];
  let t = since;
  let next = nextStart(startOf(since, unit, tz), unit, tz);
  while (t <= now) {
    out.push({ t, end: next });
    t = next;
    next = nextStart(next, unit, tz);
  }
  return out;
}

/** A SQL common table expression `b(t, e)` of the bucket bounds, for joining rows to the bucket they fall in. */
export const bucketCte = (bs: { t: number; end: number }[]) => `WITH b(t, e) AS (VALUES ${bs.map((x) => `(${Math.trunc(x.t)}, ${Math.trunc(x.end)})`).join(", ")})`;
