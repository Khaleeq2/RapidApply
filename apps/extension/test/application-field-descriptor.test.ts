import contactHtml from "./fixtures/linkedin/easy-apply-contact.html?raw";
import screeningHtml from "./fixtures/linkedin/easy-apply-screening-error.html?raw";
import { inspectLinkedInPage } from "../src/adapters/linkedin/observer";
import {
  classifyApplicationQuestion,
  describeActionableApplicationFields,
  describeObservedApplicationFields,
} from "../src/application/field-descriptor";

describe("application field descriptor", () => {
  it("maps legacy-style contact branches to deterministic field categories", () => {
    const observation = inspect(contactHtml, "https://www.linkedin.com/jobs/view/123456789/");
    const fields = describeObservedApplicationFields(observation.fields);

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", category: "contact_email", question: "Email address" }),
      expect.objectContaining({ kind: "text", category: "phone", question: "Mobile phone number" }),
    ]));
  });

  it("preserves constrained options while translating screening controls", () => {
    const observation = inspect(screeningHtml, "https://www.linkedin.com/jobs/view/123456789/");
    const fields = describeObservedApplicationFields(observation.fields);
    const experience = fields.find((field) => field.category === "years_experience");
    const authorization = fields.find((field) => field.category === "work_authorization");

    expect(experience).toEqual(expect.objectContaining({ kind: "number", required: true }));
    expect(experience?.constraints).toEqual({ minimum: 0, maximum: 99 });
    expect(authorization).toEqual(expect.objectContaining({ kind: "single_select" }));
    expect(authorization?.options.map((option) => option.label)).toEqual([
      "Yes",
      "No",
    ]);
  });

  it("leaves LinkedIn-prepopulated controls untouched while retaining blank actionable fields", () => {
    const observation = inspect(contactHtml, "https://www.linkedin.com/jobs/view/123456789/");
    const actionable = describeActionableApplicationFields([
      { ...observation.fields[0]!, hasValue: true },
      { ...observation.fields[1]!, hasValue: false },
    ]);

    expect(actionable).toHaveLength(1);
    expect(actionable[0]).toMatchObject({ category: "phone", question: "Mobile phone number" });
  });

  it("preserves native text bounds for grounded answer validation", () => {
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <label for="answer">Why are you interested?</label>
        <textarea id="answer" minlength="10" maxlength="200"></textarea>
        <button type="button">Next</button>
      </section>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(describeObservedApplicationFields(observation.fields)[0]?.constraints)
      .toEqual({ minLength: 10, maxLength: 200 });
  });

  it("describes a grouped checkbox question as one multi-select field", () => {
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <fieldset>
          <legend>Which design tools have you used?</legend>
          <label><input type="checkbox" name="tools" value="figma">Figma</label>
          <label><input type="checkbox" name="tools" value="framer">Framer</label>
        </fieldset>
        <button type="button">Next</button>
      </section>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    const fields = describeObservedApplicationFields(observation.fields);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      kind: "multi_select",
      question: "Which design tools have you used?",
    });
    expect(fields[0]?.options.map((option) => option.label)).toEqual(["Figma", "Framer"]);
  });

  it("preserves country-scale select options beyond the old forty-option cutoff", () => {
    const optionHtml = Array.from({ length: 75 }, (_, index) =>
      `<option value="country-${index + 1}">Country ${index + 1}</option>`
    ).join("");
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Contact info</h2>
        <label for="country">Country</label>
        <select id="country">${optionHtml}</select>
        <button type="button">Next</button>
      </section>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    const field = describeObservedApplicationFields(observation.fields)[0]!;
    expect(field.options).toHaveLength(75);
    expect(field.options.at(-1)?.label).toBe("Country 75");
  });

  it.each([
    ["Full legal name", "full_name"],
    ["Do you require sponsorship?", "sponsorship"],
    ["Are you willing to consent to a background check?", "background_check"],
    ["LinkedIn profile URL", "linkedin_url"],
    ["Portfolio website", "portfolio_url"],
    ["Professional headline", "headline"],
    ["Professional summary", "professional_summary"],
    ["Please describe your relevant experience", "open_text"],
    ["What is your desired salary?", "compensation"],
    ["Country of residence", "location"],
    ["Are you authorized to work in the United States?", "work_authorization"],
  ] as const)("classifies %s as %s", (label, category) => {
    expect(classifyApplicationQuestion(label, "text")).toBe(category);
  });
});

function inspect(html: string, url: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  return inspectLinkedInPage({ document, url: new URL(url), observedAt: "2026-07-21T12:00:00.000Z" });
}
