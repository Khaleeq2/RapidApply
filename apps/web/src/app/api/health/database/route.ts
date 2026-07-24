import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { databaseConfiguration, db } from "@/server/db/client";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await db.run(sql`select 1`);
    return NextResponse.json({ ok: true, mode: databaseConfiguration.mode });
  } catch (error) {
    return errorResponse(error, "database health check");
  }
}
