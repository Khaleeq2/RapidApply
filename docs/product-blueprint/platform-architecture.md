# RapidApply platform architecture

## Architectural definition

RapidApply is a multi-tenant SaaS control plane with a user-authorized browser
execution layer and an extensible site-adapter runtime.

```text
RapidApply web and mobile surfaces
        ↓
Authenticated cloud control plane
        ├── candidate data and documents
        ├── campaign strategy and policy
        ├── durable workflow state
        ├── billing and entitlements
        └── outcomes and analytics
        ↓ short-lived, run-scoped authority
Browser helper / future executor
        ↓
Versioned site adapter
        ↓
Supported application surface
        ↓ verified events
Cloud control plane
```

The control plane decides and remembers. The executor observes and acts. The
adapter understands one supported site. No layer should quietly inherit the
responsibilities of another.

## Tenant model

### Initial tenant

One authenticated RapidApply user is one tenant. The user's immutable internal
product ID is the tenant ownership key.

The term **tenant** describes an isolation boundary. It should not be called a
charter; the product charter is the strategic document governing the product.

```text
Tenant: user
├── identity link
├── candidate profile
├── resumes and document metadata
├── campaigns
│   └── application runs
│       ├── discovered jobs
│       ├── applications
│       └── append-only events
├── preferences and approved answers
├── subscription and entitlements
└── outcome history
```

### Future organizations

An organization workspace may later contain members, roles, sponsored
candidates, and policy. It must be additive rather than a reinterpretation of
user ownership.

```text
Organization
├── memberships and roles
├── billing and program policy
└── candidate access grants
     └── candidate-owned profile, consent, and application records
```

Organization access must be explicit, revocable, role-scoped, and auditable.
Adding `organization_id` must not make candidate data implicitly visible to all
organization members.

## Logical isolation

RapidApply uses logical tenant isolation on shared infrastructure. Every
tenant-owned aggregate carries `user_id`, directly or through a parent whose
ownership is checked.

The minimum enforcement rules are:

1. The server derives the user from a validated session; clients never choose
   the authoritative user ID.
2. Repository operations accept the authenticated user context and include the
   ownership predicate in the database query.
3. Child resources are accessed through both resource ID and owned parent or
   user ID; knowledge of an identifier grants no access.
4. Create operations assign ownership on the server.
5. Updates and deletes verify ownership in the same atomic operation whenever
   possible.
6. Background jobs carry a signed internal principal and the tenant ID they are
   authorized to process.
7. Object-storage keys are tenant-partitioned and access is issued through
   short-lived URLs or server-mediated streams.
8. Logs and analytics avoid exposing raw candidate data unless operationally
   necessary and authorized.

Database row-level security may be added where the chosen database supports it,
but it supplements rather than replaces application-layer ownership checks.

## Identity boundary

Authentication identity and product ownership are separate concepts:

- the authentication system proves who controls a session;
- the RapidApply user record is the durable product owner;
- an explicit provider subject links the two; and
- changing authentication providers must not orphan product data.

Passwords, authentication tokens, and recovery credentials belong only to the
authentication subsystem. The browser helper receives neither the user's
RapidApply session nor third-party site credentials.

## Control-plane responsibilities

The cloud control plane owns:

- account and tenant identity;
- candidate-authored facts and answer approvals;
- resume metadata and document lifecycle;
- campaign creation, qualification policy, and execution preferences;
- the authoritative run state machine;
- job and application deduplication;
- issuance and revocation of executor capabilities;
- event validation and idempotency;
- billing and entitlement checks;
- adapter health and emergency disablement;
- analytics and outcome attribution; and
- retention, export, and deletion workflows.

Business decisions must not exist only inside extension code. An executor can
be upgraded or replaced without losing campaign history or changing ownership.

## Executor responsibilities

The browser helper is a local executor. It may:

- receive one prepared task through a short-lived capability;
- open or focus a user-visible browser tab;
- detect whether the supported site is ready or needs manual login;
- inspect supported page states through a versioned adapter;
- perform actions authorized by the campaign policy;
- checkpoint before navigation or irreversible actions;
- pause on unknown states, security challenges, or missing facts;
- report structured evidence and progress; and
- stop promptly when authority expires or the user cancels.

It must not become the sole store for campaigns, user history, answer policy,
or billing state.

## Site authentication

Third-party authentication remains controlled by the user:

1. The executor detects a signed-out or challenged state from supported page
   signals.
2. The run changes to `needs_user_input` with a plain explanation.
3. The user manually completes login, MFA, CAPTCHA, or another security check.
4. RapidApply does not collect, type, transmit, or store the site's password or
   authentication cookie.
5. The user explicitly resumes, after which the adapter verifies the expected
   signed-in page state.

The same pause contract applies whenever a site presents an unsupported or
security-sensitive state.

## Capability model

The browser helper uses capabilities rather than a reusable account session.

### Handoff ticket

A signed-in user requests a short-lived, one-time ticket for one ready run. The
server stores only its hash. A successful claim consumes it atomically.

### Executor capability

After a successful claim, the server issues a second short-lived capability
bound to:

- one tenant;
- one run;
- one executor session;
- a limited event and task surface; and
- an explicit expiration.

The capability is stored in trusted-context extension-local storage, never
exposed to page JavaScript, and revoked when the run terminates, is cancelled,
or is explicitly recovered into a replacement executor session. Local
persistence is a validated controller checkpoint; it does not replace the
cloud run or append-only event history.

Future task-fetching or answer-fetching endpoints must use the same scoped
authority rather than broadening the capability into a general API token.

## Workflow and state

The control plane owns a durable state machine. A representative run lifecycle
is:

```text
ready
  → claimed
  → running
      ↔ paused
      ↔ needs_user_input
  → completed | failed | cancelled
```

An individual application may use a more detailed lifecycle:

```text
discovered
  → qualified | rejected_by_filter | duplicate
qualified
  → prepared
  → awaiting_approval | ready_to_submit
ready_to_submit
  → submitting
  → submitted | skipped | blocked | failed
submitted
  → response | interview | rejected | withdrawn | offer
```

Transitions are validated, recorded, and idempotent. Retries must not create
duplicate applications or inflate counters.

## Adapter architecture

Each supported site is implemented behind a versioned adapter contract. The
generic executor should understand capabilities, page states, actions, and
evidence—not site-specific selectors.

```text
adapters/
└── linkedin/
    ├── manifest and supported-flow versions
    ├── page detection
    ├── search and listing discovery
    ├── application-step parsing
    ├── field mapping
    ├── action policy
    ├── completion evidence
    └── redacted fixtures and regression tests
```

A conceptual adapter exposes operations such as:

```text
detectPageState()
extractSearchResults()
extractJobDetails()
inspectApplicationStep()
planSafeActions()
executeApprovedAction()
detectValidationErrors()
detectSubmissionEvidence()
```

Selectors and page heuristics remain adapter-owned. Interaction mechanics such
as resilient clicking, framework-compatible input, scrolling, waiting,
visibility checks, and retry budgets belong to a shared interaction toolkit.

## Interaction toolkit

The toolkit exists because browser actions that appear simple often require
multiple intentional techniques. It should provide bounded, observable
primitives rather than hidden infinite retries:

- element discovery across known containers and frames;
- rendered visibility, enabled-state, and obstruction checks;
- scroll-into-view with stability checks;
- focus, input, and change behavior compatible with common frontend frameworks;
- pointer and keyboard action primitives;
- post-action evidence checks;
- navigation-aware checkpoints;
- retry policies with explicit timeout and failure reasons; and
- redacted diagnostics suitable for fixture creation.

The toolkit must not contain security-challenge bypasses or techniques whose
purpose is concealing automation. Its purpose is reliable user-authorized
interaction with supported application states.

## Candidate fact and question policy

Every possible answer falls into one of three policy levels:

### Approved

The value is a candidate-authored fact with an active approval and an exact or
well-defined mapping. It may be used automatically within campaign policy.

### Reviewable

RapidApply can propose an answer from approved context, but the candidate must
review it before first use or whenever its meaning changes. An approval can be
stored with scope and provenance.

### Always manual

The candidate must answer the current occurrence. This includes unknown facts,
legal attestations, ambiguous work authorization or sponsorship questions,
security clearance, criminal history, sensitive voluntary disclosures, and any
question whose truthful answer cannot be established confidently.

AI may classify, map, or draft. It cannot promote an answer to approved status
or invent a candidate fact.

## Action and evidence contract

Every adapter action has:

- a precondition;
- candidate-data inputs and their provenance;
- an authorization level;
- a bounded execution method;
- expected observable effects;
- timeout and retry limits;
- a structured failure reason; and
- evidence required before advancing state.

Examples:

| Claimed event | Minimum evidence |
| --- | --- |
| Job discovered | Stable listing identity and source URL |
| Field completed | Supported field mapping and observed resulting value |
| Step advanced | Previous action plus detection of the next supported state |
| Application submitted | Supported completion page, receipt, or equivalent adapter signal |
| Input required | Known blocker category and safe user-facing explanation |

Screenshots may help diagnose failures, but collection must be explicit,
redacted where practical, retained for a defined period, and never treated as
the only structured evidence.

## Extension permission model

Permissions should be understandable and proportional to active functionality:

- RapidApply origins are required for secure pairing and dashboard messaging.
- Third-party host access is requested only for implemented, user-selected
  adapters.
- Broad all-site access is avoided.
- Executable adapter code is packaged with the extension release; the server
  may send data, policy, selector configuration, and feature flags but not
  arbitrary JavaScript for execution.
- Page context cannot access executor capabilities or privileged extension
  storage.

## Data classes and handling

RapidApply should maintain explicit data classes:

| Class | Examples | Default handling |
| --- | --- | --- |
| Identity | Name, email, auth subject | Server only; tenant-scoped |
| Candidate facts | Experience, authorization, preferences | Encrypted transport; explicit editing and deletion |
| Documents | Resumes, generated variants | Private object storage; short-lived access |
| Campaign data | Targets, filters, limits | Tenant-scoped durable storage |
| Execution data | Checkpoints, page state, failure reason | Minimized; short retention where detailed |
| Evidence | Confirmation identifiers, optional redacted captures | Purpose-bound retention and access logging |
| Outcomes | Responses, interviews, offers | Tenant-scoped; used for candidate benefit and aggregate learning |

Retention should be defined by purpose rather than convenience. Account export
and deletion must cover both database records and stored objects.

## Reliability model

The executor is assumed to stop unexpectedly. Therefore:

- extension service workers are disposable;
- checkpoints are written before navigation and irreversible actions;
- every action can be retried safely or is protected by an idempotency key;
- stale capabilities expire;
- the server can remotely disable an unhealthy adapter version;
- fixture tests run before release; and
- health metrics distinguish site change, unsupported state, user action,
  network failure, and product defect.

## Observability

Operational telemetry should answer:

- Which adapter version is running?
- Which supported page state was detected?
- Which transition occurred and why?
- What evidence justified it?
- Where are users being asked to intervene?
- Did a release change completion or failure rates?
- Can an unhealthy flow be stopped without shipping a new web release?

Telemetry uses stable event names and redacts candidate answers and page
content by default. Raw credentials and auth cookies are never logged.

## Scaling path

### Initial

- One web application and API.
- Shared SQLite-compatible hosted database with logical tenant isolation.
- Object storage for private resumes.
- Manifest V3 browser helper.
- One adapter and one durable event model.

### Growth

- Background workflow workers and queue-backed orchestration.
- Dedicated object storage lifecycle and malware scanning.
- Adapter health service, release channels, and feature flags.
- Read models or analytics storage for campaign reporting.
- Additional Chromium-compatible browsers and adapters.

### Mature

- Region-aware data and execution routing where needed.
- Organization workspaces with explicit candidate grants.
- Official ATS and employer integrations implementing the same execution
  contract.
- Optional desktop agent when browser limitations create measured customer
  friction.
- A direct opportunity and submission network that reduces dependence on any
  single external surface.

Scaling changes infrastructure, not the tenant, authority, evidence, or
source-of-truth principles.

## Architectural acceptance test

A design is acceptable only if the answer to each question is clear:

1. Which tenant owns the data and action?
2. Which authenticated principal or scoped capability authorizes it?
3. Where is the authoritative state stored?
4. What candidate fact and approval justify the action?
5. What evidence advances the workflow?
6. How does the user pause, cancel, correct, export, or delete it?
7. What happens after a crash, retry, navigation, or duplicate message?
8. Can the adapter or executor be replaced without losing product history?
9. Can an unhealthy release be disabled quickly?
10. Does the design improve candidate outcomes without weakening a trust
    guardrail?
