/**
 * The tell library: what AI-written LinkedIn posts look like.
 *
 * Baseline: Graphite's "AI tells" research (https://graphite.io/five-percent/research/ai-tells),
 * which compared 10k pre-ChatGPT human articles against 90k articles from nine models and kept
 * phrasings that appear at least 2x more often in AI text. That research covers web articles, so
 * the LinkedIn-specific tells (hooks, broetry, engagement bait, manufactured anecdotes) are our
 * own additions and are marked as such.
 *
 * Each trait is one narrow Score rubric. Levels describe concrete situations (never "somewhat"),
 * because Jev judges every level independently and never sees the level numbers.
 */

export interface Trait {
  /** Question id, also the key returned to the extension. */
  id: string;
  /** What Jev is asked. Refers to the post as `post`. */
  question: string;
  /** Ordered levels, index 0 = absent. */
  levels: readonly [string, string, string, ...string[]];
}

export const TELLS: readonly Trait[] = [
  {
    id: "contrastFraming",
    question:
      "How much does `post` define or explain things by contrast or negation instead of saying directly what they are?",
    levels: [
      "Things are described directly. No 'not X, but Y' constructions.",
      "One contrast construction, such as 'not just X, it's Y' or 'rather than merely X', in an otherwise direct post.",
      "Two or three contrast constructions ('less like X and more like Y', 'it isn't X, it's Y', 'instead it is').",
      "The post's main argument is built from repeated negation-then-reveal contrasts.",
    ],
  },
  {
    id: "emptyEvaluation",
    question:
      "How much does `post` rely on evaluative adjectives, importance flagging, and intensifiers that carry no concrete detail?",
    levels: [
      "Claims are backed by concrete detail (numbers, names, specific events). Few generic evaluations.",
      "Occasional generic evaluation ('practical', 'meaningful', 'dependable') but mostly specific.",
      "Frequent generic evaluations, or explicit importance flagging ('this matters because', 'the distinction matters', 'absolutely essential') with little supporting detail.",
      "Mostly generic evaluations and importance flagging ('profound', 'incredibly', 'remarkably', 'matters because'); could be about almost anything.",
    ],
  },
  {
    id: "tradeoffFreePromises",
    question:
      "How much does `post` promise benefits with no cost or sacrifice, using constructions like 'without sacrificing', 'without losing', or 'without requiring'?",
    levels: [
      "No tradeoff-free promises. Costs and limits are acknowledged or the topic doesn't involve them.",
      "One 'without sacrificing/losing/compromising' style phrase.",
      "Several benefit claims that skip the tradeoffs.",
      "The post's pitch is that you get everything with nothing given up.",
    ],
  },
  {
    id: "formalHedging",
    question:
      "How much does `post` use stock formal transitions and hedges ('furthermore', 'ultimately this', 'additionally', 'may provide', 'can provide', 'not necessarily', 'looking ahead')?",
    levels: [
      "Plain connective language; a casual or personal register.",
      "One or two stock transitions or hedges.",
      "Repeated formal transitions or 'may/can provide' hedging that reads like a report.",
      "Reads like a template: stock transitions open most paragraphs and claims are hedged throughout.",
    ],
  },
  {
    id: "hypeMarketing",
    question:
      "How much does `post` use hype and marketing vocabulary ('groundbreaking', 'unlock', 'elevate', 'leverage', 'game-changer', 'paramount', 'unprecedented', 'revolutionary')?",
    levels: [
      "No hype or marketing vocabulary.",
      "One or two hype words in a mostly grounded post.",
      "Several hype or marketing words ('unlock', 'elevate', 'leverage', 'game-changer').",
      "Dense with hype and marketing language; reads like ad copy.",
    ],
  },
  {
    id: "manneredProse",
    question:
      "How much does `post` substitute metaphor, flourish, or portentous phrasing ('a delicate dance', 'the quiet power of', 'a tapestry of') for saying the thing directly?",
    levels: [
      "Direct, plain statements.",
      "One figure of speech or flourish.",
      "Several metaphors or portentous phrases where a plain sentence would do.",
      "Mostly flourish; hard to extract a plain claim.",
    ],
  },
  // --- LinkedIn-specific additions (not from the Graphite research) ---
  {
    id: "formulaicHook",
    question:
      "How much does `post` follow the LinkedIn scroll-stopper formula: a dramatic short opening line, then one-sentence-per-line 'broetry' spacing, then a moral?",
    levels: [
      "Normal paragraphs; opens with substance or context rather than a hook.",
      "A punchy opening line, but the rest is normal prose.",
      "Dramatic opener ('I got fired. Best thing that ever happened.') followed by mostly one-line paragraphs.",
      "Textbook formula: dramatic hook, staccato one-liners, numbered takeaways, a moral closer.",
    ],
  },
  {
    id: "manufacturedNarrative",
    question:
      "How much does `post` tell a suspiciously tidy story (an unnamed person, a neat turning point, a lesson the story conveniently proves) that reads as constructed rather than lived?",
    levels: [
      "No story, or a specific lived anecdote with messy real-world detail.",
      "A short anecdote used to illustrate a point, with some specifics.",
      "A generic anecdote ('a candidate once told me...') with a neat lesson and few verifiable details.",
      "An invented-feeling parable with a perfect arc, no specifics, and a moral that lands too cleanly.",
    ],
  },
  {
    id: "engagementBait",
    question: "How much does `post` explicitly solicit engagement (comments, reposts, follows, reactions)?",
    levels: [
      "No call for engagement.",
      "A genuine open question to the audience.",
      "A formula ask such as 'Agree?', 'Thoughts?', or 'Repost if you agree'.",
      "Explicit engagement bait: 'Comment YES', 'Follow for more', 'Repost to help others', or a giveaway keyed to comments.",
    ],
  },
];

/** Counter-signal: the human tells from the same research, used to offset the slop score. */
export const HUMAN_VOICE: Trait = {
  id: "humanVoice",
  question:
    "How strongly does `post` sound like one specific person writing in their own voice? Consider first person, direct address, casual qualifiers ('pretty', 'sort of'), contractions, personal or narrative references ('last year', 'my manager'), genuine enthusiasm, parenthetical asides, and uneven sentence rhythm.",
  levels: [
    "Impersonal and uniform; no identifiable person behind it.",
    "A little first person, but generic.",
    "Clear personal voice with some specific references and natural rhythm.",
    "Unmistakably one person: idiosyncratic phrasing, specific personal detail, varied rhythm, asides.",
  ],
};

/** Value to a professional reader, deliberately independent of who or what wrote it. */
export const USEFULNESS: Trait = {
  id: "usefulness",
  question:
    "Setting aside who or what wrote `post`, how useful is it to a working professional? Useful means concrete, specific, novel, or actionable. `engagement` is what readers have done with it so far (reactions, comments, reposts), as observed fact: real discussion and reposts are evidence that people found something in it, while a pile of reactions alone is weak evidence. `previousAssessment`, when present, is your earlier answer and the engagement then, so weigh what has changed since; do not just repeat it.",
  levels: [
    "Nothing a reader could use: platitudes or self-promotion.",
    "Familiar advice with little that is specific.",
    "Some specific, actionable, or genuinely informative content.",
    "Substantial: concrete details, real data or experience, or an insight a reader could act on today.",
  ],
};

export const AI_LIKELIHOOD_QUESTION =
  "Was `post` most likely drafted mostly by a large language model rather than written by a person? Use `surfaceStats` as observed facts: very uniform sentence lengths, few contractions, and no exclamation marks lean toward AI; varied rhythm and casual punctuation lean toward human. Em dashes are a weak signal because newer models use them at human rates.";

export const AI_LIKELIHOOD_CRITERIA = {
  true: "Reads as LLM-drafted: template structure, stock phrasing, uniform rhythm, generic content.",
  false: "Reads as human-written, including stiff, formal, or badly written human text.",
} as const;
