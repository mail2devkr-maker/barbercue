# Deployment and rollback

Nothing has been deployed, pushed or run against production.

## Deploy (after approval)

1. Back up the database. Migration `20261126100000_fastque_home` adds tables, enums, the `btree_gist` extension and reference catalogue rows (no prices, no providers). It changes no existing table. The database role must be allowed to create `btree_gist` (check on Neon first; it is on Neon's supported list to the best of our knowledge but was not tested there).
2. Deploy backend and website with every flag unset. Behaviour is unchanged except the new admin section.
3. Set `OTP_HASH_SECRET` (already required), private storage, and optionally OSRM.
4. Review catalogue and settings in Admin → FastQue Home. Approve pilot providers.
5. Turn on `FASTQUE_HOME_ENABLED` plus one provider flag and `HOME_SCHEDULED_BOOKING_ENABLED`; build the website with `NEXT_PUBLIC_FASTQUE_HOME_ENABLED=true`. Add instant and tracking later.

Keep the order: backend before website.

## Rollback

- **Stop new business:** unset `FASTQUE_HOME_ENABLED`. Existing visits can still be viewed, completed, cancelled, paid and disputed.
- **Code:** redeploy the previous version. The new tables are ignored by old code. Do this only when no visit is open, because the old code does not know staff are out.
- **Schema (only if no home data must be kept):** drop all `home_*` tables and `professional_commitments`, the `Home*` and `ProfessionalCommitmentKind` types, function `home_reject_mutation`, and the migration's row in `_prisma_migrations`. Leave `btree_gist`. Take a backup first.

## Local demo

`apps/backend/scripts/home-demo-seed.cjs` refuses anything except a local database named `home_demo`. It creates clearly named DEMO providers, no reviews, no bookings, no passwords.
