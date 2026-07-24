# Campaign persistence foundation

RapidApply now treats a job-search campaign as durable product data rather
than browser-tab state. The web app saves the campaign before any executor is
allowed to act, and the database is the authoritative record of its progress.

## Runtime modes

The root `.env` selects one of two database modes:

| Mode | Purpose | Database URL |
| --- | --- | --- |
| `local` | Default development and automated validation | `file:./data/rapidapply.local.db` |
| `turso` | Hosted environment | `TURSO_DATABASE_URL` with `TURSO_AUTH_TOKEN` |

The local SQLite file is ignored by Git. The Turso token remains in the
ignored root `.env`; only `.env.example` is safe to copy into another
environment.

## Schema ownership

Drizzle migrations in `apps/web/drizzle/` define the database contract.

- `users` and `candidate_profiles` persist structured, candidate-authored facts.
- `resumes` reserves a safe metadata layer for uploaded resume files; file uploads
  are intentionally unavailable until object storage, retention, and deletion
  behavior are selected.
- `campaigns` retains a user’s role, location, boards, and configuration.
- `application_runs` represents one execution attempt and its durable state.
- `job_listings` and `applications` hold future verified discovery and
  submission records.
- `run_events` is an append-only, idempotent execution audit trail.

The browser helper must never be the only holder of a campaign or its state.
It can restart, navigate away, or sleep without losing the authoritative run.

## State machine

```text
ready → claimed → running → paused → running
                  ↘ needs_user_input → running
running → completed | failed | cancelled
ready | claimed → cancelled
```

`claimed` is a prepared browser-helper session, not evidence of a started
application. The API rejects invalid state changes and rejects events after a
terminal state. `application_submitted` and `application_skipped` are
idempotent by event key, preventing retries from inflating counts.

## Current API surface

- `GET /api/health/database` — database readiness only; no credentials exposed.
- `GET /api/profile` — authenticated user’s structured candidate profile.
- `PUT /api/profile` — validate and save candidate-authored profile facts.
- `GET /api/runs` — current user’s saved campaigns.
- `POST /api/runs` — create a campaign and its first `ready` run; no executor
  capability is created as a side effect.
- `GET /api/runs/:runId` — run and ordered event history.
- `POST /api/runs/:runId/events` — append a validated user-control event
  (pause, resume, or cancel).
- `POST /api/runs/:runId/executor-ticket` — issue a short-lived, hashed,
  one-time browser-helper ticket for a `ready` run.
- `POST /api/executor/claim` — capability-only endpoint that consumes the
  ticket, changes the run to `claimed`, and issues an extension-private,
  run-scoped event capability.
- `POST /api/executor/events` — capability-only endpoint that records allowed
  executor progress for the claimed run. It rejects invalid, expired, or
  terminal-run capabilities and idempotently deduplicates retried event keys.
- `POST /api/profile/summary-draft` — candidate-initiated, server-side AI
  summary drafting through one explicitly configured provider. The response is
  not persisted until the candidate reviews and explicitly saves it.

Better Auth validates the server session and links its identity to a stable
RapidApply product user. A caller can never choose the authoritative user ID in
the request. See [authentication.md](authentication.md) for the identity
boundary.

Candidate-profile data remains inside the authenticated web API. The browser
helper does not receive it today, and a future executor must not infer, invent,
or use it to answer legal or otherwise uncertain application questions.

The optional AI summary draft sends only a candidate's headline, location, and
current summary. It excludes direct contact details, work authorization, and
profile links, is never saved automatically, and never silently falls back to
another provider. See [ai-drafting.md](ai-drafting.md) for the full boundary.

## Commands

From the repository root:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:check
pnpm db:migrate:turso
pnpm verify:candidate-profile
pnpm verify:ai-drafting
```

Generate a migration whenever the schema changes; apply it locally first; then
apply the same committed migrations to Turso. Do not use schema push commands
against the hosted database.

## Current browser-helper boundary

The signed web-to-helper handoff and scoped executor-event channel are
implemented. The helper validates the RapidApply origin, claims one ready run
through a one-time ticket, and stores only an ephemeral extension-private
checkpoint and event capability. See
[extension-foundation.md](extension-foundation.md) for the full trust boundary.

The next executor increment is an explicit adapter design. Site-specific
adapters remain intentionally absent until their consent model, permissions,
fixtures, and regression tests are defined.
