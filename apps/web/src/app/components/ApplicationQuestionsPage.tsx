"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WEB_BRIDGE_SOURCE,
  type ApplicationAnswerMemoryScope,
  type ApplicationAnswerValue,
  type ApplicationFieldDescriptor,
  type ApplicationIntervention,
} from "@rapidapply/contracts";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "./ui/utils";

interface InterventionListResponse {
  interventions?: ApplicationIntervention[];
  error?: string;
}

interface InterventionAnswerResponse {
  intervention?: ApplicationIntervention;
  error?: string;
}

interface DeferredJobItem {
  id: string;
  jobExternalId: string;
  url: string;
  title: string;
  company: string;
  reasonCode: string;
  reasonDetails?: string | null;
  createdAt: string;
}

export function ApplicationQuestionsPage() {
  const [interventions, setInterventions] = useState<ApplicationIntervention[]>([]);
  const [deferredJobs, setDeferredJobs] = useState<DeferredJobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [intRes, defRes] = await Promise.all([
        fetch("/api/interventions", { cache: "no-store" }),
        fetch("/api/deferred-jobs", { cache: "no-store" }),
      ]);
      const intPayload = (await intRes.json()) as InterventionListResponse;
      const defPayload = (await defRes.json()) as { deferredJobs?: DeferredJobItem[]; error?: string };

      if (!intRes.ok || !Array.isArray(intPayload.interventions)) {
        throw new Error(intPayload.error ?? "RapidApply could not load your application questions.");
      }
      setInterventions(intPayload.interventions);
      if (defRes.ok && Array.isArray(defPayload.deferredJobs)) {
        setDeferredJobs(defPayload.deferredJobs);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "RapidApply could not load your application questions.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openQuestions = useMemo(
    () => interventions.filter((intervention) => ["pending", "deferred"].includes(intervention.status)),
    [interventions],
  );
  const answeredQuestions = useMemo(
    () => interventions.filter((intervention) => intervention.status === "answered"),
    [interventions],
  );

  return (
    <div className="mx-auto w-full max-w-[980px] px-6 pb-16 pt-3 lg:px-10 lg:pt-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12px] font-semibold text-violet-700">
            <CircleHelp className="size-3.5" />
            Your answer memory
          </div>
          <h1 className="text-[30px] font-bold tracking-tight text-foreground">Answer Center</h1>
          <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-muted-foreground">
            RapidApply stops only for answers it cannot truthfully infer. Answer once, choose where it may be reused, and the browser helper can continue from the same saved checkpoint.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setIsLoading(true); void load(); }}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[12px] font-semibold text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-white/80 p-5 shadow-[0_16px_45px_-28px_rgba(10,36,114,0.35)] sm:p-6">
        <div className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-foreground">Needs your input</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Required questions stay here instead of being guessed. Deferred applications remain linked to their verified job listing.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-primary/8 px-2.5 py-1 text-[12px] font-bold text-primary">
            {openQuestions.length} open
          </span>
        </div>

        {isLoading ? (
          <div className="grid min-h-40 place-items-center text-[13px] text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" /> Loading questions…</div>
        ) : openQuestions.length === 0 ? (
          <EmptyQuestions />
        ) : (
          <div className="mt-5 grid gap-4">
            {openQuestions.map((intervention) => (
              <ApplicationQuestionCard
                key={intervention.id}
                intervention={intervention}
                onAnswered={async (answered) => {
                  setInterventions((current) => current.map((candidate) =>
                    candidate.id === answered.id ? answered : candidate,
                  ));
                  window.postMessage({
                    source: WEB_BRIDGE_SOURCE,
                    type: "EXTENSION_APPLICATION_INTERVENTIONS_UPDATED",
                    runId: answered.runId,
                  }, window.location.origin);
                  await load();
                }}
              />
            ))}
          </div>
        )}
      </section>

      {deferredJobs.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200/60 bg-amber-50/40 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 border-b border-amber-200/50 pb-4">
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 text-amber-700" />
              <h2 className="text-[15px] font-bold text-foreground">Finish Later Queue (Deferred Jobs)</h2>
            </div>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-bold text-amber-800">
              {deferredJobs.length} deferred
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            In Autonomous Mode, applications with unresolvable fields or custom policies were automatically deferred here so your campaign could continue without stalling.
          </p>
          <div className="mt-4 grid gap-3">
            {deferredJobs.map((job) => (
              <div key={job.id} className="flex flex-col gap-2 rounded-xl border border-amber-200/70 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-[14px] font-bold text-foreground">{job.title}</h3>
                  <p className="text-[12.5px] text-muted-foreground">{job.company} • <span className="font-mono text-[11px] text-amber-700">{job.reasonCode}</span></p>
                </div>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-[12px] font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Open on LinkedIn <ArrowUpRight className="size-3.5" />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {answeredQuestions.length > 0 && (
        <section className="mt-6 rounded-2xl border border-border bg-white/65 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <h2 className="text-[15px] font-bold text-foreground">Recently answered</h2>
          </div>
          <div className="mt-4 grid gap-2">
            {answeredQuestions.slice(-6).reverse().map((intervention) => (
              <div key={intervention.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-white/75 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-foreground">{intervention.field.question}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{jobLabel(intervention)}</p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-emerald-700">Saved</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyQuestions() {
  return (
    <div className="grid min-h-48 place-items-center px-5 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Sparkles className="size-4.5" /></span>
        <h3 className="mt-3 text-[14px] font-bold text-foreground">Nothing is waiting on you</h3>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">Known facts can be completed immediately. New or consequential questions will appear here only when your decision is genuinely needed.</p>
      </div>
    </div>
  );
}

function ApplicationQuestionCard({
  intervention,
  onAnswered,
}: {
  intervention: ApplicationIntervention;
  onAnswered: (intervention: ApplicationIntervention) => Promise<void>;
}) {
  const [answer, setAnswer] = useState<ApplicationAnswerValue>(() => initialAnswer(intervention.field));
  const [remember, setRemember] = useState(true);
  const [scope, setScope] = useState<ApplicationAnswerMemoryScope>("campaign");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const validation = validateAnswer(intervention.field, answer);
    if (validation) {
      setError(validation);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/interventions/${intervention.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer,
          rememberScope: remember ? scope : undefined,
          autoUse: remember,
        }),
      });
      const payload = await response.json() as InterventionAnswerResponse;
      if (!response.ok || !payload.intervention) {
        throw new Error(payload.error ?? "RapidApply could not save that answer.");
      }
      await onAnswered(payload.intervention);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "RapidApply could not save that answer.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="rounded-xl border border-border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
              intervention.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700",
            )}>
              <Clock3 className="size-3" />
              {intervention.status === "pending" ? "Waiting now" : "Saved for later"}
            </span>
            {intervention.field.required ? <span className="text-[10.5px] font-semibold text-rose-600">Required</span> : <span className="text-[10.5px] font-semibold text-muted-foreground">Optional</span>}
          </div>
          <h3 className="mt-2 text-[15px] font-bold leading-snug text-foreground">{intervention.field.question}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">{jobLabel(intervention)}</p>
        </div>
        <a href={intervention.jobUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-[11.5px] font-semibold text-primary hover:bg-primary/5">
          Job listing <ArrowUpRight className="size-3.5" />
        </a>
      </div>

      <div className="mt-4">
        <AnswerInput field={intervention.field} answer={answer} onChange={setAnswer} />
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-primary/10 bg-primary/[0.02] p-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-[12px] font-medium text-foreground">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="accent-primary" />
          Remember this answer
        </label>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value === "global" ? "global" : "campaign")}
          disabled={!remember}
          className="h-8 rounded-md border border-border bg-white px-2 text-[11.5px] text-foreground disabled:opacity-50 sm:ml-auto"
        >
          <option value="campaign">For this job search</option>
          <option value="global">For future job searches</option>
        </select>
      </div>

      {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={isSaving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-[#123a9e] disabled:cursor-wait disabled:opacity-65">
          {isSaving && <LoaderCircle className="size-3.5 animate-spin" />}
          Save answer
        </button>
      </div>
    </article>
  );
}

function AnswerInput({ field, answer, onChange }: {
  field: ApplicationFieldDescriptor;
  answer: ApplicationAnswerValue;
  onChange: (answer: ApplicationAnswerValue) => void;
}) {
  if (["text", "textarea", "number"].includes(field.kind)) {
    const text = answer.type === "text" ? answer.text : "";
    if (field.kind === "textarea") {
      return <textarea value={text} onChange={(event) => onChange({ type: "text", text: event.target.value })} className="min-h-28 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none ring-primary/20 focus:ring-4" placeholder="Write a concise, factual answer" />;
    }
    return <input type={field.kind === "number" ? "number" : "text"} value={text} onChange={(event) => onChange({ type: "text", text: event.target.value })} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none ring-primary/20 focus:ring-4" placeholder="Type your answer" />;
  }
  if (field.kind === "checkbox") {
    const checked = answer.type === "checked" ? answer.checked : false;
    return <label className="flex items-start gap-2.5 rounded-lg border border-border bg-white px-3 py-2.5 text-[13px] text-foreground"><input type="checkbox" checked={checked} onChange={(event) => onChange({ type: "checked", checked: event.target.checked })} className="mt-0.5 accent-primary" /><span>{field.question}</span></label>;
  }
  if (field.kind === "multi_select") {
    const ids = answer.type === "options" ? answer.optionIds : [];
    return <div className="grid gap-2">{field.options.map((option) => <label key={option.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-white px-3 py-2.5 text-[13px] text-foreground"><input type="checkbox" checked={ids.includes(option.id)} onChange={(event) => onChange({ type: "options", optionIds: event.target.checked ? [...ids, option.id] : ids.filter((id) => id !== option.id) })} className="accent-primary" />{option.label}</label>)}</div>;
  }
  const selected = answer.type === "options" ? answer.optionIds[0] ?? "" : "";
  return <select value={selected} onChange={(event) => onChange({ type: "options", optionIds: event.target.value ? [event.target.value] : [] })} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none ring-primary/20 focus:ring-4"><option value="">Select an answer</option>{field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;
}

function initialAnswer(field: ApplicationFieldDescriptor): ApplicationAnswerValue {
  if (field.kind === "checkbox") return { type: "checked", checked: false };
  if (["text", "textarea", "number"].includes(field.kind)) return { type: "text", text: "" };
  return { type: "options", optionIds: [] };
}

function validateAnswer(field: ApplicationFieldDescriptor, answer: ApplicationAnswerValue): string | null {
  if (answer.type === "text" && field.required && answer.text.trim().length === 0) return "Enter an answer to continue.";
  if (answer.type === "options" && field.required && answer.optionIds.length === 0) return "Choose an answer to continue.";
  if (answer.type === "checked" && field.required && !answer.checked) return "Confirm this item to continue.";
  return null;
}

function jobLabel(intervention: ApplicationIntervention): string {
  return [intervention.jobTitle, intervention.company].filter(Boolean).join(" · ") || "LinkedIn application";
}
