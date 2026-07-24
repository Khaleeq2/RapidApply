import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "./auth";
import { db } from "../db/client";
import { users } from "../db/schema";

export interface CurrentUser {
  id: string;
  email: string;
  name?: string;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "UnauthenticatedError";
  }
}

export class AuthIdentityConflictError extends Error {
  constructor() {
    super("This authentication identity is already linked to another account.");
    this.name = "AuthIdentityConflictError";
  }
}

/**
 * Resolve the Better Auth session and link it to RapidApply's product user.
 * The product user ID remains stable so existing campaigns and profiles keep
 * their ownership when authentication is introduced.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    throw new UnauthenticatedError();
  }

  const authIdentity = {
    authProvider: "better-auth",
    authSubject: session.user.id,
    email: session.user.email,
    name: session.user.name || undefined,
  };

  const bySubject = await db
    .select()
    .from(users)
    .where(eq(users.authSubject, authIdentity.authSubject))
    .limit(1);

  if (bySubject[0]) {
    if (bySubject[0].email !== authIdentity.email) {
      throw new AuthIdentityConflictError();
    }

    await db
      .update(users)
      .set({ email: authIdentity.email, name: authIdentity.name, updatedAt: new Date().toISOString() })
      .where(eq(users.id, bySubject[0].id));

    return { id: bySubject[0].id, email: authIdentity.email, name: authIdentity.name };
  }

  const byEmail = await db.select().from(users).where(eq(users.email, authIdentity.email)).limit(1);

  if (byEmail[0]) {
    if (byEmail[0].authSubject && byEmail[0].authSubject !== authIdentity.authSubject) {
      throw new AuthIdentityConflictError();
    }

    await db
      .update(users)
      .set({ ...authIdentity, updatedAt: new Date().toISOString() })
      .where(eq(users.id, byEmail[0].id));

    return { id: byEmail[0].id, email: authIdentity.email, name: authIdentity.name };
  }

  const id = randomUUID();
  await db.insert(users).values({ id, ...authIdentity });
  return { id, email: authIdentity.email, name: authIdentity.name };
}
