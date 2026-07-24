const FORM_CONTROL_SELECTOR = "input, select, textarea";
const ACTION_SELECTOR = "button, [role='button'], input[type='submit'], input[type='button']";
const FIELD_GROUP_SELECTOR = [
  ".jobs-easy-apply-form-element",
  ".fb-dash-form-element",
  "[data-test-form-element]",
  "fieldset",
].join(", ");
const EXPLICIT_APPLICATION_SURFACE_SELECTOR = [
  ".jobs-easy-apply-modal",
  ".jobs-easy-apply-modal__content",
  ".jobs-easy-apply-content",
  ".artdeco-modal[role='dialog']",
  ".artdeco-modal[aria-modal='true']",
  "[role='dialog'][aria-labelledby]",
  "[role='dialog'][aria-modal='true']",
  "[role='dialog']",
  "[aria-modal='true']",
].join(", ");

type ApplicationControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Finds LinkedIn's active application surface without assuming one permanent
 * modal class or ARIA shape. The legacy implementation intentionally started
 * from `.jobs-easy-apply-modal` and `.jobs-easy-apply-form-element`; preserve
 * those anchors before using the generic fallback for newer LinkedIn markup.
 */
export function findLinkedInApplicationContainer(document: Document): Element | null {
  const candidates = new Set<Element>();
  const explicitCandidates = [...document.querySelectorAll(EXPLICIT_APPLICATION_SURFACE_SELECTOR)];
  for (const candidate of explicitCandidates) {
    addApplicationCandidate(candidates, candidate);
  }

  // The newer LinkedIn shell can omit both the old class and role="dialog".
  // Start only at a visible *progress action*, never at every field. Starting
  // at form fields let the global "I'm looking for …" header leak into an
  // application observation before the actual Easy Apply surface had settled.
  const seeds = [...document.querySelectorAll<HTMLElement>(ACTION_SELECTOR)]
    .filter((element) => isLinkedInElementVisible(element) && isProgressAction(element));

  for (const seed of seeds) {
    let candidate: Element | null = seed;
    while (candidate && candidate !== document.body) {
      if (isGlobalPageContainer(candidate)) break;
      addApplicationCandidate(candidates, candidate);
      candidate = candidate.parentElement;
    }
  }

  return [...candidates]
    .sort((left, right) => scoreApplicationContainer(right, candidates) - scoreApplicationContainer(left, candidates))[0] ?? null;
}

function addApplicationCandidate(candidates: Set<Element>, candidate: Element): void {
  const isLegacyEasyApplyModal = candidate.classList.contains("jobs-easy-apply-modal");
  if (
    isLinkedInElementVisible(candidate) &&
    !isGlobalPageContainer(candidate) &&
    (isLegacyEasyApplyModal || isApplicationContainer(candidate))
  ) {
    candidates.add(candidate);
  }
}

function isProgressAction(element: HTMLElement): boolean {
  const name = actionName(element);
  return name === "next" || name.includes("continue") || name.includes("review") || name.includes("submit");
}

function isApplicationContainer(candidate: Element): boolean {
  const text = normalizedText(candidate).toLowerCase();
  const hasApplicationTitle = [...candidate.querySelectorAll(
    "h1, h2, h3, [role='heading']",
  )].filter(isLinkedInElementVisible).some((heading) => {
    const headingText = normalizedText(heading).toLowerCase();
    return headingText.includes("apply to ") || headingText.includes("easy apply");
  });
  const hasApplicationCue = hasApplicationTitle ||
    text.includes("contact info") ||
    text.includes("contact information") ||
    text.includes("application questions") ||
    text.includes("resume");
  if (!hasApplicationCue) return false;

  const actions = visibleActionNames(candidate);
  const hasProgressAction = actions.some((name) =>
    name === "next" || name.includes("continue") || name.includes("review") || name.includes("submit"),
  );
  if (!hasProgressAction) return false;

  const hasFields = findLinkedInApplicationControls(candidate).length > 0;
  const hasDismissAction = actions.some((name) => name.includes("dismiss") || name.includes("close"));
  const hasFieldGroup = candidate.querySelector(FIELD_GROUP_SELECTOR) !== null;
  const hasModalSemantics = candidate.matches(EXPLICIT_APPLICATION_SURFACE_SELECTOR);

  // Generic LinkedIn application surfaces are bounded overlays. Requiring a
  // local dismiss/close action, a known Easy Apply field group, or modal
  // semantics prevents a job-detail page from being mistaken for the
  // application merely because it happens to contain an Easy Apply button,
  // an unrelated form control, and a carousel "Next" button.
  //
  // A contact/resume screen has fields; final review may have only application
  // actions and its dismiss control. Both are useful application surfaces.
  return (hasDismissAction || hasFieldGroup || hasModalSemantics) && (hasFields || hasApplicationTitle);
}

/**
 * When LinkedIn replaces an Easy Apply step, the old subtree can briefly stay
 * mounted beside the active one. Select the strongest visible application
 * surface rather than trusting the first DOM match. This keeps the observer,
 * filler, and controller on the same live modal.
 */
function scoreApplicationContainer(candidate: Element, candidates: Set<Element>): number {
  const text = normalizedText(candidate).toLowerCase();
  const headings = [...candidate.querySelectorAll("h1, h2, h3, [role='heading']")]
    .filter(isLinkedInElementVisible)
    .map((heading) => normalizedText(heading).toLowerCase());
  const nestedCandidates = [...candidates].filter((other) => other !== candidate && candidate.contains(other)).length;
  const controls = findLinkedInApplicationControls(candidate).length;
  let score = 0;

  if (candidate.matches(".jobs-easy-apply-modal")) score += 800;
  if (candidate.matches(".jobs-easy-apply-modal__content, .jobs-easy-apply-content")) score += 620;
  if (candidate.matches(".artdeco-modal")) score += 520;
  if (candidate.matches("[role='dialog']")) score += 420;
  if (candidate.getAttribute("aria-modal") === "true") score += 80;
  if (headings.some((heading) => heading.includes("apply to ") || heading.includes("easy apply"))) score += 160;
  if (text.includes("contact info") || text.includes("contact information")) score += 35;
  if (text.includes("application questions") || text.includes("resume")) score += 25;
  if (visibleActionNames(candidate).some((name) => name.includes("dismiss") || name.includes("close"))) score += 40;
  if (candidate.querySelector(FIELD_GROUP_SELECTOR)) score += 180;
  score += Math.min(controls, 10) * 3;
  score -= nestedCandidates * 450;

  if (isGlobalPageContainer(candidate)) score -= 4_000;
  return score;
}

function visibleActionNames(candidate: Element): string[] {
  return [...candidate.querySelectorAll<HTMLElement>(ACTION_SELECTOR)]
    .filter(isLinkedInElementVisible)
    .map(actionName);
}

function actionName(element: HTMLElement): string {
  const value = element instanceof HTMLInputElement ? element.value : "";
  return `${element.getAttribute("aria-label") ?? ""} ${value} ${element.textContent ?? ""} ${element.getAttribute("title") ?? ""}`
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizedText(element: Element): string {
  const renderedText = "innerText" in element ? (element as HTMLElement).innerText : undefined;
  return (renderedText ?? element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 3_000);
}

/**
 * Returns controls local to the already-selected Easy Apply surface. Sharing
 * this with the observer and review-only executor prevents an answer plan from
 * being observed from one form and applied to a different page-level control.
 */
export function findLinkedInApplicationControls(root: Element): ApplicationControl[] {
  return [...root.querySelectorAll<ApplicationControl>(FORM_CONTROL_SELECTOR)]
    .filter((element) =>
      !(element instanceof HTMLInputElement && ["hidden", "submit", "button"].includes(element.type)) &&
      isLinkedInElementVisible(element) &&
      !isGlobalLinkedInControl(element)
    );
}

function isGlobalPageContainer(candidate: Element): boolean {
  if (
    candidate.matches(
      ".jobs-easy-apply-modal, .jobs-easy-apply-modal__content, .jobs-easy-apply-content, .artdeco-modal, [role='dialog'], [aria-modal='true']",
    )
  ) {
    return false;
  }
  if (candidate.matches("html, body, main, [role='main']")) return true;
  if (candidate.querySelector(".global-nav, .global-nav__content, nav, [role='navigation']")) return true;
  return [...candidate.querySelectorAll<ApplicationControl>(FORM_CONTROL_SELECTOR)]
    .some(isGlobalLinkedInControl);
}

function isGlobalLinkedInControl(control: ApplicationControl): boolean {
  if (control.closest("header, nav, [role='navigation'], .global-nav, .global-nav__content")) return true;

  const hint = [
    control.getAttribute("aria-label"),
    control.getAttribute("placeholder"),
    control.getAttribute("name"),
  ].filter(Boolean).join(" ").toLowerCase();

  // This is LinkedIn's global people/jobs search prompt, never an Easy Apply
  // response. Keep the rule narrow so a legitimate application question is
  // not discarded just because it contains the word "search".
  return hint.includes("i'm looking for") || hint.includes("i’m looking for");
}

/** Shared visibility rule for the observer and the controlled form executor. */
export function isLinkedInElementVisible(element: Element): boolean {
  if (!element.isConnected) return false;

  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.getAttribute("aria-hidden") === "true") return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0 || element.getClientRects().length > 0) return true;

  // DOM test environments intentionally have no layout engine. Preserve the
  // production rule while allowing the same semantic fixture tests to run.
  const userAgent = element.ownerDocument.defaultView?.navigator.userAgent ?? "";
  return userAgent.includes("jsdom") || userAgent.includes("happy-dom");
}
