// Display formatting for the owner dashboard. Money is always shown in the SHOP's own currency (the
// ₹ sign for INR with Indian digit grouping, an ISO code otherwise - never a guessed symbol).

export function formatMoney(amount: number, currency: string | null | undefined, opts: { compact?: boolean; zero?: string } = {}): string {
  if (amount === 0 && opts.zero) return opts.zero;
  const code = currency ?? "INR";
  const fraction = Number.isInteger(amount) ? 0 : 2;
  const grouped = amount.toLocaleString("en-IN", {
    minimumFractionDigits: opts.compact ? 0 : fraction,
    maximumFractionDigits: opts.compact ? 0 : 2,
  });
  return code === "INR" ? `₹${grouped}` : `${code} ${grouped}`;
}

export function formatPercentChange(change: number | null): { text: string; tone: "up" | "down" | "flat" } {
  if (change === null) return { text: "No earlier data", tone: "flat" };
  if (change === 0) return { text: "No change", tone: "flat" };
  return { text: `${change > 0 ? "+" : ""}${change}%`, tone: change > 0 ? "up" : "down" };
}

/** Time of day in the shop's own timezone, e.g. "4:30 pm". */
export function formatShopTime(iso: string, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timeZone ?? undefined,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(new Date(iso))
      .toLowerCase();
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

export function formatShopDate(iso: string, timeZone: string | null | undefined, withYear = false): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timeZone ?? undefined,
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Hour (0-23) in the shop's timezone. */
export function shopHour(timeZone: string | null | undefined, now: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? undefined, hour: "2-digit", hour12: false }).format(now),
    ) % 24;
  } catch {
    return now.getHours();
  }
}

export function initialsOf(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "?";
  // An e-mail address yields the first two letters of its name part; a real name yields the
  // initials of its first two words. Never the address itself.
  if (text.includes("@")) {
    const letters = text.split("@")[0].replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    return letters || "?";
  }
  const words = text.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : text.slice(0, 2)).toUpperCase() || "?";
}

/** A short, friendly label for the account chip: the part of an e-mail before the @, or a name's first two words. */
export function shortName(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "Account";
  const base = text.includes("@") ? text.split("@")[0] : text.split(/\s+/).slice(0, 2).join(" ");
  return base.length > 18 ? `${base.slice(0, 17)}…` : base;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
