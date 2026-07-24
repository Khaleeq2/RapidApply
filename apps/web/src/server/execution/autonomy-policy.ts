import type { AutonomyPolicy } from "@rapidapply/contracts";

export const STRICT_AUTONOMY_POLICY: AutonomyPolicy = {
  mode: "strict_control",
  freeTextStrategy: "profile_only",
  unknownFieldStrategy: "pause_campaign",
  aiConfidenceThreshold: 0.75,
  maxThroughput: { dailyCap: 25, hourlyCap: 5 },
};

export function parseAutonomyPolicy(value: unknown): AutonomyPolicy {
  const fallback = STRICT_AUTONOMY_POLICY;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const record = parsed as Record<string, unknown>;
    const throughput = typeof record.maxThroughput === "object" && record.maxThroughput !== null
      ? record.maxThroughput as Record<string, unknown>
      : {};
    return {
      mode: record.mode === "autonomous" ? "autonomous" : "strict_control",
      freeTextStrategy: ["ai_draft", "profile_only", "skip_job"].includes(String(record.freeTextStrategy))
        ? record.freeTextStrategy as AutonomyPolicy["freeTextStrategy"]
        : fallback.freeTextStrategy,
      unknownFieldStrategy: ["defer_to_finish_later", "skip_job", "pause_campaign"].includes(String(record.unknownFieldStrategy))
        ? record.unknownFieldStrategy as AutonomyPolicy["unknownFieldStrategy"]
        : fallback.unknownFieldStrategy,
      aiConfidenceThreshold: typeof record.aiConfidenceThreshold === "number" &&
        record.aiConfidenceThreshold >= 0 && record.aiConfidenceThreshold <= 1
        ? record.aiConfidenceThreshold
        : fallback.aiConfidenceThreshold,
      maxThroughput: {
        dailyCap: Number.isInteger(throughput.dailyCap) && Number(throughput.dailyCap) > 0
          ? Number(throughput.dailyCap)
          : fallback.maxThroughput.dailyCap,
        hourlyCap: Number.isInteger(throughput.hourlyCap) && Number(throughput.hourlyCap) > 0
          ? Number(throughput.hourlyCap)
          : fallback.maxThroughput.hourlyCap,
      },
    };
  } catch {
    return fallback;
  }
}
