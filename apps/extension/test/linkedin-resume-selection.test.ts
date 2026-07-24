import {
  extractLinkedInProfileResumeNames,
  isLinkedInProfileResumeUploaded,
  selectExistingLinkedInResume,
  verifyLinkedInResumeAttachment,
} from "../src/adapters/linkedin/resume-selection";

const FILE_NAME = "Taylor_Rivera_Product_Designer_Resume_v1.pdf";

describe("LinkedIn resume selection", () => {
  it("selects only an exact deterministic saved-resume filename", async () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <label class="resume-card">
          <input id="other" type="radio" name="resume">
          <span>Other_Resume_v1.pdf</span>
        </label>
        <label class="resume-card">
          <input id="expected" type="radio" name="resume">
          <span>${FILE_NAME}</span>
        </label>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `);

    await expect(selectExistingLinkedInResume(document, FILE_NAME)).resolves.toBe("selected");
    expect(document.querySelector<HTMLInputElement>("#expected")?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#other")?.checked).toBe(false);
    expect(verifyLinkedInResumeAttachment(document, FILE_NAME)).toBe(true);
  });

  it("does not click a merely similar filename", async () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <label><input id="near-match" type="radio" name="resume"><span>Taylor_Rivera_Product_Designer_Resume_v2.pdf</span></label>
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `);

    await expect(selectExistingLinkedInResume(document, FILE_NAME)).resolves.toBe("not_found");
    expect(document.querySelector<HTMLInputElement>("#near-match")?.checked).toBe(false);
  });

  it("selects a truncated exact-version card without accepting another version", async () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <label><input id="v2" type="radio" name="resume"><span>Taylor_Rivera_Product_Desi…v2.pdf</span></label>
        <label><input id="v1" type="radio" name="resume"><span>Taylor_Rivera_Product_Desi…v1.pdf</span></label>
        <button type="button">Next</button>
      </section>
    `);

    await expect(selectExistingLinkedInResume(document, FILE_NAME)).resolves.toBe("selected");
    expect(document.querySelector<HTMLInputElement>("#v1")?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#v2")?.checked).toBe(false);
    expect(verifyLinkedInResumeAttachment(document, FILE_NAME)).toBe(true);
  });

  it("does not verify a different truncated resume version by shared prefix", () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <label><input id="v2" type="radio" name="resume" checked><span>Taylor_Rivera_Product_Desi…v2.pdf</span></label>
        <button type="button">Next</button>
      </section>
    `);

    expect(verifyLinkedInResumeAttachment(document, FILE_NAME)).toBe(false);
  });

  it("does not accept a checked card when it is not the target resume", async () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <label><input id="wrong" type="radio" name="resume" checked><span>Other_Resume_v1.pdf</span></label>
        <button type="button">Next</button>
      </section>
    `);

    await expect(selectExistingLinkedInResume(document, FILE_NAME)).resolves.toBe("not_found");
    expect(verifyLinkedInResumeAttachment(document, FILE_NAME)).toBe(false);
  });

  it("recognizes the exact file attached to LinkedIn's file input", () => {
    render(`
      <section class="jobs-easy-apply-modal" role="dialog">
        <h2>Resume</h2>
        <input id="upload" type="file" accept=".pdf">
        <button type="button">Next</button>
        <button type="button">Dismiss</button>
      </section>
    `);
    const input = document.querySelector<HTMLInputElement>("#upload")!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: FILE_NAME }],
    });

    expect(verifyLinkedInResumeAttachment(document, FILE_NAME)).toBe(true);
  });

  it("recognizes a truncated Application Settings card without accepting a different version", () => {
    render(`
      <main>
        <article class="jobs-document-upload-redesign-card">
          <span>Taylor_Rivera_Product_Desi…v1.pdf</span>
        </article>
      </main>
    `);

    expect(extractLinkedInProfileResumeNames(document))
      .toContain("Taylor_Rivera_Product_Desi…v1.pdf");
    expect(isLinkedInProfileResumeUploaded(document, FILE_NAME)).toBe(true);
    expect(isLinkedInProfileResumeUploaded(
      document,
      "Taylor_Rivera_Product_Designer_Resume_v2.pdf",
    )).toBe(false);
  });
});

function render(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
