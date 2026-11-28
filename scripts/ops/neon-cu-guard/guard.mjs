#!/usr/bin/env node
// Neon CU guard - runs in GitHub Actions (.github/workflows/neon-cu-guard.yml); no local machine needed.
// Modes (GUARD_MODE): auto (default: report once a day, switch when needed), report, rehearse.
// Never prints a password or connection string (on GitHub they are also masked with ::add-mask::).
// Safety rules: the source database is never written; the target is always a NEW EMPTY database;
// any failure before the Railway variables change -> redeploy on the unchanged source;
// any failure after -> restore the previous variables and redeploy; every outcome is reported.
import { spawn } from "node:child_process";
import {
  AUTO_PROJECT_PREFIX, MAX_PROJECTS, autoProjectName, cleanupPlan, decide, describeDbUrl, istDay, newDatabaseName, pickStandby, prismaUrl, usageOf, usageRow,
} from "./lib.mjs";

const NEON = "https://console.neon.tech/api/v2";
const RAILWAY = "https://backboard.railway.com/graphql/v2";
const PROD = [
  { id: "crimson-field-96192935", endpoint: "ep-bold-boat-az50sm0r" },
  { id: "muddy-paper-72512632", endpoint: "ep-silent-meadow-b3orxmoc" },
];
// Test project only (divine-darkness and misty-brook are over their own quotas -> 423). Source and target are two databases on it.
const REHEARSAL = { source: "damp-queen-75773024", target: "damp-queen-75773024" };
const RW = {
  project: "0a338e79-e96a-4aac-99c9-8e94d48a2f03",
  env: "41bff3cc-5c98-4c6d-9aa6-33cc519badb1",
  backend: "7cd12053-1973-4622-9cdd-91656a9b5e92",
  web: "23e368ec-d309-48fc-a697-b4968ed567cf",
};
const HEALTH_URL = "https://barbercuebackend-production.up.railway.app/api/v1/health";
const SITE_URL = "https://fastque.com/";
const ROLE = "neondb_owner";
const DB_KEYS = ["DATABASE_URL", "DIRECT_DATABASE_URL"];
const MODE = process.env.GUARD_MODE || "auto";
const AUTOSWITCH = (process.env.NEON_GUARD_AUTOSWITCH || "").trim().toLowerCase() === "on";
const NOW = process.env.GUARD_NOW ? new Date(process.env.GUARD_NOW) : new Date();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ::add-mask:: is a GitHub Actions command. Anywhere else (Railway cron) it would print the
// secret in plain text into the logs, so it is written only inside GitHub Actions.
function mask(secret) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  if (secret) process.stdout.write(`::add-mask::${secret}\n`);
  try {
    const u = new URL(secret);
    if (u.password) process.stdout.write(`::add-mask::${decodeURIComponent(u.password)}\n`);
  } catch { /* not a URL */ }
}
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

// ------------------------------------------------------------------ Neon API
async function neon(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(NEON + path, {
      method, headers: { Authorization: `Bearer ${need("NEON_API_KEY")}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 423 || r.status === 429 || r.status >= 500) {
      if (attempt >= 8) throw new Error(`Neon ${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      await sleep(6000 * attempt);
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`Neon ${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }
}
async function waitOps(projectId, ops) {
  for (const op of ops || []) {
    for (let i = 0; i < 60; i++) {
      const { operation } = await neon("GET", `/projects/${projectId}/operations/${op.id}`);
      if (operation.status === "finished") break;
      if (["failed", "error", "cancelled"].includes(operation.status)) throw new Error(`Neon operation ${op.action} ${operation.status}`);
      await sleep(3000);
    }
  }
}
const getProject = async (id) => (await neon("GET", `/projects/${id}`)).project;
async function orgProjects() {
  const org = (await getProject(PROD[0].id)).org_id;
  const q = new URLSearchParams({ limit: "400", ...(org ? { org_id: org } : {}) });
  return (await neon("GET", `/projects?${q}`)).projects;
}
/** Pinned production projects plus projects the guard created ("FastQue Prod Auto ..."). */
async function prodCandidates() {
  const list = PROD.map((p) => ({ ...p, pinned: true }));
  for (const p of await orgProjects()) {
    if (!p.name?.startsWith(AUTO_PROJECT_PREFIX) || list.some((x) => x.id === p.id)) continue;
    const b = await defaultBranch(p.id);
    const e = await rwEndpoint(p.id, b.id);
    list.push({ id: p.id, endpoint: e.id, pinned: false });
  }
  return list;
}
/** Creates a new empty Neon project with the same region / Postgres / compute settings as `like`. */
async function createProject(name, like) {
  if ((await orgProjects()).length >= MAX_PROJECTS) throw new Error(`the Neon organisation already has ${MAX_PROJECTS} projects`);
  const r = await neon("POST", "/projects", {
    project: {
      name, region_id: like.region_id, pg_version: like.pg_version,
      default_endpoint_settings: {
        autoscaling_limit_min_cu: like.default_endpoint_settings?.autoscaling_limit_min_cu ?? 0.25,
        autoscaling_limit_max_cu: like.default_endpoint_settings?.autoscaling_limit_max_cu ?? 2,
      },
      ...(like.org_id ? { org_id: like.org_id } : {}),
    },
  });
  await waitOps(r.project.id, r.operations);
  const b = await defaultBranch(r.project.id);
  const e = await rwEndpoint(r.project.id, b.id);
  return { id: r.project.id, endpoint: e.id, pinned: false, name };
}
async function deleteProject(id, expectedPrefix) {
  const p = await getProject(id);
  if (!p.name?.startsWith(expectedPrefix) || PROD.some((x) => x.id === id)) throw new Error(`refusing to delete project ${id}`);
  await neon("DELETE", `/projects/${id}`);
}
async function defaultBranch(projectId) {
  const { branches } = await neon("GET", `/projects/${projectId}/branches`);
  const b = branches.find((x) => x.default) || branches.find((x) => x.primary);
  if (!b) throw new Error(`no default branch in ${projectId}`);
  return b;
}
async function rwEndpoint(projectId, branchId) {
  const { endpoints } = await neon("GET", `/projects/${projectId}/endpoints`);
  const e = endpoints.find((x) => x.branch_id === branchId && x.type === "read_write");
  if (!e) throw new Error(`no read_write endpoint on ${branchId}`);
  return e;
}
const listDbs = async (p, b) => (await neon("GET", `/projects/${p}/branches/${b}/databases`)).databases.map((d) => d.name);
/** Owner role: neondb_owner on production (required); on the test projects whatever role exists. */
async function ownerRole(p, b) {
  const { roles } = await neon("GET", `/projects/${p}/branches/${b}/roles`);
  const names = roles.map((r) => r.name);
  if (names.includes(ROLE)) return ROLE;
  if (PROD.some((x) => x.id === p)) throw new Error(`production project ${p} has no ${ROLE} role`);
  if (!names.length) throw new Error(`no role on ${p}/${b}`);
  return names[0];
}
async function createDb(p, b, name) {
  const r = await neon("POST", `/projects/${p}/branches/${b}/databases`, { database: { name, owner_name: await ownerRole(p, b) } });
  await waitOps(p, r.operations);
}
async function dropDb(p, b, name) {
  if (!/^fq_guard_/.test(name)) throw new Error(`refusing to drop ${name}`);
  const r = await neon("DELETE", `/projects/${p}/branches/${b}/databases/${encodeURIComponent(name)}`);
  await waitOps(p, r.operations);
}
async function connUri(p, b, db) {
  const q = new URLSearchParams({ branch_id: b, database_name: db, role_name: await ownerRole(p, b), pooled: "false" });
  const { uri } = await neon("GET", `/projects/${p}/connection_uri?${q}`);
  mask(uri);
  return prismaUrl(uri);
}

// ------------------------------------------------------------------ Railway API
async function railway(query, variables) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(RAILWAY, {
      method: "POST",
      headers: { "Project-Access-Token": need("RAILWAY_TOKEN"), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json().catch(() => ({}));
    if ((r.status >= 500 || r.status === 429) && attempt < 6) {
      await sleep(6000 * attempt);
      continue;
    }
    if (!r.ok || j.errors) throw new Error(`Railway ${r.status} ${JSON.stringify(j.errors || j).slice(0, 300)}`);
    return j.data;
  }
}
async function rwVars(serviceId) {
  const d = await railway("query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}", { p: RW.project, e: RW.env, s: serviceId });
  for (const k of DB_KEYS) if (d.variables[k]) mask(d.variables[k]);
  return d.variables;
}
async function rwSetDbUrl(url) {
  for (const name of DB_KEYS) {
    await railway("mutation($i:VariableUpsertInput!){variableUpsert(input:$i)}",
      { i: { projectId: RW.project, environmentId: RW.env, serviceId: RW.backend, name, value: url, skipDeploys: true } });
  }
  const v = await rwVars(RW.backend);
  if (!DB_KEYS.every((k) => v[k] === url)) throw new Error("Railway read-back does not match the intended database URL");
}
async function rwDeployments(serviceId, first = 5) {
  const d = await railway("query($p:String!,$e:String!,$s:String!,$n:Int){deployments(first:$n,input:{projectId:$p,environmentId:$e,serviceId:$s}){edges{node{id status createdAt meta}}}}",
    { p: RW.project, e: RW.env, s: serviceId, n: first });
  return d.deployments.edges.map((e) => e.node);
}
const INFLIGHT = new Set(["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"]);
async function liveDeployment(serviceId) {
  const deps = await rwDeployments(serviceId);
  if (deps.some((d) => INFLIGHT.has(d.status))) throw new Error(`a deployment is in flight on ${serviceId}; not switching now`);
  const live = deps.find((d) => d.status === "SUCCESS");
  const sha = live?.meta?.commitHash;
  if (!live || !/^[0-9a-f]{40}$/.test(sha || "")) throw new Error(`no SUCCESS deployment with a commit on ${serviceId}`);
  return { id: live.id, sha };
}
const rwRemove = (id) => railway("mutation($id:String!){deploymentRemove(id:$id)}", { id });
async function rwDeploy(serviceId, sha, label) {
  const d = await railway("mutation($e:String!,$s:String!,$c:String!){serviceInstanceDeployV2(environmentId:$e,serviceId:$s,commitSha:$c)}",
    { e: RW.env, s: serviceId, c: sha });
  const id = d.serviceInstanceDeployV2;
  log(`${label}: deployment ${String(id).slice(0, 8)} started at ${sha.slice(0, 8)}`);
  for (let i = 0; i < 90; i++) {
    await sleep(15000);
    const dep = (await rwDeployments(serviceId, 5)).find((x) => x.id === id);
    if (dep?.status === "SUCCESS") return id;
    if (dep && ["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(dep.status)) throw new Error(`${label} deployment ${dep.status}`);
  }
  throw new Error(`${label} deployment did not finish in time`);
}
async function httpOk(url, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status === 200) return true;
    } catch { /* retry */ }
    await sleep(10000);
  }
  return false;
}

// ------------------------------------------------------------------ Postgres (psql / pg_dump / pg_restore 18)
function pgEnv(url, readonly) {
  const u = new URL(url);
  return {
    ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGSSLMODE: "require", PGTZ: "UTC",
    ...(readonly ? { PGOPTIONS: "-c default_transaction_read_only=on -c extra_float_digits=1 -c datestyle=ISO,MDY -c timezone=UTC -c bytea_output=hex" } : {}),
  };
}
function run(cmd, args, env, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}: ${err.replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 300)}`))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}
const sql = async (url, q, readonly = true) => (await run("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], pgEnv(url, readonly))).trim();
const SESSIONS_SQL = "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend' and coalesce(usename,'') <> 'cloud_admin'";
const TABLES_SQL = "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'";
const ANY_TABLES_SQL = "select count(*) from information_schema.tables where table_schema='public'";
const LEDGER_SQL = "select count(*)||'|'||md5(coalesce(string_agg(migration_name||':'||coalesce(finished_at::text,'-')||':'||coalesce(rolled_back_at::text,'-'), ',' order by migration_name),'')) from _prisma_migrations";
async function digest(url) {
  const tables = (await sql(url, "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).split("\n").filter(Boolean);
  const lines = [];
  let rows = 0;
  for (const t of tables) {
    const r = await sql(url, `select count(*)||'|'||coalesce(md5(string_agg(md5(x::text), '' order by md5(x::text))), '-') from public."${t.replace(/"/g, '""')}" x`);
    rows += Number(r.split("|")[0]);
    lines.push(`${t}|${r}`);
  }
  const { createHash } = await import("node:crypto");
  return { tables: tables.length, rows, digest: createHash("md5").update(lines.join("\n")).digest("hex"), lines };
}
function copy(srcUrl, dstUrl) {
  return new Promise((resolve, reject) => {
    const dump = spawn("pg_dump", ["--format=custom", "--no-password"], { env: pgEnv(srcUrl, true), stdio: ["ignore", "pipe", "pipe"] });
    const rest = spawn("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--no-password", "--dbname", new URL(dstUrl).pathname.slice(1)],
      { env: pgEnv(dstUrl, false), stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    dump.stderr.on("data", (d) => { err += d; });
    rest.stderr.on("data", (d) => { err += d; });
    dump.stdout.pipe(rest.stdin);
    const codes = {};
    const done = () => {
      if (!("dump" in codes) || !("restore" in codes)) return;
      if (codes.dump === 0 && codes.restore === 0) resolve();
      else reject(new Error(`copy failed (pg_dump ${codes.dump}, pg_restore ${codes.restore}): ${err.replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 400)}`));
    };
    dump.on("close", (c) => { codes.dump = c; done(); });
    rest.on("close", (c) => { codes.restore = c; done(); });
    dump.on("error", reject);
    rest.on("error", reject);
  });
}

/** Copy src -> NEW EMPTY dst and prove it. Never writes src. Returns the parity facts. */
async function copyAndProve(srcUrl, dstUrl, { requireFrozen }) {
  if (requireFrozen) {
    let s = -1;
    for (let i = 0; i < 18; i++) {
      s = Number(await sql(srcUrl, SESSIONS_SQL));
      if (s === 0) break;
      await sleep(10000);
    }
    if (s !== 0) throw new Error(`source still has ${s} client session(s) after the freeze`);
  }
  if (Number(await sql(dstUrl, ANY_TABLES_SQL)) !== 0) throw new Error("target database is not empty");
  const t0 = Date.now();
  await copy(srcUrl, dstUrl);
  await sql(dstUrl, "analyze", false);
  const [a, b] = [await digest(srcUrl), await digest(dstUrl)];
  const ledgerA = await sql(srcUrl, LEDGER_SQL).catch(() => "none");
  const ledgerB = await sql(dstUrl, LEDGER_SQL).catch(() => "none");
  const facts = { seconds: Math.round((Date.now() - t0) / 1000), tables: `${a.tables}/${b.tables}`, rows: `${a.rows}/${b.rows}`, digest: a.digest, ledgerEqual: ledgerA === ledgerB };
  if (a.digest !== b.digest || a.tables !== b.tables || ledgerA !== ledgerB) {
    const diff = a.lines.filter((l, i) => l !== b.lines[i]).map((l) => l.split("|")[0]).slice(0, 10);
    throw new Error(`PARITY FAIL ${JSON.stringify(facts)} differing: ${diff.join(",")}`);
  }
  return facts;
}

// ------------------------------------------------------------------ GitHub issue (reports + alerts)
const GH = "https://api.github.com";
async function gh(method, path, body) {
  const r = await fetch(GH + path, {
    method, headers: { Authorization: `Bearer ${need("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path} -> ${r.status}`);
  return r.status === 204 ? {} : r.json();
}
async function trackingIssue() {
  const repo = need("GITHUB_REPOSITORY");
  const found = await gh("GET", `/repos/${repo}/issues?state=open&labels=neon-cu-guard&per_page=5`);
  if (found.length) return found[0].number;
  const owner = repo.split("/")[0];
  const created = await gh("POST", `/repos/${repo}/issues`, {
    title: "Neon CU guard - daily usage and automatic database switches",
    body: "Automated report from `.github/workflows/neon-cu-guard.yml`. Daily Neon compute usage, warnings, and every automatic switch (or refusal) are posted here.",
    labels: ["neon-cu-guard"], assignees: [owner],
  });
  return created.number;
}
async function post(text, { mention = false } = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  const body = (mention ? `@${repo.split("/")[0]} ` : "") + text + `\n\n<sub>${process.env.GITHUB_RUN_ID ? `run: ${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : "runner: Railway cron"} · mode ${MODE}</sub>`;
  log("REPORT:\n" + text);
  if (!process.env.GITHUB_TOKEN || !repo) return;
  try {
    const n = await trackingIssue();
    await gh("POST", `/repos/${repo}/issues/${n}/comments`, { body });
  } catch (e) {
    log("could not post to GitHub:", e.message);
    process.exitCode = 1;
  }
}
async function reportedToday() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!process.env.GITHUB_TOKEN || !repo) return false;
  const n = await trackingIssue();
  const comments = await gh("GET", `/repos/${repo}/issues/${n}/comments?per_page=30&sort=created&direction=desc`);
  const today = istDay(NOW);
  return comments.some((c) => istDay(new Date(c.created_at)) === today && /Daily Neon usage/.test(c.body || ""));
}

// ------------------------------------------------------------------ modes
async function status() {
  const vars = await rwVars(RW.backend);
  const live = describeDbUrl(vars.DATABASE_URL);
  const direct = describeDbUrl(vars.DIRECT_DATABASE_URL);
  if (!live || !direct || live.endpoint !== direct.endpoint || live.database !== direct.database) throw new Error("backend DATABASE_URL / DIRECT_DATABASE_URL missing or not pointing at the same database");
  const candidates = await prodCandidates();
  const activeCfg = candidates.find((p) => p.endpoint === live.endpoint);
  if (!activeCfg) throw new Error(`backend points at an unknown endpoint ${live.endpoint}`);
  const activeProject = await getProject(activeCfg.id);
  const standbys = [];
  for (const cfg of candidates.filter((c) => c !== activeCfg)) standbys.push({ cfg, usage: usageOf(await getProject(cfg.id), NOW) });
  const best = pickStandby(standbys.map((x) => x.usage));
  const otherCfg = best ? standbys.find((x) => x.usage === best).cfg : null;
  return { live, activeCfg, activeProject, otherCfg, active: usageOf(activeProject, NOW), other: best, standbys: standbys.map((x) => x.usage) };
}
function table(s) {
  return ["| project | CU-h used | of 100 | CU-h/day | resets |", "|---|---|---|---|---|", usageRow(s.active, true), ...s.standbys.map((u) => usageRow(u, false))].join("\n")
    + `\n\nLive database: \`${s.live.database}\` on \`${s.live.endpoint}\`.`;
}

async function switchOver(s, d) {
  let createdProject = null;
  if (d.target === "new") {
    try {
      createdProject = await createProject(autoProjectName(NOW), s.activeProject);
    } catch (e) {
      await post(`### 🔴 Switch needed but a new Neon project could not be created\n${e.message}\nProduction stays on **${s.active.name}** (${(s.active.pct * 100).toFixed(1)}% used). Nothing else was changed.`, { mention: true });
      process.exitCode = 1;
      return;
    }
    log(`created new project ${createdProject.id} (${createdProject.name})`);
    s.otherCfg = createdProject;
    s.other = { name: createdProject.name, pct: 0, cuHours: 0 };
  }
  const p = s.otherCfg.id;
  const srcBranch = await defaultBranch(s.activeCfg.id);
  const dstBranch = await defaultBranch(p);
  const dstEndpoint = await rwEndpoint(p, dstBranch.id);
  if (dstEndpoint.id !== s.otherCfg.endpoint) throw new Error(`standby endpoint is ${dstEndpoint.id}, expected ${s.otherCfg.endpoint}`);
  const backendLive = await liveDeployment(RW.backend);
  const webLive = await liveDeployment(RW.web);
  const oldVars = await rwVars(RW.backend);
  const srcUrl = await connUri(s.activeCfg.id, srcBranch.id, s.live.database);
  const newDb = newDatabaseName(NOW);
  let dstUrl = "";

  let stage = "prepare";
  try {
    await createDb(p, dstBranch.id, newDb);
    dstUrl = await connUri(p, dstBranch.id, newDb);
    log(`target ${newDb} created on ${s.otherCfg.id}`);
    stage = "freeze";
    // Only the backend (the only database writer) is stopped. The website keeps running and shows
    // every visitor the "under maintenance" screen while the API is unreachable (owner, 24 Nov);
    // the mobile app shows the same screen.
    await rwRemove(backendLive.id);
    log("frozen: backend stopped; website stays up showing the maintenance screen");
    stage = "copy";
    const facts = await copyAndProve(srcUrl, dstUrl, { requireFrozen: true });
    log("parity PASS", JSON.stringify(facts));
    stage = "variables";
    await rwSetDbUrl(dstUrl);
    stage = "deploy";
    await rwDeploy(RW.backend, backendLive.sha, "backend");
    if (!(await httpOk(HEALTH_URL))) throw new Error("backend health check failed after the switch");
    let sessions = 0;
    for (let i = 0; i < 12 && sessions === 0; i++) {
      sessions = Number(await sql(dstUrl, SESSIONS_SQL));
      if (!sessions) await sleep(10000);
    }
    if (!sessions) throw new Error("backend is up but has no session on the new database");
    const siteOk = await httpOk(SITE_URL);
    let cleaned = [];
    for (const [proj, branch, liveName] of [[p, dstBranch.id, newDb], [s.activeCfg.id, srcBranch.id, s.live.database]]) {
      for (const name of cleanupPlan(await listDbs(proj, branch), liveName)) {
        await dropDb(proj, branch, name);
        cleaned.push(`${proj}/${name}`);
      }
    }
    await post([
      d.urgent ? `### ✅ URGENT automatic database switch done (outside the night window)` : `### ✅ Automatic database switch done`,
      `Production moved from **${s.active.name}** (\`${s.live.database}\`, ${(s.active.pct * 100).toFixed(1)}% used) to **${s.other.name}** \`${newDb}\`${createdProject ? ` - a NEW Neon project \`${createdProject.id}\` was created for this switch` : ""}.`,
      `Why: ${d.reasons.join("; ")}`,
      `Copy ${facts.seconds} s · tables ${facts.tables} · rows ${facts.rows} · digest \`${facts.digest}\` · migration ledger equal ${facts.ledgerEqual}`,
      `Backend redeployed at its previous commit (${backendLive.sha.slice(0, 8)}); the website stayed up (maintenance screen during the copy). Health OK; website ${siteOk ? "OK" : "**not 200 - check**"}; backend sessions on the new database: ${sessions}.`,
      `The old database \`${s.live.database}\` is kept unchanged as the previous copy.${cleaned.length ? ` Removed older guard copies: ${cleaned.join(", ")}.` : ""}`,
    ].join("\n"), { mention: !siteOk || !!d.urgent });
  } catch (err) {
    log(`switch failed at stage ${stage}: ${err.message}`);
    const restore = [];
    try {
      if (stage === "variables" || stage === "deploy") {
        await rwSetDbUrl(oldVars.DATABASE_URL);
        if (oldVars.DIRECT_DATABASE_URL !== oldVars.DATABASE_URL) {
          await railway("mutation($i:VariableUpsertInput!){variableUpsert(input:$i)}",
            { i: { projectId: RW.project, environmentId: RW.env, serviceId: RW.backend, name: "DIRECT_DATABASE_URL", value: oldVars.DIRECT_DATABASE_URL, skipDeploys: true } });
        }
        restore.push("variables restored to the old database");
      }
      if (stage === "deploy" || (await rwDeployments(RW.backend, 3)).every((x) => x.status !== "SUCCESS")) {
        await rwDeploy(RW.backend, backendLive.sha, "backend (rollback)");
        restore.push(`backend back on ${s.live.database}: health ${(await httpOk(HEALTH_URL)) ? "OK" : "FAILED"}`);
      }
      if ((await rwDeployments(RW.web, 3)).every((x) => x.status !== "SUCCESS")) {
        await rwDeploy(RW.web, webLive.sha, "website (rollback)");
        restore.push(`website ${(await httpOk(SITE_URL)) ? "OK" : "FAILED"}`);
      }
      try { await dropDb(p, dstBranch.id, newDb); restore.push(`unused target ${newDb} removed`); } catch { /* keep it */ }
      if (createdProject) {
        try { await deleteProject(createdProject.id, AUTO_PROJECT_PREFIX); restore.push(`unused new project ${createdProject.name} deleted`); } catch { /* keep it */ }
      }
      await post(`### ⚠️ Automatic switch FAILED and was rolled back\nStage: ${stage}. Error: ${err.message}\nRollback: ${restore.join("; ") || "nothing to undo"}.\nProduction stays on **${s.active.name}** \`${s.live.database}\`. The guard will try again in the next window.`, { mention: true });
    } catch (rb) {
      await post(`### 🚨 CRITICAL: switch failed AND rollback failed\nStage: ${stage}. Error: ${err.message}\nRollback error: ${rb.message}\nDone so far: ${restore.join("; ") || "none"}.\n**The site may be down. Manual action needed now** (runbook: scripts/ops/neon-cu-guard/README.md).`, { mention: true });
    }
    process.exitCode = 1;
  }
}

async function rehearse() {
  const out = [];
  const src = REHEARSAL.source, dst = REHEARSAL.target;
  const sb = await defaultBranch(src), db = await defaultBranch(dst);
  const srcDb = newDatabaseName(NOW); // synthetic source, seeded below
  const dstDb = newDatabaseName(new Date(NOW.getTime() + 60_000));
  // Self-healing: remove guard copies left in the TEST projects by an earlier interrupted rehearsal.
  for (const [p, b] of [[src, sb.id], [dst, db.id]]) {
    for (const name of (await listDbs(p, b)).filter((n) => /^fq_guard_\d{12}$/.test(n))) {
      await dropDb(p, b, name);
      out.push(`removed leftover test copy ${p}/${name}`);
    }
  }
  try {
    await createDb(src, sb.id, srcDb);
    await createDb(dst, db.id, dstDb);
    const srcUrl = await connUri(src, sb.id, srcDb);
    const dstUrl = await connUri(dst, db.id, dstDb);
    await sql(srcUrl, `create extension if not exists pg_trgm;
      create table _prisma_migrations(id text primary key, migration_name text, finished_at timestamptz, rolled_back_at timestamptz);
      insert into _prisma_migrations values ('1','a',now(),null),('2','b',null,now());
      create table salons(id uuid primary key default gen_random_uuid(), name text, lat float8, created timestamptz default now());
      create index on salons using gin (name gin_trgm_ops);
      insert into salons(name, lat) select 'shop '||g, g*0.1 from generate_series(1,2000) g;
      create table bookings(id serial primary key, salon_id uuid references salons(id), note text, at timestamptz default now());
      insert into bookings(salon_id, note) select id, 'n' from salons;`, false);
    const facts = await copyAndProve(srcUrl, dstUrl, { requireFrozen: true });
    out.push(`DB copy rehearsal PASS: ${JSON.stringify(facts)}`);
  } finally {
    for (const [p, b, n] of [[src, sb.id, srcDb], [dst, db.id, dstDb]]) {
      try { await dropDb(p, b, n); } catch (e) { out.push(`could not remove ${p}/${n}: ${e.message}`); }
    }
    out.push("rehearsal databases removed");
  }
  // Production read-only probes: token scopes and identities, no change.
  const s = await status();
  out.push(`Railway read OK; live = ${s.live.database} on ${s.live.endpoint} (${s.active.name}); standby = ${s.other?.name ?? "none"}`);
  for (const cfg of PROD) {
    const b = await defaultBranch(cfg.id);
    const e = await rwEndpoint(cfg.id, b.id);
    out.push(`${cfg.id}: default branch ${b.name}, endpoint ${e.id} ${e.id === cfg.endpoint ? "matches" : "**MISMATCH**"}, databases: ${(await listDbs(cfg.id, b.id)).join(", ")}`);
  }
  const liveUrl = await connUri(s.activeCfg.id, (await defaultBranch(s.activeCfg.id)).id, s.live.database);
  out.push(`live database read-only probe: ${await sql(liveUrl, TABLES_SQL)} tables, ${await sql(liveUrl, SESSIONS_SQL)} app sessions`);
  const b = await liveDeployment(RW.backend), w = await liveDeployment(RW.web);
  out.push(`live deployments: backend ${b.sha.slice(0, 8)}, website ${w.sha.slice(0, 8)}`);
  // Railway write permission probe on a harmless variable (no deploy), then remove it.
  await railway("mutation($i:VariableUpsertInput!){variableUpsert(input:$i)}",
    { i: { projectId: RW.project, environmentId: RW.env, serviceId: RW.web, name: "NEON_GUARD_PROBE", value: NOW.toISOString(), skipDeploys: true } });
  await railway("mutation($i:VariableDeleteInput!){variableDelete(input:$i)}",
    { i: { projectId: RW.project, environmentId: RW.env, serviceId: RW.web, name: "NEON_GUARD_PROBE" } });
  out.push("Railway write permission OK (harmless probe variable set and removed, no deploy)");
  const probe = await createProject(`FastQue Rehearsal ${NOW.toISOString().slice(0, 16)}`, s.activeProject);
  await deleteProject(probe.id, "FastQue Rehearsal ");
  out.push(`new-project permission OK (created and deleted test project ${probe.id}, endpoint ${probe.endpoint})`);
  out.push(`production candidates: live ${s.activeCfg.id}; standbys ${s.standbys.map((u) => `${u.name} ${(u.pct * 100).toFixed(1)}%`).join(", ") || "none"}`);
  out.push(`decision now: ${JSON.stringify(decide({ active: s.active, other: s.other, now: NOW, autoswitch: AUTOSWITCH }))}`);
  await post(`### 🧪 Rehearsal PASS\n${out.map((l) => `- ${l}`).join("\n")}\n\n${table(s)}\n\nAuto-switch is **${AUTOSWITCH ? "ON" : "OFF"}**.`);
}

async function main() {
  log(`mode=${MODE} autoswitch=${AUTOSWITCH} now=${NOW.toISOString()}`);
  if (MODE === "rehearse") return rehearse();
  const s = await status();
  const d = decide({ active: s.active, other: s.other, now: NOW, autoswitch: AUTOSWITCH });
  log("decision", JSON.stringify(d));
  const daily = MODE === "report" || !(await reportedToday());
  if (d.action === "switch") return switchOver(s, d);
  if (daily || d.action === "blocked" || (d.action === "wait-window" && daily)) {
    const icon = { ok: "🟢", warn: "🟡", "wait-window": "🟠", blocked: "🔴" }[d.action];
    await post(`### ${icon} Daily Neon usage - ${istDay(NOW)} (IST)\n${table(s)}\n\nDecision: **${d.action}**${d.reasons.length ? ` - ${d.reasons.join("; ")}` : ""}. Auto-switch is **${AUTOSWITCH ? "ON" : "OFF"}**.`,
      { mention: d.action === "blocked" });
  }
}

main().catch(async (e) => {
  log("guard error:", e.message);
  await post(`### 🔴 Neon CU guard could not run\n${e.message}\nNothing was changed by this run.`, { mention: true }).catch(() => {});
  process.exitCode = 1;
});
