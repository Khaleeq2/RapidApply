import type { ApplicationAnswerPlanRecord, ApplicationAnswerValue } from "@rapidapply/contracts";
import contactHtml from "./fixtures/linkedin/easy-apply-contact.html?raw";
import reviewHtml from "./fixtures/linkedin/easy-apply-review.html?raw";
import resumeHtml from "./fixtures/linkedin/easy-apply-resume.html?raw";
import screeningHtml from "./fixtures/linkedin/easy-apply-screening-error.html?raw";
import { inspectLinkedInPage } from "../src/adapters/linkedin/observer";
import { describeObservedApplicationFields } from "../src/application/field-descriptor";
import { applyLinkedInReviewOnlyAnswers } from "../src/adapters/linkedin/review-only-executor";

describe("LinkedIn review-only executor", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("fills only resolved contact facts and does not click the next button", async () => {
    const observation = renderAndObserve(contactHtml.replace("+1 555 010 9999", ""));
    const fields = describeObservedApplicationFields(observation.fields);
    const next = document.querySelector<HTMLButtonElement>("button")!;
    const click = vi.fn();
    next.addEventListener("click", click);

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [
        resolvedPlan(fields[0]!, { type: "text", text: "new@example.test" }),
        resolvedPlan(fields[1]!, { type: "text", text: "+1 555 010 0001" }),
      ],
    });

    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe("new@example.test");
    expect(document.querySelector<HTMLInputElement>("#phone")?.value).toBe("+1 555 010 0001");
    expect(result.appliedFieldKeys).toEqual(fields.map((field) => field.key));
    expect(click).not.toHaveBeenCalled();
  });

  it("fills the blank mobile number and city fields from the current LinkedIn contact form", async () => {
    const observation = renderAndObserve(`
      <div class="job-details-jobs-unified-top-card" data-job-id="123456789"><h1>Senior Product Designer</h1></div>
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Apply to Fixture Labs</h2>
        <p>Contact info</p>
        <label for="first-name">First name*</label>
        <input id="first-name" type="text" value="Casey" required>
        <label for="last-name">Last name*</label>
        <input id="last-name" type="text" value="Rivera" required>
        <label for="phone-country">Phone country code*</label>
        <select id="phone-country"><option value="us" selected>United States (+1)</option></select>
        <label for="mobile-phone">Mobile phone number*</label>
        <input id="mobile-phone" type="tel" value="" required>
        <label for="email">Email address*</label>
        <input id="email" type="email" value="casey@example.test" required>
        <label for="city">Location (city)*</label>
        <input id="city" type="text" value="" required>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `);
    const fields = describeObservedApplicationFields(observation.fields);
    const phone = fields.find((field) => field.question === "Mobile phone number*");
    const city = fields.find((field) => field.question === "Location (city)*");
    expect(phone).toBeDefined();
    expect(city).toBeDefined();

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [
        resolvedPlan(phone!, { type: "text", text: "3333333" }),
        resolvedPlan(city!, { type: "text", text: "Brooklyn" }),
      ],
    });

    expect(document.querySelector<HTMLInputElement>("#mobile-phone")?.value).toBe("3333333");
    expect(document.querySelector<HTMLInputElement>("#city")?.value).toBe("Brooklyn");
    expect(result.appliedFieldKeys).toEqual([phone!.key, city!.key]);
  });

  it("selects the unique approved typeahead match instead of the first suggestion", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Contact info</h2>
        <div class="jobs-easy-apply-form-element">
          <label for="city">Location (city)</label>
          <input id="city" type="text" value="">
          <div role="listbox">
            <div id="wrong-city" role="option">Brooklyn, Ohio, United States</div>
            <div id="approved-city" role="option">Brooklyn, New York, United States</div>
          </div>
        </div>
        <button type="button">Next</button>
      </section>
    `);
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    const wrongClick = vi.fn();
    const approvedClick = vi.fn();
    document.querySelector("#wrong-city")?.addEventListener("click", wrongClick);
    document.querySelector("#approved-city")?.addEventListener("click", approvedClick);

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(field, {
        type: "text",
        text: "Brooklyn, New York, United States",
      })],
    });

    expect(wrongClick).not.toHaveBeenCalled();
    expect(approvedClick).toHaveBeenCalledOnce();
    expect(result.appliedFieldKeys).toEqual([field.key]);
  });

  it("re-resolves a field after LinkedIn replaces and reorders the form", async () => {
    const observation = renderAndObserve(contactHtml);
    const fields = describeObservedApplicationFields(observation.fields);
    const dialog = document.querySelector<HTMLElement>(".jobs-easy-apply-modal")!;
    const email = document.querySelector<HTMLInputElement>("#email")!;

    email.addEventListener("change", () => {
      dialog.innerHTML = `
        <h2>Contact info</h2>
        <label for="replacement-phone">Mobile phone number</label>
        <input id="replacement-phone" type="tel" value="">
        <label for="replacement-email">Email address</label>
        <input id="replacement-email" type="email" value="${email.value}">
        <button type="button">Next</button>
        <button type="button">Dismiss</button>`;
    });

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [
        resolvedPlan(fields[0]!, { type: "text", text: "candidate@example.test" }),
        resolvedPlan(fields[1]!, { type: "text", text: "+1 555 010 0001" }),
      ],
    });

    expect(document.querySelector<HTMLInputElement>("#replacement-email")?.value).toBe("candidate@example.test");
    expect(document.querySelector<HTMLInputElement>("#replacement-phone")?.value).toBe("+1 555 010 0001");
    expect(result.appliedFieldKeys).toEqual(fields.map((field) => field.key));
  });

  it("selects a server-approved option and blocks unresolved screening questions", async () => {
    const observation = renderAndObserve(screeningHtml);
    const fields = describeObservedApplicationFields(observation.fields);
    const authorization = fields.find((field) => field.category === "work_authorization")!;
    const experience = fields.find((field) => field.category === "years_experience")!;
    const yes = authorization.options.find((option) => option.label === "Yes")!;

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [
        resolvedPlan(authorization, { type: "options", optionIds: [yes.id] }),
        unresolvedPlan(experience),
      ],
    });

    expect(document.querySelector<HTMLSelectElement>("#authorization")?.value).toBe("yes");
    expect(result.appliedFieldKeys).toEqual([authorization.key]);
    expect(result.blocked).toEqual([{ fieldKey: experience.key, reason: "This field requires candidate review." }]);
  });

  it("does not choose the first native option when visible labels are duplicated", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <label for="answer">Choose one</label>
        <select id="answer">
          <option value="">Select an option</option>
          <option value="first">Yes</option>
          <option value="second">Yes</option>
          <option value="no">No</option>
        </select>
        <button type="button">Next</button>
      </section>
    `);
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    const duplicateYes = field.options.filter((option) => option.label === "Yes");
    expect(duplicateYes).toHaveLength(2);

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(field, {
        type: "options",
        optionIds: [duplicateYes[1]!.id],
      })],
    });

    expect(document.querySelector<HTMLSelectElement>("#answer")?.value).toBe("");
    expect(result.blocked).toEqual([{
      fieldKey: field.key,
      reason: "RapidApply could not identify the approved select option uniquely.",
    }]);
  });

  it("refuses review pages that expose a submit control", async () => {
    const observation = renderAndObserve(reviewHtml);
    await expect(applyLinkedInReviewOnlyAnswers({ document, observation, plans: [] }))
      .rejects.toThrow("refuses to fill a review or submission state");
  });

  it("blocks resume uploads even when a server plan exists", async () => {
    const observation = renderAndObserve(resumeHtml);
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(field, { type: "text", text: "resume.pdf" })],
    });

    expect(result.appliedFieldKeys).toEqual([]);
    expect(result.blocked).toEqual([{
      fieldKey: field.key,
      reason: "Resume upload is not enabled in review-only execution.",
    }]);
  });

  it("never maps an active answer plan onto a hidden stale application control", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog" aria-hidden="true">
        <h2>Apply to stale job</h2>
        <label for="stale-phone">Mobile phone number</label>
        <input id="stale-phone" type="tel" value="">
        <button type="button">Next</button>
      </section>
      <section class="live-linkedin-shell">
        <h2>Apply to Fixture Labs</h2>
        <p>Contact info</p>
        <label for="active-email">Email address</label>
        <input id="active-email" type="email" value="">
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `);
    const email = describeObservedApplicationFields(observation.fields)[0]!;

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(email, { type: "text", text: "active@example.test" })],
    });

    expect(document.querySelector<HTMLInputElement>("#active-email")?.value).toBe("active@example.test");
    expect(document.querySelector<HTMLInputElement>("#stale-phone")?.value).toBe("");
    expect(result.appliedFieldKeys).toEqual([email.key]);
  });

  it("never maps an answer plan onto LinkedIn's global header controls", async () => {
    const observation = renderAndObserve(`
      <div id="linkedin-app-shell">
        <header class="global-nav">
          <label>I'm looking for… <input id="global-search" aria-label="I'm looking for…" type="search" value=""></label>
          <label>Global notification preference <input id="global-toggle" type="checkbox"></label>
        </header>
        <main class="job-details-jobs-unified-top-card" data-job-id="123456789">
          <h1>Senior Product Designer</h1>
        </main>
        <section data-live-easy-apply-surface>
          <h2>Apply to Fixture Labs</h2>
          <p>Contact info</p>
          <div class="jobs-easy-apply-form-element">
            <label for="modal-email">Email address</label>
            <input id="modal-email" type="email" value="">
          </div>
          <button type="button">Next</button>
          <button type="button">Dismiss</button>
        </section>
      </div>
    `);
    const email = describeObservedApplicationFields(observation.fields)[0]!;

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(email, { type: "text", text: "candidate@example.test" })],
    });

    expect(document.querySelector<HTMLInputElement>("#modal-email")?.value).toBe("candidate@example.test");
    expect(document.querySelector<HTMLInputElement>("#global-search")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#global-toggle")?.checked).toBe(false);
    expect(result.appliedFieldKeys).toEqual([email.key]);
  });

  it("blocks when neither the field key nor a unique semantic label matches", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <label for="portfolio">Portfolio URL</label>
        <input id="portfolio" type="text" value="">
        <label for="headline">Professional headline</label>
        <input id="headline" type="text" value="">
        <button type="button">Next</button>
      </section>
    `);
    const observed = describeObservedApplicationFields(observation.fields)[0]!;
    const staleField = { ...observed, key: "deadbeef", question: "Unmatched question" };
    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(staleField, { type: "text", text: "Must not be guessed" })],
    });

    expect(document.querySelector<HTMLInputElement>("#portfolio")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#headline")?.value).toBe("");
    expect(result.blocked).toEqual([{
      fieldKey: "deadbeef",
      reason: "The observed form control changed.",
    }]);
  });

  it("applies an exact multi-checkbox option set and verifies every control", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <fieldset>
          <legend>Which tools have you used?</legend>
          <label><input type="checkbox" name="tools" value="figma">Figma</label>
          <label><input type="checkbox" name="tools" value="sketch">Sketch</label>
          <label><input type="checkbox" name="tools" value="framer">Framer</label>
        </fieldset>
        <button type="button">Next</button>
      </section>
    `);
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    const figma = field.options.find((option) => option.label === "Figma")!;
    const framer = field.options.find((option) => option.label === "Framer")!;
    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(field, {
        type: "options",
        optionIds: [figma.id, framer.id],
      })],
    });

    const controls = [...document.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
    expect(controls.map((control) => control.checked)).toEqual([true, false, true]);
    expect(result.appliedFieldKeys).toEqual([field.key]);
  });

  it("applies an exact native multi-select option set", async () => {
    const observation = renderAndObserve(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <label for="disciplines">Design disciplines</label>
        <select id="disciplines" multiple>
          <option value="product">Product design</option>
          <option value="research">User research</option>
          <option value="brand">Brand design</option>
        </select>
        <button type="button">Next</button>
      </section>
    `);
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    expect(field.kind).toBe("multi_select");
    const product = field.options.find((option) => option.label === "Product design")!;
    const research = field.options.find((option) => option.label === "User research")!;
    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [resolvedPlan(field, {
        type: "options",
        optionIds: [product.id, research.id],
      })],
    });

    const selected = [...document.querySelector<HTMLSelectElement>("#disciplines")!.options]
      .filter((option) => option.selected)
      .map((option) => option.textContent);
    expect(selected).toEqual(["Product design", "User research"]);
    expect(result.appliedFieldKeys).toEqual([field.key]);
  });
});

function renderAndObserve(html: string) {
  document.open();
  document.write(html);
  document.close();
  return inspectLinkedInPage({
    document,
    url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    observedAt: "2026-07-21T12:00:00.000Z",
  });
}

function resolvedPlan(field: ApplicationAnswerPlanRecord["field"], answer: ApplicationAnswerValue): ApplicationAnswerPlanRecord {
  return {
    id: crypto.randomUUID(),
    runId: "run",
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    field,
    plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: ["profile.fixture"], requiresReview: false },
    decision: { status: "resolved", fieldKey: field.key, source: "profile_fact", answer, provenanceIds: ["profile.fixture"], requiresReview: false },
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
}

function unresolvedPlan(field: ApplicationAnswerPlanRecord["field"]): ApplicationAnswerPlanRecord {
  return {
    id: crypto.randomUUID(),
    runId: "run",
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    field,
    plan: { strategy: "user_input", reason: "approved_answer_required", candidateFactIds: [], requiresReview: true },
    decision: { status: "needs_user_input", fieldKey: field.key, reason: "approved_answer_required", requiresReview: true },
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
}
