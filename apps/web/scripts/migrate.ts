import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { databaseConfiguration, db } from "../src/server/db/client";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  console.log(`Database migrations applied (${databaseConfiguration.mode}).`);
}

main().catch((error: unknown) => {
  console.error("Database migration failed.");
  console.error(error);
  process.exitCode = 1;
});
