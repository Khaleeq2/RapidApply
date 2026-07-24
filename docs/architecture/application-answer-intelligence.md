# Application answer intelligence

## Objective

RapidApply should answer application questions through one intentional decision
system, not through disconnected deterministic rules and ad hoc model calls.
The system must prefer approved facts, use AI only where judgment or writing is
actually useful, validate every output against the live form, and preserve a
clear path to candidate intervention.

The architecture separates four concerns:

```text
Observe the field
  → classify question and risk
  → choose deterministic, approved, AI, or user-input strategy
  → resolve on the authenticated server
  → validate against facts, constraints, and option IDs
  → apply through packaged adapter code
  → verify the DOM result and record provenance
```

AI never receives authority to click or submit. It proposes a typed answer;
the policy engine and adapter remain responsible for whether and how that
answer is used.

## Current implementation boundary

Implemented now:

- shared field, option, planning, answer, and provenance contracts;
- opaque deterministic option IDs in LinkedIn observations;
- deterministic resolution for approved name, contact, location, headline,
  professional-summary, profile-link, portfolio-link, work-authorization, and
  sponsorship facts;
- risk gates for sensitive and consequential categories;
- eligibility decisions for grounded text drafts and constrained option
  selection;
- a live Gemini/Groq structured provider adapter using only bounded
  candidate-approved facts and current job context;
- strict AI-candidate validation for schema, provenance IDs, form constraints,
  numeric bounds, option membership, selection counts, and style;
- deterministic verification covering the major policy branches;
- capability-authorized, value-minimized application-field planning with
  durable, idempotent answer-plan records;
- durable, scoped candidate answer memory that is reused only when the current
  form shape remains compatible;
- a persistent intervention queue, a dashboard Answer Center, and an isolated
  in-page prompt with an adaptive candidate-controlled timeout;
- verified completion of compatible deterministic and policy-approved AI
  answers across text, textarea, number, select, radio, and checkbox controls;
- semantic grouping of option controls and exact live-control re-resolution
  after framework rerenders;
- country-scale select support (up to 300 bounded visible options) so country
  and dialing-code answers are not lost after an arbitrary short-list cutoff;
- dashboard feedback that distinguishes an answer request, resume selection,
  final review, deferred question, and manual verification pause.

Not enabled now:

- extracted work-history, education, skills, or résumé facts beyond the
  candidate's currently saved headline and summary;
- AI usage metering and plan limits;
- automatic answers for sensitive or consequential candidate facts that have
  not been explicitly supplied.

The application planner calls one configured provider. Provider failure,
insufficient evidence, malformed output, low confidence, or a blocked question
category produces no synthetic fallback; the campaign then follows its
persisted unknown-field policy.

## Decision order

The server evaluates a field in this order:

1. A previously approved answer with a compatible field shape.
2. An explicit candidate-profile fact.
3. A mandatory user-input rule for sensitive or consequential questions.
4. A grounded AI text draft for an eligible open-ended question.
5. A constrained AI choice among supplied option IDs for an eligible structured
   question.
6. User input for missing context, an unknown category, an unsupported control,
   or invalid model output.

AI is therefore a narrow resolver inside a deterministic state machine. It is
not the default answer source.

## Risk policy

| Question type | Default handling |
| --- | --- |
| Name, contact email, phone, general location, headline, professional summary, profile/portfolio URL | Exact approved profile fact |
| Work authorization or sponsorship | Exact approved fact; otherwise pause |
| Prior approved reusable answer | Reuse only within its recorded scope |
| Ordinary role-specific free text | Grounded AI answer; auto-use only for an autonomous campaign above its confidence threshold |
| Ordinary structured judgment | AI may return only supplied opaque option IDs; the same policy/confidence gate applies |
| Compensation, clearance, legal attestation, consent, background history | Candidate input unless an exact scoped answer was already approved |
| Demographic, disability, veteran status | Candidate input |
| Unknown or weakly classified question | Candidate input |

Risk policy is separate from the model prompt. A model cannot reclassify a
blocked category into an eligible one.

## Context assembly

The extension should send only the observed field descriptor, opaque option
IDs, stable job identity, and state fingerprint. It should not send a complete
candidate profile or résumé back to the server.

After authenticating the run, the server assembles the minimum context needed
for that one field from authoritative records:

- candidate-approved profile facts;
- the current job title, company, description, and relevant requirements;
- scoped approved answers;
- candidate-approved voice guidance and writing samples;
- field label, type, constraints, and available option labels/IDs.

Each context item receives a stable provenance ID. Model output must cite only
IDs supplied in that request. RapidApply records the IDs, not private model
reasoning.

Job descriptions, profile text, field labels, and option labels are treated as
untrusted reference data. Prompt instructions explicitly prohibit following
instructions found inside those sources. Rich résumé facts remain future
profile-model work; the current foundational PDF contains no additional work
history beyond the saved profile.

## Structured model output

The model returns a strict object containing:

- one answer variant: text, opaque option IDs, or checked state;
- provenance IDs;
- bounded confidence; and
- a short enumerated rationale code such as `grounded_synthesis` or
  `best_matching_option`.

The server does not ask for or persist chain-of-thought. Free-form rationales,
DOM selectors, JavaScript, URLs, and raw option values are not valid output.

For structured controls, the server rejects every option ID that was not in the
observed field. The extension maps a valid opaque ID back to the live control
locally and verifies the result after interaction.

## Voice and natural writing

Voice should come from candidate-approved evidence, not a generic persona
prompt. The eventual voice profile should capture preferences such as direct
versus conversational tone, sentence length, formality, and approved writing
samples.

Generated text is rejected or regenerated when deterministic lint detects:

- em dashes;
- canned enthusiasm or generic AI phrasing;
- inflated or unsupported claims;
- repetitive sentence openings;
- violation of the field's length or numeric constraints.

The goal is truthful writing that sounds consistent with the candidate, not
text engineered to evade a detector.

## Extension authentication and ownership

The web dashboard uses a server-validated Better Auth session. The extension
does not receive the password, Better Auth cookie, database token, or provider
API key.

The authenticated dashboard mints a short-lived, one-time run ticket. After
the extension claims it, the server binds the executor session to the durable
run, whose owner is already known. Every extension request must then present a
short-lived hashed capability bound to:

- one run;
- one executor session;
- an expiry; and
- explicit endpoint scopes.

The current planning endpoint is capability-authorized, resolves the user
through the run, assembles context server-side, and invokes the configured
provider there; it never trusts a user ID supplied by the extension and never
sends provider credentials to the browser.

An invalid, expired, cancelled, terminal, wrong-session, or wrong-scope request
is rejected before profile context is loaded or a provider is called.

## Usage, limits, and abuse controls

Every attempted provider call should create a server-owned usage record with:

- user, run, application, and answer-decision IDs;
- purpose, provider, and model;
- idempotent request fingerprint;
- input/output token counts when the provider reports them;
- latency, status, retry count, and cache outcome;
- plan/limit decision; and
- timestamps.

Raw prompts and responses should not be usage-log defaults. The answer decision
stores the validated result and provenance under the product's retention rules.

Limits are checked before a provider call and incremented atomically. The same
field fingerprint reuses the prior valid decision instead of spending twice.
Controls should exist per user, run, minute, and billing period, with a smaller
concurrency limit to prevent a compromised extension from creating a burst of
costly requests.

Provider failure does not silently send candidate data to another vendor. A
configured fallback, if ever offered, must be an explicit product and privacy
decision.

## AI-assisted page interpretation

AI may eventually classify an unfamiliar observation or propose a mapping into
a versioned, bounded action vocabulary. It must not generate downloadable
JavaScript, selectors that are executed without validation, `eval` payloads,
or remote code for injection.

Executable adapters remain packaged with the reviewed Manifest V3 extension.
An unfamiliar state is recorded and paused. A proposed interpretation can help
create a fixture or a future adapter release, but it does not grant itself live
execution authority.

## Production-hardening criteria for live AI answers

- Server context is assembled from the run owner, job, and approved facts
  without trusting extension-supplied identity.
- Usage and idempotency records are durable and quota checks are atomic.
- Provider output is schema-valid, grounded, form-compatible, and style-valid.
- Sensitive, consequential, unknown, or weakly grounded questions follow the
  campaign's explicit pause, defer, or skip policy.
- Every applied answer records source and provenance.
- Fixture tests and one reviewed live application prove the complete path.
## Current MVP behavior

When the browser helper observes a LinkedIn application form after it has
verified the visible Easy Apply transition, it sends a bounded
description of the fields—not their values—to RapidApply's
capability-protected planning API.

The API identifies the campaign owner from the executor capability, reads that
candidate's saved profile, and persists an answer-plan record for every field.
Each record contains the observed question shape, a policy decision, and only a
candidate-approved resolved value when that value is needed to make the later
executor decision. It never enters run-event details, browser logs, or
structured checkpoint metadata.

```text
LinkedIn form observation
  → normalized field descriptors
  → capability-authorized planning API
  → approved answer memory / profile fact / structured AI / intervention policy
  → durable answer-plan record
  → verified fill when permitted
  → persistent intervention + in-page prompt or Answer Center when needed
  → application_answers_planned progress event
  → dashboard explains exactly why the campaign is waiting
```

An absent résumé is not treated as an answerable field. Before discovery, the
helper inspects LinkedIn Application Settings and reuses an exact full or
verifiably truncated campaign filename. Only when the platform asset is absent
does it request PDF bytes, reuse an exact managed local download when present,
and upload. Inside any application step, it first inventories saved application
résumé cards and asks the server for an identity-only audit. A matching card is
selected without transmitting PDF bytes. If platform selection is unavailable,
the helper checks its exact managed local file identity before requesting
bytes. The helper then stores a current-job résumé checkpoint and returns to
ordinary field planning without depending on a fixed step number.

For compatible, approved values, the helper uses verified native form updates
and may advance one step at a time. Autonomous campaigns submit from a verified
final-review action; strict-control campaigns pause there. Both paths require a
positive LinkedIn confirmation before recording success. Neither mode enters
credentials or bypasses a security challenge.

## Autopilot modes

`verified` is the default. It may fill an exact candidate profile fact and may
continue an answer that the candidate just supplied for the same observed form,
but it does not reuse an answer from a different application.

`smart` adds one narrowly bounded convenience: it may reuse a compatible answer
only when the candidate explicitly chose to remember it with automatic reuse.
The answer must still pass the current field's type, option, and constraint
validation. Campaign autonomy is a separate contract: it determines whether a
validated AI answer can be applied and submitted automatically or must be
reviewed. Neither profile mode invents a fact or silently chooses a sensitive
or consequential response.
