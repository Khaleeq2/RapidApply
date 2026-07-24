import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const mode = process.env.RAPIDAPPLY_DATABASE_MODE ?? "local";
const url =
  mode === "turso"
    ? process.env.TURSO_DATABASE_URL
    : process.env.RAPIDAPPLY_LOCAL_DATABASE_URL ?? "file:./data/rapidapply.local.db";

if (!url) {
  throw new Error("A database URL is required to generate or apply migrations.");
}

export default defineConfig({
  dialect: "turso",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials:
    mode === "turso"
      ? {
          url,
          authToken: process.env.TURSO_AUTH_TOKEN,
        }
      : { url },
});
