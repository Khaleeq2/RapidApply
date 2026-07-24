import checkpointHtml from "./fixtures/linkedin/checkpoint.html?raw";
import confirmationHtml from "./fixtures/linkedin/confirmation.html?raw";
import contactHtml from "./fixtures/linkedin/easy-apply-contact.html?raw";
import resumeHtml from "./fixtures/linkedin/easy-apply-resume.html?raw";
import reviewHtml from "./fixtures/linkedin/easy-apply-review.html?raw";
import screeningHtml from "./fixtures/linkedin/easy-apply-screening-error.html?raw";
import jobDetailHtml from "./fixtures/linkedin/job-detail.html?raw";
import loginHtml from "./fixtures/linkedin/login.html?raw";
import searchResultsHtml from "./fixtures/linkedin/search-results.html?raw";
import { inspectLinkedInPage, linkedinObserverAdapter } from "../src/adapters/linkedin/observer";
import {
  isAdapterObservationMessage,
  isLinkedInSearchDiscoveryResultMessage,
} from "../src/observer/messages";

const OBSERVED_AT = "2026-07-21T12:00:00.000Z";

describe("LinkedIn observer adapter", () => {
  it.each([
    ["login_required", loginHtml, "https://www.linkedin.com/login"],
    ["security_challenge", checkpointHtml, "https://www.linkedin.com/checkpoint/challenge/"],
    ["search_results", searchResultsHtml, "https://www.linkedin.com/jobs/search/?keywords=designer"],
    ["job_detail", jobDetailHtml, "https://www.linkedin.com/jobs/view/123456789/"],
    ["application_form", contactHtml, "https://www.linkedin.com/jobs/view/123456789/"],
    ["application_form", resumeHtml, "https://www.linkedin.com/jobs/view/123456789/"],
    ["application_form", screeningHtml, "https://www.linkedin.com/jobs/view/123456789/"],
    ["application_review", reviewHtml, "https://www.linkedin.com/jobs/view/123456789/"],
    ["application_confirmation", confirmationHtml, "https://www.linkedin.com/jobs/view/123456789/"],
  ] as const)("classifies %s", (expected, html, url) => {
    const observation = inspect(html, url);
    expect(observation.pageType).toBe(expected);
    expect(observation.fingerprint).toMatch(/^[a-f0-9]{8}$/);
  });

  it("extracts job identity and an Easy Apply action", () => {
    const observation = inspect(jobDetailHtml, "https://www.linkedin.com/jobs/view/123456789/");
    expect(observation.job).toEqual({
      externalId: "123456789",
      title: "Senior Product Designer",
      company: "Fixture Labs",
      location: "New York, NY · Remote",
    });
    expect(observation.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "open_application", disabled: false }),
    ]));
  });

  it("recognizes LinkedIn's generic Apply to container without legacy dialog markers", () => {
    const observation = inspect(`
      <main class="job-details-jobs-unified-top-card" data-job-id="123456789">
        <h1>Senior Product Designer</h1>
        <button aria-label="Easy Apply to this job">Easy Apply</button>
      </main>
      <div class="live-linkedin-shell">
        <h2>Apply to Fixture Labs</h2>
        <p>Contact info</p>
        <label>Mobile phone number <input type="tel" required></label>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </div>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(observation.pageType).toBe("application_form");
    expect(observation.applicationStep).toBe("contact");
    expect(observation.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ control: "tel", required: true }),
    ]));
  });

  it("does not mistake a job-detail page for a generic application surface", () => {
    const observation = inspect(`
      <main class="job-details-jobs-unified-top-card" data-job-id="123456789">
        <h1>Senior Product Designer</h1>
        <label>Search jobs <input type="search"></label>
        <button aria-label="Easy Apply to this job">Easy Apply</button>
        <button type="button">Next</button>
      </main>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(observation.pageType).toBe("job_detail");
    expect(observation.fields).toEqual([]);
  });

  it("uses only the visible active application surface and preserves preselected selects", () => {
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog" aria-hidden="true">
        <h2>Apply to stale job</h2>
        <label>Stale checkbox <input type="checkbox"></label>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
      <div class="live-linkedin-shell">
        <h2>Apply to Fixture Labs</h2>
        <p>Contact info</p>
        <label for="email">Email address <input id="email" type="email" value=""></label>
        <label for="country">Phone country code
          <select id="country">
            <option value="" selected>United States (+1)</option>
            <option value="CA">Canada (+1)</option>
          </select>
        </label>
        <label for="phone">Mobile phone number <input id="phone" type="tel" value=""></label>
        <label for="availability">Availability
          <select id="availability">
            <option value="" selected>Select an option</option>
            <option value="now">Immediately</option>
          </select>
        </label>
        <button type="button" aria-hidden="true">Submit application</button>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </div>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(observation.pageType).toBe("application_form");
    expect(observation.applicationStep).toBe("contact");
    expect(observation.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "submit" }),
    ]));
    expect(observation.fields).toHaveLength(4);
    expect(observation.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Phone country code", hasValue: true }),
      expect.objectContaining({ label: "Availability", hasValue: false }),
    ]));
    expect(observation.fields.map((field) => field.label)).not.toContain("Stale checkbox");
  });

  it("anchors a generic Easy Apply surface below LinkedIn's global header controls", () => {
    const observation = inspect(`
      <div id="linkedin-app-shell">
        <header class="global-nav">
          <label>I'm looking for… <input aria-label="I'm looking for…" type="search"></label>
          <label>Global notification preference <input type="checkbox"></label>
        </header>
        <main class="job-details-jobs-unified-top-card" data-job-id="123456789">
          <h1>Senior Product Designer</h1>
          <button aria-label="Easy Apply to this job">Easy Apply</button>
        </main>
        <aside class="overlay-host">
          <section data-live-easy-apply-surface>
            <h2>Apply to Fixture Labs</h2>
            <p>Contact info</p>
            <div class="jobs-easy-apply-form-element">
              <label for="modal-email">Email address</label>
              <input id="modal-email" type="email" required>
            </div>
            <div class="jobs-easy-apply-form-element">
              <label for="modal-phone">Mobile phone number</label>
              <input id="modal-phone" type="tel" required>
            </div>
            <button type="button">Next</button>
            <button type="button">Dismiss</button>
          </section>
        </aside>
      </div>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(observation.pageType).toBe("application_form");
    expect(observation.fields.map((field) => field.label)).toEqual([
      "Email address",
      "Mobile phone number",
    ]);
    expect(observation.fields.map((field) => field.label)).not.toContain("I'm looking for…");
    expect(observation.fields.map((field) => field.label)).not.toContain("Global notification preference");
  });

  it.each([
    [contactHtml, "contact"],
    [resumeHtml, "resume"],
    [screeningHtml, "screening"],
    [reviewHtml, "review"],
  ] as const)("detects the %s application stage", (html, expected) => {
    const observation = inspect(html, "https://www.linkedin.com/jobs/view/123456789/");
    expect(observation.applicationStep).toBe(expected);
  });

  it("records field shape and presence without recording field or query values", () => {
    const observation = inspect(
      contactHtml,
      "https://www.linkedin.com/jobs/view/123456789/?keywords=secret-search-phrase&currentJobId=123456789",
    );
    const serialized = JSON.stringify(observation);

    expect(observation.queryKeys).toEqual(["currentJobId", "keywords"]);
    expect(observation.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Email address", control: "email", hasValue: true }),
      expect.objectContaining({ label: "Mobile phone number", control: "tel", hasValue: true }),
    ]));
    expect(serialized).not.toContain("private-candidate@example.test");
    expect(serialized).not.toContain("+1 555 010 9999");
    expect(serialized).not.toContain("secret-search-phrase");
  });

  it("captures validation structure and option labels", () => {
    const observation = inspect(screeningHtml, "https://www.linkedin.com/jobs/view/123456789/");
    expect(observation.validationMessages).toContain("Enter a whole number from 0 to 99");
    expect(observation.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "How many years of product design experience do you have?",
        validationMessage: "Enter a whole number from 0 to 99",
      }),
      expect.objectContaining({
        options: [
          expect.objectContaining({ label: "Yes", id: expect.stringMatching(/^[a-f0-9]{8}$/) }),
          expect.objectContaining({ label: "No", id: expect.stringMatching(/^[a-f0-9]{8}$/) }),
        ],
      }),
    ]));
  });

  it("captures native text and numeric bounds without exposing field values", () => {
    const observation = inspect(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Apply to Fixture Labs</h2>
        <div class="jobs-easy-apply-form-element">
          <label for="gpa">University GPA</label>
          <input id="gpa" type="text" minlength="1" maxlength="20" value="">
        </div>
        <div class="jobs-easy-apply-form-element">
          <label for="years">Years of experience</label>
          <input id="years" type="number" min="0" max="50" value="">
        </div>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `, "https://www.linkedin.com/jobs/view/123456789/");

    expect(observation.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "University GPA",
        constraints: { minLength: 1, maxLength: 20 },
      }),
      expect.objectContaining({
        label: "Years of experience",
        constraints: { minimum: 0, maximum: 50 },
      }),
    ]));
  });

  it("keeps fingerprints deterministic and changes them when observable state changes", () => {
    render(contactHtml);
    const url = new URL("https://www.linkedin.com/jobs/view/123456789/");
    const first = linkedinObserverAdapter.inspect({ document, url, observedAt: OBSERVED_AT });
    const second = linkedinObserverAdapter.inspect({ document, url, observedAt: "2026-07-21T12:01:00.000Z" });
    expect(second.fingerprint).toBe(first.fingerprint);

    const email = document.querySelector<HTMLInputElement>("#email");
    expect(email).not.toBeNull();
    email!.value = "";
    const changed = linkedinObserverAdapter.inspect({ document, url, observedAt: OBSERVED_AT });
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it("requires manual intervention for login and security pages", () => {
    expect(inspect(loginHtml, "https://www.linkedin.com/login").blockingReason)
      .toBe("Manual LinkedIn sign-in is required.");
    expect(inspect(checkpointHtml, "https://www.linkedin.com/checkpoint/challenge/").blockingReason)
      .toBe("Manual LinkedIn security verification is required.");
  });
});

describe("observer message boundary", () => {
  it("accepts the exact observation schema", () => {
    const observation = inspect(contactHtml, "https://www.linkedin.com/jobs/view/123456789/");
    expect(isAdapterObservationMessage({
      type: "rapidapply.adapter-observation",
      observation,
    })).toBe(true);
  });

  it("rejects extra field values instead of persisting untrusted content", () => {
    const observation = inspect(contactHtml, "https://www.linkedin.com/jobs/view/123456789/");
    const unsafe = {
      type: "rapidapply.adapter-observation",
      observation: {
        ...observation,
        fields: observation.fields.map((field, index) => index === 0
          ? { ...field, value: "must-not-cross-boundary" }
          : field),
      },
    };
    expect(isAdapterObservationMessage(unsafe)).toBe(false);
  });

  it("accepts only bounded, canonical LinkedIn discovery results", () => {
    const result = {
      type: "rapidapply.linkedin-search-discovery",
      runId: "8fc331d6-5712-4fd1-836a-a3b8e5dc1a9d",
      pageIndex: 0,
      cycles: 3,
      jobs: [{
        externalId: "10001",
        url: "https://www.linkedin.com/jobs/view/10001/",
        title: "Product Designer",
      }],
    };

    expect(isLinkedInSearchDiscoveryResultMessage(result)).toBe(true);
    expect(isLinkedInSearchDiscoveryResultMessage({
      ...result,
      jobs: [{ ...result.jobs[0], url: "https://example.test/jobs/10001" }],
    })).toBe(false);
    expect(isLinkedInSearchDiscoveryResultMessage({
      ...result,
      jobs: [{ ...result.jobs[0], rawHtml: "must-not-cross-boundary" }],
    })).toBe(false);
  });
});

function inspect(html: string, url: string) {
  render(html);
  return inspectLinkedInPage({ document, url: new URL(url), observedAt: OBSERVED_AT });
}

function render(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
