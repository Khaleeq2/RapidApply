import { sql } from "drizzle-orm";
import { databaseConfiguration, db } from "../src/server/db/client";

async function main(): Promise<void> {
  await db.run(sql`select 1`);
  console.log(`Database connection verified (${databaseConfiguration.mode}).`);
}

main().catch((error: unknown) => {
  console.error("Database connection check failed.");
  console.error(error);
  process.exitCode = 1;
});
