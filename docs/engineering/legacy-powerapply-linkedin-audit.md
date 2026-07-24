# Legacy PowerApply LinkedIn execution audit

## Purpose

The original PowerApply extension is reference evidence, not a code dependency.
This audit identifies the behavior that made the old workflow viable, separates
intentional reliability techniques from accidental complexity, and maps the
useful behavior into RapidApply's clean-room architecture.

No legacy script is loaded, shipped, or evaluated by RapidApply. New code is
organized around typed observations, bounded interactions, durable server
events, fixture tests, and explicit evidence.

## Reconstructed legacy workflow

The original LinkedIn path began with a deliberate initializer handshake, then
behaved as a resumable but largely implicit state machine:

```text
User clicks Start Applying in the web application
  → web application saves task/profile values in real time
  → a normal hyperlink opens /linkedin_initializer in a new tab
  → initializer reads the PowerApply-origin localStorage payload
  → initializer sends linkedin_initializer to the extension background page
  → background retains the working values and initializer builds the search URL
  → that same tab navigates to LinkedIn
  → LinkedIn content script announces linkedinSearchReady
  → background relays the working values into the LinkedIn controller
  → controller checkpoints the values and starts step1Handler
  → scroll until result cards are hydrated
  → collect and deduplicate job links
  → paginate until the candidate pool exceeds the requested target
  → visit each job
  → reject missing, excluded, already-applied, or non-Easy-Apply jobs
  → open the Easy Apply dialog
  → inspect, fill, and advance each form step
  → refill after controlled-form rerenders
  → submit and infer completion
  → report progress to the web application
  → continue or finish
```

The old implementation persisted working data in page-local storage and used
many overlapping timers and condition branches to recover from LinkedIn's
asynchronous rendering. That made the script difficult to reason about, but
many individual branches addressed genuine browser behavior.

The initializer was not incidental plumbing. It opened the executor tab inside
the user's click before popup blocking could interfere, gave the extension a
deterministic startup state, and kept preprocessing plus LinkedIn navigation in
the same tab. RapidApply preserves that shape with `/launch/waiting`,
`/launch/:runId`, exact-tab binding, and an extension-private checkpoint. It
replaces the full page-local payload with a one-time claim ticket and a server-
issued execution plan.

## Techniques worth preserving

### Native form-property setters

Assigning `input.value` alone does not reliably notify controlled form
frameworks. The legacy script called native value setters and emitted bubbling
`input` and `change` events. RapidApply preserves that technique in a shared,
tested interaction module for text, textarea, select, checkbox, and radio
controls.

### Re-resolution after rerender

A form framework can replace an element after an event. Retrying against the
old DOM reference cannot succeed. RapidApply accepts element resolver
functions, re-resolves the current control after every attempt, and verifies
that the intended state persisted. Retries are explicitly bounded.

### Interaction prelude

Some page handlers observe focus, pointer, or mouse activity in addition to a
native click. RapidApply scrolls and focuses the element, emits a bounded
pointer/mouse prelude, then calls the native `click()` method. A caller-defined
postcondition determines success.

### Repeated page inspection

LinkedIn changes URL, modal, validation, and button state without always
performing a full navigation. RapidApply combines mutation observation, form
events, history/navigation events, and a low-frequency recovery heartbeat.
It fingerprints observable state so repeated heartbeats do not create duplicate
evidence.

The old script also waited for LinkedIn's top-card controls to settle before it
attempted an application action. RapidApply preserves that intent with a
three-second bounded wait for the visible enabled Easy Apply control, followed
by a verified open postcondition. A recovery checkpoint that returns to the
same job page may reopen that same surface once; failure remains a visible
candidate checkpoint rather than an unbounded loop.

### Explicit state gates

The legacy script checked login state, missing jobs, prior submissions,
Easy Apply availability, modal steps, validation errors, résumé requirements,
and completion. RapidApply models those as named adapter observations before
it introduces action logic.

### Field-specific policy

The old script contained branches for experience, education, compensation,
languages, licenses, work authorization, sponsorship, background checks,
commute, dates, consent, skills, and other common questions. These branches
show that a generic "fill every input" strategy is insufficient. In the new
system, those cases will become typed question categories with candidate-
approved provenance and an explicit pause path when no safe answer exists.

## Behavior that must not be carried forward

- Profile data, answers, job queues, or credentials in a third-party page's
  `localStorage`.
- Global mutable variables as the source of execution truth.
- Unbounded or overlapping intervals.
- Random answers, guessed facts, or a generic "yes" fallback.
- A missing modal treated as proof of submission.
- Active-tab assumptions without a run-to-tab binding.
- Broad host access unrelated to a supported adapter.
- Raw candidate values in progress logs.
- Backend updates authorized by a client-supplied user identifier.
- Retrying a consequential submit action without idempotency and evidence.

## Clean-room mapping

| Legacy intent | RapidApply replacement | Current status |
| --- | --- | --- |
| Detect the current LinkedIn state | Versioned `SiteAdapter` observation | Implemented |
| Survive SPA rerenders | Mutation, form-event, navigation, and heartbeat observer | Implemented |
| Trigger controlled inputs | Native setters plus `input` and `change` events | Implemented and tested |
| Recover from replaced controls | Resolver-based, verified, bounded retries | Implemented and tested |
| Trigger stubborn buttons | Scroll, focus, pointer/mouse prelude, native click | Implemented and tested |
| Know whether an action worked | Caller-defined postcondition | Implemented for Easy Apply open and non-submitting progression |
| Remember work across navigation | Validated extension-private checkpoint plus durable run events | Implemented |
| Show real-time progress | Run-scoped executor event capability | Implemented |
| Understand form variants | Stored synthetic fixtures and live observer recordings | Semantic radio/checkbox grouping, native constraints, and current fixture set implemented |
| Prove what the page showed | Local visual audit with state fingerprints | Implemented |
| Open a deterministic initializer tab | Dedicated waiting and run-specific launch routes | Implemented |
| Bind relays to the intended tab | Immutable executor tab ID checked on every message | Implemented |
| Discover and paginate jobs | Buffered, bounded LinkedIn discovery controller | Implemented and fixture-tested |
| Answer application questions | Observed-field descriptors plus provenance-aware answer policy | Deterministic facts and live structured AI answers are validated, filled, and verified; unresolved fields follow campaign policy |
| Select or upload a résumé | Role-keyed generated résumé, deterministic natural filename, platform/local preflight audit, exact existing-file selection, capability delivery, and verified file attachment | Implemented and fixture-tested |
| Confirm submission | Policy-gated final-review action and LinkedIn confirmation postcondition before recording success | Implemented and fixture-tested |

## Remaining unknowns for live observation

Synthetic fixtures establish deterministic behavior, but they cannot answer
which selectors and accessible labels LinkedIn currently emits for every
account and form variant. Observer-only sessions must establish:

- which search-card selectors remain stable across the dedicated account's
  current layout, now that attribute and link fallbacks are fixture-tested;
- how the selected job ID is represented during search-detail navigation;
- current Easy Apply dialog landmarks and step headings;
- résumé cards, selected-résumé evidence, and upload controls;
- validation structures for radio groups, custom dropdowns, and date controls;
- positive submission signals that remain present after the modal closes;
- unsupported, rate-limited, expired-job, and already-applied states.

The result of live observation should be converted into minimal synthetic or
redacted fixtures. HAR capture is optional and secondary: it may help explain
navigation or request timing, but the DOM and visual state are the primary
execution interface. Any HAR remains outside version control because it can
contain session material even when produced by a dedicated test account.

## Conclusion

The old implementation's length was evidence of a real state-space, not proof
that every line should survive. RapidApply preserves the difficult browser
techniques and domain cases while replacing implicit loops with observable
states, bounded actions, candidate-approved data, and regression evidence.

## Intent matrix

| Legacy mechanism | Why it existed | Modern treatment |
| --- | --- | --- |
| Initializer page | User-gesture tab opening and deterministic startup | Preserve as dedicated launch route |
| PowerApply-origin localStorage | Make asynchronous web data visible to the initializer | Narrow to one expiring ticket; remove after claim |
| LinkedIn-origin localStorage | Survive page navigation with a page-owned payload | Replace with trusted extension-local checkpoint |
| Background relay messages | Re-enter logic after navigation | Preserve as typed controller commands tied to one tab |
| 20 percent extra links | Compensate for ineligible or failed listings | Preserve as `poolTarget` |
| Down/up lazy-load scrolling | Force result hydration before link collection | Preserve with bounded scroll cycles and mutation settling |
| Link-first fallback selectors | Survive wrapper and class changes | Preserve with canonical ID/link extraction |
| Repeated timers | Recover from asynchronous SPA changes | Replace with observations, navigation state, and bounded retry |
| Wait for LinkedIn top-card controls | Avoid acting before asynchronous job controls render | Bounded visible-Easy-Apply wait plus verified modal-open postcondition |
| Native setters and event sequences | Trigger controlled fields correctly | Preserve in tested interaction primitives |
| Re-resolving controls | Survive React/SPA node replacement | Preserve in resolver-based verified interactions |
| Long conditional form logic | Encode genuinely different field and modal states | Refactor into typed page/question/action policies; do not flatten |
