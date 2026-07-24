# RapidApply MVP and evolution roadmap

## Planning model

This roadmap is organized by capability and exit criteria rather than calendar
promises. A phase is complete when its observable product outcome is proven.
Work may overlap, but later breadth must not hide missing reliability in the
core campaign loop.

## Phase 0 — Control-plane foundation

### Outcome

RapidApply can identify a user, save durable campaign state, and securely hand
one run to a browser helper without exposing general account authority.

### Capabilities

- Workspace separation for web, extension, and shared contracts.
- Local and hosted SQLite-compatible persistence through committed migrations.
- Self-hosted authentication and server-validated sessions.
- Candidate profile with structured, candidate-authored facts.
- Server-side, candidate-initiated AI drafting with review before save.
- Durable campaigns, runs, and append-only events.
- One-time web-to-extension handoff ticket.
- Run-scoped executor event capability and extension-private checkpoint.
- Dedicated launch tab, exact-tab ownership, and explicit executor recovery.
- Dashboard progress based on verified server events rather than timers.

### Exit criteria

- A second user cannot access the first user's profile, campaigns, or runs.
- A ticket cannot be replayed or used for another run.
- A cancelled or terminal run rejects later executor events.
- Restarting the dashboard does not erase campaign history.
- Type checks, production builds, migrations, and focused handoff/profile tests
  pass.

### Current state

The repository implements this phase, including recovery-token revocation and
dashboard restoration of an active durable run. Remaining production
operational work—such as real email delivery and deployment-secret management—
belongs in the launch-readiness track below.

## Phase 1 — Browser execution runtime

### Outcome

The browser helper can safely resume a task across navigation, recognize when
the user must act, and execute deterministic workflows against controlled
fixtures.

### Capabilities

- Server-issued immutable execution plan using the existing run-scoped authority.
- Durable server events plus a validated browser-lifecycle extension checkpoint.
- Generic adapter contract and registry.
- Shared interaction toolkit for element discovery, visibility, scrolling,
  input, click, waiting, retry, and post-action evidence.
- `needs_user_input` workflow and dashboard prompt.
- Manual login/security-challenge pause and explicit resume.
- Adapter version reporting and remote disablement.
- Redacted fixture format and deterministic browser tests.

### Exit criteria

- A multi-page fixture completes after extension-worker suspension and browser
  navigation.
- Pause, resume, cancel, expiry, and duplicate-message tests pass.
- Unknown page states stop with a useful reason rather than continuing blindly.
- Interaction primitives have bounded retries and produce structured evidence.
- No task, answer, or capability is exposed to ordinary page JavaScript.

### Current state

The generic adapter contract, dedicated-tab controller, exact-tab enforcement,
durable checkpoint recovery, LinkedIn observer, strict message boundary,
bounded local visual audit, synthetic fixture suite, and verified interaction
primitives are implemented. Manual-auth resume is fixture-tested and
server-authoritative; live observer and intervention validation plus remote
adapter disablement remain before this phase exits.

## Phase 2 — LinkedIn campaign adapter

### Outcome

One candidate can run a bounded LinkedIn campaign through explicitly supported
search and Easy Apply states using a manually authenticated browser session.

### Capability sequence

1. **Implemented:** Build the search URL from the saved campaign.
2. **Implemented:** Open or focus a dedicated execution tab.
3. **Implemented:** Detect signed-in, signed-out, challenged, and unsupported states.
4. **Implemented foundation:** Pause for manual login, MFA, CAPTCHA, or other security action.
5. **Implemented; live validation pending:** Discover result cards and stable job identities.
6. **Implemented; live validation pending:** Scroll and paginate within explicit campaign and retry limits.
7. Deduplicate jobs against prior applications in addition to the current-run deduplication already implemented.
8. Apply campaign filters and record qualification reasons.
9. Open one job at a time and detect Easy Apply availability.
10. Inspect each application step and map fields to approved candidate facts.
11. Route eligible free text or constrained option judgment through the
    authenticated, provenance-aware AI answer service.
12. Pause for missing, ambiguous, consequential, sensitive, or unsupported
    questions.
13. Upload the selected resume through an explicit file-access path.
14. Review or submit according to the candidate's campaign policy.
15. Detect supported submission evidence and record the application.
16. Continue until the target, cancellation, or bounded stopping condition.

### Exit criteria

- Stored fixtures cover every supported page and form state.
- A layout change fails closed and identifies the broken adapter state.
- No application is duplicated after retry or restart.
- Every submitted answer has candidate-approved provenance.
- Every AI request is authenticated, idempotent, metered, quota-checked, and
  validated against the observed field before use.
- Unsupported questions pause before submission.
- Login and security challenges always require manual user action.
- Application counters are derived from confirmed events.
- A user cancellation stops further page actions promptly.
- The adapter can be disabled independently of the dashboard.

## Phase 3 — Private beta reliability

### Outcome

The supported campaign loop works repeatedly for a controlled cohort and its
failure modes are measurable.

### Capabilities

- Release channels for internal, beta, and stable extension builds.
- Adapter health dashboard and alerting.
- Failure capture with redaction and user-approved diagnostics.
- Resume object storage, scanning, retention, replacement, and deletion.
- Candidate answer inbox and reusable approval scopes.
- Application detail view showing submitted values and evidence.
- Recovery from browser closure, network interruption, and stale tasks.
- Rate and campaign limits that protect user intent and service reliability.
- Support tooling that does not grant broad access to candidate data.

### Exit criteria

- Completion and intervention rates are known by supported flow.
- No unresolved cross-tenant, wrong-identity, or invented-fact incidents.
- Critical adapter breakage is detected and halted within the defined response
  objective.
- A candidate can export and delete their stored profile, documents, and
  campaign history according to product policy.
- The team can reproduce common failures from fixtures without using a
  customer's live account.

## Phase 4 — Launch and monetization

### Outcome

New customers can understand the promise, activate, pay, receive value, and
recover or cancel without manual founder intervention.

### Capabilities

- Public onboarding and browser-helper installation guidance.
- Production email verification and account recovery.
- Plans, checkout, subscription lifecycle, entitlements, and usage accounting.
- Honest product limits and supported-flow disclosures.
- Privacy policy, terms, consent records, and data controls.
- Product analytics for acquisition, activation, time to value, retention, and
  outcomes.
- Refund, support, and incident processes.
- Backups, restore exercises, secret rotation, and production monitoring.

### Exit criteria

- A new user reaches a verified application without founder assistance.
- Billing state and executor entitlement cannot diverge silently.
- Activation and time-to-value metrics are calculated from durable events.
- Account recovery, cancellation, export, and deletion are exercised end to
  end.
- Production rollback and adapter-disable procedures are tested.

## Phase 5 — Campaign intelligence

### Outcome

RapidApply improves application relevance and interview yield, not merely
execution speed.

### Capabilities

- Job-quality and candidate-fit scoring with explainable factors.
- Resume selection and candidate-reviewed tailoring.
- Campaign-level exclusion and prioritization rules.
- Outcome ingestion for responses, interviews, rejections, and offers.
- Experimentation across timing, source, resume, and role strategy.
- Candidate-specific recommendations grounded in their outcome history.
- Follow-up and intervention scheduling.

### Exit criteria

- Recommendations can be traced to data and reversed by the candidate.
- Interview yield is measurable by campaign decision.
- Model-generated content remains reviewable and fact-grounded.
- Optimization does not increase trust-guardrail violations.

## Phase 6 — Multi-source execution

### Outcome

RapidApply can choose among multiple execution routes while preserving one
campaign and evidence model.

### Capabilities

- Additional browser adapters selected from measured customer demand.
- Direct employer-career-page and ATS adapters.
- Official partner or API integrations where available and advantageous.
- Cross-source job identity and duplicate resolution.
- Executor routing based on capability, health, cost, and customer preference.
- Edge and other browser packages where blocked demand justifies them.

### Exit criteria

- Adding a source does not duplicate tenant, campaign, answer, or billing logic.
- Every executor reports the same canonical events and evidence contract.
- A source outage does not corrupt or stall unrelated campaigns.
- Cross-source duplicates are prevented before submission.

## Phase 7 — Career agent

### Outcome

RapidApply manages the broader path from job-search intent to accepted offer.

### Capabilities

- Recruiter communication and candidate-controlled follow-up.
- Interview preparation connected to the actual role and application.
- Offer comparison and negotiation support.
- Longitudinal career profile and reusable achievement evidence.
- Direct employer invitations and candidate marketplace participation.
- Premium human-assisted campaigns where customers want them.
- Organization workspaces for coaches, education, outplacement, and workforce
  programs with explicit candidate access grants.

### Exit criteria

- The product can attribute value beyond application completion.
- Candidate consent and ownership remain clear in organization-sponsored use.
- Revenue can align more closely with outcomes without encouraging low-quality
  or unwanted applications.

## Continuous tracks

The following are not deferred phases; they evolve alongside every capability.

### Security and tenant isolation

- Ownership tests for every resource and endpoint.
- Capability scope, expiry, rotation, and revocation.
- Dependency and secret management.
- Data minimization, retention, export, and deletion.
- Threat modeling when a new executor, integration, or organization role is
  introduced.

### Adapter quality

- Fixture coverage for every supported state.
- Health metrics segmented by adapter version.
- Bounded retries and deterministic stopping behavior.
- Emergency disablement and rollback.
- Clear distinction between unsupported state and transient failure.

### Candidate trust

- Truthful product status and application evidence.
- Explainable skips and intervention requests.
- Reviewable submitted values.
- Immediate pause and cancellation behavior.
- No unsupported candidate claims.

### Product learning

- Activation and time-to-value measurement.
- Structured reasons for abandonment and intervention.
- Application-to-interview attribution.
- Customer research focused on outcome quality and trust.

## Prioritization rule

At any decision point, prioritize in this order:

1. Prevent wrong-user, wrong-answer, or unapproved-submission failures.
2. Make the single supported campaign loop reliable and recoverable.
3. Reduce time to first verified application.
4. Improve relevance and interview yield.
5. Add source breadth, convenience surfaces, and organizational models.

This ordering protects the original wedge—automating repetitive application
work—while ensuring each layer can support the long-term career agent.
