import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { CurrentUser } from "../src/server/auth/current-user";
import { db } from "../src/server/db/client";
import {
  claimExecutionTicket,
  createApplicationRun,
  prepareExecutionTicket,
} from "../src/server/db/repositories/run-repository";
import {
  auditExecutorResume,
  generateResumeForUser,
  getExecutorResumeDocument,
  getResumeDownloadForUser,
} from "../src/server/db/repositories/resume-repository";
import { saveCandidateProfile } from "../src/server/db/repositories/candidate-profile-repository";
import { migrate } from "drizzle-orm/libsql/migrator";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const id = randomUUID();
  const user: CurrentUser = {
    id: `resume-verification-${id}`,
    email: `resume-${id}@rapidapply.local`,
    name: "Taylor Rivera",
  };
  await saveCandidateProfile(user, profile("taylor.rivera@example.com"));

  const first = await generateResumeForUser(user, "Product Designer");
  const firstDownload = await getResumeDownloadForUser(user.id, first.id);
  const pdf = await PDFDocument.load(firstDownload.bytes);
  assert(pdf.getPageCount() === 1, "The foundational resume must be one page.");
  assert(first.fileName === "Taylor_Rivera_Product_Designer_Resume_v1.pdf", "The first filename is not deterministic.");
  assert(firstDownload.bytes.subarray(0, 5).toString("ascii") === "%PDF-", "The stored resume is not a PDF.");

  const repeat = await generateResumeForUser(user, "Product Designer");
  assert(repeat.id === first.id, "Unchanged generation must reuse the same resume record.");
  assert(repeat.version === 1, "Unchanged generation must not create a new resume version.");
  assert(repeat.contentHash === first.contentHash, "Unchanged generation must retain its document identity.");

  await saveCandidateProfile(user, {
    ...profile("taylor.rivera@example.com"),
    summary: "Candidate-authored verification profile with an approved revision.",
  });
  const revised = await generateResumeForUser(user, "Product Designer");
  assert(revised.id === first.id, "A role keeps one durable resume record.");
  assert(revised.version === 2, "Changed approved content must create one deliberate revision.");
  assert(revised.fileName === "Taylor_Rivera_Product_Designer_Resume_v2.pdf", "Revision filename is not deterministic.");
  assert(revised.contentHash !== first.contentHash, "Changed approved content did not change the PDF identity.");

  const run = await createApplicationRun(user, {
    targetRole: "Product Designer",
    targetLocation: "Remote",
    boardIds: ["linkedin"],
    targetApplications: 1,
    configuration: {
      dailyLimit: 1,
      experience: "senior",
      workStyle: "remote",
      aiTailor: false,
      onlyEasyApply: true,
      exclude: "",
    },
  });
  const ticket = await prepareExecutionTicket(user.id, run.id);
  const executorSessionId = randomUUID();
  const claim = await claimExecutionTicket({
    runId: run.id,
    executionTicket: ticket.executionTicket.token,
    executorSessionId,
    executorTabId: 42,
    extensionVersion: "verification",
  });
  const executorDocument = await getExecutorResumeDocument({
    runId: run.id,
    executorSessionId,
    executorEventToken: claim.executorEventCapability.token,
  });
  assert(executorDocument.fileName === revised.fileName, "The executor did not receive the exact active role resume.");
  assert(Buffer.from(executorDocument.bytesBase64, "base64").byteLength === executorDocument.byteSize, "Executor delivery bytes do not match metadata.");

  const reusedAudit = await auditExecutorResume({
    runId: run.id,
    executorSessionId,
    executorEventToken: claim.executorEventCapability.token,
    existingFileNames: ["Taylor_Rivera_Product_Desi…v2.pdf"],
  });
  assert(reusedAudit.needsUpload === false, "A truncated exact-version LinkedIn card must be reused.");
  assert(
    !("bytesBase64" in reusedAudit),
    "A reusable platform resume must not send PDF bytes.",
  );

  const staleAudit = await auditExecutorResume({
    runId: run.id,
    executorSessionId,
    executorEventToken: claim.executorEventCapability.token,
    existingFileNames: ["Taylor_Rivera_Product_Desi…v1.pdf"],
  });
  assert(staleAudit.needsUpload === true, "A different resume version must not be treated as the target asset.");
  assert(
    !("bytesBase64" in staleAudit),
    "The identity audit must not transmit PDF bytes before the extension checks managed local storage.",
  );

  const outputDirectory = resolve(process.cwd(), "../../output/pdf");
  await mkdir(outputDirectory, { recursive: true });
  const visualArtifact = resolve(outputDirectory, "RapidApply_Resume_Verification.pdf");
  await writeFile(visualArtifact, await getResumeDownloadForUser(user.id, revised.id).then((value) => value.bytes));

  // Deliberately never print profile data, resume text, document bytes, or a
  // user identifier. The artifact is used solely for local visual QA.
  console.log("Resume generation verified: deterministic versions, platform-first audit reuse, exact identity delivery, and visual-QA artifact created.");
}

function profile(email: string) {
  return {
    fullName: "Taylor Rivera",
    contactEmail: email,
    phone: "+1 555 010 1000",
    location: "Remote, United States",
    headline: "Senior Product Designer",
    summary: "Candidate-authored verification profile.",
    linkedinUrl: "https://www.linkedin.com/in/taylor-rivera",
    portfolioUrl: "https://taylor-rivera.example",
    authorizedToWork: "yes" as const,
    requiresSponsorship: "no" as const,
    autopilot: { mode: "verified" as const, questionTimeoutSeconds: 15 as const, autoSkipOptionalFields: true },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error: unknown) => {
  console.error("Resume generation verification failed.");
  console.error(error);
  process.exitCode = 1;
});
