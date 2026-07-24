# Clean-room browser-helper handoff

The browser helper is a local executor, not the source of truth. The web app
and backend own the customer account, campaign strategy, durable history, and
future billing. The helper now provides a secure dedicated-tab handoff, a
scoped progress channel, a LinkedIn state observer, bounded development-only
diagnostics, search discovery, exact-tab job qualification, and verified
Easy Apply execution. It can preflight and reuse the campaign résumé, open Easy
Apply, preserve LinkedIn-prepopulated values, fill validated profile/AI answers,
advance dynamic steps, and submit when the campaign policy authorizes it. It
never enters credentials or bypasses a challenge, and it records submission
only after LinkedIn confirmation.

```text
Web app saves a ready campaign
        ↓
Dashboard synchronously opens a dedicated RapidApply launch tab
        ↓
Authenticated web API issues a short-lived, one-time ticket
        ↓
Launch page reads the ticket from temporary same-origin storage
        ↓
Background worker validates the exact /launch/:runId page, origin, and tab
        ↓
Capability endpoint consumes the ticket and changes ready → claimed
        ↓
Server issues a second, scoped event capability for that one claimed run
        ↓
Launch page deletes the ticket and acknowledges the successful claim
        ↓
Extension stores the capability and durable controller checkpoint privately
        ↓
The exact same tab navigates to the planned LinkedIn search
```

## What the claim means

`claimed` means the helper has successfully prepared a specific campaign. It
does **not** mean an application has started or a submission occurred. The
first accepted adapter observation emits `executor_started` and moves the run
to `running`; later application counters must still come only from explicit,
verified events.

```text
ready → claimed → running → paused → running
                  ↘ needs_user_input → running
running → completed | failed | cancelled
ready | claimed → cancelled
```

Only the capability-protected executor event path may move a run from `claimed`
to `running`. The normal web-session event route is deliberately limited to
user controls: pause, resume, and cancel.

## Ticket properties

- A ticket is issued by `POST /api/runs/:runId/executor-ticket` only after a
  signed-in user selects a `ready` campaign.
- The server stores a SHA-256 hash and expiry, never the raw ticket.
- The raw ticket is returned with `Cache-Control: no-store`, temporarily held
  under the RapidApply origin, read only by the exact launch route, and consumed by
  `POST /api/executor/claim`.
- A successful claim clears the stored hash and expiry atomically. A replay is
  rejected.
- The expiry is configurable with `RAPIDAPPLY_EXECUTION_TICKET_TTL_SECONDS`
  (five minutes to eight hours; two hours by default).

## Executor-event capability

A successful claim returns a second short-lived capability to the extension
background worker only. It authorizes the narrow executor APIs for exactly one
claimed run and matching executor session, including progress, answer planning,
interventions, and résumé delivery.

- The server stores only the SHA-256 hash and expiry, never the raw capability.
- The raw capability stays in trusted-context `chrome.storage.local`; it is never sent back
  to the RapidApply web page or exposed to dashboard JavaScript.
- Its expiry is configurable with `RAPIDAPPLY_EXECUTOR_EVENT_TTL_SECONDS`
  (five minutes to eight hours; four hours by default).
- It may report only executor lifecycle and progress events, such as
  `executor_started`, `page_loaded`, `job_discovered`, `job_qualified`,
  `application_prepared`, `application_submitted`,
  `application_skipped`, `user_input_required`, `run_completed`, and
  `run_failed`. It cannot pause, resume, cancel, or access arbitrary user API
  routes.
- A terminal run state or user cancellation clears the capability immediately;
  later reports are rejected.

The extension receives no database credential, Turso token, or general user
session token. Its checkpoint and scoped capability are extension-private and
survive worker or browser lifecycle; the backend remains the authoritative
campaign and event record.

## Permission boundary

The production Manifest V3 helper has host permissions for RapidApply's local
and production web origins plus `https://www.linkedin.com/*`. It does not
declare Chrome's `activeTab` permission and contains no screenshot capture
implementation. No other job board is permitted.

Visual capture can exist only in an explicitly enabled development build. It
is excluded from the production manifest and bundle so it cannot become a
hidden customer-facing feature by configuration accident.

See [linkedin-observer.md](linkedin-observer.md) for the exact data contract,
storage boundary, fixture coverage, and staged live-test process.

## Verification

Run the focused local verification from the workspace root:

```bash
pnpm verify:executor-handoff
```

It uses an ignored SQLite verification file and proves the one-time claim,
explicit recovery, scoped progress reporting, job persistence, terminal-state
revocation, and replay rejection. It
deliberately prints no ticket, capability, database URL, or credential.

For the complete deterministic MVP gate, run:

```bash
pnpm verify:mvp
```

This includes type checks, the extension fixture suite, candidate profile and
answer-resolution verifiers, the scoped handoff verifier, both production
builds, and the production-package permission scan. A passing command is not a
replacement for a bounded dedicated-account live browser run.

## Source-adapter boundary

Every supported source adapter, including the current LinkedIn adapter, needs
its own explicit design and review for:

- allowed hosts and narrowly scoped extension permissions;
- the candidate-approved data it may use;
- evidence required before recording a state change;
- how its existing scoped executor-event capability should be used and
  evidence required before it reports each event;
- pause, cancellation, recovery, and user-input paths;
- stored fixtures and regression tests for supported pages.

See [executor ignition and recovery](executor-ignition-and-recovery.md) for the
dedicated-tab protocol, local checkpoint, idempotency, discovery controller,
and fail-closed qualification checkpoint.

The original extension is useful reference material for interaction techniques,
but behavior is reimplemented only behind these modern state, security,
evidence, and permission boundaries. See the
[legacy execution audit](../engineering/legacy-powerapply-linkedin-audit.md).
