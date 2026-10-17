import {
  INVITE_TEXT_MAX,
  cleanInviteText,
  composeMessage,
  defaultInviteText,
  emailShareUrl,
  facebookShareUrl,
  findOwnListing,
  isShareable,
  publicShopPath,
  whatsappShareUrl,
} from "../shop-share";

describe("public shop path", () => {
  it("lower-cases the country and keeps the slugs", () => {
    expect(publicShopPath({ countryCode: "IN", citySlug: "gorakhpur-uttar-pradesh", slug: "ajay-men-s-parlour" })).toBe("/in/gorakhpur-uttar-pradesh/ajay-men-s-parlour");
  });
});

describe("findOwnListing", () => {
  const items = [{ id: "a", slug: "x" }, { id: "b", slug: "y" }];
  it("finds this shop and never another", () => {
    expect(findOwnListing(items, "b")).toEqual({ id: "b", slug: "y" });
    expect(findOwnListing(items, "zzz")).toBeNull();
    expect(findOwnListing([], "a")).toBeNull();
  });
});

describe("invite text and links", () => {
  const url = "https://fastque.com/in/patna/fade-house";

  it("builds a default message that names the shop and promises only what exists", () => {
    const text = defaultInviteText("Fade House");
    expect(text).toContain("Fade House");
    expect(text).toContain("Live Queue");
    expect(text.toLowerCase()).not.toContain("walk-in");
    expect(text.toLowerCase()).not.toContain("discount");
  });

  it("cleans whitespace and caps the length", () => {
    expect(cleanInviteText("  hello\r\n\r\n\r\n\r\nworld  ")).toBe("hello\n\nworld");
    expect(cleanInviteText("x".repeat(INVITE_TEXT_MAX + 100))).toHaveLength(INVITE_TEXT_MAX);
  });

  it("composes message then link, and just the link when the message is empty", () => {
    expect(composeMessage("Book now", url)).toBe(`Book now\n${url}`);
    expect(composeMessage("   ", url)).toBe(url);
  });

  it("builds a WhatsApp link with the encoded message (nothing is sent by FastQue)", () => {
    const link = whatsappShareUrl("Book & save? 100%", url);
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe(`Book & save? 100%\n${url}`);
  });

  it("encodes the link for the Facebook share dialog", () => {
    expect(facebookShareUrl(url)).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
  });

  it("builds an email link with subject and body", () => {
    const link = emailShareUrl("Fade House", "Hi there", url);
    expect(link.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Book at Fade House on FastQue");
    expect(decodeURIComponent(link)).toContain(url);
  });

  it("encodes characters that could break a share link", () => {
    const link = whatsappShareUrl("a&b=c#d", url);
    expect(link).not.toContain("&b=");
    expect(link).not.toContain("#d");
  });
});

describe("isShareable", () => {
  it("is true only for an ACTIVE shop", () => {
    expect(isShareable("ACTIVE")).toBe(true);
    expect(isShareable("PENDING")).toBe(false);
    expect(isShareable("SUSPENDED")).toBe(false);
    expect(isShareable(null)).toBe(false);
    expect(isShareable(undefined)).toBe(false);
  });
});
