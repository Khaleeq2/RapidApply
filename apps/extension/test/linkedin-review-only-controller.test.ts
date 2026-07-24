import contactHtml from "./fixtures/linkedin/easy-apply-contact.html?raw";
import jobDetailHtml from "./fixtures/linkedin/job-detail.html?raw";
import reviewHtml from "./fixtures/linkedin/easy-apply-review.html?raw";
import screeningHtml from "./fixtures/linkedin/easy-apply-screening-error.html?raw";
import {
  advanceLinkedInReviewOnlyStep,
  dismissLinkedInSubmissionConfirmation,
  openLinkedInEasyApply,
  submitLinkedInApplication,
} from "../src/adapters/linkedin/review-only-controller";

describe("LinkedIn review-only controller", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("opens Easy Apply and verifies the dialog", async () => {
    document.body.innerHTML = jobDetailHtml;
    const easyApply = document.querySelector<HTMLButtonElement>("button[aria-label*='Easy Apply']")!;
    easyApply.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `<section class="jobs-easy-apply-modal" role="dialog"><h2>Contact info</h2></section>`);
    });

    await expect(openLinkedInEasyApply(document)).resolves.toBe("application_opened");
  });

  it("waits briefly for LinkedIn to finish rendering the Easy Apply control", async () => {
    document.body.innerHTML = `<main class="job-details-jobs-unified-top-card"><h1>Fixture role</h1></main>`;
    window.setTimeout(() => {
      document.body.insertAdjacentHTML("beforeend", `
        <button type="button" aria-label="Easy Apply to this job">Easy Apply</button>`);
      document.querySelector<HTMLButtonElement>("button[aria-label*='Easy Apply']")!
        .addEventListener("click", () => {
          document.body.insertAdjacentHTML("beforeend", `
            <section class="jobs-easy-apply-modal" role="dialog"><h2>Contact info</h2></section>`);
        });
    }, 10);

    await expect(openLinkedInEasyApply(document)).resolves.toBe("application_opened");
  });

  it("recognizes a live-style Apply to container without the old dialog class", async () => {
    document.body.innerHTML = jobDetailHtml;
    const easyApply = document.querySelector<HTMLButtonElement>("button[aria-label*='Easy Apply']")!;
    easyApply.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="live-linkedin-shell">
          <h2>Apply to Fixture Labs</h2>
          <label>Mobile phone number <input type="tel"></label>
          <button type="button">Next</button>
          <button type="button">Dismiss</button>
        </div>`);
    });

    await expect(openLinkedInEasyApply(document)).resolves.toBe("application_opened");
  });

  it("does not accept the job detail itself as an already-open application", async () => {
    document.body.innerHTML = `
      <main>
        <h1>Senior Product Designer</h1>
        <label>Search jobs <input type="search"></label>
        <button type="button" aria-label="Easy Apply to this job">Easy Apply</button>
        <button type="button">Next</button>
      </main>`;
    const easyApply = document.querySelector<HTMLButtonElement>("button[aria-label*='Easy Apply']")!;
    easyApply.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="live-linkedin-shell">
          <h2>Apply to Fixture Labs</h2>
          <label>Mobile phone number <input type="tel"></label>
          <button type="button">Next</button>
          <button type="button">Dismiss</button>
        </div>`);
    });

    await expect(openLinkedInEasyApply(document)).resolves.toBe("application_opened");
  });

  it("advances a non-submit step and recognizes the final review state", async () => {
    document.body.innerHTML = contactHtml;
    const next = document.querySelector<HTMLButtonElement>("button")!;
    next.addEventListener("click", () => {
      document.querySelector(".jobs-easy-apply-modal")!.innerHTML = `
        <h2>Review your application</h2>
        <button type="button" aria-label="Submit application">Submit application</button>`;
    });

    await expect(advanceLinkedInReviewOnlyStep(document)).resolves.toBe("review_ready");
  });

  it("ignores a submit-like action outside the active Easy Apply surface", async () => {
    document.body.innerHTML = `
      <header class="global-nav"><button type="button">Submit feedback</button></header>
      ${contactHtml}`;
    const next = document.querySelector<HTMLButtonElement>(".jobs-easy-apply-modal button")!;
    next.addEventListener("click", () => {
      document.querySelector(".jobs-easy-apply-modal")!.innerHTML = `
        <h2>Additional questions</h2>
        <label for="portfolio">Portfolio URL</label>
        <input id="portfolio" type="url">
        <button type="button">Next</button>
        <button type="button">Dismiss</button>`;
    });

    await expect(advanceLinkedInReviewOnlyStep(document)).resolves.toBe("advanced");
  });

  it("never clicks a review page's submit action", async () => {
    document.body.innerHTML = reviewHtml;
    const submit = document.querySelector<HTMLButtonElement>("button")!;
    const click = vi.fn();
    submit.addEventListener("click", click);

    await expect(advanceLinkedInReviewOnlyStep(document)).resolves.toBe("review_ready");
    expect(click).not.toHaveBeenCalled();
  });

  it("submits only from final review and requires LinkedIn confirmation", async () => {
    document.body.innerHTML = reviewHtml;
    const submit = document.querySelector<HTMLButtonElement>("button")!;
    submit.addEventListener("click", () => {
      document.body.innerHTML = `
        <main><h1>Your application was sent to Fixture Labs</h1></main>`;
    });

    await expect(submitLinkedInApplication(document)).resolves.toBe("application_submitted");
  });

  it("dismisses LinkedIn's post-apply next-best-action modal after confirmation", async () => {
    document.body.innerHTML = `
      <main><h1>Lead Designer</h1></main>
      <div data-test-modal role="dialog" class="artdeco-modal" aria-labelledby="post-apply-modal">
        <h2 id="post-apply-modal">Next best action</h2>
        <div class="artdeco-modal__content">
          <h3 class="jpac-modal-header">Your application was sent to Holon Publishing!</h3>
        </div>
        <button class="artdeco-modal__dismiss" aria-label="Dismiss" type="button">Close</button>
      </div>
    `;
    const modal = document.querySelector<HTMLElement>("[data-test-modal]")!;
    modal.querySelector("button")!.addEventListener("click", () => modal.remove());

    await expect(dismissLinkedInSubmissionConfirmation(document)).resolves.toBeUndefined();
    expect(document.querySelector("[data-test-modal]")).toBeNull();
  });

  it("walks a supported multi-step flow from contact to screening to confirmed submission", async () => {
    document.body.innerHTML = contactHtml;
    const dialog = document.querySelector<HTMLElement>(".jobs-easy-apply-modal")!;
    const mountReview = () => {
      dialog.innerHTML = `
        <h2>Review your application</h2>
        <button type="button" aria-label="Submit application">Submit application</button>`;
    };
    const mountScreening = () => {
      dialog.innerHTML = screeningHtml
        .replace(/^[\s\S]*?<section class="jobs-easy-apply-modal"[^>]*>/, "")
        .replace(/<\/section>[\s\S]*$/, "");
      dialog.querySelector<HTMLButtonElement>("button")!.addEventListener("click", mountReview);
    };
    dialog.querySelector<HTMLButtonElement>("button")!.addEventListener("click", mountScreening);

    await expect(advanceLinkedInReviewOnlyStep(document)).resolves.toBe("advanced");
    expect(dialog.textContent).toContain("years of product design experience");
    await expect(advanceLinkedInReviewOnlyStep(document)).resolves.toBe("review_ready");

    dialog.querySelector<HTMLButtonElement>("button")!.addEventListener("click", () => {
      document.body.innerHTML = "<main><h1>Your application was sent</h1></main>";
    });
    await expect(submitLinkedInApplication(document)).resolves.toBe("application_submitted");
  });

  it("does not submit when LinkedIn confirmation never appears", async () => {
    document.body.innerHTML = reviewHtml;
    const submit = document.querySelector<HTMLButtonElement>("button")!;
    const click = vi.fn();
    submit.addEventListener("click", click);

    await expect(submitLinkedInApplication(document, { confirmationTimeoutMs: 100 }))
      .rejects.toThrow("postcondition");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("does not treat a stale confirmation from an earlier application as current proof", async () => {
    document.body.innerHTML = `
      <main><h1>Your application was sent to an earlier employer</h1></main>
      ${reviewHtml}`;
    const submit = document.querySelector<HTMLButtonElement>(".jobs-easy-apply-modal button")!;
    const click = vi.fn();
    submit.addEventListener("click", click);

    await expect(submitLinkedInApplication(document, { confirmationTimeoutMs: 100 }))
      .rejects.toThrow("postcondition");
    expect(click).toHaveBeenCalledTimes(1);
  });
});
