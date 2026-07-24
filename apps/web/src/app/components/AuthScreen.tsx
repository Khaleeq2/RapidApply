"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Mail, Sparkles, UserRound } from "lucide-react";
import { authClient } from "../lib/auth-client";

type AuthMode = "sign-in" | "sign-up" | "reset";

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      if (mode === "reset") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/" });
        if (result.error) throw new Error(result.error.message ?? "Unable to request a reset link.");
        setMessage("If that email belongs to an account, a password-reset link is on its way.");
        return;
      }

      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: "/",
        });
        if (result.error) throw new Error(result.error.message ?? "Unable to create your account.");
        const session = await authClient.getSession();
        if (!session.data) {
          setMessage("Your account was created. Check your email to verify it, then sign in.");
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) throw new Error(result.error.message ?? "Unable to sign in.");
      }

      window.location.reload();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to complete that request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isReset = mode === "reset";
  const isSignUp = mode === "sign-up";

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12 text-foreground">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[560px] rounded-full bg-primary/10 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 size-[520px] rounded-full bg-accent/10 blur-[130px]" />

      <section className="relative z-10 w-full max-w-[440px] rounded-2xl border border-border bg-white/85 p-7 shadow-[0_24px_80px_-30px_rgba(10,36,114,0.35)] backdrop-blur-xl sm:p-9">
        <div className="mb-8">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
            <Sparkles className="size-5" />
          </div>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent">RapidApply</p>
          <h1 className="mt-2 text-[28px] font-bold tracking-tight">
            {isReset ? "Reset your password" : isSignUp ? "Start your campaign" : "Welcome back"}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {isReset
              ? "We’ll send a secure link if an account exists for that email."
              : isSignUp
                ? "Create your workspace and keep every campaign under your control."
                : "Sign in to manage campaigns, applications, and your candidate profile."}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {isSignUp && (
            <label className="block space-y-1.5">
              <span className="text-[12px] font-semibold text-foreground">Name</span>
              <span className="relative block">
                <UserRound className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <input required value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15" placeholder="Your name" />
              </span>
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-foreground">Email</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15" placeholder="you@example.com" />
            </span>
          </label>

          {!isReset && (
            <label className="block space-y-1.5">
              <span className="text-[12px] font-semibold text-foreground">Password</span>
              <span className="relative block">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15" placeholder="At least 8 characters" />
              </span>
            </label>
          )}

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">{error}</p>}
          {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-700">{message}</p>}

          <button disabled={isSubmitting} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-bold text-white shadow-lg shadow-primary/15 transition hover:bg-[#123a9e] disabled:cursor-wait disabled:opacity-60">
            {isSubmitting ? "Working…" : isReset ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
            {!isSubmitting && <ArrowRight className="size-4" />}
          </button>
        </form>

        <div className="mt-6 space-y-3 text-center text-[12px] text-muted-foreground">
          {isReset ? (
            <button type="button" onClick={() => changeMode("sign-in")} className="font-semibold text-primary hover:underline">Back to sign in</button>
          ) : (
            <>
              <button type="button" onClick={() => changeMode(isSignUp ? "sign-in" : "sign-up")} className="font-semibold text-primary hover:underline">
                {isSignUp ? "Already have an account? Sign in" : "New to RapidApply? Create an account"}
              </button>
              {!isSignUp && <><span className="mx-2 text-border">·</span><button type="button" onClick={() => changeMode("reset")} className="font-semibold text-primary hover:underline">Forgot password?</button></>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
