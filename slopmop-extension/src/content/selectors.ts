/**
 * Every LinkedIn-specific selector lives here. LinkedIn changes its DOM often, so this is the one
 * file to touch when extraction breaks. Each entry lists fallbacks, tried in order.
 *
 * Verified against the live feed on 2026-09-18: classes are hashed and there are no
 * `urn:li:activity` attributes, so the current markup is found through role/componentkey/data-testid.
 * The legacy (pre-hash) selectors are kept as fallbacks.
 */
export const SEL = {
  post: [
    '[role="listitem"][componentkey^="update-card"]',
    'div[data-urn^="urn:li:activity:"]',
    'div[data-id^="urn:li:activity:"]',
    ".feed-shared-update-v2",
  ],
  /** Current markup: the post id is the componentkey minus this prefix. */
  componentKeyPrefix: /^update-card(?:-focus)?/,
  urnAttrs: ["data-urn", "data-id"],
  text: [
    '[data-testid="expandable-text-box"]',
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
  ],
  /** Trailing "… more" control that LinkedIn renders inside the text box. */
  moreSuffix: /[\s…]*\bmore\s*$/i,
  /** Counts are rendered as leaf text like "34 reactions", "16 comments", "5 reposts". */
  countLeaf: "span,p,button,a,div",
  promotedLeaf: "span,p,div",
  promotedText: /^\s*(promoted|sponsored)\s*$/i,
  /**
   * Ads: verified 2026-09-18 that a sponsored card carries an element (an svg on the creative link) with
   * aria-label "View Sponsored Content" and no "Promoted" text leaf, so any sponsored/promoted aria-label counts.
   */
  adAria: /\b(sponsored|promoted)\b/i,
  /** "Open control menu for post by <Name>" names the post's author on every card. */
  authorAria: '[aria-label^="Open control menu for post by "]',
  authorPrefix: "Open control menu for post by ",
  /** Your own posts also say so in their author line ("• You"), which works even when your name hasn't been learned yet. */
  youMarker: /^\s*•?\s*You\s*$/,
  actorScope: '[class*="actor"]',
  /** Left-rail profile card: an avatar whose alt is the signed-in user's name, linking to their profile. */
  profileImg: 'img[alt]',
  profileHref: /\/in\/[^/?#]+\/?(?:[?#].*)?$/,
  /**
   * The "Start a post" composer, a modal <dialog> verified on 2026-09-21: the editor is a role=textbox. The mop button is NOT put
   * into LinkedIn's toolbar (it reshuffles and collapses that as the draft grows, and a sibling there can land on top of another
   * icon): it floats inside the dialog, beside the footer's Post button.
   */
  composer: {
    dialog: 'dialog[open], [role="dialog"]',
    editor: '[role="textbox"][contenteditable="true"], .ql-editor',
    /** The footer's Post button, found by its label (English); without it the mop button sits in the dialog's bottom right. */
    postLabel: /^\s*Post\s*$/i,
  },
} as const;

export const POST_SELECTOR = SEL.post.join(",");

export function firstMatch(root: Element, selectors: readonly string[]): Element | null {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}
