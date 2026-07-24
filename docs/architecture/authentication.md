# Authentication

RapidApply uses self-hosted Better Auth with the existing Drizzle/libSQL
database. Passwords are never stored in the RapidApply product tables; Better
Auth stores a one-way password hash in its `account` table and manages sessions
in its `session` table.

## Local development

The local setup uses SQLite and console email delivery:

```text
RAPIDAPPLY_DATABASE_MODE=local
AUTH_EMAIL_MODE=console
```

Verification and password-reset links are written to the server log. This is
deliberately free and is only suitable for local testing.

## Production

Configure a long random `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and
a real email sender:

```text
BETTER_AUTH_SECRET=<long random secret>
BETTER_AUTH_URL=https://app.example.com
AUTH_EMAIL_MODE=resend
RESEND_API_KEY=<server-only key>
RESEND_FROM_EMAIL=RapidApply <no-reply@example.com>
```

Production sign-up requires email verification. API routes validate the Better
Auth session on the server and then provision/link the corresponding RapidApply
product user by `auth_subject`, preserving ownership of existing campaigns and
profiles.

The browser dashboard is session-gated. Sign-out uses Better Auth's origin and
CSRF protections. The browser extension never receives a password or auth
secret; it continues to use the separate, short-lived campaign execution
capabilities.
