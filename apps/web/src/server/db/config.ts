import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export type DatabaseMode = "local" | "turso";

export interface DatabaseConfiguration {
  mode: DatabaseMode;
  url: string;
  authToken?: string;
}

export function getDatabaseConfiguration(): DatabaseConfiguration {
  const mode = process.env.RAPIDAPPLY_DATABASE_MODE ?? "local";

  if (mode === "local") {
    const url = process.env.RAPIDAPPLY_LOCAL_DATABASE_URL ?? "file:./data/rapidapply.local.db";
    ensureLocalDatabaseDirectory(url);

    return { mode, url };
  }

  if (mode === "turso") {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
      throw new Error("Turso mode requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    }

    return { mode, url, authToken };
  }

  throw new Error(`Unsupported RAPIDAPPLY_DATABASE_MODE: ${mode}`);
}

export function getExecutionTicketTtlSeconds(): number {
  return readCapabilityTtlSeconds(
    "RAPIDAPPLY_EXECUTION_TICKET_TTL_SECONDS",
    process.env.RAPIDAPPLY_EXECUTION_TICKET_TTL_SECONDS,
    "7200",
  );
}

export function getExecutorEventTtlSeconds(): number {
  return readCapabilityTtlSeconds(
    "RAPIDAPPLY_EXECUTOR_EVENT_TTL_SECONDS",
    process.env.RAPIDAPPLY_EXECUTOR_EVENT_TTL_SECONDS,
    "14400",
  );
}

function readCapabilityTtlSeconds(name: string, value: string | undefined, fallback: string): number {
  const configured = Number.parseInt(value ?? fallback, 10);

  if (!Number.isInteger(configured) || configured < 300 || configured > 28_800) {
    throw new Error(`${name} must be an integer between 300 and 28800.`);
  }

  return configured;
}

function ensureLocalDatabaseDirectory(url: string): void {
  if (!url.startsWith("file:") || url === "file::memory:") return;

  const filePath = url.slice("file:".length);
  const absolutePath = resolve(process.cwd(), filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
}
