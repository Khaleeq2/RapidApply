# Executor ignition and recovery

## Purpose

RapidApply starts browser work through a dedicated, user-opened execution tab.
The design preserves the original PowerApply initializer pattern—prepare data,
open a known page, let the extension recognize it, then continue in that same
tab—while removing page-owned task state and implicit background globals.

The ignition boundary has four invariants:

1. The campaign is durable before browser work starts.
2. A one-time ticket never appears in a URL or third-party page.
3. One exact Chrome tab owns one executor session.
4. Every navigation can resume from a validated extension-private checkpoint.

## End-to-end handoff

```text
Dashboard click
  → synchronously open /launch/waiting in a dedicated named tab
  → save campaign through the authenticated API
  → issue a short-lived one-time execution ticket
  → store that ticket temporarily in RapidApply-origin localStorage
  → navigate the dedicated tab to /launch/:runId
  → extension content script verifies the exact origin and path
  → extension background atomically consumes the ticket
  → server returns a run-scoped event capability and execution plan
  → extension persists a private checkpoint bound to the exact tab
  → launch page receives the successful claim and deletes the raw ticket
  → launch page acknowledges deletion
  → background navigates that same tab to the planned LinkedIn search
```

The dashboard never broadcasts a task to whichever tab happens to be active.
The launch page is the explicit rendezvous point, and the tab ID recorded at
claim remains immutable for the life of that executor session.

## Why the waiting page exists

Browsers generally allow a new tab only during the original click. Saving a
campaign and issuing a ticket are asynchronous, so opening the tab afterward
can be blocked as a popup. `/launch/waiting` is opened synchronously, displays
an honest preparation state, and is navigated only when the server result is
ready.

This is the modern equivalent of PowerApply's original initializer hyperlink.
It is not a cosmetic route: it establishes tab ownership without active-tab
guessing.

## Ticket handling

The raw execution ticket is:

- scoped to one run;
- short-lived and single-use;
- stored by the server only as a hash;
- written only under the RapidApply web origin;
- read only by the matching `/launch/:runId` page;
- never placed in a query string, fragment, log, or LinkedIn storage; and
- deleted before the extension begins third-party navigation.

The extension stores only a SHA-256 fingerprint of the consumed ticket. That
fingerprint distinguishes an idempotent replay of the same handoff from a new,
server-issued recovery ticket without retaining the raw ticket.

## Durable extension checkpoint

The extension checkpoint lives in `chrome.storage.local` with access restricted
to trusted extension contexts. It contains:

- run and executor-session identity;
- exact executor tab ID;
- run-scoped event capability;
- controller origin;
- immutable execution plan;
- LinkedIn discovery page, limits, and deduplicated job buffer;
- the canonical post-discovery job currently being qualified, its bounded
  inspection budget, and its inspected IDs;
- current controller phase; and
- a small, enum-only reason when the controller is awaiting the candidate
  (answer, resume selection, final review, verification, security, or a
  deferred question); and
- the last named checkpoint and attempt count.

It contains no LinkedIn password, cookie, RapidApply database credential, or
general account session. The schema is validated on every read. The additive
version-one checkpoint is migrated deterministically to version two; malformed
or incomplete records are removed rather than guessed into a newer state.

`chrome.storage.local` is deliberate. Manifest V3 service workers are
disposable, and browser or extension-worker lifecycle must not erase the
controller's page-level checkpoint. The cloud run and append-only events remain
the authoritative product record; local storage is the durable executor cursor.

## Idempotency and recovery

The same launch message may be delivered more than once. If its run, tab,
origin, and ticket fingerprint all match the stored session, the extension
returns the already claimed run without calling the server again.

If the server run is active but the extension no longer owns it, the dashboard
offers an explicit reconnect. The recovery endpoint:

1. records `executor_recovery_prepared`;
2. revokes the former executor capability;
3. moves the run back to `ready`;
4. issues a new one-time ticket; and
5. lets a new executor session claim the same run.

An old executor cannot report progress after that transaction. A new ticket
for the same run has a different fingerprint, so it replaces rather than
replays the local checkpoint.

## LinkedIn discovery controller

After launch acknowledgement, the extension builds the search URL from the
server-issued execution plan and navigates only the bound tab. The controller
then advances from observed page state, not fixed cross-page delays:

```text
claimed
  → navigating_to_search
  → discovering_search
  → navigating_to_search (next page, when needed)
  → discovery_complete
  → navigating_to_job
  → qualifying_job
  → qualification_complete
  → processing_application
  → qualification_complete (next non-submitting step)
  → awaiting_user (only when a candidate decision is actually needed)
```

Discovery now deterministically selects the first saved canonical job, navigates
the same claimed tab to that exact URL, verifies the observed LinkedIn job ID,
and classifies it as qualified, explicitly skipped, or unable to verify.
Qualification requires an enabled Easy Apply control and respects the campaign's
explicit exclusion terms. For a qualified listing, the helper may open only the
visible Easy Apply surface. It first tries a standard packaged content-script
interaction and, only when necessary, a narrowly allowlisted trusted browser
input transport for that one non-submit action. A trusted input sequence is not
treated as proof: a separate observation must confirm that LinkedIn rendered an
application surface before the form controller can continue.

The form controller fills only values that have an approved, compatible source,
verifies each DOM result, and advances through verified steps. It never enters
credentials or bypasses a security challenge. The campaign's durable autonomy
policy determines whether a verified final-review action submits automatically
or pauses under strict control; `test_submit` is reserved for the isolated
submission verifier. The server records `application_submitted` only after
LinkedIn exposes a positive confirmation surface. Missing or weakly grounded
answers follow the campaign's explicit pause, defer, or skip policy. Resume,
review, verification, and answer checkpoints retain typed context across a
worker or browser restart.

## Discovery reliability retained from PowerApply

- The desired application count is expanded by a 20 percent candidate-pool
  buffer.
- Result cards are repeatedly scrolled into view to trigger lazy hydration.
- The list is returned to the beginning after hydration.
- Job IDs are extracted from data attributes first and links second.
- Link-only extraction remains as a fallback when card wrappers change.
- Jobs observed during every scroll cycle are accumulated, so virtualized DOM
  recycling cannot erase earlier discoveries.
- IDs and canonical URLs are deduplicated locally and by server idempotency
  keys.
- Pagination has an extra-page hydration margin, an eight-page hard ceiling,
  and an early stop as soon as the buffered pool is satisfied.
- Every discovered job is persisted in `job_listings` and represented by an
  append-only `job_discovered` event.

## Failure behavior

| Condition | Behavior |
| --- | --- |
| Popup blocked | Campaign remains saved; dashboard explains how to retry |
| Helper absent | Launch page stops with an installation/reload instruction |
| Ticket expired or replayed | Claim fails without revealing run existence |
| Wrong RapidApply path or origin | Handoff is rejected |
| Wrong LinkedIn tab | Observation and discovery result are rejected |
| Worker suspension | Next message reloads and validates the local checkpoint |
| Duplicate observation or event | Fingerprint/idempotency key prevents inflation |
| Login or security challenge | Run moves to `needs_user_input`; no bypass occurs |
| Unknown or stale discovery page | Controller stops without navigating forward |
| Wrong LinkedIn job detail | Controller records an intervention checkpoint; no application control is touched |
| Missing or disabled Easy Apply | Listing is recorded as skipped; no application UI is opened |
| Direct page click ignored | Helper uses the optional, fixed trusted-input action for Easy Apply only |
| Trusted input does not reveal a form | Run pauses with a visible retry checkpoint; it never assumes the form opened |
| Resume required | Preflight reuses the exact platform card without bytes or upload; an application on any step reasserts that target, otherwise reuses the managed local PDF or performs one verified upload |
| Final review reached | Autonomous campaigns submit; strict-control campaigns pause; every submission still requires final-review and LinkedIn confirmation evidence |
| Explicit recovery | Old capability is revoked before the replacement claim |

## Verification

The extension test suite covers URL construction, overscan, card and link
fallbacks, virtualized-card retention, deduplication, exact-tab ownership,
checkpoint serialization and migration, typed waiting-context validation,
per-page recording identity, malformed-state rejection, manual-auth resume,
deterministic job selection, exact job URL/ID verification, qualified/skipped
outcomes, deterministic form interactions, resume gating, and bounded trusted
input behavior.

`pnpm verify:executor-handoff` additionally proves one-time consumption,
replay rejection, explicit recovery, old-capability revocation, execution-plan
delivery, discovered-job persistence, event deduplication, and terminal
revocation against local SQLite.
