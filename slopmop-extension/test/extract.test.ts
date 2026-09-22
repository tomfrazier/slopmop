// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { authorOf, extractPost, findOwnName, inspectPost, isAd, looksEnglish, parseCount } from "../src/content/extract";

const LONG = "We finally shipped the billing migration last Thursday and I think it is the best thing that our team has done in the last year. ".repeat(3);
// Synthetic markup modelled on LinkedIn's class names; real-feed verification is still open (see README).
const post = (opts: { text?: string; promoted?: boolean } = {}) => {
  document.body.innerHTML = `<div data-urn="urn:li:activity:42" class="feed-shared-update-v2">
    <div class="update-components-actor__sub-description">${opts.promoted ? "Promoted" : "3h"}</div>
    <div class="update-components-text">${opts.text ?? LONG}</div>
    <span class="social-details-social-counts__reactions-count" aria-label="1,234 reactions">1,234</span>
  </div>`;
  return document.querySelector(".feed-shared-update-v2")!;
};

describe("extractPost", () => {
  it("still finds urn and text on the legacy markup, and the reaction count from its aria-label", () => {
    const x = extractPost(post())!;
    expect(x.urn).toBe("urn:li:activity:42");
    expect(x.text.length).toBeGreaterThan(200);
    expect(x.engagement.reactions).toBe(1234);
  });
  it("skips promoted, short, and non-English posts", () => {
    expect(extractPost(post({ promoted: true }))).toBeNull();
    expect(extractPost(post({ text: "Short post." }))).toBeNull();
    expect(extractPost(post({ text: "Ceci est un long message en français sans rapport avec l'anglais. ".repeat(6) }))).toBeNull();
  });
});

// Modelled on the live feed's structure (verified 2026-09-18): hashed classes, componentkey, data-testid.
const modern = (opts: { promoted?: boolean; comment?: string } = {}) => {
  document.body.innerHTML = `<div><div role="listitem" componentkey="update-card-focusAbC123-x_y" class="_a1 _b2">
    <p>Someone</p>${opts.promoted ? "<span>Promoted</span>" : "<span>3h</span>"}
    <p><span data-testid="expandable-text-box">${LONG}<button data-testid="expandable-text-button">… more</button></span></p>
    <span>34 reactions</span><span>16 comments</span><span>5 reposts</span>
    <div class="comment"><p>I have 900 comments on my other post about reposts</p></div>
  </div></div>`;
  return document.querySelector('[role="listitem"]')!;
};

describe("extractPost (current LinkedIn markup)", () => {
  it("extracts id from componentkey, text without the 'more' control, and counts", () => {
    const x = extractPost(modern())!;
    expect(x.urn).toBe("post:AbC123-x_y");
    expect(x.text.endsWith("more")).toBe(false);
    expect(x.engagement).toEqual({ reactions: 34, comments: 16, reposts: 5 });
  });
  it("skips promoted posts", () => {
    expect(extractPost(modern({ promoted: true }))).toBeNull();
  });
});

// A video-post layout found on a live post 2026-09-22: the reaction count renders as a bare, aria-hidden number
// (data-test-id="social-actions__reaction-count") inside an ancestor <a aria-label="5,543 Reactions">, so no leaf's
// own text contains the word "reactions" at all. Comments and reposts, whose leaves do carry the word, were unaffected
// -- this is why the post's engagement was recorded as 0 reactions despite having thousands.
describe("a reaction count that only appears in an ancestor's aria-label (no leaf text says 'reactions')", () => {
  it("is still read correctly, and comments/reposts are unaffected", () => {
    const el = card(`
      <div class="details">
        <div><a aria-label="5,543 Reactions" class="flex items-center"><span aria-hidden="true" data-test-id="social-actions__reaction-count">5,543</span></a></div>
        <span>324 Comments</span><span>128 reposts</span>
      </div>`);
    expect(extractPost(el)!.engagement).toEqual({ reactions: 5543, comments: 324, reposts: 128 });
  });
  it("does not pick up an unrelated aria-label that happens to contain a number", () => {
    const el = card('<div><button aria-label="Like"></button><span>16 comments</span></div>');
    expect(extractPost(el)!.engagement).toEqual({ reactions: 0, comments: 16, reposts: 0 });
  });
});

describe("helpers", () => {
  it("parses counts", () => {
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("3,456 reactions")).toBe(3456);
    expect(parseCount(null)).toBe(0);
  });
  it("detects english", () => {
    expect(looksEnglish(LONG)).toBe(true);
    expect(looksEnglish("日本語のテキストです。".repeat(30))).toBe(false);
  });
});

// Sponsored marker verified on the live feed 2026-09-18: an svg with aria-label "View Sponsored Content"
// inside the creative's link, and no "Promoted" text anywhere in the card.
const card = (inner: string, author = "Someone Else") => {
  document.body.innerHTML = `<div role="listitem" componentkey="update-card-focusXyz">
    <button aria-label="Open control menu for post by ${author}"></button>
    <p><span data-testid="expandable-text-box">${LONG}</span></p>${inner}</div>`;
  return document.querySelector('[role="listitem"]')!;
};

describe("ads are never touched", () => {
  it("detects the real sponsored marker (aria-label only)", () => {
    const el = card('<a href="x"><figure><svg aria-label="View Sponsored Content"></svg></figure></a>');
    expect(isAd(el)).toBe(true);
    expect(inspectPost(el).status).toBe("ad");
    expect(extractPost(el)).toBeNull();
  });
  it("detects a Promoted text label and other aria variants", () => {
    expect(isAd(card("<span>Promoted</span>"))).toBe(true);
    expect(isAd(card('<div aria-label="Promoted by Acme"></div>'))).toBe(true);
    expect(isAd(card("<span>Sponsored</span>"))).toBe(true);
  });
  it("an ad is skipped even when it is the user's own author name", () => {
    const el = card('<svg aria-label="View Sponsored Content"></svg>', "Me Myself");
    expect(inspectPost(el, "Me Myself").status).toBe("ad");
  });
  it("does not flag ordinary posts, or posts that merely mention the word in their body", () => {
    expect(isAd(card(""))).toBe(false);
    document.body.innerHTML = `<div role="listitem" componentkey="update-card-focusQ"><p><span data-testid="expandable-text-box">${LONG} We were sponsored by nobody, and promoted no one.</span></p></div>`;
    expect(isAd(document.querySelector('[role="listitem"]')!)).toBe(false);
  });
});

describe("own posts", () => {
  it("reads the author from the control-menu label", () => {
    expect(authorOf(card("", "Alex Example"))).toBe("Alex Example");
  });
  it("marks a post as own when the author matches the signed-in name, and accepts shorter text", () => {
    const el = card("", "Alex Example");
    const r = inspectPost(el, "Alex Example");
    expect(r.status === "ok" && r.post.own).toBe(true);
    expect(inspectPost(el, "Someone Else Entirely").status === "ok" && (inspectPost(el, "Nope") as any).post.own).toBe(false);
    document.body.innerHTML = `<div role="listitem" componentkey="update-card-focusS"><button aria-label="Open control menu for post by Alex Example"></button><span data-testid="expandable-text-box">I think we should ship this on the first of the month, honestly.</span></div>`;
    const shortEl = document.querySelector('[role="listitem"]')!;
    expect(inspectPost(shortEl, "Alex Example").status).toBe("ok"); // own posts allow >= 60 chars
    expect(inspectPost(shortEl, "Other").status).toBe("short");
  });
  it("finds the signed-in name from the left-rail avatar, not from avatars inside posts", () => {
    document.body.innerHTML = `<main>
      <div role="listitem" componentkey="update-card-focusZ"><a href="https://www.linkedin.com/in/other/"><img alt="Other Person"></a></div>
      <aside><a href="https://www.linkedin.com/in/alexexample/"><img alt="Alex Example"></a></aside></main>`;
    expect(findOwnName()).toBe("Alex Example");
  });
});

describe("debug: label every post (lenient)", () => {
  const withText = (text: string, inner = "") => {
    document.body.innerHTML = `<div role="listitem" componentkey="update-card-focusL"><button aria-label="Open control menu for post by Someone"></button><span data-testid="expandable-text-box">${text}</span>${inner}</div>`;
    return document.querySelector('[role="listitem"]')!;
  };
  it("normal mode still skips short and non-English posts", () => {
    expect(inspectPost(withText("Excited to share I'm starting a new role at Acme!")).status).toBe("short");
    expect(inspectPost(withText("Ceci est un long message en français sans rapport. ".repeat(6))).status).toBe("notEnglish");
  });
  it("lenient mode lets them through as inspect-only so they can be voted on", () => {
    const short = inspectPost(withText("Excited to share I'm starting a new role at Acme!"), null, true);
    expect(short.status === "ok" && short.post.inspectOnly).toBe(true);
    const fr = inspectPost(withText("Ceci est un long message en français sans rapport. ".repeat(6)), null, true);
    expect(fr.status === "ok" && fr.post.inspectOnly).toBe(true);
  });
  it("normal-length English posts are not inspect-only", () => {
    const r = inspectPost(withText(LONG), null, true);
    expect(r.status === "ok" && r.post.inspectOnly).toBeFalsy();
  });
  it("still refuses text the server would reject (under 20 characters)", () => {
    expect(inspectPost(withText("Congrats!"), null, true).status).toBe("short");
  });
  it("ads stay ads in lenient mode", () => {
    expect(inspectPost(withText(LONG, '<svg aria-label="View Sponsored Content"></svg>'), null, true).status).toBe("ad");
  });
});
