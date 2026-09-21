import { PALETTE } from "../shared/palette";
import { h } from "../shared/dom";
import type { VerdictTone } from "../shared/verdict";
import { TELL_AXES, TELL_LABELS } from "./labels";

const NAMES: Record<string, string> = {
  ...TELL_LABELS,
  humanVoice: "personal, human voice",
  usefulness: "useful to a reader",
};
export const nameOf = (id: string) => NAMES[id] ?? id;
export const f2 = (n: number) => n.toFixed(2);
export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const TONE_COLOR: Record<VerdictTone, string> = { green: PALETTE.blue500, yellow: PALETTE.mop900, red: PALETTE.red500, grey: PALETTE.ink600 };

export function bar(value: number, color: string) {
  return h("div", { class: "bar" }, h("i", { style: `width:${Math.round(value * 100)}%;background:${color}` }));
}

export const tellLabel = (id: string) => TELL_AXES.find((a) => a.id === id)?.label ?? nameOf(id);
