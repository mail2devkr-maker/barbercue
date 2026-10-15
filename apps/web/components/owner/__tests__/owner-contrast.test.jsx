import fs from "fs";
import path from "path";

// Regression guard for the defect that made Live Queue customer names unreadable: a card hard-coded
// a white background while its text colour came from a dark-theme token (near-white), giving white on
// white. Every text/background pair the owner dashboard uses is resolved from the real stylesheet and
// must meet WCAG AA (4.5:1 for normal text).
const CSS = fs.readFileSync(path.join(__dirname, "../owner.module.css"), "utf8");
const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, "../../../app/globals.css"), "utf8");
const LEGACY_CSS = fs.readFileSync(path.join(__dirname, "../../dashboard/dashboard.module.css"), "utf8");

function tokensFrom(source, selector) {
  const block = new RegExp("\\" + selector + "\\s*\\{([\\s\\S]*?)\\n\\}").exec(source)?.[1];
  if (!block) throw new Error("missing token block " + selector);
  const tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) tokens[m[1]] = m[2].trim();
  return tokens;
}
const TOKENS = { ...tokensFrom(GLOBAL_CSS, ":root"), ...tokensFrom(CSS, ".root") };

function resolve(value, depth = 0) {
  const v = value.trim();
  const ref = /^var\(--([a-z0-9-]+)\)$/i.exec(v);
  if (ref && depth < 6) return resolve(TOKENS[ref[1]] ?? "", depth + 1);
  return v;
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const a = luminance(hexToRgb(fg));
  const b = luminance(hexToRgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** The value of `prop` in the first rule for exactly `.name` that declares it. */
function declared(selector, prop) {
  const re = new RegExp("(^|\\n)\\s*\\." + selector + "\\s*\\{([^}]*)\\}", "g");
  for (const match of CSS.matchAll(re)) {
    const m = new RegExp("(^|[;\\s])" + prop + ":\\s*([^;]+);").exec(match[2]);
    if (m) return resolve(m[2]);
  }
  throw new Error("." + selector + " has no " + prop);
}

const SURFACE = resolve("var(--os-surface)");
const PAGE_BG = resolve("var(--os-bg)");

describe("owner dashboard colour contrast", () => {
  it("the page and card surfaces are light and the base ink on them is dark", () => {
    expect(ratio(resolve("var(--os-ink)"), SURFACE)).toBeGreaterThanOrEqual(7);
    expect(ratio(resolve("var(--os-ink)"), PAGE_BG)).toBeGreaterThanOrEqual(7);
  });

  const TEXT_ON_SURFACE = ["os-ink", "os-ink-2", "os-muted", "os-brand", "os-ok-ink", "os-warn-ink", "os-bad-ink", "os-info-ink"];
  it.each(TEXT_ON_SURFACE)("%s is readable on a white card", (token) => {
    expect(ratio(resolve("var(--" + token + ")"), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["os-ink-2", "os-muted"])("%s is readable on the page background and on a tinted panel", (token) => {
    expect(ratio(resolve("var(--" + token + ")"), PAGE_BG)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(resolve("var(--" + token + ")"), resolve("var(--os-surface-2)"))).toBeGreaterThanOrEqual(4.5);
  });

  const BADGES = ["badgeOk", "badgeWarn", "badgeBad", "badgeInfo", "badgeBrand", "badgeNeutral"];
  it.each(BADGES)("status badge .%s keeps readable text on its own background", (name) => {
    expect(ratio(declared(name, "color"), declared(name, "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("Live Queue cards: the card background and every text colour inside it are a safe pair", () => {
    const cardBg = declared("entry", "background");
    expect(cardBg.toLowerCase()).toBe(SURFACE.toLowerCase());
    for (const cls of ["entryName", "entryMeta"]) {
      expect({ cls, ok: ratio(declared(cls, "color"), cardBg) >= 4.5 }).toEqual({ cls, ok: true });
    }
    // The customer name must be dark ink - never the near-white a dark theme would supply.
    expect(luminance(hexToRgb(declared("entryName", "color")))).toBeLessThan(0.1);
  });

  it("queue token chip, buttons, tabs and navigation states are readable", () => {
    expect(ratio(declared("token", "color"), declared("token", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("btnPrimary", "color"), declared("btnPrimary", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("btnDanger", "color"), declared("btnDanger", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("btnSecondary", "color"), declared("btnSecondary", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("navLinkActive", "color"), declared("navLinkActive", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("navLink", "color"), declared("sidebar", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("tabActive", "color"), declared("tabActive", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("tab", "color"), SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("navBadge", "color"), declared("navBadge", "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the welcome banner text is readable on every stop of its gradient", () => {
    for (const stop of ["#09090c", "#211722", "#592039"]) {
      expect(ratio("#ffffff", stop)).toBeGreaterThanOrEqual(7);
      expect(ratio(resolve("var(--os-navy-muted)"), stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses readable charcoal chrome on desktop and mobile without darkening work cards", () => {
    const chrome = resolve("var(--os-chrome)");
    for (const selector of ["rail", "sidebar", "topbar", "bottomBar"]) {
      expect(declared(selector, "background")).toBe(chrome);
    }
    for (const selector of ["railBtn", "navLink", "shopName", "navGroupLabel", "bottomLink", "avatarBtn"]) {
      expect(ratio(declared(selector, "color"), chrome)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(declared("iconBtn", "color"), declared("iconBtn", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(declared("searchInput", "color"), declared("searchInput", "background"))).toBeGreaterThanOrEqual(4.5);
    expect(declared("card", "background")).toBe(SURFACE);
  });

  it("uses the canonical FastQue gradient only for brand actions, with accessible ink at every stop", () => {
    const stops = ["bc-brand-pink", "bc-brand-coral", "bc-brand-orange"].map((name) => resolve("var(--" + name + ")"));
    for (const selector of ["railBtnActive", "navLinkActive", "bottomLinkActive", "btnPrimary", "tabActive"]) {
      expect(declared(selector, "background-image")).toBe(resolve("var(--bc-brand-gradient)"));
      for (const stop of stops) expect(ratio(declared(selector, "color"), stop)).toBeGreaterThanOrEqual(4.5);
    }
    expect(CSS).not.toMatch(/\.badge(?:Ok|Warn|Bad|Info)\s*\{[^}]*background-image:/);
  });

  it("keeps legacy shop-management gradient controls readable too", () => {
    const stops = ["bc-brand-pink", "bc-brand-coral", "bc-brand-orange"].map((name) => resolve("var(--" + name + ")"));
    const brandedRules = [...LEGACY_CSS.matchAll(/\{([^{}]*background-image:\s*var\(--bc-brand-gradient\);[^{}]*)\}/g)];
    expect(brandedRules.length).toBeGreaterThanOrEqual(4);
    for (const [, body] of brandedRules) {
      const ink = /(?:^|;)\s*color:\s*(#[0-9a-f]{6});/i.exec(body)?.[1];
      expect(ink).toBeDefined();
      for (const stop of stops) expect(ratio(ink, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps keyboard focus visible on both the light workspace and dark chrome", () => {
    expect(ratio(resolve("var(--os-focus-ink)"), SURFACE)).toBeGreaterThanOrEqual(3);
    expect(ratio(resolve("var(--bc-brand-orange)"), resolve("var(--os-chrome)"))).toBeGreaterThanOrEqual(3);
    expect(CSS).toMatch(/\.root \*:focus-visible\s*\{[^}]*outline: 2px solid var\(--os-focus-ink\)/);
    expect(CSS).toMatch(/\.rail :focus-visible,[\s\S]*?outline-color: var\(--bc-brand-orange\)/);
  });

  it("never sets low-contrast text on a hard-coded white surface anywhere in the stylesheet", () => {
    const rules = [...CSS.matchAll(/\n([.#][^{}\n]+)\{([^}]*)\}/g)];
    for (const [, selector, body] of rules) {
      const bg = /background(?:-color)?:\s*(#fff(?:fff)?|white)\b/i.exec(body);
      const color = /(^|[;\s])color:\s*([^;]+);/.exec(body);
      if (bg && color) {
        const fg = resolve(color[2]);
        if (/^#/.test(fg)) expect({ selector: selector.trim(), ok: ratio(fg, "#ffffff") >= 4.5 }).toEqual({ selector: selector.trim(), ok: true });
      }
    }
  });

  it("the legacy --bc-* tokens are remapped to dark-on-light so older pages stay readable in the shell", () => {
    for (const token of ["bc-ink", "bc-muted"]) expect(ratio(resolve("var(--" + token + ")"), SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(resolve("var(--bc-surface)").toLowerCase()).toBe(SURFACE.toLowerCase());
  });
});
