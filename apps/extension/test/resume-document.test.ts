import type { ExecutorResumeDocument } from "@rapidapply/contracts";
import { downloadExecutorResume, verifyResumePayload, type ResumeDownloadTransport } from "../src/background/resume-document";

const FILE_NAME = "Taylor_Rivera_Product_Designer_Resume_v1.pdf";

describe("executor resume document", () => {
  it("reuses an exact completed managed download before starting another download", async () => {
    const document = await fixtureDocument();
    const download = vi.fn(async () => 92);
    const search = vi.fn(async () => [{
      id: 77,
      state: "complete",
      exists: true,
      fileSize: document.byteSize,
      filename: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
    }] as chrome.downloads.DownloadItem[]);

    await expect(downloadExecutorResume(document, { download, search }))
      .resolves.toMatchObject({
        absolutePath: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
        downloadId: 77,
      });
    expect(download).not.toHaveBeenCalled();
  });

  it("verifies a bounded PDF payload and downloads it only to the managed folder", async () => {
    const document = await fixtureDocument();
    const download = vi.fn(async () => 91);
    const search = vi.fn(async () => [{
      id: 91,
      state: "complete",
      filename: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
    }] as chrome.downloads.DownloadItem[]);
    const transport: ResumeDownloadTransport = { download, search };

    await expect(verifyResumePayload(document)).resolves.toBeUndefined();
    await expect(downloadExecutorResume(document, transport, { timeoutMs: 20, pollMs: 1 }))
      .resolves.toMatchObject({ absolutePath: `/Users/test/Downloads/RapidApply/${FILE_NAME}`, downloadId: 91 });
    expect(download).toHaveBeenCalledWith(expect.objectContaining({
      filename: `RapidApply/${FILE_NAME}`,
      conflictAction: "overwrite",
      saveAs: false,
    }));
  });

  it("rejects a payload whose bytes do not match the server integrity hash", async () => {
    const document = await fixtureDocument();
    await expect(verifyResumePayload({ ...document, contentHash: "a".repeat(64) }))
      .rejects.toThrow("integrity check");
  });

  it("rejects a completed download outside the managed RapidApply folder", async () => {
    const document = await fixtureDocument();
    const transport: ResumeDownloadTransport = {
      download: async () => 91,
      search: async () => [{
        id: 91,
        state: "complete",
        filename: `/Users/test/Downloads/${FILE_NAME}`,
      }] as chrome.downloads.DownloadItem[],
    };

    await expect(downloadExecutorResume(document, transport, { timeoutMs: 4, pollMs: 1 }))
      .rejects.toThrow("did not finish preparing");
  });
});

async function fixtureDocument(): Promise<ExecutorResumeDocument> {
  const bytes = new TextEncoder().encode("%PDF-1.7\nfixture");
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const binary = String.fromCharCode(...bytes);
  return {
    id: "resume-1",
    fileName: FILE_NAME,
    targetRole: "Product Designer",
    mimeType: "application/pdf",
    byteSize: bytes.byteLength,
    contentHash,
    version: 1,
    isDefault: true,
    updatedAt: "2026-07-22T12:00:00.000Z",
    bytesBase64: btoa(binary),
  };
}
