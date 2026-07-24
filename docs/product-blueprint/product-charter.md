# RapidApply product charter

## Purpose

This charter defines the product RapidApply is building. It is intentionally
independent of a particular browser, website layout, AI provider, database, or
deployment vendor so it can guide both the first launch and the mature product.

## Product category

RapidApply is a multi-tenant job-search automation SaaS with a user-authorized
browser execution layer.

It is not fundamentally a resume builder, job board, browser extension, or
form-filling utility. Those may be surfaces or capabilities. The product is a
managed job-search campaign that turns a candidate's intent and approved facts
into completed applications and measurable outcomes.

## Vision

RapidApply becomes the candidate's trusted job-search agent: it finds relevant
opportunities, prepares and executes accurate applications, manages necessary
follow-up, learns what produces interviews, and helps the candidate progress
from intent to a strong offer.

## Mission

Remove the repetitive operational work of job searching while keeping the
candidate informed, accurately represented, and in control.

## Core promise

> Tell RapidApply the work you want. RapidApply keeps the campaign moving and
> involves you only when your judgment, authorization, or new information is
> required.

The launch promise may be expressed more concretely as:

> Configure one campaign and complete many relevant applications without
> repeating the same search, typing, and form work.

## Customer

### Primary ideal customer profile

The initial customer is an active individual job seeker who:

- repeatedly applies to similar roles;
- uses a supported desktop browser and supported job source;
- has enough relevant experience and stable profile facts to reuse across
  applications;
- values time savings, consistency, and campaign visibility;
- is comfortable reviewing preferences and intervening when an answer is not
  already known; and
- is willing to pay for a faster, less exhausting path to interviews.

The strongest initial segment is a focused applicant pursuing one or a small
number of role families, rather than a casual browser with no defined target.

### Customer jobs to be done

When searching for work, the customer hires RapidApply to:

1. translate a target role and location into a repeatable search campaign;
2. identify opportunities that fit declared preferences;
3. eliminate repeated data entry and navigation;
4. apply consistently without making unsupported claims;
5. understand what was attempted, completed, skipped, or blocked;
6. respond quickly when human input is necessary; and
7. learn which campaign choices lead to interviews and offers.

### Future customer models

The individual candidate remains the fundamental subject even if RapidApply
later serves career coaches, universities, outplacement providers, staffing
organizations, or employers. An organization may sponsor or manage access, but
candidate facts, consent, and application history require explicit boundaries.

## Product principles

### Outcomes over volume

The product optimizes for relevant interviews and strong offers. Application
count is an operational measure, not the ultimate definition of success.

### Automation earns autonomy

RapidApply may act automatically when the action is supported, reversible where
appropriate, and based on candidate-approved facts. Uncertain or consequential
questions pause for the candidate. Greater autonomy is earned through measured
reliability, not assumed by default.

### Accurate representation

RapidApply must not invent candidate facts. Rewriting may improve presentation,
but it may not alter the truth of experience, authorization, qualifications,
identity, or legal attestations.

### Visible control

The candidate can understand what is running, pause or cancel a campaign, see
why an application was skipped or blocked, and inspect what was submitted.

### Durable progress

Closing a page, suspending an extension worker, losing a network connection, or
restarting a browser must not erase the authoritative campaign state.

### Replaceable execution

The value of RapidApply lives in campaign intelligence, trusted candidate data,
outcome history, and orchestration. A particular extension, site adapter, or
submission route may be replaced without replacing the product.

### Explicit evidence

RapidApply records a meaningful event only when it has corresponding evidence.
Opening a page is not an application. Clicking a button is not confirmation.
Submission is recorded only after a supported completion signal is observed.

## Initial product experience

The intended MVP loop is:

```text
Create account and candidate profile
        ↓
Define role, location, filters, and application target
        ↓
Save a durable campaign
        ↓
Start the browser helper and grant the required site access
        ↓
Sign in manually when the site requires authentication
        ↓
Discover and qualify job listings
        ↓
Prepare each supported application from approved facts
        ↓
Submit automatically when campaign policy allows;
pause when authorization, a security challenge, or new facts are required
        ↓
Verify and record the result
        ↓
Show campaign progress and outcomes in RapidApply
```

LinkedIn is the first intended site adapter and product-learning environment.
The underlying execution runtime must remain site-independent so later sources
can be added without duplicating campaign logic.

## MVP scope

### Required for launch

- Account creation, secure sign-in, sign-out, and account recovery.
- One candidate profile containing reusable, candidate-approved facts.
- Resume selection and a durable file-storage policy.
- Campaign creation for role, location, filters, target count, and execution
  preferences.
- A browser helper paired securely to the signed-in RapidApply account.
- Manual site login, MFA, CAPTCHA, and security-challenge handling by the user.
- One production-quality LinkedIn adapter for explicitly supported search and
  Easy Apply flows.
- Search-result discovery, deduplication, qualification, and bounded job
  collection.
- Reliable form interaction, navigation recovery, and resumable checkpoints.
- A question policy that distinguishes approved, reviewable, and always-manual
  answers.
- Automatic submission only within the candidate's declared campaign policy.
- Submission confirmation, skips, failures, and human-input requests recorded
  as durable events.
- Live campaign status, pause, resume, cancel, and application history.
- Clear disclosures, consent, privacy controls, and data deletion paths before
  public launch.
- Basic entitlement enforcement and payment for the paid product.
- Operational monitoring sufficient to detect broken adapters and halt them
  remotely.

### Deliberately outside the first launch

- Broad support for every job board or arbitrary web form.
- Mobile-device execution of third-party application flows.
- A candidate marketplace or employer network.
- Offer negotiation and interview coaching as automated workflows.
- Agency or enterprise organization workspaces.
- Fully autonomous answers to unknown or consequential questions.
- Dependence on cloud-hosted stealth browsers or stored third-party passwords.

These exclusions control sequencing; they do not limit the long-term vision.

## Success model

### North Star

**Qualified interviews generated by active campaigns.**

An interview counts only when it is attributable to a recorded RapidApply
application and represents genuine employer interest. This is the clearest
measure that the system is doing useful work rather than producing activity.

Because interviews are delayed, the product also needs leading indicators.

### Activation

An account is activated when the candidate:

1. completes the minimum trusted profile;
2. creates a valid campaign;
3. securely connects the browser helper; and
4. completes the first verified supported application.

**Activation rate** is activated accounts divided by eligible new accounts.

### Time to value

**Time to first verified application** is measured from completed account
creation to the first application with supported submission evidence.

### Execution quality

- Supported-flow completion rate.
- Applications completed per active execution hour.
- Human-intervention rate and reason distribution.
- Unexpected failure rate by adapter and page state.
- Duplicate-attempt rate.
- Submission-confirmation confidence.
- Percentage of applications using only previously approved facts.

### Campaign quality

- Qualified applications per campaign.
- Employer-response rate.
- Interview rate per qualified application.
- Interview rate by source, role family, resume version, and campaign rule.
- Candidate skip, correction, and cancellation rates.

### Business health

- Visitor-to-account conversion.
- Account-to-activation conversion.
- Activated free-to-paid conversion.
- Gross and net revenue retention for applicable plans.
- Contribution margin per completed campaign.
- Support burden and refund rate.

### Trust guardrails

The following are release-blocking guardrails rather than optimization targets:

- cross-tenant data exposure;
- submission under the wrong candidate identity;
- invented candidate facts;
- unapproved answers to always-manual questions;
- applications recorded as submitted without acceptable evidence; and
- continued execution after the user cancels or a run reaches a terminal state.

## Long-term product

The mature product expands along five connected capabilities:

1. **Execution:** complete supported applications reliably.
2. **Campaign management:** choose opportunities, timing, resume, and follow-up.
3. **Outcome intelligence:** learn what produces interviews for each candidate.
4. **Direct access:** use official ATS, employer, and partner submission paths
   where they provide a stronger route than browser execution.
5. **Career agency:** help the candidate prepare, interview, evaluate, and
   negotiate until a suitable offer is accepted.

The extension is the initial execution wedge. The durable company is the
trusted system that learns and manages the shortest path from candidate intent
to a good employment outcome.

## Decision test

A proposed capability belongs in RapidApply when it materially improves at
least one of the following without violating the trust guardrails:

- speed to a qualified application;
- application accuracy or relevance;
- campaign reliability;
- candidate visibility and control;
- interview or offer probability; or
- the system's ability to learn which actions create outcomes.

Work that only increases technical novelty, raw click volume, or platform
breadth without improving these dimensions should not displace core execution
quality.
