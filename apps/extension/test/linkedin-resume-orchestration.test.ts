import type { ExecutorResumeDocument, ExtensionExecutionSession } from "@rapidapply/contracts";
import { prepareLinkedInResume, type LinkedInResumeDependencies } from "../src/background/linkedin-resume";

const FILE_NAME = "Taylor_Rivera_Product_Designer_Resume_v1.pdf";

describe("LinkedIn resume orchestration", () => {
  it("reuses an exact existing LinkedIn resume without downloading or attaching another copy", async () => {
    const audit = vi.fn(async () => auditFixture(false));
    const findLocal = vi.fn();
    const requestDocument = vi.fn(async () => documentFixture());
    const download = vi.fn();
    const attach = vi.fn();
    const result = await prepareLinkedInResume(session(), 42, {
      audit,
      findLocal,
      requestDocument,
      download,
      attach,
      send: async (_tabId, message) => {
        if (message.type === "rapidapply.list-existing-application-resumes") {
          return { ok: true, fileNames: ["Taylor_Rivera_Product_Desi…_v1.pdf"] };
        }
        return message.type === "rapidapply.select-existing-resume"
          ? { ok: true, result: "already_selected" }
          : { ok: false };
      },
    } as Partial<LinkedInResumeDependencies>);

    expect(result).toEqual({ ok: true, fileName: FILE_NAME, method: "existing" });
    expect(audit).toHaveBeenCalledWith(session(), ["Taylor_Rivera_Product_Desi…_v1.pdf"]);
    expect(findLocal).not.toHaveBeenCalled();
    expect(requestDocument).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("downloads, attaches, and verifies the exact role resume when LinkedIn has no reusable match", async () => {
    const attach = vi.fn(async () => ({ ok: true, fileName: FILE_NAME }));
    const send = vi.fn(async (_tabId: number, message: Record<string, unknown>) => {
      if (message.type === "rapidapply.list-existing-application-resumes") {
        return { ok: true, fileNames: [] };
      }
      if (message.type === "rapidapply.select-existing-resume") return { ok: true, result: "not_found" };
      if (message.type === "rapidapply.verify-resume-attachment") return { ok: true, verified: true };
      return { ok: false };
    });

    const result = await prepareLinkedInResume(session(), 42, {
      audit: async () => auditFixture(true),
      findLocal: async () => null,
      requestDocument: async () => documentFixture(),
      download: async (document) => ({
        document,
        absolutePath: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
        downloadId: 1,
      }),
      attach,
      send,
    });

    expect(result).toEqual({ ok: true, fileName: FILE_NAME, method: "uploaded" });
    expect(attach).toHaveBeenCalledWith(42, `/Users/test/Downloads/RapidApply/${FILE_NAME}`, FILE_NAME);
    expect(send).toHaveBeenCalledWith(42, expect.objectContaining({
      type: "rapidapply.verify-resume-attachment",
      fileName: FILE_NAME,
    }));
  });

  it("fails closed when LinkedIn does not confirm the attached file", async () => {
    const result = await prepareLinkedInResume(session(), 42, {
      audit: async () => auditFixture(true),
      findLocal: async () => null,
      requestDocument: async () => documentFixture(),
      download: async (document) => ({
        document,
        absolutePath: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
        downloadId: 1,
      }),
      attach: async () => ({ ok: true, fileName: FILE_NAME }),
      send: async (_tabId, message) => {
        if (message.type === "rapidapply.list-existing-application-resumes") {
          return { ok: true, fileNames: [] };
        }
        return message.type === "rapidapply.select-existing-resume"
          ? { ok: true, result: "not_found" }
          : { ok: true, verified: false };
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "LinkedIn did not confirm the generated resume after attachment.",
    });
  });

  it("does not request resume bytes when saved-card inspection is unavailable", async () => {
    const audit = vi.fn();
    const requestDocument = vi.fn();
    const download = vi.fn();
    const result = await prepareLinkedInResume(session(), 42, {
      audit,
      findLocal: vi.fn(),
      requestDocument,
      download,
      attach: vi.fn(),
      send: async () => ({ ok: false }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "RapidApply could not inspect saved LinkedIn resumes before requesting the document.",
    });
    expect(audit).not.toHaveBeenCalled();
    expect(requestDocument).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("reuses an exact managed local file without requesting PDF bytes again", async () => {
    const requestDocument = vi.fn();
    const download = vi.fn();
    const attach = vi.fn(async () => ({ ok: true, fileName: FILE_NAME }));
    const result = await prepareLinkedInResume(session(), 42, {
      audit: async () => auditFixture(true),
      findLocal: async (summary) => ({
        summary,
        absolutePath: `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
        downloadId: 7,
      }),
      requestDocument,
      download,
      attach,
      send: async (_tabId, message) => {
        if (message.type === "rapidapply.list-existing-application-resumes") {
          return { ok: true, fileNames: [] };
        }
        if (message.type === "rapidapply.select-existing-resume") {
          return { ok: true, result: "not_found" };
        }
        return { ok: true, verified: true };
      },
    });

    expect(result).toEqual({ ok: true, fileName: FILE_NAME, method: "uploaded" });
    expect(requestDocument).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalledWith(
      42,
      `/Users/test/Downloads/RapidApply/${FILE_NAME}`,
      FILE_NAME,
    );
  });
});

function session(): ExtensionExecutionSession {
  return {
    runId: "67e55044-10b1-426f-9247-bb680e5fe0c8",
  } as ExtensionExecutionSession;
}

function documentFixture(): ExecutorResumeDocument {
  return {
    id: "resume-1",
    fileName: FILE_NAME,
    targetRole: "Product Designer",
    mimeType: "application/pdf",
    byteSize: 12,
    contentHash: "a".repeat(64),
    version: 1,
    isDefault: true,
    updatedAt: "2026-07-22T12:00:00.000Z",
    bytesBase64: "JVBERi0xLjc=",
  };
}

function auditFixture(needsUpload: boolean) {
  const { bytesBase64: _bytesBase64, ...summary } = documentFixture();
  return {
    needsUpload,
    resumeToSelect: FILE_NAME,
    summary,
  };
}
