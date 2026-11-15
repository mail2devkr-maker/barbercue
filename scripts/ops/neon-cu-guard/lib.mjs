// Pure decision logic for the Neon CU guard (no network, no secrets) - unit-tested in lib.test.mjs.
// Owner directive 15 Nov 2026: watch Neon compute (CU-hours) every day and, when the live project
// passes 90% of its monthly allowance, move production to the other FastQue project between
// 02:00 and 05:00 IST - safely, unattended.

export const QUOTA_CU_HOURS = 100; // Neon Free plan, per project per billing period
export const SWITCH_AT = 0.9; // owner threshold
export const TARGET_MAX_START = 0.5; // never switch onto a project that is already half used
export const IST_OFFSET_MIN = 330;
export const WINDOW_START_MIN = 2 * 60; // 02:00 IST
export const WINDOW_LAST_START_MIN = 4 * 60 + 30; // a switch must START by 04:30 IST to end before 05:00
export const GUARD_DB_PREFIX = "fq_guard_";

/** Minutes since IST midnight for a UTC Date. */
export function istMinutes(now) {
  const m = now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}

/** "YYYY-MM-DD" of the IST calendar day for a UTC Date. */
export function istDay(now) {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function inSwitchWindow(now) {
  const m = istMinutes(now);
  return m >= WINDOW_START_MIN && m < WINDOW_LAST_START_MIN;
}

/** Hours from `now` until the end of the NEXT day's switch window (tomorrow 04:30 IST or later). */
export function hoursUntilNextWindowEnd(now) {
  const m = istMinutes(now);
  let minutes = WINDOW_LAST_START_MIN - m;
  if (minutes <= 0) minutes += 1440; // already past today's window end
  if (inSwitchWindow(now)) minutes += 1440; // switching now; the next chance is tomorrow
  return minutes / 60;
}

/**
 * Usage snapshot from a Neon project object (GET /projects/{id}).project.
 * compute_time_seconds = CU-seconds this billing period; consumption_period_start = period start.
 */
export function usageOf(project, now, quota = QUOTA_CU_HOURS) {
  const cuSeconds = Number(project.compute_time_seconds);
  if (!Number.isFinite(cuSeconds) || cuSeconds < 0) throw new Error(`project ${project.id}: compute_time_seconds missing`);
  const start = new Date(project.consumption_period_start);
  if (Number.isNaN(start.getTime())) throw new Error(`project ${project.id}: consumption_period_start missing`);
  const next = nextPeriodStart(start, project.quota_reset_at);
  const cuHours = cuSeconds / 3600;
  const hoursElapsed = Math.max(1, (now.getTime() - start.getTime()) / 3_600_000);
  return {
    id: project.id,
    name: project.name,
    cuHours,
    pct: cuHours / quota,
    burnPerHour: cuHours / hoursElapsed,
    periodStart: start.toISOString(),
    resetAt: next.toISOString(),
    hoursToReset: Math.max(0, (next.getTime() - now.getTime()) / 3_600_000),
  };
}

function nextPeriodStart(start, quotaResetAt) {
  const r = quotaResetAt ? new Date(quotaResetAt) : null;
  if (r && !Number.isNaN(r.getTime()) && r > start) return r;
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

/**
 * Decide what to do. `active` is the live project's usage, `other` the standby project's usage.
 * Returns { action: 'ok' | 'warn' | 'switch' | 'wait-window' | 'blocked', reasons: string[] }.
 */
export function decide({ active, other, now, autoswitch, quota = QUOTA_CU_HOURS }) {
  const reasons = [];
  const horizon = hoursUntilNextWindowEnd(now);
  const projectedNextWindow = active.cuHours + active.burnPerHour * horizon;
  const projectedAtReset = active.cuHours + active.burnPerHour * active.hoursToReset;
  const overThreshold = active.pct >= SWITCH_AT;
  const wouldRunOut = projectedNextWindow >= quota * 0.98;
  if (!overThreshold && !wouldRunOut) {
    const warn = active.pct >= 0.75;
    if (warn) reasons.push(`live project at ${(active.pct * 100).toFixed(1)}% - not yet at ${SWITCH_AT * 100}%`);
    return { action: warn ? "warn" : "ok", reasons, projectedNextWindow, projectedAtReset };
  }
  if (projectedAtReset < quota * 0.97) {
    reasons.push(`over threshold but the allowance resets at ${active.resetAt} before it can run out (projected ${projectedAtReset.toFixed(1)} CU-h)`);
    return { action: "warn", reasons, projectedNextWindow, projectedAtReset };
  }
  reasons.push(overThreshold
    ? `live project at ${(active.pct * 100).toFixed(1)}% (>= ${SWITCH_AT * 100}%)`
    : `live project would reach ${projectedNextWindow.toFixed(1)} CU-h before the next window ends`);
  if (other.pct >= TARGET_MAX_START) {
    reasons.push(`standby project ${other.name} cannot take over: already ${(other.pct * 100).toFixed(1)}% used`);
    return { action: "blocked", reasons, projectedNextWindow, projectedAtReset };
  }
  // A short-lived standby is still better than running out: switch, but say so loudly.
  const otherAtReset = other.cuHours + active.burnPerHour * other.hoursToReset;
  if (otherAtReset >= quota * SWITCH_AT) {
    reasons.push(`WARNING: at this burn rate ${other.name} also passes ${SWITCH_AT * 100}% before its reset (projected ${otherAtReset.toFixed(1)} CU-h) - cut usage or upgrade the Neon plan`);
  }
  if (!inSwitchWindow(now)) {
    reasons.push("outside 02:00-04:30 IST - will switch in the next window");
    return { action: "wait-window", reasons, projectedNextWindow, projectedAtReset };
  }
  if (!autoswitch) {
    reasons.push("auto-switch is OFF (repository variable NEON_GUARD_AUTOSWITCH != on) - alert only");
    return { action: "blocked", reasons, projectedNextWindow, projectedAtReset };
  }
  return { action: "switch", reasons, projectedNextWindow, projectedAtReset };
}

/** New target database name, e.g. fq_guard_202611152045 (UTC). */
export function newDatabaseName(now) {
  const s = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return GUARD_DB_PREFIX + s;
}

/**
 * Old guard-made copies to delete in one project: keep the live one and the newest other guard
 * copy (one previous backup); delete older guard copies. NEVER returns a name without the
 * fq_guard_ prefix, the live database, or anything when the live name is unknown.
 */
export function cleanupPlan(databaseNames, liveName) {
  if (!liveName) return [];
  const guard = databaseNames.filter((n) => /^fq_guard_\d{12}$/.test(n) && n !== liveName).sort().reverse();
  return guard.slice(1);
}

/** host / endpoint / database / user from a postgres URL (no password returned). */
export function describeDbUrl(url) {
  const m = /^postgres(?:ql)?:\/\/([^:@/]*)(?::[^@/]*)?@([^/:?]+)(?::\d+)?\/([^?]*)/.exec(String(url || ""));
  if (!m) return null;
  const host = m[2];
  return { user: decodeURIComponent(m[1]), host, endpoint: host.split(".")[0], database: decodeURIComponent(m[3]) };
}

/** Prisma-ready DIRECT URL with sslmode=require (Neon connection_uri may carry other params). */
export function prismaUrl(uri) {
  const u = new URL(uri);
  if (u.hostname.split(".")[0].endsWith("-pooler")) throw new Error("refusing a pooled host");
  u.search = "?sslmode=require";
  return u.toString();
}

/** One-line markdown summary row. */
export function usageRow(u, live) {
  return `| ${live ? "**LIVE** " : ""}${u.name} | ${u.cuHours.toFixed(2)} | ${(u.pct * 100).toFixed(1)}% | ${(u.burnPerHour * 24).toFixed(2)} | ${u.resetAt.slice(0, 10)} |`;
}
