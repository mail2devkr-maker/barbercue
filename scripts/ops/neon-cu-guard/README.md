# Neon CU guard

Production runs on Neon's **Free plan**: every project gets 100 CU-hours of compute per month. When the
live project runs out, Neon suspends the database and FastQue goes down. The guard prevents that.

- **Every day at 09:00 IST** it posts the usage of both FastQue projects to the GitHub issue labelled
  `neon-cu-guard` (you are assigned, so GitHub e-mails you).
- **Every night between 02:00 and 04:30 IST** it checks again. If the live project is at **90% or more**
  (or would run out before the next night), and the standby project is less than 50% used, it moves
  production to the standby project. That is the same procedure that was done by hand on 15 Nov 2026:
  1. Create a NEW EMPTY database `fq_guard_YYYYMMDDHHMM` on the standby project.
  2. Stop the Railway backend and website (writer freeze). The site is down for about 5-10 minutes.
  3. Copy with `pg_dump | pg_restore --single-transaction`. The source database is only read.
  4. Prove the copy: same tables, same migration ledger, same per-table row digest.
  5. Point `DATABASE_URL` and `DIRECT_DATABASE_URL` of the backend at the new database.
  6. Redeploy the backend, then the website, at the exact commits that were live. Check the backend
     health, the backend's sessions on the new database, and fastque.com.
  7. Keep the old database unchanged as the previous copy. Older guard copies (`fq_guard_*` only)
     are deleted, so each project keeps the live copy plus one previous copy. Databases with any other
     name are **never** deleted.
- **If anything fails**, it puts everything back: the old variables and a redeploy on the unchanged
  old database. It then reports the failure and mentions you. If even the rollback fails, the report
  says **CRITICAL** and the site may be down (see "Manual recovery" below).
- It runs in GitHub Actions (cloud). No PC or laptop has to be on.

Production projects (pinned in `guard.mjs`):

| Project | Neon id | endpoint |
|---|---|---|
| BarberCue (P1) | `crimson-field-96192935` | `ep-bold-boat-az50sm0r` |
| FastQue Production 2026-09 Recovery (P2) | `muddy-paper-72512632` | `ep-silent-meadow-b3orxmoc` |

Rehearsals use only the test projects `damp-queen-75773024` (source) and `misty-brook-21882562` (target).

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
