# Neon CU guard

Production runs on Neon's **Free plan**: every project gets 100 CU-hours of compute per month. When the
live project runs out, Neon suspends the database and FastQue goes down. The guard prevents that.

- **Every day at 09:00 IST** it posts the usage of both FastQue projects to the GitHub issue labelled
  `neon-cu-guard` (you are assigned, so GitHub e-mails you).
- **Every night between 00:00 and 05:30 IST** (a switch must start by 05:30 to finish before 06:00) it checks again. Daytime checks every 3 hours switch at once only when the allowance would run out before the next night (urgent, alert with @mention). If the live project is at **90% or more**
  (or would run out before the next night), and the standby project is less than 50% used, it moves
  production to the standby project. That is the same procedure that was done by hand on 15 Nov 2026:
  1. Create a NEW EMPTY database `fq_guard_YYYYMMDDHHMM` on the standby project.
  2. Stop the Railway backend (writer freeze). The website stays up and every visitor, on the site and in the app, sees an "under maintenance" screen for about 5-10 minutes; it clears by itself.
  3. Copy with `pg_dump | pg_restore --single-transaction`. The source database is only read.
  4. Prove the copy: same tables, same migration ledger, same per-table row digest.
  5. Point `DATABASE_URL` and `DIRECT_DATABASE_URL` of the backend at the new database.
  6. Redeploy the backend, then the website, at the exact commits that were live. Check the backend
     health, the backend's sessions on the new database, and fastque.com.
  7. Keep the old database unchanged as the previous copy. Older guard copies (`fq_guard_*` only)
     are deleted, so each project keeps the live copy plus one previous copy. Databases with any other
     name are **never** deleted.
- **If no standby project has room** (every other FastQue project is 50% or more used and has not
  reset yet), it **creates a new Neon project** named `FastQue Prod Auto YYYY-MM-DD`. The new project
  gets the same region, Postgres version and compute size, and the switch goes there. The Free plan
  allows 100 projects, 100 CU-hours each, and 20 GB of storage in total. The guard treats as production
  only the two pinned projects and projects whose name starts with `FastQue Prod Auto `. If the
  switch fails, the empty new project is deleted again. Note: moving production through new free
  projects to stay inside the free compute allowance may be against Neon's fair-use terms. The Launch
  plan ($0.106 per CU-hour) is the long-term answer.
- **If anything fails**, it puts everything back: the old variables and a redeploy on the unchanged
  old database. It then reports the failure and mentions you. If even the rollback fails, the report
  says **CRITICAL** and the site may be down (see "Manual recovery" below).
- It runs in GitHub Actions (cloud). No PC or laptop has to be on.

Production projects (pinned in `guard.mjs`):

| Project | Neon id | endpoint |
|---|---|---|
| BarberCue (P1) | `crimson-field-96192935` | `ep-bold-boat-az50sm0r` |
| FastQue Production 2026-09 Recovery (P2) | `muddy-paper-72512632` | `ep-silent-meadow-b3orxmoc` |

Rehearsals use only the test project `damp-queen-75773024` (two databases on it: source and target).

## One-time setup (owner)

1. **Neon API key.** In Neon Console, open your organization → Settings → API keys → Create, and copy it.
   In GitHub, open the repository → Settings → Secrets and variables → Actions → New repository secret.
   Name it `NEON_API_KEY` and paste the key.
2. **Railway token.** In Railway, open the FastQue project → Settings → Tokens. Create a token for the
   `production` environment and copy it. Add it as the GitHub secret `RAILWAY_TOKEN`.
3. **Rehearsal.** In GitHub, open Actions → *Neon CU guard* → Run workflow and choose mode `rehearse`.
   It does three things, and the result appears in the `neon-cu-guard` issue as "🧪 Rehearsal PASS":
   - a full copy-and-prove on the two test projects;
   - read-only checks of production;
   - a harmless Railway permission probe: a probe variable is set and removed again, with no deploy.
4. **Turn auto-switch on.** In repository → Settings → Secrets and variables → Actions → Variables, add
   the variable `NEON_GUARD_AUTOSWITCH` with the value `on`. Until it is `on`, the guard only reports
   and alerts.

To pause automatic switching, set `NEON_GUARD_AUTOSWITCH` to `off`.

Security: both secrets control production. Only workflows on this repository's default branch can read
them; pull requests from forks cannot. Do not give write access to people you would not give these keys to.

## Manual recovery (if a report says CRITICAL)

1. Open the run linked in the report and read its log. It never prints passwords.
2. In Railway, open the backend service → Variables. `DATABASE_URL` and `DIRECT_DATABASE_URL` must both
   point at one database: the old live one named in the report, unless the report says the switch
   completed.
3. Redeploy the backend, then the website, at the commit shown in the report.
4. Check `https://barbercuebackend-production.up.railway.app/api/v1/health` and `https://fastque.com/`.

## Development

```bash
node --test scripts/ops/neon-cu-guard/lib.test.mjs   # decision logic (also run by the workflow before every guard run)
```

`GUARD_NOW=2026-11-20T21:00:00Z` overrides the clock, for testing only.

## Running on Railway (primary since 26 Nov 2026)

GitHub runs scheduled workflows late and drops many of them (on 25-26 Nov only 1 of ~25 night checks
ran), so the auto checks run as a Railway cron job in the FastQue project:

- Service `neon-cu-guard`: built from `scripts/ops/neon-cu-guard/Dockerfile` (Node 22 + PostgreSQL 18
  client tools), cron `*/15 * * * *` (UTC) from `railway.json`. Each run takes about a minute and exits;
  the script itself enforces the 00:00-06:00 IST switch window and the daytime urgent rule.
  It only calls the Neon and Railway APIs unless it switches, so it does not wake the database.
- Variables on that service:
  - secrets, set by the owner: `NEON_API_KEY`, `RAILWAY_TOKEN` (the same values as the GitHub secrets),
    and `GITHUB_TOKEN`, a fine-grained token for this repository with Issues read/write only (for the
    tracking issue and alerts);
  - `NEON_GUARD_AUTOSWITCH=on`, `GITHUB_REPOSITORY=mail2devkr-maker/barbercue`.
- Once it runs, set the repository variable `NEON_GUARD_RUNNER=railway`. The scheduled auto checks in the
  GitHub workflow then stop, so two runners can never switch at the same time. The 09:00 IST daily
  report and manual runs (report / rehearse) stay on GitHub. To fall back to GitHub, delete that
  variable (and remove the Railway cron schedule).
