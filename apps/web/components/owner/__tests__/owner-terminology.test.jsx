import fs from "fs";
import path from "path";

// FastQue's customer-facing word for a queue-originated visit is "Live Queue", never "Walk-in".
// (The persisted WALK_IN enum value is unchanged; only what people READ is checked here.)
const OWNER_DIR = path.join(__dirname, "..");

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
}

describe("owner dashboard wording", () => {
  const files = walk(OWNER_DIR).filter((f) => /\.(tsx|ts)$/.test(f));

  it("never shows the word walk-in to a user", () => {
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // strip code comments; look only at text that could render
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const hits = [...withoutComments.matchAll(/walk[- ]?in/gi)].map((m) => m[0]);
      expect({ file: path.basename(file), hits }).toEqual({ file: path.basename(file), hits: [] });
    }
  });

  it("does not offer the confusing local-customer chair control or the setup wizard's 'Finish setup' on the queue", () => {
    const consoleSource = fs.readFileSync(path.join(OWNER_DIR, "LiveQueueConsole.tsx"), "utf8");
    expect(consoleSource).not.toMatch(/Seat local customer/i);
    expect(consoleSource).not.toMatch(/Finish setup/i);
    expect(consoleSource).not.toMatch(/Set local customer/i);
    const page = fs.readFileSync(path.join(__dirname, "../../../app/(dashboard)/dashboard/salons/[salonId]/queue/page.tsx"), "utf8");
    expect(page).not.toMatch(/SetupNavigation/);
    expect(page.replace(/\/\/.*$/gm, "")).not.toMatch(/Finish setup/);
  });

  it("describes the payment QR accurately: optional for online bookings, never needed in the shop", () => {
    const text = fs.readFileSync(path.join(__dirname, "../../dashboard/PaymentQrSection.tsx"), "utf8");
    expect(text).toMatch(/Online Booking Payment QR/);
    expect(text).toMatch(/optional/i);
    expect(text).not.toMatch(/online bookings are blocked/i);
    expect(text).not.toMatch(/Required before a customer can book online/i);
  });

  it("the settings page no longer shows a 'not yet implemented' placeholder", () => {
    const settings = fs.readFileSync(path.join(__dirname, "../../../app/(dashboard)/dashboard/salons/[salonId]/settings/page.tsx"), "utf8");
    expect(settings).not.toMatch(/not yet implemented/i);
  });
});
