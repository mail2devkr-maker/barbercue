"use strict";

// Repository guard against committing local QA sign-in helpers and fixture credential files.
//
// Why: a disposable QA login page that contains a test account's email and password (written into a public folder so a browser can
// sign in without a person typing the secret) was once swept into a pushed commit by a blanket `git add`. Anything under a `public/`
// folder is also served to the world by the web app. Removing a file from the latest commit does not remove it from history, so the
// protection has to stop it getting there: the ignore rules in the root .gitignore, and this check, which the web test run executes
// (apps/web/lib/__tests__/repo-qa-credential-guard.test.jsx) so a commit that adds such a file fails the website CI job.
//
// Run by hand:   node apps/web/scripts/qa-credential-guard.cjs
// It never prints a credential: only the path and the reason.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** File names that are QA helpers or fixture credential files, wherever they sit in the repository. */
const FORBIDDEN_NAME = [
  /(^|\/)__qa_[^/]*$/i, // the local QA login helper pages, for example public/__qa_login.html
  /(^|\/)qa-creds[^/]*\.json$/i, // seeded demo accounts written by a local QA seeding script
  /(^|\/)[^/]*qa-credentials[^/]*\.json$/i,
  /(^|\/)fastque-admin-qa-[^/]*\.json$/i, // the disposable platform-admin fixture file (password and authenticator seed)
  /(^|\/)\.test-shop-credentials\.json$/i,
];

const SERVED_FOLDER = /(^|\/)public\//i;
const TEXT_EXTENSION = /\.(html?|js|cjs|mjs|json|txt|svg|xml|map)$/i;
const MAX_SCAN_BYTES = 512 * 1024;

function isForbiddenName(relativePath) {
  const p = String(relativePath).replace(/\\/g, "/");
  return FORBIDDEN_NAME.some((re) => re.test(p));
}

/**
 * A file served from a public folder that looks like a sign-in helper: it calls an authentication route and carries a password or a
 * one-time code. A static asset has no reason to do both.
 */
function looksLikeLoginHelper(content) {
  const text = String(content);
  const callsAuth = /\/auth\/[a-z/-]*(login|otp\/verify|verify)/i.test(text) || /auth\/(staff|admin|owner|employee)\/login/i.test(text);
  const carriesSecret = /["']?(password|passwd|totpCode|totp_secret|otpauth)["']?\s*[:=]/i.test(text);
  return callsAuth && carriesSecret;
}

/** A JSON fixture that holds an account's email together with its password or authenticator secret. */
function looksLikeCredentialJson(content) {
  const text = String(content);
  return /"email"\s*:/i.test(text) && /"(password|totpSecret)"\s*:/i.test(text);
}

function listTracked(root) {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out.split("\0").filter(Boolean);
  } catch {
    return null; // no git available: the caller falls back to walking the folders
  }
}

function walk(dir, root, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, found);
    else found.push(path.relative(root, full).replace(/\\/g, "/"));
  }
}

/** Every problem under `root`: a tracked or staged-able file with a forbidden name, or a served file that looks like a login helper. */
function findProblems(root, options = {}) {
  const problems = [];
  const files = (options.useGit === false ? null : listTracked(root)) ?? (() => {
    const found = [];
    walk(root, root, found);
    return found;
  })();
  for (const rel of files) {
    if (isForbiddenName(rel)) problems.push({ path: rel, reason: "QA helper or fixture credential file name" });
  }
  // Files an ignore rule hides from git are still served by the web app, so the public folders are also read from disk.
  const onDisk = [];
  for (const sub of ["apps/web/public", "apps/mobile/public"]) walk(path.join(root, sub), root, onDisk);
  for (const rel of onDisk) {
    if (isForbiddenName(rel) && !problems.some((p) => p.path === rel)) problems.push({ path: rel, reason: "QA helper or fixture credential file name (present on disk in a served folder)" });
  }
  for (const rel of new Set([...files, ...onDisk])) {
    if (!SERVED_FOLDER.test(rel) || !TEXT_EXTENSION.test(rel)) continue;
    let content;
    try {
      const full = path.join(root, rel);
      if (fs.statSync(full).size > MAX_SCAN_BYTES) continue;
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (looksLikeLoginHelper(content)) problems.push({ path: rel, reason: "served file calls an authentication route and carries a password or code" });
    else if (looksLikeCredentialJson(content)) problems.push({ path: rel, reason: "served JSON holds an account email with a password or authenticator secret" });
  }
  return problems;
}

module.exports = { FORBIDDEN_NAME, isForbiddenName, looksLikeLoginHelper, looksLikeCredentialJson, findProblems };

if (require.main === module) {
  const root = path.resolve(__dirname, "..", "..", "..");
  const problems = findProblems(root);
  if (problems.length === 0) {
    console.log("QA credential guard: nothing found.");
  } else {
    console.error("QA credential guard: remove these before committing (and never push them):");
    for (const p of problems) console.error(` - ${p.path}: ${p.reason}`);
    process.exit(1);
  }
}
