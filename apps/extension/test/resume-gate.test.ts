import resumeHtml from "./fixtures/linkedin/easy-apply-resume.html?raw";
import { inspectLinkedInPage } from "../src/adapters/linkedin/observer";
import {
  isResumeSelectionField,
  needsManualResumeSelection,
} from "../src/application/resume-gate";

describe("resume gate", () => {
  it("pauses a required resume step until LinkedIn has an attached document", () => {
    const observation = inspect(resumeHtml);
    expect(needsManualResumeSelection(observation)).toBe(true);

    observation.fields[0] = { ...observation.fields[0]!, hasValue: true };
    expect(needsManualResumeSelection(observation)).toBe(false);
  });

  it("detects an unresolved document control regardless of the inferred step label", () => {
    const observation = inspect(resumeHtml);
    observation.applicationStep = "contact";
    expect(needsManualResumeSelection(observation)).toBe(true);
  });

  it("ignores an unavailable disabled upload control", () => {
    const observation = inspect(resumeHtml.replace('type="file"', 'type="file" disabled'));
    expect(needsManualResumeSelection(observation)).toBe(false);
  });

  it("does not treat an unrelated optional document upload as the campaign resume", () => {
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Additional questions</h2>
        <label for="cover-letter">Optional cover letter</label>
        <input id="cover-letter" type="file">
        <button type="button">Next</button>
      </section>
    `);
    expect(observation.applicationStep).not.toBe("resume");
    expect(observation.fields.some((field) =>
      isResumeSelectionField(observation, field)
    )).toBe(false);
    expect(needsManualResumeSelection(observation)).toBe(false);
  });
});

function inspect(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  return inspectLinkedInPage({
    document,
    url: new URL("https://www.linkedin.com/jobs/view/123456789/"),
    observedAt: "2026-07-21T12:00:00.000Z",
  });
}
