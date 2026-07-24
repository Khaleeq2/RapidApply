import {
  AUTOPILOT_MODES,
  CANDIDATE_FACT_STATUSES,
  type CandidateAutopilotPreferences,
  type CandidateFactStatus,
  type CandidateProfile,
} from "@rapidapply/contracts";
import { eq } from "drizzle-orm";
import type { CurrentUser } from "../../auth/current-user";
import type { CandidateProfileInput } from "../../http/profile-schemas";
import { db } from "../client";
import { candidateProfiles, users } from "../schema";

export interface CandidateProfileRecord {
  profile: CandidateProfile;
  updatedAt: string | null;
}

export async function getCandidateProfile(user: CurrentUser): Promise<CandidateProfileRecord> {
  const [row] = await db
    .select({
      profileJson: candidateProfiles.profileJson,
      updatedAt: candidateProfiles.updatedAt,
    })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, user.id))
    .limit(1);

  if (!row) {
    return { profile: createEmptyProfile(user), updatedAt: null };
  }

  return {
    profile: parseCandidateProfile(row.profileJson, user),
    updatedAt: row.updatedAt,
  };
}

/** Capability-authorized executor paths resolve profile facts by the run owner,
 * without accepting a user ID from browser-page JavaScript. */
export async function getCandidateProfileForUserId(userId: string): Promise<CandidateProfileRecord> {
  const [row] = await db
    .select({
      profileJson: candidateProfiles.profileJson,
      updatedAt: candidateProfiles.updatedAt,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .leftJoin(candidateProfiles, eq(candidateProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const user: CurrentUser = { id: userId, email: row?.email ?? "", name: row?.name ?? undefined };
  if (!row?.profileJson) return { profile: createEmptyProfile(user), updatedAt: null };
  return { profile: parseCandidateProfile(row.profileJson, user), updatedAt: row.updatedAt };
}

export async function saveCandidateProfile(
  user: CurrentUser,
  input: CandidateProfileInput,
): Promise<CandidateProfileRecord> {
  const now = new Date().toISOString();

  await db.transaction(async (transaction) => {
    await transaction
      .insert(users)
      .values({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: user.email,
          name: user.name ?? null,
          updatedAt: now,
        },
      });

    await transaction
      .insert(candidateProfiles)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        profileJson: JSON.stringify(input),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: candidateProfiles.userId,
        set: {
          profileJson: JSON.stringify(input),
          updatedAt: now,
        },
      });
  });

  // Keep the persisted and returned shape identical, even when a caller was
  // built against an older profile contract that omitted newer preferences.
  return { profile: parseCandidateProfile(JSON.stringify(input), user), updatedAt: now };
}

function createEmptyProfile(user: CurrentUser): CandidateProfile {
  return {
    fullName: user.name ?? "",
    contactEmail: user.email,
    phone: "",
    location: "",
    headline: "",
    summary: "",
    linkedinUrl: "",
    portfolioUrl: "",
    authorizedToWork: "not_specified",
    requiresSponsorship: "not_specified",
    autopilot: createDefaultAutopilotPreferences(),
  };
}

function parseCandidateProfile(value: string, user: CurrentUser): CandidateProfile {
  const fallback = createEmptyProfile(user);

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return fallback;

    return {
      fullName: readText(parsed.fullName, 160, fallback.fullName),
      contactEmail: readText(parsed.contactEmail, 320, fallback.contactEmail),
      phone: readText(parsed.phone, 40, fallback.phone),
      location: readText(parsed.location, 160, fallback.location),
      headline: readText(parsed.headline, 220, fallback.headline),
      summary: readText(parsed.summary, 4_000, fallback.summary),
      linkedinUrl: readText(parsed.linkedinUrl, 2_048, fallback.linkedinUrl),
      portfolioUrl: readText(parsed.portfolioUrl, 2_048, fallback.portfolioUrl),
      authorizedToWork: readFactStatus(parsed.authorizedToWork),
      requiresSponsorship: readFactStatus(parsed.requiresSponsorship),
      autopilot: readAutopilotPreferences(parsed.autopilot),
    };
  } catch {
    // A legacy or malformed profile must not take the dashboard down.
    return fallback;
  }
}

function createDefaultAutopilotPreferences(): CandidateAutopilotPreferences {
  return {
    mode: "verified",
    questionTimeoutSeconds: 15,
    autoSkipOptionalFields: true,
  };
}

function readAutopilotPreferences(value: unknown): CandidateAutopilotPreferences {
  const fallback = createDefaultAutopilotPreferences();
  if (!isRecord(value)) return fallback;

  return {
    mode: typeof value.mode === "string" && (AUTOPILOT_MODES as readonly string[]).includes(value.mode)
      ? value.mode as CandidateAutopilotPreferences["mode"]
      : fallback.mode,
    questionTimeoutSeconds: [15, 30, 60].includes(Number(value.questionTimeoutSeconds))
      ? Number(value.questionTimeoutSeconds) as CandidateAutopilotPreferences["questionTimeoutSeconds"]
      : fallback.questionTimeoutSeconds,
    autoSkipOptionalFields: typeof value.autoSkipOptionalFields === "boolean"
      ? value.autoSkipOptionalFields
      : fallback.autoSkipOptionalFields,
  };
}

function readText(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function readFactStatus(value: unknown): CandidateFactStatus {
  return typeof value === "string" && (CANDIDATE_FACT_STATUSES as readonly string[]).includes(value)
    ? (value as CandidateFactStatus)
    : "not_specified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
