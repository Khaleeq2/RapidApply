import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`);

// Better Auth's managed identity is intentionally separate from RapidApply's
// product user record. The auth subject is linked to the product user below.
export const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$onUpdate(() => new Date())
    .notNull(),
});

export const authSession = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const authAccount = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const authVerification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    authProvider: text("auth_provider"),
    authSubject: text("auth_subject").unique(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
);

export const candidateProfiles = sqliteTable(
  "candidate_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileJson: text("profile_json").notNull().default("{}"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [uniqueIndex("candidate_profiles_user_id_idx").on(table.userId)],
);

export const resumes = sqliteTable(
  "resumes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    // Nullable only for compatibility with any pre-generation upload rows.
    // Every RapidApply-generated document receives a stable role identity.
    roleKey: text("role_key"),
    targetRole: text("target_role"),
    contentHash: text("content_hash"),
    byteSize: integer("byte_size"),
    version: integer("version").notNull().default(1),
    source: text("source").notNull().default("generated"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("resumes_user_id_idx").on(table.userId),
    uniqueIndex("resumes_user_role_key_idx").on(table.userId, table.roleKey),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug"),
    targetRole: text("target_role").notNull(),
    targetLocation: text("target_location").notNull(),
    boardIdsJson: text("board_ids_json").notNull(),
    configurationJson: text("configuration_json").notNull(),
    autonomyPolicyJson: text("autonomy_policy_json"),
    dailyCap: integer("daily_cap").notNull().default(25),
    hourlyCap: integer("hourly_cap").notNull().default(5),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("campaigns_user_id_idx").on(table.userId)],
);

export const applicationRuns = sqliteTable(
  "application_runs",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    currentStepState: text("current_step_state").default("created"),
    targetApplications: integer("target_applications").notNull(),
    appliedCount: integer("applied_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    jobsDiscoveredCount: integer("jobs_discovered_count").notNull().default(0),
    jobsAttemptedCount: integer("jobs_attempted_count").notNull().default(0),
    jobsSubmittedCount: integer("jobs_submitted_count").notNull().default(0),
    jobsDeferredCount: integer("jobs_deferred_count").notNull().default(0),
    executorTabId: integer("executor_tab_id"),
    executionTicketHash: text("launch_token_hash"),
    executionTicketExpiresAt: text("execution_ticket_expires_at"),
    executorSessionId: text("executor_session_id"),
    executorEventTokenHash: text("executor_event_token_hash"),
    executorEventTokenExpiresAt: text("executor_event_token_expires_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("application_runs_user_state_idx").on(table.userId, table.state),
    index("application_runs_campaign_id_idx").on(table.campaignId),
    uniqueIndex("application_runs_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.state} in ('ready', 'claimed', 'running', 'paused', 'needs_user_input')`),
  ],
);

export const jobListings = sqliteTable(
  "job_listings",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    matchScore: integer("match_score"),
    status: text("status").notNull().default("discovered"),
    rawJson: text("raw_json"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("job_listings_run_id_idx").on(table.runId),
    uniqueIndex("job_listings_run_source_url_idx").on(table.runId, table.source, table.url),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    jobListingId: text("job_listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("prepared"),
    resumeId: text("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    submittedAt: text("submitted_at"),
    confirmationJson: text("confirmation_json"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("applications_run_id_idx").on(table.runId),
    uniqueIndex("applications_job_listing_id_idx").on(table.jobListingId),
  ],
);

/**
 * Stores policy decisions, not raw DOM values. The browser helper sends field
 * shape and option labels only. The stored decision includes provenance and,
 * where applicable, a candidate-approved value protected by the user's
 * database boundary; it is never emitted in progress events or extension logs.
 */
export const applicationAnswerPlans = sqliteTable(
  "application_answer_plans",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    jobExternalId: text("job_external_id").notNull(),
    observationFingerprint: text("observation_fingerprint").notNull(),
    fieldKey: text("field_key").notNull(),
    fieldJson: text("field_json").notNull(),
    planJson: text("plan_json").notNull(),
    decisionJson: text("decision_json"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("application_answer_plans_run_id_idx").on(table.runId),
    uniqueIndex("application_answer_plans_observation_field_idx").on(
      table.runId,
      table.jobExternalId,
      table.observationFingerprint,
      table.fieldKey,
    ),
  ],
);

/**
 * Candidate-approved answers that may be reused only when their normalized
 * intent and current form shape are compatible. Option values are stored as
 * labels, never as transient third-party DOM values.
 */
export const applicationAnswerMemory = sqliteTable(
  "application_answer_memory",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    intentKey: text("intent_key").notNull(),
    category: text("category").notNull(),
    question: text("question").notNull(),
    answerJson: text("answer_json").notNull(),
    autoUse: integer("auto_use", { mode: "boolean" }).notNull().default(false),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("application_answer_memory_user_id_idx").on(table.userId),
    uniqueIndex("application_answer_memory_scope_intent_idx").on(table.userId, table.scopeKey, table.intentKey),
  ],
);

/**
 * A persistent question queue. It contains the minimum application context
 * needed to resume an answer flow without saving a raw LinkedIn page or DOM.
 */
export const applicationInterventions = sqliteTable(
  "application_interventions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobExternalId: text("job_external_id").notNull(),
    jobUrl: text("job_url").notNull(),
    jobTitle: text("job_title"),
    company: text("company"),
    observationFingerprint: text("observation_fingerprint").notNull(),
    fieldKey: text("field_key").notNull(),
    fieldJson: text("field_json").notNull(),
    status: text("status").notNull().default("pending"),
    deadlineAt: text("deadline_at"),
    answerJson: text("answer_json"),
    rememberScope: text("remember_scope"),
    autoUse: integer("auto_use", { mode: "boolean" }),
    answeredAt: text("answered_at"),
    deferredAt: text("deferred_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("application_interventions_user_status_idx").on(table.userId, table.status),
    index("application_interventions_run_id_idx").on(table.runId),
    uniqueIndex("application_interventions_observed_field_idx").on(
      table.runId,
      table.jobExternalId,
      table.observationFingerprint,
      table.fieldKey,
    ),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    detailJson: text("detail_json"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [index("run_events_run_occurred_at_idx").on(table.runId, table.occurredAt)],
);

export const deferredJobs = sqliteTable(
  "deferred_jobs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobExternalId: text("job_external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonDetails: text("reason_details"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("deferred_jobs_user_id_idx").on(table.userId),
    index("deferred_jobs_run_id_idx").on(table.runId),
  ],
);

export const aiUsageLogs = sqliteTable(
  "ai_usage_logs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .references(() => applicationRuns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fieldKey: text("field_key"),
    question: text("question"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    confidenceScore: integer("confidence_score"),
    source: text("source").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("ai_usage_logs_user_id_idx").on(table.userId),
    index("ai_usage_logs_run_id_idx").on(table.runId),
  ],
);
