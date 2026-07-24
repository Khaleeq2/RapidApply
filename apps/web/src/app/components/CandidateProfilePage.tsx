"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  CandidateFactStatus,
  CandidateProfile,
  ResumeDocumentSummary,
} from "@rapidapply/contracts";
import {
  Bot,
  Download,
  FileText,
  Link,
  LoaderCircle,
  MapPin,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

interface CandidateProfileResponse {
  profile: CandidateProfile;
  updatedAt: string | null;
  error?: string;
}

interface SummaryDraftResponse {
  draftSummary?: string;
  provider?: "gemini" | "groq";
  model?: string;
  error?: string;
}

interface ResumeListResponse {
  resumes?: ResumeDocumentSummary[];
  error?: string;
}

interface GenerateResumeResponse {
  resume?: ResumeDocumentSummary;
  error?: string;
}

const EMPTY_PROFILE: CandidateProfile = {
  fullName: "",
  contactEmail: "",
  phone: "",
  location: "",
  headline: "",
  summary: "",
  linkedinUrl: "",
  portfolioUrl: "",
  authorizedToWork: "not_specified",
  requiresSponsorship: "not_specified",
  autopilot: {
    mode: "verified",
    questionTimeoutSeconds: 15,
    autoSkipOptionalFields: true,
  },
};

const FACT_STATUS_LABEL: Record<CandidateFactStatus, string> = {
  not_specified: "Not specified",
  yes: "Yes",
  no: "No",
};

export function CandidateProfilePage() {
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_PROFILE);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isGeneratingResume, setIsGeneratingResume] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeDocumentSummary | null>(null);
  const [resumeTargetRole, setResumeTargetRole] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile(): Promise<void> {
      try {
        const [response, resumesResponse] = await Promise.all([
          fetch("/api/profile", { cache: "no-store" }),
          fetch("/api/resumes", { cache: "no-store" }),
        ]);
        const payload = (await response.json()) as CandidateProfileResponse;
        const resumesPayload = (await resumesResponse.json()) as ResumeListResponse;

        if (!response.ok || !payload.profile) {
          throw new Error(payload.error ?? "RapidApply could not load your profile.");
        }
        if (!resumesResponse.ok) {
          throw new Error(resumesPayload.error ?? "RapidApply could not load your generated resume.");
        }

        if (!active) return;
        setProfile(payload.profile);
        setUpdatedAt(payload.updatedAt);
        const activeResume = resumesPayload.resumes?.[0] ?? null;
        setResume(activeResume);
        setResumeTargetRole(activeResume?.targetRole ?? payload.profile.headline);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "RapidApply could not load your profile.",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const completion = useMemo(
    () =>
      [profile.fullName, profile.contactEmail, profile.phone, profile.location, profile.headline]
        .filter((value) => value.trim().length > 0).length,
    [profile],
  );

  function updateField<K extends keyof CandidateProfile>(key: K, value: CandidateProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    if (key === "summary") setDraftNotice(null);
  }

  async function generateSummaryDraft(): Promise<void> {
    if (!profile.headline.trim() && !profile.summary.trim()) {
      setError("Add a headline or a starting summary before requesting a draft.");
      return;
    }

    setIsDrafting(true);
    setError(null);
    setDraftNotice(null);

    try {
      const response = await fetch("/api/profile/summary-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload = (await response.json()) as SummaryDraftResponse;

      if (!response.ok || !payload.draftSummary) {
        throw new Error(payload.error ?? "RapidApply could not create a summary draft.");
      }

      setProfile((current) => ({ ...current, summary: payload.draftSummary ?? current.summary }));
      setDraftNotice(
        `${getProviderLabel(payload.provider)} drafted this text. Review every claim, then save the profile only if it is accurate.`,
      );
    } catch (draftError) {
      setError(
        draftError instanceof Error
          ? draftError.message
          : "RapidApply could not create a summary draft.",
      );
    } finally {
      setIsDrafting(false);
    }
  }

  async function saveProfile(): Promise<void> {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const payload = (await response.json()) as CandidateProfileResponse;

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "RapidApply could not save your profile.");
      }

      setProfile(payload.profile);
      setUpdatedAt(payload.updatedAt);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "RapidApply could not save your profile.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function generateResume(): Promise<void> {
    const targetRole = resumeTargetRole.trim();
    if (targetRole.length < 2) {
      setError("Add the role this resume should target.");
      return;
    }

    setIsGeneratingResume(true);
    setError(null);
    setResumeNotice(null);
    try {
      // The PDF must be built from the same candidate-approved facts that are
      // durable in the account, never from an unsaved browser-only draft.
      const profileResponse = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const profilePayload = (await profileResponse.json()) as CandidateProfileResponse;
      if (!profileResponse.ok || !profilePayload.profile) {
        throw new Error(profilePayload.error ?? "RapidApply could not save your profile first.");
      }
      setProfile(profilePayload.profile);
      setUpdatedAt(profilePayload.updatedAt);

      const response = await fetch("/api/resumes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetRole }),
      });
      const payload = (await response.json()) as GenerateResumeResponse;
      if (!response.ok || !payload.resume) {
        throw new Error(payload.error ?? "RapidApply could not generate your resume.");
      }
      setResume(payload.resume);
      setResumeTargetRole(payload.resume.targetRole);
      setResumeNotice(
        "Resume ready. The browser helper will reuse this exact filename before uploading another copy.",
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "RapidApply could not generate your resume.",
      );
    } finally {
      setIsGeneratingResume(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[980px] px-6 pb-16 pt-3 lg:px-10 lg:pt-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/[0.03] px-3 py-1.5 text-[12px] font-semibold text-primary">
            <UserRound className="size-3.5" />
            Candidate-authored facts
          </div>
          <h1 className="text-[30px] font-bold tracking-tight text-foreground">Resume &amp; Profile</h1>
          <p className="mt-2 max-w-[620px] text-[14px] leading-relaxed text-muted-foreground">
            Keep the facts RapidApply may later reference in one place. Nothing here is inferred,
            and no future workflow should answer a question beyond what you have approved.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-white/75 px-4 py-3 text-right shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Profile setup</div>
          <div className="mt-0.5 text-[18px] font-bold text-foreground">{completion} / 5</div>
          <div className="text-[11.5px] text-muted-foreground">
            {updatedAt ? "Saved to your account" : "Not saved yet"}
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-2xl border border-border bg-white/80 p-5 shadow-[0_16px_45px_-28px_rgba(10,36,114,0.35)] sm:p-6">
          <div className="flex items-start gap-3 border-b border-border/60 pb-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <UserRound className="size-4.5" />
            </span>
            <div>
              <h2 className="text-[16px] font-bold text-foreground">Your professional identity</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                These details are saved privately to your RapidApply account. Fill only what is accurate.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input
                value={profile.fullName}
                onChange={(event) => updateField("fullName", event.target.value)}
                placeholder="Your full name"
                disabled={isLoading}
              />
            </Field>
            <Field label="Contact email" required>
              <Input
                type="email"
                value={profile.contactEmail}
                onChange={(event) => updateField("contactEmail", event.target.value)}
                placeholder="you@example.com"
                disabled={isLoading}
              />
            </Field>
            <Field label="Phone number" required>
              <Input
                type="tel"
                value={profile.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                placeholder="(555) 555-5555"
                disabled={isLoading}
              />
            </Field>
            <Field label="Current location" required>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={profile.location}
                  onChange={(event) => updateField("location", event.target.value)}
                  placeholder="City, state or Remote"
                  className="pl-9"
                  disabled={isLoading}
                />
              </div>
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Professional headline" required>
              <Input
                value={profile.headline}
                onChange={(event) => updateField("headline", event.target.value)}
                placeholder="e.g. Senior Product Designer building B2B SaaS"
                disabled={isLoading}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Professional summary">
              <Textarea
                value={profile.summary}
                onChange={(event) => updateField("summary", event.target.value)}
                placeholder="A concise, factual summary of your experience and strengths."
                className="min-h-32 bg-white"
                disabled={isLoading}
              />
            </Field>
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-primary/10 bg-primary/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-[470px] text-[11.5px] leading-relaxed text-muted-foreground">
                AI drafting is optional. It sends only your headline, location, and current summary in one server-side request—never your name, email, phone, authorization answers, or links.
              </p>
              <button
                type="button"
                onClick={generateSummaryDraft}
                disabled={isLoading || isDrafting}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-primary/20 bg-white px-3 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-wait disabled:opacity-60"
              >
                {isDrafting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {isDrafting ? "Drafting…" : "Draft with AI"}
              </button>
            </div>
            {draftNotice && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700">{draftNotice}</p>
            )}
          </div>

          <div className="mt-7 border-t border-border/60 pt-6">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <Link className="size-4.5" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Professional links</h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Optional public URLs only.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="LinkedIn URL">
                <Input
                  type="url"
                  value={profile.linkedinUrl}
                  onChange={(event) => updateField("linkedinUrl", event.target.value)}
                  placeholder="https://linkedin.com/in/you"
                  disabled={isLoading}
                />
              </Field>
              <Field label="Portfolio URL">
                <Input
                  type="url"
                  value={profile.portfolioUrl}
                  onChange={(event) => updateField("portfolioUrl", event.target.value)}
                  placeholder="https://yourportfolio.com"
                  disabled={isLoading}
                />
              </Field>
            </div>
          </div>

          <div className="mt-7 border-t border-border/60 pt-6">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600">
                <Bot className="size-4.5" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Autopilot preferences</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Choose how quickly RapidApply should ask for help when a required answer is unknown.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <Field label="Mode">
                <Select
                  value={profile.autopilot.mode}
                  onValueChange={(value) => updateField("autopilot", {
                    ...profile.autopilot,
                    mode: value === "smart" ? "smart" : "verified",
                  })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-white text-[14px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verified">Verified answers only</SelectItem>
                    <SelectItem value="smart">Smart Autopilot</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Question timer">
                <Select
                  value={String(profile.autopilot.questionTimeoutSeconds)}
                  onValueChange={(value) => updateField("autopilot", {
                    ...profile.autopilot,
                    questionTimeoutSeconds: value === "60" ? 60 : value === "30" ? 30 : 15,
                  })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-white text-[14px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">60 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Optional fields">
                <Select
                  value={profile.autopilot.autoSkipOptionalFields ? "skip" : "ask"}
                  onValueChange={(value) => updateField("autopilot", {
                    ...profile.autopilot,
                    autoSkipOptionalFields: value === "skip",
                  })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-white text-[14px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip automatically</SelectItem>
                    <SelectItem value="ask">Ask me first</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Answering Strategy">
                <Select
                  value={profile.autopilot.answeringMode ?? "competitive"}
                  onValueChange={(value: "competitive" | "conservative") => updateField("autopilot", {
                    ...profile.autopilot,
                    answeringMode: value,
                  })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-white text-[14px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="competitive">Competitive Mode (Recommended)</SelectItem>
                    <SelectItem value="conservative">Conservative Mode</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Competitive Mode advocates for your candidacy by presenting your background in its strongest truthful light to pass automated ATS filters. Conservative Mode requires exact string matches and defers ambiguous questions.
            </p>
          </div>

          <div className="mt-7 border-t border-border/60 pt-6">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
                <ShieldCheck className="size-4.5" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Work authorization</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Keep these answers explicit. Future workflows must ask when a listing needs a more specific legal attestation.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Authorized to work in your target country?">
                <FactStatusSelect
                  value={profile.authorizedToWork}
                  onChange={(value) => updateField("authorizedToWork", value)}
                  disabled={isLoading}
                />
              </Field>
              <Field label="Will you require sponsorship now or later?">
                <FactStatusSelect
                  value={profile.requiresSponsorship}
                  onChange={(value) => updateField("requiresSponsorship", value)}
                  disabled={isLoading}
                />
              </Field>
            </div>
          </div>

          <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {formatUpdatedAt(updatedAt)}
            </p>
            <button
              onClick={saveProfile}
              disabled={isLoading || isSaving || isDrafting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[#123a9e] disabled:cursor-wait disabled:opacity-60"
            >
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? "Saving profile…" : "Save profile"}
            </button>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-border bg-white/80 p-5 shadow-[0_16px_45px_-28px_rgba(10,36,114,0.3)]">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600">
                <FileText className="size-4.5" />
              </span>
              <div>
                <h2 className="text-[15px] font-bold text-foreground">Resume files</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Generate one role-specific PDF from the facts you approved above. RapidApply never invents work history,
                  education, skills, or achievements.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="resume-target-role" className="text-[12px] font-semibold text-foreground">
                Target role
              </Label>
              <Input
                id="resume-target-role"
                value={resumeTargetRole}
                onChange={(event) => setResumeTargetRole(event.target.value)}
                placeholder="Product Designer"
                disabled={isLoading || isGeneratingResume}
              />
            </div>
            {resume ? (
              <div className="mt-4 rounded-lg border border-primary/10 bg-primary/[0.025] p-3">
                <p className="break-all text-[12px] font-semibold text-foreground">{resume.fileName}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatFileSize(resume.byteSize)} · Version {resume.version} · {resume.targetRole}
                </p>
                <a
                  href={`/api/resumes/${resume.id}/download`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
                >
                  <Download className="size-3.5" />
                  Download PDF
                </a>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-slate-50/70 px-3 py-2.5 text-[12px] font-medium text-muted-foreground">
                No generated resume yet
              </div>
            )}
            <button
              type="button"
              onClick={generateResume}
              disabled={isLoading || isSaving || isDrafting || isGeneratingResume}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e] disabled:cursor-wait disabled:opacity-60"
            >
              {isGeneratingResume ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {isGeneratingResume ? "Generating resume…" : resume ? "Update generated resume" : "Generate resume"}
            </button>
            {resumeNotice && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-emerald-700">{resumeNotice}</p>
            )}
          </section>

          <section className="rounded-2xl border border-primary/10 bg-primary/[0.025] p-5">
            <h2 className="text-[14px] font-bold text-foreground">How this will be used</h2>
            <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <li>• Campaigns can reference your approved facts.</li>
              <li>• The browser helper receives only the answer required for the observed field.</li>
              <li>• Uncertain or legal questions must still pause for you.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[12.5px] font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </Label>
      {children}
    </div>
  );
}

function formatUpdatedAt(updatedAt: string | null): string {
  if (!updatedAt) return "Your draft is only saved when you choose Save profile.";

  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return "Your profile has been saved.";

  return `Last saved ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)}.`;
}

function formatFileSize(byteSize: number): string {
  return byteSize < 1_000_000
    ? `${Math.max(1, Math.round(byteSize / 1_000))} KB`
    : `${(byteSize / 1_000_000).toFixed(1)} MB`;
}

function getProviderLabel(provider: SummaryDraftResponse["provider"]): string {
  if (provider === "groq") return "Groq";
  if (provider === "gemini") return "Gemini";
  return "AI";
}

function FactStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: CandidateFactStatus;
  onChange: (value: CandidateFactStatus) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as CandidateFactStatus)} disabled={disabled}>
      <SelectTrigger className="bg-white text-[14px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border border-border bg-white shadow-md">
        {(Object.keys(FACT_STATUS_LABEL) as CandidateFactStatus[]).map((status) => (
          <SelectItem key={status} value={status}>
            {FACT_STATUS_LABEL[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
