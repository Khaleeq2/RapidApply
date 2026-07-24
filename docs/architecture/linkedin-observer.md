# LinkedIn observer and controlled-execution architecture

## Current capability

RapidApply's LinkedIn adapter recognizes supported page states, observes the
shape of Easy Apply forms, and performs bounded discovery, qualification, and
verified form progression. It can build the campaign search URL, hydrate result
cards, collect stable job identities, verify canonical saved jobs, open Easy
Apply, fill grounded answers, resolve saved résumés, and progress dynamically
through application forms.

Submission follows the campaign's durable autonomy policy. An `autonomous`
campaign receives an `autonomous_submit` execution plan and may submit from a
verified final-review surface. A `strict_control` campaign receives a
`review_only` plan and pauses at review. In either mode, the content script
must observe LinkedIn's confirmation state before the server records
`application_submitted`. `test_submit` remains an isolated verification mode;
it is not the production autonomy setting.

```text
LinkedIn page
  → isolated content-script observer
  → strict observation-schema validation
  → extension background worker
      ├─ extension-private run checkpoint
      ├─ development-only local diagnostics (when explicitly enabled)
      └─ run-scoped progress event to RapidApply
```

The launch and recovery protocol is documented separately in
[executor-ignition-and-recovery.md](executor-ignition-and-recovery.md).

## Adapter states

The current observer recognizes:

- `login_required`
- `security_challenge`
- `search_results`
- `job_detail`
- `application_form`
- `application_review`
- `application_confirmation`
- `unsupported`

Application forms are further classified as contact, résumé, screening,
review, or unknown. Unknown states are observations, never permission to act.

## Observation contract

An observation may contain:

- adapter ID and version;
- timestamp and deterministic state fingerprint;
- URL path and query-parameter names, but not query values;
- page and application-step type;
- visible heading and non-sensitive job identity;
- form labels, control types, required/disabled flags, and whether a value is
  present;
- visible option labels paired with opaque deterministic IDs, plus validation
  messages;
- available action names, kinds, and disabled state.

It does not contain input values, selected candidate answers, cookies,
authorization headers, passwords, or the raw page HTML. The background worker
rejects extra object keys at the message boundary so a raw field value cannot
be smuggled into local or server evidence.

Opaque option IDs let a constrained decision service choose from an exact
allowlist without receiving or returning raw DOM values. The extension can map
the chosen ID back to the observed option locally.

Option lists are bounded at 300 entries, not 40. This covers ordinary country,
region, and dialing-code controls without making the observation contract
unbounded.

## Active application surface

LinkedIn can briefly retain an old Easy Apply subtree while rendering the next
step. The adapter therefore never assumes the first matching dialog is current.
It identifies the strongest visible application surface, favoring the legacy
Easy Apply modal and its `.jobs-easy-apply-form-element` groups before falling
back to a visible, bounded `Apply to …` container with local progress and
dismiss controls. The generic fallback begins at a local `Next`, `Continue`,
`Review`, or `Submit` action—not at arbitrary page fields—so LinkedIn's global
search header and unrelated controls can never become application fields.
Hidden, `aria-hidden`, global-navigation, and non-rendered ancestors are
excluded before field or action discovery.

The observer and the controlled form executor share this exact surface and
control-selection rule. That prevents a stale hidden or global-page control
from changing the field fingerprint, receiving a candidate answer, or shifting
the mapping between an observed descriptor and its live DOM control.

Select controls are considered already satisfied when their selected visible
option has a real label, even if LinkedIn exposes an empty native value. Known
placeholder labels such as `Select an option` remain actionable. Account-managed
contact details are therefore preserved rather than re-planned or overwritten.

## Development diagnostics

Visual capture is a development-only diagnostic, not a product feature. It is
compiled only into a development helper build when
`RAPIDAPPLY_VISUAL_AUDIT=true`. Production builds omit both Chrome's
`activeTab` permission and the browser screenshot implementation; no screenshot
control, export, or capture route is shipped to users.

When development capture is intentionally enabled, evidence stays in
extension-local storage and is never uploaded. Login and security-challenge
pages remain categorically excluded.

## Server progress boundary

The extension reports only summary metadata through the existing run-scoped
executor capability:

- adapter and version;
- page type and URL path;
- state fingerprint;
- counts of fields, actions, and validation messages;
- development diagnostic status, never screenshot data.

The first accepted observation moves a claimed executor into `running`.
Login or security detection then emits `user_input_required`, moving the run to
the server's intervention state. Manual sign-in, MFA, CAPTCHA, and account
security steps remain user actions.

Each new search identity emits an idempotent `job_discovered` event and is
upserted into `job_listings` by `(run, source, canonical URL)`. A verified
post-discovery listing emits `job_qualified`; a listing without enabled Easy
Apply or matching an explicit exclusion emits `application_skipped`. The
dashboard therefore displays real discovery and qualification activity without
treating either as an application.

## Search discovery

The search controller preserves the reliability behavior established by the
legacy extension:

- deterministic role, location, work-style, Easy Apply, and page parameters;
- a candidate-pool target 20 percent above the requested application count;
- repeated bounded scroll-to-card hydration followed by scroll-to-start;
- extraction from stable job data attributes and canonical link fallbacks;
- accumulation during every hydration cycle for virtualized lists;
- local and server-side deduplication;
- early completion at the buffered target; and
- an extra-page margin with an eight-page absolute ceiling.

The controller responds only to observations from the tab that claimed the
run. It stores the current page and accumulated identities before navigation,
so a disposable service worker can resume without active-tab assumptions.

## Post-discovery job qualification

Once the candidate pool is saved, the extension chooses the first canonical
job in stable discovery order and records it as `currentJob` in its private
checkpoint. Only the exact claimed tab is navigated to that canonical
`/jobs/view/:id/` URL. A job-detail observation qualifies only when all of the
following are true:

- the browser URL matches the saved canonical job ID;
- the observed job ID matches that same ID;
- the listing does not match a candidate-provided exclusion term; and
- the observer finds an enabled Easy Apply control.

Any mismatch or unexpected application UI moves to a visible intervention
checkpoint. An unavailable Easy Apply control or an explicit exclusion is
recorded as a skipped listing. A positive outcome proves only eligibility for
the controlled form path. The helper may open the visible Easy Apply surface,
but verifies the rendered state before it fills a value or advances a step.

If a saved application-retry checkpoint returns to that same qualified job
detail page after the Easy Apply surface disappears, the helper does not
silently switch jobs or restart discovery. It performs one narrow recovery:
wait up to three seconds for the visible enabled Easy Apply control that
belongs to the saved listing, open it, verify the application surface, and
then resume normal observation. If the control never appears or LinkedIn does
not render the form, the campaign pauses with a visible reason. This is the
bounded, evidence-driven replacement for the legacy extension's page-settle
loops.

## Interaction foundation

The shared interaction toolkit is connected to the LinkedIn adapter for
verified form work. It provides:

- mutation-based element waiting and bounded condition waiting;
- native text, select, checkbox, and radio property setters;
- bubbling, composed `input` and `change` events;
- resolver-based recovery when a framework replaces a control;
- bounded verification and retry;
- scroll, focus, pointer/mouse prelude, and native click;
- caller-defined click postconditions;
- a one-attempt default for clicks so consequential actions are not duplicated.

The only retried browser message is the idempotent, value-verified fill command
between the extension worker and its LinkedIn content script. It has three
short readiness attempts and can only repeat a plan that already confirms the
same live value. Navigation, upload, review, and submit actions are never
retried through that mechanism. Submission is a one-attempt action with a
postcondition that requires a new or changed visible LinkedIn confirmation
surface after the click. Stale confirmation text from an earlier application
is not proof.

## Extension-reload recovery

Chrome invalidates a content script that was already running in an open tab
when the extension itself is reloaded. RapidApply keeps the executor tab ID in
the durable extension session. On an explicit campaign resume, the background
worker first asks that exact tab to flush a fresh observation. If Chrome
reports that the tab has no receiving content script, RapidApply reloads only
that stored executor tab once. The LinkedIn observer is reinjected at document
idle and reports its current page state before the controller takes any further
action.

An absent message acknowledgement is treated the same way as Chrome's
explicit no-receiver error because an invalidated content-script context can
resolve without replying. An explicit `{ ok: false }` response is not retried
or reloaded unless it specifically reports `runtime_unavailable`; that signal
means the old page helper can still receive a Chrome message but can no longer
send its observation into the reloaded extension. Other explicit failures stay
visible for diagnosis rather than triggering a page reload.

The same narrow repair runs when the background worker starts after an
extension reload, but only if its restored session is already `running` and
the stored executor tab is still a LinkedIn page. An ordinary worker restart
therefore sends a cheap flush to a live content script; it does not reload the
page. The exact-tab reload happens only when Chrome confirms that the old
content script is gone.

This recovery never reloads arbitrary LinkedIn tabs, never replays a click or
form-fill action, and never advances a review or submission step. It is solely
a repair for the observer transport after an extension update.

Application-surface recovery is similarly exact-tab and state-bound. It is
allowed only when a running `application_retry` checkpoint is on the saved
canonical job URL; it opens only the visible Easy Apply control, waits for the
form surface, and returns to ordinary observation. It cannot select a new
listing, upload a résumé, or submit an application.

## Fixture and live test ladder

Changes move through the following gates:

1. Pure interaction tests.
2. Synthetic LinkedIn fixture tests.
3. Live observer-only recording on the dedicated development account.
4. Live discovery without form actions.
5. Fill one application and pause at résumé selection or final review.
6. Use `test_submit` only for the isolated submission verifier, then validate
   one policy-driven `autonomous_submit` campaign on the dedicated test account.
7. Candidate confirms the visible live state and records any unsupported
   variant as a fixture.
8. Expand the bounded campaign only after the previous gates are stable.

Advancing a gate requires useful evidence at the current gate. Unsupported
states stop for diagnosis and become fixtures before action coverage expands.

Run `pnpm verify:mvp` from the workspace root to execute the deterministic
contract, answer-resolution, intervention, handoff, production-build, and
production-permission checks together. It proves the local gates; it does not
substitute for the dedicated-account live validation gate.

The committed fixture set currently covers login, security checkpoint, search
results, job detail, contact, résumé, screening validation, review, and
confirmation. It uses synthetic content and contains no account session data.

## Résumé resolution

Automatic résumé reuse and verified attachment are implemented. Before
discovery, the helper inventories LinkedIn Application Settings and sends only
bounded visible filenames to the capability-protected résumé audit. Exact and
verifiably truncated matches bypass PDF delivery, local download, and upload.
When the platform asset is absent, RapidApply verifies the server PDF's size,
SHA-256 hash, and header, reuses an exact managed local file when available,
and otherwise downloads and uploads one role/version-specific document.

The same ordering applies inside Easy Apply on any step number: inventory saved
cards first, perform the identity-only audit, select the exact target, check
managed local storage, and request bytes only if both reuse paths are
unavailable. Attachment is verified before the current-job résumé checkpoint
is stored. A fresh observation then handles questions on the same or following
step. The checkpoint is cleared on job change, recovery rebind, or explicit
manual retry, preventing both repeated file work and accidental carryover to
another listing.

## Next implementation boundary

The next increment is evidence expansion: record diverse real job-detail and
form states, convert observed variants into synthetic fixtures, and extend
conservative classification for already-applied and unsupported states. Resume
selection and answer-prompt recovery must continue to prove their state
transitions against fixtures before their supported surface expands.

## References

- [Chrome content-script isolation and messaging](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage/)
