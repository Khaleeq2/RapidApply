import type {
  BrowserExecutionPlan,
  DiscoveredJobReference,
  LinkedInDiscoveryState,
} from "@rapidapply/contracts";
import { normalizeText } from "../fingerprint";

const RESULTS_PER_PAGE = 25;
const MAX_DISCOVERY_PAGES = 8;
const JOB_CARD_SELECTOR = [
  "[data-occludable-job-id]",
  "[data-job-id]",
  ".jobs-search-results__list-item",
  ".job-card-container",
].join(",");
const SEARCH_RESULTS_ROOT_SELECTOR = [
  ".jobs-search-results-list",
  ".jobs-search-results__list",
  "[aria-label*='Search results']",
].join(",");

export interface SearchHydrationResult {
  cycles: number;
  jobs: DiscoveredJobReference[];
}

export function createLinkedInDiscoveryState(
  plan: BrowserExecutionPlan,
): LinkedInDiscoveryState {
  return {
    searchUrl: buildLinkedInSearchUrl(plan, 0),
    pageIndex: 0,
    // The legacy worker deliberately left room for an additional page because
    // hydrated card counts and eligible-job counts are not the same thing. We
    // retain that ceiling but stop as soon as the buffered pool is satisfied.
    maxPages: Math.min(
      MAX_DISCOVERY_PAGES,
      Math.max(1, Math.ceil(plan.poolTarget / RESULTS_PER_PAGE) + 1),
    ),
    poolTarget: plan.poolTarget,
    jobs: [],
  };
}

export function buildLinkedInSearchUrl(
  plan: BrowserExecutionPlan,
  pageIndex: number,
): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", plan.targetRole.trim());
  url.searchParams.set("location", normalizeCampaignLocation(plan.targetLocation));
  url.searchParams.set("start", String(Math.max(0, pageIndex) * RESULTS_PER_PAGE));

  if (plan.preferences.onlyEasyApply) url.searchParams.set("f_AL", "true");

  const workType = linkedInWorkType(plan.preferences.workStyle);
  if (workType) url.searchParams.set("f_WT", workType);

  return url.toString();
}

export function nextLinkedInSearchPageUrl(
  plan: BrowserExecutionPlan,
  pageIndex: number,
): string {
  return buildLinkedInSearchUrl(plan, pageIndex);
}

export function extractLinkedInSearchJobs(
  document: Document,
  pageUrl: URL,
): DiscoveredJobReference[] {
  const jobs = new Map<string, DiscoveredJobReference>();
  const resultsRoot = searchResultsRoot(document);
  const cards = [...resultsRoot.querySelectorAll<HTMLElement>(JOB_CARD_SELECTOR)];

  for (const card of cards) {
    const anchor = findJobAnchor(card);
    const externalId = findExternalJobId(card, anchor, pageUrl);
    if (!externalId || jobs.has(externalId)) continue;

    jobs.set(externalId, {
      externalId,
      url: canonicalJobUrl(externalId),
      title: readFirstText(card, [
        ".job-card-list__title--link",
        ".job-card-container__link",
        "a[href*='/jobs/view/']",
      ]) || normalizeText(anchor?.textContent, 240) || undefined,
      company: readFirstText(card, [
        ".job-card-container__primary-description",
        ".artdeco-entity-lockup__subtitle",
        ".job-card-list__company-name",
      ]) || undefined,
      location: readFirstText(card, [
        ".job-card-container__metadata-item",
        ".artdeco-entity-lockup__caption",
        ".job-card-container__metadata-wrapper",
      ]) || undefined,
    });
  }

  // LinkedIn sometimes changes or virtualizes the card wrapper while keeping
  // the job link. This fallback preserves the old extension's link-first
  // strategy instead of treating the missing wrapper as an empty result page.
  for (const anchor of resultsRoot.querySelectorAll<HTMLAnchorElement>("a[href*='/jobs/view/']")) {
    const externalId = jobIdFromHref(anchor.href, pageUrl);
    if (!externalId || jobs.has(externalId)) continue;
    jobs.set(externalId, {
      externalId,
      url: canonicalJobUrl(externalId),
      title: normalizeText(anchor.textContent, 240) || undefined,
    });
  }

  return [...jobs.values()];
}

export async function hydrateLinkedInSearchResults(
  document: Document,
  pageUrl: URL,
  options: { maxCycles?: number; settleMs?: number; stableCycles?: number } = {},
): Promise<SearchHydrationResult> {
  const maxCycles = options.maxCycles ?? 12;
  const settleMs = options.settleMs ?? 750;
  const stableCyclesRequired = options.stableCycles ?? 2;
  let stableCycles = 0;
  let previousCount = -1;
  let cycles = 0;
  let discovered: DiscoveredJobReference[] = [];

  for (; cycles < maxCycles; cycles += 1) {
    const cards = [
      ...searchResultsRoot(document).querySelectorAll<HTMLElement>(JOB_CARD_SELECTOR),
    ];
    discovered = mergeDiscoveredJobs(
      discovered,
      extractLinkedInSearchJobs(document, pageUrl),
    );
    const bottomTarget = document.querySelector<HTMLElement>(".global-footer-compact")
      ?? cards.at(-1);

    bottomTarget?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await waitForSearchSettle(document, settleMs);
    discovered = mergeDiscoveredJobs(
      discovered,
      extractLinkedInSearchJobs(document, pageUrl),
    );

    if (discovered.length === previousCount) stableCycles += 1;
    else stableCycles = 0;
    previousCount = discovered.length;

    if (stableCycles >= stableCyclesRequired) break;
  }

  const firstCard = searchResultsRoot(document).querySelector<HTMLElement>(JOB_CARD_SELECTOR);
  firstCard?.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });

  return {
    cycles: Math.min(cycles + 1, maxCycles),
    jobs: mergeDiscoveredJobs(
      discovered,
      extractLinkedInSearchJobs(document, pageUrl),
    ),
  };
}

export function mergeDiscoveredJobs(
  existing: readonly DiscoveredJobReference[],
  incoming: readonly DiscoveredJobReference[],
): DiscoveredJobReference[] {
  const merged = new Map(existing.map((job) => [job.externalId, job]));
  for (const job of incoming) {
    const previous = merged.get(job.externalId);
    merged.set(job.externalId, previous ? { ...previous, ...compactJob(job) } : compactJob(job));
  }
  return [...merged.values()];
}

function normalizeCampaignLocation(value: string): string {
  const normalized = value
    .replace(/\s*[·|]\s*(remote|hybrid|on[ -]?site)\s*$/i, "")
    .trim();
  return normalized || "United States";
}

function linkedInWorkType(workStyle: BrowserExecutionPlan["preferences"]["workStyle"]): string | null {
  switch (workStyle) {
    case "onsite": return "1";
    case "remote": return "2";
    case "hybrid": return "3";
    case "any": return null;
  }
}

function findJobAnchor(card: Element): HTMLAnchorElement | null {
  return card.querySelector<HTMLAnchorElement>("a[href*='/jobs/view/'], a[href*='currentJobId=']");
}

function findExternalJobId(
  card: HTMLElement,
  anchor: HTMLAnchorElement | null,
  pageUrl: URL,
): string | null {
  const attributes = [
    card.dataset.occludableJobId,
    card.dataset.jobId,
    card.getAttribute("data-job-id"),
  ];
  for (const value of attributes) {
    if (value && /^\d+$/.test(value)) return value;
  }
  return anchor ? jobIdFromHref(anchor.href, pageUrl) : null;
}

function jobIdFromHref(href: string, pageUrl: URL): string | null {
  try {
    const url = new URL(href, pageUrl);
    const pathId = url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (pathId) return pathId;
    const currentJobId = url.searchParams.get("currentJobId");
    return currentJobId && /^\d+$/.test(currentJobId) ? currentJobId : null;
  } catch {
    return null;
  }
}

function canonicalJobUrl(externalId: string): string {
  return `https://www.linkedin.com/jobs/view/${externalId}/`;
}

function readFirstText(root: ParentNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const text = normalizeText(root.querySelector(selector)?.textContent, 240);
    if (text) return text;
  }
  return "";
}

function compactJob(job: DiscoveredJobReference): DiscoveredJobReference {
  return {
    externalId: job.externalId,
    url: job.url,
    ...(job.title ? { title: job.title } : {}),
    ...(job.company ? { company: job.company } : {}),
    ...(job.location ? { location: job.location } : {}),
  };
}

function searchResultsRoot(document: Document): ParentNode {
  return document.querySelector(SEARCH_RESULTS_ROOT_SELECTOR) ?? document;
}

function waitForSearchSettle(document: Document, quietMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver;
    let quietTimer: number;
    let hardTimer: number;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(quietTimer);
      window.clearTimeout(hardTimer);
      resolve();
    };
    observer = new MutationObserver(() => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, quietMs);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    quietTimer = window.setTimeout(finish, quietMs);
    hardTimer = window.setTimeout(finish, quietMs * 3);
  });
}
