import { z } from "zod";

export const generateResumeInputSchema = z.object({
  targetRole: z.string().trim().min(2).max(160),
}).strict();

export type GenerateResumeInput = z.infer<typeof generateResumeInputSchema>;
