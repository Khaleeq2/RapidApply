import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { CurrentUser } from "../src/server/auth/current-user";
import { db } from "../src/server/db/client";
import {
  getCandidateProfile,
  saveCandidateProfile,
} from "../src/server/db/repositories/candidate-profile-repository";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const verificationId = `candidate-profile-verification-${randomUUID()}`;
  const verificationUser: CurrentUser = {
    id: verificationId,
    email: `${verificationId}@rapidapply.local`,
    name: "Candidate profile verification",
  };

  const emptyProfile = await getCandidateProfile(verificationUser);
  const savedProfile = await saveCandidateProfile(verificationUser, {
    fullName: "Candidate profile verification",
    contactEmail: verificationUser.email,
    phone: "+1 555 010 0000",
    location: "Remote",
    headline: "Product designer",
    summary: "Candidate-authored verification profile.",
    linkedinUrl: "https://www.linkedin.com/in/profile-verification",
    portfolioUrl: "https://profile-verification.example",
    authorizedToWork: "yes",
    requiresSponsorship: "no",
    autopilot: { mode: "verified", questionTimeoutSeconds: 15, autoSkipOptionalFields: true },
  });
  const reloadedProfile = await getCandidateProfile(verificationUser);

  const defaultProfileUsesDevelopmentIdentity =
    emptyProfile.profile.fullName === verificationUser.name &&
    emptyProfile.profile.contactEmail === verificationUser.email &&
    emptyProfile.updatedAt === null;
  const persistedExactly =
    JSON.stringify(savedProfile.profile) === JSON.stringify(reloadedProfile.profile) &&
    typeof savedProfile.updatedAt === "string" &&
    savedProfile.updatedAt === reloadedProfile.updatedAt;

  if (!defaultProfileUsesDevelopmentIdentity || !persistedExactly) {
    throw new Error("Candidate profile persistence verification did not reach the expected state.");
  }

  // Deliberately do not print profile data, user identifiers, or connection details.
  console.log("Candidate profile verified: defaults available; saved profile reloaded.");
}

main().catch((error: unknown) => {
  console.error("Candidate profile verification failed.");
  console.error(error);
  process.exitCode = 1;
});
