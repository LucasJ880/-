# Incident Postmortem — 2026-08-24 Prisma db push to Production

## Summary
At ~2026-08-24T22:18Z, during B2 (approval-CAS) test preparation, `prisma db push --accept-data-loss` intended for a throwaway `localhost:5433` database executed against the production Neon database instead. The operator had overridden only `DATABASE_URL` inline; the repo-local `.env` supplied a production `DIRECT_URL`, and Prisma CLI DDL resolves `directUrl` (declared in `prisma/schema.prisma`), so the push forced production to exactly match HEAD `schema.prisma`.

## Impact (forensically confirmed via Neon PITR branch @ 22:14:46Z)
- Dropped: 11 tables + 18 columns (on `AgentTask`/`AgentRun`) + their indexes/FK constraints — **all belonging to paused/superseded experiment lines** (pre-greenfield "phase4 bid data layer" migrations, now in `prisma/migrations_legacy_pre_greenfield_baseline/`, plus `bid_workflow_phase1` from a paused branch). None referenced by deployed code.
- Data loss: **LOW** — 26 rows across 5 tables + column values on 24 `AgentTask` rows, all written 2026-07-24 and untouched for 31 days; 6 of 11 tables were empty. Zero live business data affected.
- Not damaged: all 23 current migrations & `_prisma_migrations` history intact; production schema now equals HEAD `schema.prisma`; the running app remained fully compatible; zero production writes occurred during the incident window (verified); one missing schema index was actually created and one unique index renamed (normalizations).

## Root cause
1. Local developer `.env` carried production `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
2. `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`; Prisma CLI (6.19.2) uses `directUrl` for DDL, so inline `DATABASE_URL=localhost` changed nothing.
3. No guard validated URL-pair consistency or blocked production targets for destructive CLI commands (runtime isolation guards cover the app layer only).
4. Output piping (`| tail`) masked the connection banner until after execution.

## Decision
`RECOVERY_RECOMMENDATION = NO_RESTORE_REQUIRED` (restoring would re-create the drift; local restore parachute + PITR branch `br-fancy-leaf-an24kh74` retained). `PRODUCTION_RESTORE_EXECUTED = NO`.

## Prevention (B0, this change)
- `src/lib/db-safety/target.ts` + `command-policy.ts` + `safe-cli.ts`: sanitized target identification (reusing the single production-endpoint registry in `env/runtime-isolation.ts`), DATABASE_URL/DIRECT_URL logical-pair validation, fail-closed command policy.
- Guarded entrypoints: `npm run db:target:check` / `db:push:dev` / `db:push:safe` / `db:migrate:dev` — guard evaluates the exact env Prisma would use and pins it into the child process; blocked commands never spawn Prisma.
- Policy: production `db push` ALWAYS blocked (break-glass cannot override; `--accept-data-loss` has its own hard-block code); production `migrate dev`/`reset` always blocked; staging destructive blocked; production `migrate deploy` preflight requires a per-ticket `ALLOW_PRODUCTION_DB_MUTATION=<token>` (permanent booleans rejected) — actual deploys continue through the pre-existing `scripts/safe-migrate-deploy.ts` convention.
- `.env.example`: production URLs must not live in daily local `.env`; raw `npx prisma db push`/`migrate dev` documented as unsupported.
- Mandatory regression test recreates the incident shape (local `DATABASE_URL` + production `DIRECT_URL` + `push --accept-data-loss`) and asserts BLOCKED with zero Prisma spawns.

No secrets, connection strings, or customer data appear in this document or in the committed tests (fixtures use synthetic credentials).
