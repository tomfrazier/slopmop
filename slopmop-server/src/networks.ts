/**
 * The social networks Slop Mop understands. The API is network-agnostic: every record is keyed by
 * (network, contentId), so supporting reddit, facebook, instagram, etc. is a matter of adding an entry here
 * (and, later, any network-specific criteria) plus a content script in the extension.
 * v1 ships LinkedIn only.
 */
export interface NetworkProfile {
  id: string;
  name: string;
  /** Text shorter than this can't be scored meaningfully (the model needs something to judge). */
  minChars: number;
  /** Longer text is rejected rather than truncated, so a verdict is never based on a partial post. */
  maxChars: number;
  /** A network's own post id is only kept when it matches this: it must be stable across users and views. */
  nativeId?: RegExp;
}

export const NETWORKS: Record<string, NetworkProfile> = {
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    minChars: 20,
    maxChars: 6000,
    // Canonical post URNs. The modern feed's per-card keys are viewer-specific, so the extension only sends these.
    nativeId: /^urn:li:(activity|share|ugcPost):\d{10,25}$/,
  },
};

export const SUPPORTED_NETWORKS = Object.keys(NETWORKS);
export const getNetwork = (id: unknown): NetworkProfile | null => (typeof id === "string" && Object.hasOwn(NETWORKS, id) ? NETWORKS[id] : null);
