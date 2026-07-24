import type {
  ExecutorResumeDocument,
  ExtensionExecutionSession,
  ResumeDocumentSummary,
} from "@rapidapply/contracts";
import { attachTrustedLinkedInResume } from "./trusted-input";
import {
  downloadExecutorResume,
  findReusableManagedResume,
  requestExecutorResumeAudit,
  requestExecutorResumeDocument,
  type DownloadedResume,
  type ExecutorResumeAuditResult,
  type ManagedResumeFile,
} from "./resume-document";
import type { TrustedResumeAttachmentResult } from "./trusted-input";

export interface LinkedInResumePreparationResult {
  ok: boolean;
  fileName?: string;
  method?: "existing" | "uploaded";
  reason?: string;
}

export interface LinkedInResumeDependencies {
  audit(
    session: ExtensionExecutionSession,
    existingFileNames: string[],
  ): Promise<ExecutorResumeAuditResult>;
  findLocal(summary: ResumeDocumentSummary): Promise<ManagedResumeFile | null>;
  requestDocument(session: ExtensionExecutionSession): Promise<ExecutorResumeDocument>;
  download(document: ExecutorResumeDocument): Promise<DownloadedResume>;
  attach(tabId: number, absolutePath: string, fileName: string): Promise<TrustedResumeAttachmentResult>;
  send(tabId: number, message: Record<string, unknown>): Promise<unknown>;
}

/**
 * Reuses an exact LinkedIn filename before downloading. Upload is attempted
 * only when the role-specific generated document is not already selected.
 */
export async function prepareLinkedInResume(
  session: ExtensionExecutionSession,
  tabId: number,
  dependencies: Partial<LinkedInResumeDependencies> = {},
): Promise<LinkedInResumePreparationResult> {
  const { audit, findLocal, requestDocument, download, attach, send } = {
    ...defaultDependencies,
    ...dependencies,
  };
  try {
    const listed: unknown = await send(tabId, {
      type: "rapidapply.list-existing-application-resumes",
    });
    const existingFileNames = readListedFileNames(listed);
    if (!existingFileNames) {
      throw new Error("RapidApply could not inspect saved LinkedIn resumes before requesting the document.");
    }
    const audited = await audit(session, existingFileNames);
    console.log(`[RapidApply] [resume.prepare] Target generated resume document: ${audited.summary.fileName}`);

    const selected: unknown = await send(tabId, {
      type: "rapidapply.select-existing-resume",
      fileName: audited.summary.fileName,
    });
    if (isSelectionSuccess(selected)) {
      console.log(`[RapidApply] [resume.select_success] Selected existing saved resume: ${audited.summary.fileName}`);
      return { ok: true, fileName: audited.summary.fileName, method: "existing" };
    }

    const reusable = await findLocal(audited.summary);
    const document = reusable ? null : await requestDocument(session);
    if (document) {
      console.log(`[RapidApply] [resume.download_start] Downloading generated resume: ${document.fileName}...`);
    }
    const downloaded = document ? await download(document) : null;
    const absolutePath = reusable?.absolutePath ?? downloaded?.absolutePath;
    const fileName = reusable?.summary.fileName ?? downloaded?.document.fileName;
    if (!absolutePath || !fileName) {
      return { ok: false, reason: "RapidApply could not prepare the audited resume file." };
    }
    console.log(`[RapidApply] [resume.local_ready] Resume available at: ${absolutePath}`);

    console.log(`[RapidApply] [resume.attach_start] Attaching file via browser debugger...`);
    const attached = await attach(
      tabId,
      absolutePath,
      fileName,
    );
    if (!attached.ok) {
      console.log(`[RapidApply] [resume.attach_failed] Attachment failed: ${attached.reason}`);
      return { ok: false, reason: attached.reason };
    }

    console.log(`[RapidApply] [resume.verify_start] Verifying file attachment on LinkedIn...`);
    const verification: unknown = await send(tabId, {
      type: "rapidapply.verify-resume-attachment",
      fileName,
    });
    if (!isAttachmentVerified(verification)) {
      console.log(`[RapidApply] [resume.verify_failed] LinkedIn did not confirm attachment.`);
      return {
        ok: false,
        reason: "LinkedIn did not confirm the generated resume after attachment.",
      };
    }
    console.log(`[RapidApply] [resume.complete] Resume attached successfully!`);
    return { ok: true, fileName, method: "uploaded" };
  } catch (error) {
    console.log(`[RapidApply] [resume.error] Resume preparation error:`, error);
    return {
      ok: false,
      reason: error instanceof Error
        ? error.message.slice(0, 300)
        : "RapidApply could not prepare the generated resume.",
    };
  }
}

const defaultDependencies: LinkedInResumeDependencies = {
  audit: requestExecutorResumeAudit,
  findLocal: findReusableManagedResume,
  requestDocument: requestExecutorResumeDocument,
  download: downloadExecutorResume,
  attach: attachTrustedLinkedInResume,
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
};

function isSelectionSuccess(value: unknown): boolean {
  return isRecord(value) && value.ok === true &&
    (value.result === "selected" || value.result === "already_selected");
}

function isAttachmentVerified(value: unknown): boolean {
  return isRecord(value) && value.ok === true && value.verified === true;
}

function readListedFileNames(value: unknown): string[] | null {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.fileNames)) return null;
  return value.fileNames
    .filter((fileName): fileName is string => typeof fileName === "string")
    .slice(0, 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
