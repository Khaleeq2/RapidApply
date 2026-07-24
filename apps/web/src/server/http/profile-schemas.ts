import { AUTOPILOT_MODES, CANDIDATE_FACT_STATUSES } from "@rapidapply/contracts";
import { z } from "zod";

const optionalEmailSchema = z
  .string()
  .trim()
  .max(320)
  .refine(
    (value) => value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Enter a valid contact email address.",
  );

const optionalHttpUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .refine(
    (value) => {
      if (value.length === 0) return true;

      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
    "Enter a valid http(s) URL.",
  );

export const candidateProfileInputSchema = z
  .object({
    fullName: z.string().trim().max(160),
    contactEmail: optionalEmailSchema,
    phone: z.string().trim().max(40),
    location: z.string().trim().max(160),
    headline: z.string().trim().max(220),
    summary: z.string().trim().max(4_000),
    linkedinUrl: optionalHttpUrlSchema,
    portfolioUrl: optionalHttpUrlSchema,
    authorizedToWork: z.enum(CANDIDATE_FACT_STATUSES),
    requiresSponsorship: z.enum(CANDIDATE_FACT_STATUSES),
    autopilot: z.object({
      mode: z.enum(AUTOPILOT_MODES),
      questionTimeoutSeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]),
      autoSkipOptionalFields: z.boolean(),
    }).strict(),
  })
  .strict();

export type CandidateProfileInput = z.infer<typeof candidateProfileInputSchema>;
