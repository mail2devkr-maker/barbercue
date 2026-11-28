import {
  INVITE_TEXT_MAX,
  cleanInviteText,
  composeMessage,
  defaultInviteText,
  emailShareUrl,
  facebookShareUrl,
  classifyShareLinks,
  whatsappShareUrl,
} from "../shop-share";

const dto = (over = {}) => ({
  salonId: "s1",
  status: "ACTIVE",
  publicPath: "/in/patna/fade-house",
  publicUrl: "https://fastque.com/in/patna/fade-house",
  readiness: { ready: true, reasons: [] },
  metadata: { title: "Fade House", description: null, imageUrl: null },
  ...over,
});

describe("classifyShareLinks", () => {
  it("uses the server's canonical public URL when the shop is ready", () => {
    expect(classifyShareLinks(dto())).toEqual({ kind: "ready", name: "Fade House", url: "https://fastque.com/in/patna/fade-house" });
  });
  it("shows no link for a shop that is not open to the public, even if the server sent a URL", () => {
    expect(classifyShareLinks(dto({ status: "PENDING", readiness: { ready: false, reasons: ["SALON_NOT_PUBLIC"] } })).kind).toBe("not-public");
    expect(classifyShareLinks(dto({ readiness: { ready: false, reasons: ["SALON_NOT_PUBLIC"] } })).kind).toBe("not-public");
  });
  it("shows no link when the server has no trusted address", () => {
    expect(classifyShareLinks(dto({ publicUrl: null, readiness: { ready: false, reasons: ["WEB_BASE_URL_NOT_CONFIGURED"] } })).kind).toBe("not-configured");
  });
  it("never trusts a URL the server did not mark ready or that is not an http(s) address", () => {
    expect(classifyShareLinks(dto({ readiness: { ready: false, reasons: [] } })).kind).toBe("not-configured");
    expect(classifyShareLinks(dto({ publicUrl: "javascript:alert(1)" })).kind).toBe("not-configured");
    expect(classifyShareLinks(dto({ publicUrl: "not a url" })).kind).toBe("not-configured");
  });
  it("falls back to a neutral name when the title is missing", () => {
    expect(classifyShareLinks(dto({ metadata: { title: "", description: null, imageUrl: null } })).name).toBe("Your shop");
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

