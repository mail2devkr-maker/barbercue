import fs from "fs";
import path from "path";

const CSS = fs.readFileSync(path.join(__dirname, "../owner.module.css"), "utf8");
const SHELL = fs.readFileSync(path.join(__dirname, "../OwnerShell.tsx"), "utf8");

function rule(source, name) {
  const re = new RegExp("\\." + name + "\\s*\\{([^}]*)\\}");
  const match = re.exec(source);
  if (!match) throw new Error("Missing Owner CSS rule: ." + name);
  return match[1];
}

const desktop = CSS.split("@media (max-width: 1180px)")[0];
const tablet = CSS.split("@media (max-width: 1180px)")[1]?.split("@media (max-width: 767px)")[0];
const mobile = CSS.split("@media (max-width: 767px)")[1]?.split("@media (max-width: 1600px)")[0];

describe("Owner navigation viewport layout (#212)", () => {
  it("pins both desktop navigation columns to the real viewport, not a sticky grid boundary", () => {
    const rail = rule(desktop, "rail");
    const sidebar = rule(desktop, "sidebar");
    for (const nav of [rail, sidebar]) {
      expect(nav).toMatch(/position:\s*fixed;/);
      expect(nav).toMatch(/top:\s*0;/);
      expect(nav).toMatch(/height:\s*100vh;/);
      expect(nav).toMatch(/height:\s*100dvh;/);
      expect(nav).toMatch(/box-sizing:\s*border-box;/);
      expect(nav).not.toMatch(/position:\s*sticky;/);
    }
    expect(rail).toMatch(/left:\s*0;/);
    expect(rail).toMatch(/width:\s*84px;/);
    expect(sidebar).toMatch(/left:\s*84px;/);
    expect(sidebar).toMatch(/width:\s*268px;/);
    expect(sidebar).toMatch(/overflow-y:\s*auto;/);
  });

  it("retains the 3-column desktop grid without allowing content beneath the fixed nav", () => {
    expect(rule(desktop, "app")).toMatch(/grid-template-columns:\s*84px 268px minmax\(0, 1fr\)/);
    expect(rule(desktop, "main")).toMatch(/grid-column:\s*3;/);
    expect(rule(desktop, "main")).toMatch(/min-width:\s*0;/);
  });

  it("keeps the original tablet drawer and mobile navigation tracks", () => {
    expect(tablet).toBeDefined();
    expect(rule(tablet, "main")).toMatch(/grid-column:\s*2;/);
    expect(rule(tablet, "sidebar")).toMatch(/left:\s*84px;/);
    expect(rule(tablet, "sidebar")).toMatch(/visibility:\s*hidden;/);
    expect(rule(tablet, "sidebarOpen")).toMatch(/visibility:\s*visible;/);
    expect(mobile).toBeDefined();
    expect(rule(mobile, "main")).toMatch(/grid-column:\s*1;/);
    expect(rule(mobile, "rail")).toMatch(/display:\s*none;/);
    expect(rule(mobile, "sidebar")).toMatch(/left:\s*0;/);
    expect(rule(mobile, "bottomBar")).toMatch(/position:\s*fixed;/);
  });

  it("preserves all navigation markup, scroll reachability and the log-out entry", () => {
    expect(SHELL).toContain('aria-label="Main navigation"');
    expect(SHELL).toContain('aria-label="Sections"');
    expect(SHELL).toContain('aria-label="Quick navigation"');
    expect(SHELL).toContain('aria-current={active ? "page" : undefined}');
    expect(SHELL).toContain('Log out</span>');
    expect(rule(desktop, "sidebar")).not.toMatch(/overflow-y:\s*hidden;/);
  });
});
