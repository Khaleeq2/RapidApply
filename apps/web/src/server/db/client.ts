import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql/node";
import { getDatabaseConfiguration } from "./config";
import * as schema from "./schema";

const configuration = getDatabaseConfiguration();

const client = createClient({
  url: configuration.url,
  authToken: configuration.authToken,
});

export const db = drizzle({ client, schema });
export { configuration as databaseConfiguration };
