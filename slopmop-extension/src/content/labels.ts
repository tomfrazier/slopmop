export const TELL_LABELS: Record<string, string> = {
  contrastFraming: "“not X, it’s Y” framing",
  emptyEvaluation: "generic evaluative language",
  tradeoffFreePromises: "no-tradeoff promises",
  formalHedging: "stock transitions and hedges",
  hypeMarketing: "hype vocabulary",
  manneredProse: "flourish over plain statements",
  formulaicHook: "scroll-stopper formula",
  manufacturedNarrative: "too-tidy story",
  engagementBait: "engagement bait",
};

/** Short names for the spider chart, in the order the axes are drawn (related tells sit next to each other). */
export const TELL_AXES: { id: string; label: string }[] = [
  { id: "formulaicHook", label: "Scroll-stopper" },
  { id: "engagementBait", label: "Engagement bait" },
  { id: "hypeMarketing", label: "Hype words" },
  { id: "emptyEvaluation", label: "Empty praise" },
  { id: "tradeoffFreePromises", label: "No-catch promises" },
  { id: "contrastFraming", label: "“Not X, but Y”" },
  { id: "manneredProse", label: "Flowery prose" },
  { id: "formalHedging", label: "Stiff phrasing" },
  { id: "manufacturedNarrative", label: "Too-tidy story" },
];
