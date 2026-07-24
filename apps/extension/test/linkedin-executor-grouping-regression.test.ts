import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ApplicationAnswerPlanRecord } from "@rapidapply/contracts";
import { inspectLinkedInPage } from "../src/adapters/linkedin/observer";
import { describeObservedApplicationFields } from "../src/application/field-descriptor";
import { applyLinkedInReviewOnlyAnswers } from "../src/adapters/linkedin/review-only-executor";

describe("LinkedIn executor grouping regression test", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("correctly maps text field answer to text input when preceded by a 2-option radio group", async () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card" data-job-id="123456789"><h1>Product Designer</h1></div>
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Apply to Fixture Labs</h2>
        <fieldset>
          <legend>Are you authorized to work in the US?*</legend>
          <label><input type="radio" name="authorized" value="Yes"> Yes</label>
          <label><input type="radio" name="authorized" value="No"> No</label>
        </fieldset>
        <label for="headline">Professional headline*</label>
        <input id="headline" type="text" value="" required />
      </section>
    `;

    const observation = inspectLinkedInPage({
      document,
      url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    });

    expect(observation.pageType).toBe("application_form");
    expect(observation.fields).toHaveLength(2); // 1 radio group + 1 text input

    const fields = describeObservedApplicationFields(observation.fields);
    const radioField = fields[0]!;
    const textField = fields[1]!;

    const radioPlan: ApplicationAnswerPlanRecord = {
      id: "plan-1",
      jobExternalId: "123456789",
      observationFingerprint: "a1b2c3d4",
      createdAt: "2026-07-23T12:00:00Z",
      updatedAt: "2026-07-23T12:00:00Z",
      runId: "run-1",
      field: radioField,
      plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: [], requiresReview: false },
      decision: {
        status: "resolved",
        fieldKey: radioField.key,
        source: "profile_fact",
        answer: { type: "options", optionIds: [radioField.options![0]!.id] },
        provenanceIds: [],
        requiresReview: false,
      },
    };

    const textPlan: ApplicationAnswerPlanRecord = {
      id: "plan-2",
      jobExternalId: "123456789",
      observationFingerprint: "a1b2c3d4",
      createdAt: "2026-07-23T12:00:00Z",
      updatedAt: "2026-07-23T12:00:00Z",
      runId: "run-1",
      field: textField,
      plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: [], requiresReview: false },
      decision: {
        status: "resolved",
        fieldKey: textField.key,
        source: "profile_fact",
        answer: { type: "text", text: "Staff Product Designer" },
        provenanceIds: [],
        requiresReview: false,
      },
    };

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [radioPlan, textPlan],
    });

    const headlineInput = document.querySelector<HTMLInputElement>("#headline");
    const secondRadio = document.querySelectorAll<HTMLInputElement>("input[type='radio']")[1];

    expect(result.appliedFieldKeys).toContain(textField.key);
    expect(result.appliedFieldKeys).toContain(radioField.key);
    expect(headlineInput?.value).toBe("Staff Product Designer");
    expect(document.querySelectorAll<HTMLInputElement>("input[type='radio']")[0]?.checked).toBe(true);
    expect(secondRadio?.value).toBe("No"); // Second radio input MUST NOT be corrupted by text answer!
  });

  it("reads choice text from LinkedIn SDUI role-radio containers", async () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card" data-job-id="123456789"><h1>Product Designer</h1></div>
      <dialog class="jobs-easy-apply-modal" open>
      <h2>Additional Questions</h2>
      <p>Are you comfortable working in a remote setting?*</p>
      <fieldset role="radiogroup">
          <div role="radio" aria-checked="false"><input id="yes" type="radio" name="remote"><label for="yes"></label><p>Yes</p></div>
          <div role="radio" aria-checked="false"><input id="no" type="radio" name="remote"><label for="no"></label><p>No</p></div>
        </fieldset>
      </dialog>
    `;

    for (const radio of [...document.querySelectorAll<HTMLElement>("[role='radio']")]) {
      radio.addEventListener("click", () => {
        for (const sibling of [...radio.parentElement!.querySelectorAll<HTMLElement>("[role='radio']")]) {
          sibling.setAttribute("aria-checked", String(sibling === radio));
          const input = sibling.querySelector<HTMLInputElement>("input[type='radio']");
          if (input) input.checked = sibling === radio;
        }
      });
    }

    const observation = inspectLinkedInPage({
      document,
      url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    });
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    expect(field.options?.map((option) => option.label)).toEqual(["Yes", "No"]);

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [{
        id: "sdui-plan",
        runId: "run-1",
        jobExternalId: "123456789",
        observationFingerprint: "a1b2c3d4",
        createdAt: "2026-07-23T12:00:00Z",
        updatedAt: "2026-07-23T12:00:00Z",
        field,
        plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: [], requiresReview: false },
        decision: {
          status: "resolved",
          fieldKey: field.key,
          source: "profile_fact",
          answer: { type: "options", optionIds: [field.options![0]!.id] },
          provenanceIds: [],
          requiresReview: false,
        },
      }],
    });

    expect(result.blocked).toEqual([]);
    expect(document.querySelector<HTMLInputElement>("#yes")?.checked).toBe(true);
    expect(document.querySelector<HTMLElement>("#yes")?.closest("[role='radio']")?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector<HTMLElement>("#no")?.closest("[role='radio']")?.getAttribute("aria-checked")).toBe("false");
  });

  it("does not report success when a custom radio remains only natively checked", async () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card" data-job-id="123456789"><h1>Product Designer</h1></div>
      <dialog class="jobs-easy-apply-modal" open>
        <h2>Additional Questions</h2>
        <p>Are you comfortable working in a remote setting?*</p>
        <fieldset role="radiogroup">
          <div role="radio" aria-checked="false"><input id="yes" type="radio" name="remote"><label for="yes"></label><p>Yes</p></div>
          <div role="radio" aria-checked="false"><input id="no" type="radio" name="remote"><label for="no"></label><p>No</p></div>
        </fieldset>
      </dialog>
    `;
    const observation = inspectLinkedInPage({
      document,
      url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    });
    const field = describeObservedApplicationFields(observation.fields)[0]!;

    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [{
        id: "native-only-plan",
        runId: "run-1",
        jobExternalId: "123456789",
        observationFingerprint: "a1b2c3d4",
        createdAt: "2026-07-23T12:00:00Z",
        updatedAt: "2026-07-23T12:00:00Z",
        field,
        plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: [], requiresReview: false },
        decision: {
          status: "resolved",
          fieldKey: field.key,
          source: "profile_fact",
          answer: { type: "options", optionIds: [field.options![0]!.id] },
          provenanceIds: [],
          requiresReview: false,
        },
      }],
    });

    expect(result.appliedFieldKeys).toEqual([]);
    expect(result.blocked).toEqual([{
      fieldKey: field.key,
      reason: "LinkedIn did not accept the approved option selection.",
    }]);
    expect(document.querySelector<HTMLInputElement>("#yes")?.checked).toBe(true);
    expect(document.querySelector<HTMLElement>("#yes")?.closest("[role='radio']")?.getAttribute("aria-checked")).toBe("false");
  });

  it("falls back to LinkedIn's associated label when the wrapper has no handler", async () => {
    document.body.innerHTML = `
      <div class="job-details-jobs-unified-top-card" data-job-id="123456789"><h1>Product Designer</h1></div>
      <dialog class="jobs-easy-apply-modal" open>
        <h2>Additional Questions</h2>
        <p>Are you legally authorized to work in the United States?*</p>
        <fieldset role="radiogroup">
          <div role="radio" aria-checked="false"><input id="authorized-yes" type="radio" name="authorized"><label for="authorized-yes"></label><p>Yes</p></div>
          <div role="radio" aria-checked="false"><input id="authorized-no" type="radio" name="authorized"><label for="authorized-no"></label><p>No</p></div>
        </fieldset>
      </dialog>
    `;

    const yes = document.querySelector<HTMLInputElement>("#authorized-yes")!;
    const no = document.querySelector<HTMLInputElement>("#authorized-no")!;
    const yesLabel = document.querySelector<HTMLLabelElement>("label[for='authorized-yes']")!;
    yesLabel.addEventListener("click", () => {
      yes.checked = true;
      no.checked = false;
      yes.closest("[role='radio']")?.setAttribute("aria-checked", "true");
      no.closest("[role='radio']")?.setAttribute("aria-checked", "false");
    });

    const observation = inspectLinkedInPage({
      document,
      url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    });
    const field = describeObservedApplicationFields(observation.fields)[0]!;
    const result = await applyLinkedInReviewOnlyAnswers({
      document,
      observation,
      plans: [{
        id: "label-plan",
        runId: "run-1",
        jobExternalId: "123456789",
        observationFingerprint: "a1b2c3d4",
        createdAt: "2026-07-23T12:00:00Z",
        updatedAt: "2026-07-23T12:00:00Z",
        field,
        plan: { strategy: "deterministic", reason: "candidate_fact_available", candidateFactIds: [], requiresReview: false },
        decision: {
          status: "resolved",
          fieldKey: field.key,
          source: "profile_fact",
          answer: { type: "options", optionIds: [field.options![0]!.id] },
          provenanceIds: [],
          requiresReview: false,
        },
      }],
    });

    expect(result.blocked).toEqual([]);
    expect(yes.checked).toBe(true);
    expect(yes.closest("[role='radio']")?.getAttribute("aria-checked")).toBe("true");
  });
});
