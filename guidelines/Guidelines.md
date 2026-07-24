# RapidApply Core Guidelines & Source of Truth

## North Star Vision & End State Statement
> **RapidApply is a production-ready, fully autonomous SaaS platform and Chrome extension engine that executes one-click job search campaigns unattended—discovering qualified LinkedIn Easy Apply listings, filling applications with candidate-truthful facts and AI-guided answers, and auto-queueing unknown fields—so job seekers effortlessly convert single-click campaign intent into verified interview opportunities without spending hours manually filling repetitive forms.**

---

## Core Product Invariants

1. **Autonomous Execution Contract**:
   - One-click launch from the web dashboard.
   - 100% unattended execution loop by default (`searching` → `opening_job` → `easy_apply` → `fill_step` → `submitted`).
   - Unknown/unresolvable fields never block or stall the main campaign execution loop; they are automatically deferred to the non-blocking **Finish Later Queue** or skipped according to candidate autonomy policy.

2. **Candidate Truthfulness & Facts Guardrail**:
   - System never invents candidate facts, degree details, or work authorization.
   - AI acts strictly as a candidate-fact-grounded synthesis aid, returning structured plans (`field → value → confidence → source`).

3. **Cloud Control Plane as Source of Truth**:
   - Web application database owns persistent state (campaigns, runs, events, profile facts, interventions, deferred jobs).
   - Chrome extension operates as a scoped, replaceable execution helper with short-lived capability tokens.

4. **Deterministic Resume Reuse**:
   - Single candidate-approved resume version per campaign (`ra_<user_id>_<campaign_slug>_v<rev>.pdf`).
   - Pre-run audit checks LinkedIn's existing uploaded resume list to eliminate duplicate uploads and churn.

5. **Explicit Verified Evidence**:
   - Domain events (`job_discovered`, `job_qualified`, `application_submitted`) are logged only upon explicit, verified DOM and adapter evidence.
