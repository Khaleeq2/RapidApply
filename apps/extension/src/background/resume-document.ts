import type {
  ExecutorResumeDocument,
  ExtensionExecutionSession,
  ResumeDocumentSummary,
} from "@rapidapply/contracts";
import { isExecutorResumeDocument } from "@rapidapply/contracts";

const DOWNLOAD_TIMEOUT_MS = 12_000;
const DOWNLOAD_POLL_MS = 100;

export interface DownloadedResume {
  document: ExecutorResumeDocument;
  absolutePath: string;
  downloadId: number;
}

export interface ManagedResumeFile {
  summary: ResumeDocumentSummary;
  absolutePath: string;
  downloadId: number;
}

export interface ResumeDownloadTransport {
  download(options: chrome.downloads.DownloadOptions): Promise<number>;
  search(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]>;
}

export interface ExecutorResumeAuditResult {
  needsUpload: boolean;
  resumeToSelect: string;
  summary: ResumeDocumentSummary;
}

export async function requestExecutorResumeAudit(
  session: ExtensionExecutionSession,
  existingFileNames: string[],
  fetcher: typeof fetch = fetch,
): Promise<ExecutorResumeAuditResult> {
  const response = await fetcher(new URL("/api/executor/resume-audit", session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: session.runId,
      executorSessionId: session.executorSessionId,
      executorEventToken: session.executorEventCapability.token,
      existingFileNames: existingFileNames.slice(0, 100),
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isExecutorResumeAuditResult(payload)) {
    throw new Error(readSafeApiError(payload) ?? "RapidApply could not audit the campaign resume.");
  }
  return payload;
}

export async function requestExecutorResumeDocument(
  session: ExtensionExecutionSession,
  fetcher: typeof fetch = fetch,
): Promise<ExecutorResumeDocument> {
  const response = await fetcher(new URL("/api/executor/resume", session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: session.runId,
      executorSessionId: session.executorSessionId,
      executorEventToken: session.executorEventCapability.token,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  const resume = isRecord(payload) ? payload.resume : undefined;
  if (!response.ok || !isExecutorResumeDocument(resume)) {
    throw new Error(readSafeApiError(payload) ?? "RapidApply could not prepare the campaign resume.");
  }
  await verifyResumePayload(resume);
  return resume;
}

export async function downloadExecutorResume(
  document: ExecutorResumeDocument,
  transport: ResumeDownloadTransport = chromeResumeDownloadTransport,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<DownloadedResume> {
  await verifyResumePayload(document);
  const reusable = await findReusableManagedResume(document, transport);
  if (reusable) {
    return {
      document,
      absolutePath: reusable.absolutePath,
      downloadId: reusable.downloadId,
    };
  }

  const downloadId = await transport.download({
    url: `data:application/pdf;base64,${document.bytesBase64}`,
    filename: `RapidApply/${document.fileName}`,
    conflictAction: "overwrite",
    saveAs: false,
  });
  const deadline = Date.now() + (options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const pollMs = options.pollMs ?? DOWNLOAD_POLL_MS;

  while (Date.now() <= deadline) {
    const [item] = await transport.search({ id: downloadId });
    if (item?.state === "interrupted") {
      throw new Error("Chrome could not finish downloading the generated resume.");
    }
    if (item?.state === "complete" && isManagedDownloadedPath(item.filename, document.fileName)) {
      return { document, absolutePath: item.filename, downloadId };
    }
    await wait(pollMs);
  }
  throw new Error("Chrome did not finish preparing the generated resume in time.");
}

export async function findReusableManagedResume(
  summary: ResumeDocumentSummary,
  transport: ResumeDownloadTransport = chromeResumeDownloadTransport,
): Promise<ManagedResumeFile | null> {
  const items = await transport.search({
    query: [summary.fileName],
    state: "complete",
  });
  const matched = items.find((item) =>
    typeof item.id === "number" &&
    item.state === "complete" &&
    item.exists !== false &&
    item.fileSize === summary.byteSize &&
    isManagedDownloadedPath(item.filename, summary.fileName)
  );
  return matched
    ? { summary, absolutePath: matched.filename, downloadId: matched.id }
    : null;
}

export async function verifyResumePayload(document: ExecutorResumeDocument): Promise<void> {
  const bytes = decodeBase64(document.bytesBase64);
  if (bytes.byteLength !== document.byteSize) {
    throw new Error("RapidApply rejected a resume with an unexpected file size.");
  }
  if (await sha256Hex(bytes) !== document.contentHash) {
    throw new Error("RapidApply rejected a resume that failed its integrity check.");
  }
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("RapidApply rejected a document that is not a PDF.");
  }
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("RapidApply rejected an invalid resume payload.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isManagedDownloadedPath(absolutePath: string, expectedFileName: string): boolean {
  const parts = absolutePath.split(/[\\/]+/).filter(Boolean);
  return (absolutePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolutePath)) &&
    parts.includes("RapidApply") && parts.at(-1) === expectedFileName;
}

function readSafeApiError(value: unknown): string | null {
  if (!isRecord(value) || typeof value.error !== "string") return null;
  return value.error.slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutorResumeAuditResult(value: unknown): value is ExecutorResumeAuditResult {
  if (!isRecord(value) || typeof value.needsUpload !== "boolean" ||
    typeof value.resumeToSelect !== "string" || !isRecord(value.summary)) {
    return false;
  }
  const summary = value.summary;
  return (
    typeof summary.id === "string" &&
    typeof summary.fileName === "string" &&
    typeof summary.targetRole === "string" &&
    summary.mimeType === "application/pdf" &&
    typeof summary.byteSize === "number" &&
    typeof summary.contentHash === "string" &&
    typeof summary.version === "number" &&
    typeof summary.isDefault === "boolean" &&
    typeof summary.updatedAt === "string"
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const chromeResumeDownloadTransport: ResumeDownloadTransport = {
  download: (options) => chrome.downloads.download(options),
  search: (query) => chrome.downloads.search(query),
};
