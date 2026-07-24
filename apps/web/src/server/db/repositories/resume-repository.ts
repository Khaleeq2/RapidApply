import { createHash } from "node:crypto";
import type {
  ExecutorResumeDocument,
  ResumeDocumentSummary,
} from "@rapidapply/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { CurrentUser } from "../../auth/current-user";
import type { ExecutorResumeInput, ResumeAuditInput } from "../../http/run-schemas";
import { generateResumePdf } from "../../resumes/generator";
import { buildResumeRoleKey } from "../../resumes/naming";
import { readResumeObject, writeResumeObject } from "../../resumes/storage";
import { db } from "../client";
import { resumes } from "../schema";
import { getCandidateProfileForUserId } from "./candidate-profile-repository";
import { getAuthorizedExecutorRunContext } from "./run-repository";

const MAX_LINKEDIN_RESUME_BYTES = 2_000_000;

type ResumeRow = typeof resumes.$inferSelect;

export class ResumeGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeGenerationError";
  }
}

export class ResumeNotFoundError extends Error {
  constructor() {
    super("Resume not found.");
    this.name = "ResumeNotFoundError";
  }
}

export interface ResumeDownload {
  summary: ResumeDocumentSummary;
  bytes: Buffer;
}

export async function listGeneratedResumes(userId: string): Promise<ResumeDocumentSummary[]> {
  const rows = await db.select().from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.isDefault), desc(resumes.updatedAt));
  return rows.map(toSummary).filter((value): value is ResumeDocumentSummary => value !== null);
}

export async function generateResumeForUser(
  user: CurrentUser,
  targetRole: string,
): Promise<ResumeDocumentSummary> {
  return (await ensureGeneratedResume(user.id, targetRole)).summary;
}

export async function getResumeDownloadForUser(
  userId: string,
  resumeId: string,
): Promise<ResumeDownload> {
  const [row] = await db.select().from(resumes).where(and(
    eq(resumes.id, resumeId),
    eq(resumes.userId, userId),
  )).limit(1);
  const summary = row ? toSummary(row) : null;
  if (!row || !summary) throw new ResumeNotFoundError();

  const bytes = await readResumeObject(row.storageKey);
  assertStoredDocument(bytes, summary);
  return { summary, bytes };
}

export async function getExecutorResumeDocument(
  input: ExecutorResumeInput,
): Promise<ExecutorResumeDocument> {
  const context = await getAuthorizedExecutorRunContext(input);
  if (!["claimed", "running", "paused", "needs_user_input"].includes(context.run.state)) {
    throw new ResumeGenerationError("This campaign is not active for resume delivery.");
  }

  const document = await ensureGeneratedResume(context.userId, context.targetRole);
  return {
    ...document.summary,
    bytesBase64: Buffer.from(document.bytes).toString("base64"),
  };
}

export interface ResumeAuditResult {
  needsUpload: boolean;
  resumeToSelect: string;
  summary: ResumeDocumentSummary;
}

export async function auditExecutorResume(
  input: ResumeAuditInput,
): Promise<ResumeAuditResult> {
  const context = await getAuthorizedExecutorRunContext(input);
  if (!["claimed", "running", "paused", "needs_user_input"].includes(context.run.state)) {
    throw new ResumeGenerationError("This campaign is not active for resume delivery.");
  }

  const document = await ensureGeneratedResume(context.userId, context.targetRole);
  const matchedExisting = input.existingFileNames.find((name) =>
    visibleResumeNameMatches(name, document.summary.fileName)
  );

  if (matchedExisting) {
    return {
      needsUpload: false,
      resumeToSelect: matchedExisting,
      summary: document.summary,
    };
  }

  return {
    needsUpload: true,
    resumeToSelect: document.summary.fileName,
    summary: document.summary,
  };
}

function visibleResumeNameMatches(visibleValue: string, expectedFileName: string): boolean {
  const visible = normalizeResumeName(visibleValue);
  const expected = normalizeResumeName(expectedFileName);
  if (!visible || !expected) return false;
  if (visible === expected || containsDelimitedResumeName(visible, expected)) return true;

  const compactVisible = visible.replace(/\s*(?:\.\.\.|…)\s*/g, "…");
  if (!compactVisible.includes("…")) return false;
  const [prefix, suffix = ""] = compactVisible.split("…", 2);
  return prefix.length >= 8 &&
    expected.startsWith(prefix) &&
    (suffix.length === 0 || expected.endsWith(suffix));
}

function containsDelimitedResumeName(visible: string, expected: string): boolean {
  let index = visible.indexOf(expected);
  while (index >= 0) {
    const before = index > 0 ? visible[index - 1] : "";
    const after = visible[index + expected.length] ?? "";
    if (!/[a-z0-9._-]/i.test(before) && !/[a-z0-9._-]/i.test(after)) return true;
    index = visible.indexOf(expected, index + 1);
  }
  return false;
}

function normalizeResumeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function ensureGeneratedResume(
  userId: string,
  rawTargetRole: string,
): Promise<{ summary: ResumeDocumentSummary; bytes: Uint8Array }> {
  const targetRole = rawTargetRole.trim().replace(/\s+/g, " ");
  if (targetRole.length < 2 || targetRole.length > 160) {
    throw new ResumeGenerationError("Choose a valid target role before generating a resume.");
  }

  const { profile } = await getCandidateProfileForUserId(userId);
  if (!profile.fullName.trim() || !profile.contactEmail.trim()) {
    throw new ResumeGenerationError(
      "Add your full name and contact email to Resume & Profile before generating a resume.",
    );
  }

  const roleKey = buildResumeRoleKey(targetRole);
  const [existing] = await db.select().from(resumes).where(and(
    eq(resumes.userId, userId),
    eq(resumes.roleKey, roleKey),
  )).limit(1);

  let version = existing?.version ?? 1;
  let generated = await generateResumePdf({ profile, targetRole, version });
  let contentHash = hashBytes(generated.bytes);

  // A changed approved profile produces one deliberate revision. Unchanged
  // generation is idempotent and preserves both filename and LinkedIn reuse.
  if (existing?.contentHash && existing.contentHash !== contentHash) {
    version += 1;
    generated = await generateResumePdf({ profile, targetRole, version });
    contentHash = hashBytes(generated.bytes);
  }

  if (generated.bytes.byteLength > MAX_LINKEDIN_RESUME_BYTES) {
    throw new ResumeGenerationError("The generated resume exceeds LinkedIn's supported PDF size.");
  }

  const storageOwner = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  const storageKey = `${storageOwner}/${roleKey}/resume-v${version}.pdf`;
  await writeResumeObject(storageKey, generated.bytes);

  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  await db.transaction(async (transaction) => {
    await transaction.update(resumes).set({ isDefault: false, updatedAt: now })
      .where(eq(resumes.userId, userId));
    await transaction.insert(resumes).values({
      id,
      userId,
      fileName: generated.fileName,
      storageKey,
      mimeType: "application/pdf",
      roleKey,
      targetRole,
      contentHash,
      byteSize: generated.bytes.byteLength,
      version,
      source: "generated",
      isDefault: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [resumes.userId, resumes.roleKey],
      set: {
        fileName: generated.fileName,
        storageKey,
        mimeType: "application/pdf",
        targetRole,
        contentHash,
        byteSize: generated.bytes.byteLength,
        version,
        source: "generated",
        isDefault: true,
        updatedAt: now,
      },
    });
  });

  return {
    summary: {
      id,
      fileName: generated.fileName,
      targetRole,
      mimeType: "application/pdf",
      byteSize: generated.bytes.byteLength,
      contentHash,
      version,
      isDefault: true,
      updatedAt: now,
    },
    bytes: generated.bytes,
  };
}

function toSummary(row: ResumeRow): ResumeDocumentSummary | null {
  if (
    !row.targetRole ||
    !row.contentHash ||
    row.mimeType !== "application/pdf" ||
    !row.byteSize ||
    row.byteSize <= 0
  ) {
    return null;
  }
  return {
    id: row.id,
    fileName: row.fileName,
    targetRole: row.targetRole,
    mimeType: "application/pdf",
    byteSize: row.byteSize,
    contentHash: row.contentHash,
    version: row.version,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt,
  };
}

function assertStoredDocument(bytes: Uint8Array, summary: ResumeDocumentSummary): void {
  if (bytes.byteLength !== summary.byteSize || hashBytes(bytes) !== summary.contentHash) {
    throw new Error("Stored resume verification failed.");
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
