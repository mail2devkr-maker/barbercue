// Repository protection against committing local QA sign-in helpers and fixture credential files (see scripts/qa-credential-guard.cjs).
// The last test runs the guard over the real repository, so a commit that adds such a file fails the website CI job.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORBIDDEN_NAME, findProblems, isForbiddenName, looksLikeCredentialJson, looksLikeLoginHelper } from "../../scripts/qa-credential-guard.cjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

describe("QA file names", () => {
  it("flags QA helper pages and fixture credential files wherever they sit", () => {
    for (const name of [
      "apps/web/public/__qa_login.html",
      "apps/web/public/__qa_login_admin.html",
      "apps/web/public/__qa_login_barber.html",
      "__qa_anything.js",
      "qa-creds.json",
      "C:/work/qa-creds-2.json",
      "apps/backend/prisma/.test-shop-credentials.json",
      "tmp/fastque-admin-qa-1760000000.json",
      "docs/shop-qa-credentials.json",
    ]) {
      expect(isForbiddenName(name)).toBe(true);
    }
  });

  it("does not flag ordinary files, including ones with qa in the name", () => {
    for (const name of [
      "apps/web/public/brand/mark.png",
      "apps/web/lib/qa-helpers.ts",
      "apps/web/components/owner/__tests__/DemoDashboard.test.jsx",
      "docs/qa-plan.md",
      "apps/backend/prisma/seed-platform-admin-browser-qa.ts",
      "apps/web/scripts/qa-credential-guard.cjs",
    ]) {
      expect(isForbiddenName(name)).toBe(false);
    }
    expect(FORBIDDEN_NAME.length).toBeGreaterThan(3);
  });
});

describe("served file content", () => {
  it("recognises a login helper page that carries a password", () => {
    const helper = '<script>fetch("/api/v1/auth/staff/login",{method:"POST",body:JSON.stringify({"email":"a@b.test","password":"x"})})</script>';
    expect(looksLikeLoginHelper(helper)).toBe(true);
    expect(looksLikeLoginHelper('fetch("/api/v1/auth/admin/login",{body:JSON.stringify({totpCode:"123456"})})')).toBe(true);
  });

  it("does not flag a page that only mentions the words", () => {
    expect(looksLikeLoginHelper("<p>Sign in with your password</p>")).toBe(false);
    expect(looksLikeLoginHelper('fetch("/api/v1/auth/staff/login")')).toBe(false);
    expect(looksLikeLoginHelper("")).toBe(false);
  });

  it("recognises a JSON fixture holding an email with a password or authenticator secret", () => {
    expect(looksLikeCredentialJson('{"email":"a@b.test","password":"x"}')).toBe(true);
    expect(looksLikeCredentialJson('{ "email": "a@b.test", "totpSecret": "ABC" }')).toBe(true);
    expect(looksLikeCredentialJson('{"email":"a@b.test"}')).toBe(false);
    expect(looksLikeCredentialJson('{"password":"x"}')).toBe(false);
  });
});

describe("findProblems on a scratch repository", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-guard-"));
    fs.mkdirSync(path.join(root, "apps", "web", "public"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds nothing in a clean tree", () => {
    fs.writeFileSync(path.join(root, "apps", "web", "public", "robots.txt"), "User-agent: *");
    expect(findProblems(root, { useGit: false })).toEqual([]);
  });

  it("finds a QA helper page in the served folder by name and by content, without printing its content", () => {
    fs.writeFileSync(path.join(root, "apps", "web", "public", "__qa_login.html"), '<script>fetch("/api/v1/auth/staff/login",{body:JSON.stringify({"password":"secret-value"})})</script>');
    const problems = findProblems(root, { useGit: false });
    expect(problems.map((p) => p.path)).toContain("apps/web/public/__qa_login.html");
    expect(JSON.stringify(problems)).not.toContain("secret-value");
  });

  it("finds a renamed helper page by what it does", () => {
    fs.writeFileSync(path.join(root, "apps", "web", "public", "signin.html"), '<script>fetch("/api/v1/auth/admin/login",{body:JSON.stringify({password:"p",totpCode:"1"})})</script>');
    const problems = findProblems(root, { useGit: false });
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toContain("authentication route");
  });

  it("finds a credential JSON file in a served folder, and a fixture file anywhere", () => {
    fs.writeFileSync(path.join(root, "apps", "web", "public", "accounts.json"), '{"email":"a@b.test","password":"p"}');
    fs.writeFileSync(path.join(root, "qa-creds.json"), "{}");
    const paths = findProblems(root, { useGit: false }).map((p) => p.path).sort();
    expect(paths).toEqual(["apps/web/public/accounts.json", "qa-creds.json"]);
  });
});

describe("this repository", () => {
  it("has no QA helper page, fixture credential file or credential-bearing served file", () => {
    expect(findProblems(REPO_ROOT)).toEqual([]);
  });
});
