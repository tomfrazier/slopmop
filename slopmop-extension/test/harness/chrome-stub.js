// Dev-only stand-in for the chrome.* APIs so the built content script and popup can run on a plain page.
(() => {
  const mk = (canned) => ({
    hi: { model: "stub", aiLikelihood: 0.97, dimensions: { contrastFraming: { value: 1, confidence: 0.9 }, emptyEvaluation: { value: 0.9, confidence: 0.9 }, tradeoffFreePromises: { value: 0.7, confidence: 0.9 }, formalHedging: { value: 0.6, confidence: 0.9 }, hypeMarketing: { value: 0.8, confidence: 0.9 }, manneredProse: { value: 0.7, confidence: 0.9 }, formulaicHook: { value: 1, confidence: 0.9 }, manufacturedNarrative: { value: 0.9, confidence: 0.9 }, engagementBait: { value: 0.9, confidence: 0.9 }, humanVoice: { value: 0, confidence: 0.9 }, usefulness: { value: 0.1, confidence: 0.9 } } },
    mid: { model: "stub", aiLikelihood: 0.8, dimensions: { contrastFraming: { value: 0.5, confidence: 0.9 }, emptyEvaluation: { value: 0.4, confidence: 0.9 }, tradeoffFreePromises: { value: 0.1, confidence: 0.9 }, formalHedging: { value: 0.3, confidence: 0.9 }, hypeMarketing: { value: 0.2, confidence: 0.9 }, manneredProse: { value: 0.2, confidence: 0.9 }, formulaicHook: { value: 0.4, confidence: 0.9 }, manufacturedNarrative: { value: 0.3, confidence: 0.9 }, engagementBait: { value: 0.3, confidence: 0.9 }, humanVoice: { value: 0.4, confidence: 0.9 }, usefulness: { value: 0.4, confidence: 0.9 } } },
    human: { model: "stub", aiLikelihood: 0.1, dimensions: { contrastFraming: { value: 0.9, confidence: 0.9 }, emptyEvaluation: { value: 0.9, confidence: 0.9 }, tradeoffFreePromises: { value: 0.9, confidence: 0.9 }, formalHedging: { value: 0.9, confidence: 0.9 }, hypeMarketing: { value: 0.9, confidence: 0.9 }, manneredProse: { value: 0.9, confidence: 0.9 }, formulaicHook: { value: 0.9, confidence: 0.9 }, manufacturedNarrative: { value: 0.9, confidence: 0.9 }, engagementBait: { value: 0.9, confidence: 0.9 }, humanVoice: { value: 1, confidence: 0.9 }, usefulness: { value: 0.9, confidence: 0.9 } } },
  })[canned];
  const store = { sync: { settings: { enabled: true, acknowledged: true, mode: new URLSearchParams(location.search).get("mode") || "hide", sensitivity: new URLSearchParams(location.search).get("sens") || "moderate", debug: true } }, local: {} };
  window.__store = store;
  const listeners = [];
  const area = (name) => ({
    get: async (k) => (k ? { [k]: store[name][k] } : { ...store[name] }),
    set: async (o) => { const changes = {}; for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: store[name][k], newValue: v }; store[name][k] = v; } listeners.forEach((l) => l(changes, name)); },
  });
  let day = new Date().toISOString().slice(0, 10);
  const hidden = { [new Date(Date.now() - 86400000).toISOString().slice(0, 10)]: 9, [day]: 0 };
  const seen = new Set();
  const sum = () => {
    const today = hidden[day], total = Object.values(hidden).reduce((a, b) => a + b, 0), record = Math.max(...Object.values(hidden));
    const s = { today, week: total, month: total, total, record, dial: record ? today / record : 0, isNewRecord: today > 0 && today >= record && today > 9 };
    return { hidden: s, flagged: { today: 0, week: 0, month: 0, total: 0, record: 0, dial: 0, isNewRecord: false } };
  };
  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener: (l) => listeners.push(l) } },
    runtime: {
      id: "harness", // feed.ts's extensionAlive() checks this; without it the content script shuts itself down before scanning
      getURL: (p) => p,
      sendMessage: async (m) => {
        (window.__msgs = window.__msgs || []).push(m.type);
        if (m.type === "judge") { await new Promise((r) => setTimeout(r, 150)); const el = document.querySelector(`[data-urn="${m.urn}"]`); return mk(el.dataset.canned); }
        if (m.type === "vote") { await window.chrome.storage.local.set({ ["label:" + m.record.urn]: m.record }); window.__votes = (window.__votes || []).concat(m.record.label); return; }
        if (m.type === "unvote") { const old = store.local["label:" + m.urn]; delete store.local["label:" + m.urn]; listeners.forEach((l) => l({ ["label:" + m.urn]: { oldValue: old, newValue: undefined } }, "local")); window.__votes = (window.__votes || []).concat("cleared"); return; }
        if (m.type === "getLabelSync") return { pending: 2, lastOk: Date.now() - 60000, lastError: 'collector not reachable at http://localhost:8788: run "npm run collect"', endpoint: "http://localhost:8788" };
        if (m.type === "getDebug") return { sent: 12, cached: 30, errors: 1, lastError: "network: Failed to fetch (http://localhost:8787)", detected: 41, ads: 2, own: 1, skipped: 6 };
        if (m.type === "record") { if (!seen.has(m.urn)) { seen.add(m.urn); hidden[day]++; } return sum(); }
        return sum();
      },
    },
    tabs: { create: () => {}, query: async () => [{ id: 1 }] },
  };
})();
