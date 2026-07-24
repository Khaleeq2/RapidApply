# RapidApply

RapidApply is a web-first job-search campaign product with a separate browser executor.

The governing product strategy, tenant model, execution boundaries, and
capability roadmap live in the
[RapidApply product blueprint](docs/product-blueprint/README.md).

## Workspace layout

- `apps/web` — Next.js dashboard and MVP backend surface.
- `apps/extension` — clean-room Manifest V3 browser helper.
- `packages/contracts` — shared task, event, and browser-bridge contracts.

## Development

```bash
pnpm install
cp .env.example .env
pnpm dev
pnpm dev:extension
```

The checked-in `.env.example` starts the web app with a local SQLite database.
The ignored root `.env` can instead select Turso for hosted development. See
[campaign-persistence.md](docs/architecture/campaign-persistence.md) for the
schema, migration workflow, and production authentication boundary.

Authentication is implemented with self-hosted Better Auth and the existing
Drizzle/libSQL database. Local development uses SQLite and console email links;
production requires a random `BETTER_AUTH_SECRET` and a configured email sender.
See [authentication.md](docs/architecture/authentication.md) for the setup and
identity-ownership boundary.

## Database

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:check
pnpm db:migrate:turso
pnpm verify:executor-handoff
pnpm verify:candidate-profile
pnpm verify:ai-drafting
pnpm verify:application-answer-policy
pnpm test
```

Always generate and apply migrations locally before applying the same migration
history to Turso. Do not commit `.env` or the local SQLite file.

Run a production verification with:

```bash
pnpm build
```

The browser helper supports a dedicated-tab campaign handoff, durable recovery,
a scoped progress channel, LinkedIn observation, action-free result discovery,
and a local visual audit. It does not yet open applications, click application
controls, type, upload, or submit. See
[extension-foundation.md](docs/architecture/extension-foundation.md) and
[linkedin-observer.md](docs/architecture/linkedin-observer.md), plus
[executor-ignition-and-recovery.md](docs/architecture/executor-ignition-and-recovery.md), for the exact
permission, evidence, and staged action boundary.

The Resume & Profile screen now saves structured, candidate-authored facts.
Resume-file uploads remain intentionally unavailable until durable object
storage and retention/deletion rules are selected.

The optional **Draft with AI** control is server-side and candidate-initiated.
It sends only the profile headline, location, and current summary to one
explicitly configured provider; its draft is never saved automatically. See
[ai-drafting.md](docs/architecture/ai-drafting.md) for the provider, data, and
review boundary.
