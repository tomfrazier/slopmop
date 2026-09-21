// The weights editor's state (kept outside the rendered DOM so the once-a-minute refresh never throws away an edit in progress),
// and the calls that load and save it.
import { api } from "./api.js";
import { hooks } from "./hooks.js";

export const W = { data: null, draft: null, dirty: false, suggestion: null, note: "", minVotes: 2 };


export async function loadWeights(suggest = false) {
  const d = await api("/weights", suggest ? { suggest: "1", minVotes: String(W.minVotes) } : {});
  W.data = d;
  if (!W.dirty) W.draft = { ...d.effective.weights };
  if (suggest) W.suggestion = d.suggestion;
}

export async function saveWeights(body) {
  try {
    await api("/weights", {}, false, body);
    Object.assign(W, { dirty: false, note: "", suggestion: null, draft: null });
    await hooks.refresh();
  } catch (e) {
    alert(e.message);
  }
}

/** Puts weights in the editor without saving them. */
export function loadIntoEditor(weights, refetch = true) {
  W.draft = { ...W.data.defaults, ...weights };
  W.dirty = true;
  return hooks.refresh(refetch);
}
