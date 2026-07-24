# Candidate-reviewable AI drafting

AI is currently an optional writing aid inside **Resume & Profile**. It is not
yet called by browser execution, application submission, or screening-question
answers, and it is never a candidate-fact authority.

The provider-independent contracts and decision policy for future application
answers are defined separately in
[application-answer-intelligence.md](application-answer-intelligence.md).

## User flow

```text
Candidate edits their profile
        ↓
Candidate explicitly selects “Draft with AI”
        ↓
Server sends a minimal profile excerpt to one configured provider
        ↓
Draft fills the editable summary field locally
        ↓
Candidate verifies every claim and chooses Save profile
```

The draft endpoint never writes to the candidate profile. Closing the page or
editing the text without saving leaves the durable profile unchanged.

## Data boundary

The server sends only these fields to the configured provider:

- professional headline;
- location; and
- the current professional-summary text.

It deliberately excludes name, contact email, phone number, work
authorization, sponsorship status, LinkedIn URL, and portfolio URL. The model
is instructed to use the supplied fields as reference material, never as
instructions, and to avoid inventing employers, achievements, years of
experience, tools, education, certifications, metrics, or legal-status claims.

## Provider boundary

`RAPIDAPPLY_AI_PROVIDER` selects exactly one provider:

- `gemini` uses Gemini's Interactions API with `store: false` and structured
  JSON output; or
- `groq` uses Groq Chat Completions with the configured model and JSON Object
  Mode. RapidApply validates Groq output server-side before returning it.

`GEMINI_API_KEY` and `GROQ_API_KEY` are read only in the Next.js server runtime;
neither is returned to the browser or extension. Providers have bounded
timeouts, return safe errors, and do not trigger an automatic fallback. That
last rule is intentional: a candidate's excerpt must never be sent to a second
vendor merely because the first vendor failed.

The UI identifies the provider after it produces an unsaved draft and requires
candidate review. RapidApply treats the candidate's saved profile—not the
generated draft—as the only source of candidate facts.

## Groq configuration

The current Groq configuration uses `llama-3.1-8b-instant`. It supports JSON
Object Mode, not Groq's strict schema mode, so output validation remains part
of RapidApply's server boundary. Any public launch must also document the
chosen provider in the product privacy notice and review that provider's
current data-handling terms.

## Current limits

- No resume file is sent or uploaded through this feature.
- The feature does not query job boards, open browser tabs, or submit
  applications.
- The feature does not answer screening, legal, compensation, or demographic
  questions.
- The endpoint requires a server-validated RapidApply session. Production still
  requires deployment secrets and real verification/reset email delivery.
