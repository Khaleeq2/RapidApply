import { findLinkedInApplicationContainer, isLinkedInElementVisible } from "./application-container";

export type ExistingResumeSelectionResult = "already_selected" | "selected" | "not_found";

/** Selects only an exact, deterministic filename inside the active application. */
export async function selectExistingLinkedInResume(
  document: Document,
  expectedFileName: string,
): Promise<ExistingResumeSelectionResult> {
  const container = findLinkedInApplicationContainer(document);
  if (!container) return "not_found";

  const attached = [...container.querySelectorAll<HTMLInputElement>("input[type='file']")]
    .find((input) => input.files?.[0]?.name === expectedFileName);
  if (attached) return "already_selected";

  const candidates = [...container.querySelectorAll<HTMLElement>(
    "label, button, [role='button'], [role='radio'], [role='option'], li, span, p, div",
  )].filter((element) => {
    if (!isLinkedInElementVisible(element)) return false;
    return elementMatchesResumeIdentity(element, expectedFileName);
  }).sort((left, right) => left.children.length - right.children.length);

  for (const nameElement of candidates) {
    const selectable = findSelectableControl(nameElement, container);
    if (!selectable) continue;
    if (isSelected(selectable)) return "already_selected";
    selectable.click();
    await wait(80);
    if (isSelected(selectable)) return "selected";
  }

  return "not_found";
}

export function verifyLinkedInResumeAttachment(
  document: Document,
  expectedFileName: string,
): boolean {
  const container = findLinkedInApplicationContainer(document);
  if (!container) return false;

  if (
    [...container.querySelectorAll<HTMLInputElement>("input[type='file']")].some(
      (input) => input.files?.[0]?.name === expectedFileName,
    )
  ) {
    return true;
  }

  const uploadRef = container.querySelector(
    "#easyApplyUploadedResumeRef, [componentkey*='easyApplyUploadedResume'], .jobs-document-upload-redesign-card, [data-test-document-upload]",
  );
  if (uploadRef) {
    const identitySurfaces = [
      uploadRef,
      uploadRef.parentElement,
      uploadRef.closest<HTMLElement>("fieldset"),
    ].filter((element): element is HTMLElement => element instanceof HTMLElement);
    if (identitySurfaces.some((element) =>
      elementMatchesResumeIdentity(element, expectedFileName)
    )) {
      return true;
    }
  }

  return [...container.querySelectorAll<HTMLElement>("label, [role='radio'], [role='option'], button, div, span, p")].some(
    (element) => {
      if (!elementMatchesResumeIdentity(element, expectedFileName)) return false;
      const control = findSelectableControl(element, container);
      return control === null || isSelected(control);
    },
  );
}

export function isLinkedInProfileResumeUploaded(
  document: Document,
  expectedFileName: string,
): boolean {
  return extractLinkedInProfileResumeNames(document)
    .some((visibleName) => visibleResumeNameMatches(visibleName, expectedFileName));
}

export function extractLinkedInProfileResumeNames(document: Document): string[] {
  const selectors = [
    ".jobs-document-upload-redesign-card",
    "[data-test-document-upload]",
    "[data-test-resume-card]",
    "[class*='resume-card']",
    "[class*='document-card']",
    "button[aria-label*='resume' i]",
    "[role='radio'][aria-label*='resume' i]",
  ].join(", ");
  const values = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>(selectors)) {
    for (const raw of [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-file-name"),
      element.textContent,
    ]) {
      const value = raw?.trim().replace(/\s+/g, " ").slice(0, 240);
      if (value && (looksLikeResumeName(value) || /\.pdf\b/i.test(value))) values.add(value);
    }
  }

  // Settings-page cards sometimes expose only the filename in an otherwise
  // generic leaf node. Limit this fallback to short visible strings so page
  // prose is never sent to the resume audit endpoint.
  for (const element of document.querySelectorAll<HTMLElement>("span, p, label")) {
    const value = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240);
    if (value && looksLikeResumeName(value)) values.add(value);
  }
  return [...values].slice(0, 100);
}

function findSelectableControl(nameElement: HTMLElement, container: Element): HTMLElement | null {
  if (isSelectable(nameElement)) return nameElement;
  const label = nameElement.closest("label");
  const labelledInput = label?.querySelector<HTMLInputElement>("input[type='radio'], input[type='checkbox']");
  if (labelledInput) return labelledInput;

  let current: HTMLElement | null = nameElement.parentElement;
  for (let depth = 0; current && current !== container && depth < 5; depth += 1) {
    const control = current.querySelector<HTMLElement>(
      "input[type='radio'], input[type='checkbox'], [role='radio'], [role='option'], button[aria-pressed], button[aria-label*='resume' i], button[aria-label*='select' i]",
    );
    if (control && isLinkedInElementVisible(control)) return control;
    current = current.parentElement;
  }
  return null;
}

function isSelectable(element: HTMLElement): boolean {
  return element.matches(
    "input[type='radio'], input[type='checkbox'], [role='radio'], [role='option'], button[aria-pressed]",
  );
}

function isSelected(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) return element.checked;
  return element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("aria-selected") === "true" ||
    element.getAttribute("aria-pressed") === "true" ||
    element.classList.contains("selected") ||
    element.classList.contains("active");
}

export function extractLinkedInExistingResumeNames(document: Document): string[] {
  const container = findLinkedInApplicationContainer(document);
  if (!container) return [];

  const fileInputs = [...container.querySelectorAll<HTMLInputElement>("input[type='file']")];
  const fileInputNames = fileInputs.map((i) => i.files?.[0]?.name).filter((n): n is string => Boolean(n));

  const textNodes = [...container.querySelectorAll<HTMLElement>(
    "label, [role='radio'], [role='option'], button, div, span, p",
  )]
    .filter((el) => isLinkedInElementVisible(el))
    .map((el) => el.textContent?.trim() ?? "")
    .filter(looksLikeResumeName);

  return [...new Set([...fileInputNames, ...textNodes])];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function visibleResumeNameMatches(visibleValue: string, expectedFileName: string): boolean {
  const visible = normalize(visibleValue);
  const expected = normalize(expectedFileName);
  if (visible === expected || containsDelimitedResumeName(visible, expected)) return true;
  const compactVisible = visible.replace(/\s*(?:\.\.\.|…)\s*/g, "…");
  if (!compactVisible.includes("…")) return false;
  const [prefix, suffix = ""] = compactVisible.split("…", 2);
  return prefix.length >= 8 &&
    expected.startsWith(prefix) &&
    (suffix.length === 0 || expected.endsWith(suffix));
}

function containsDelimitedResumeName(visible: string, expected: string): boolean {
  let index = visible.indexOf(expected);
  while (index >= 0) {
    const before = index > 0 ? visible[index - 1] : "";
    const after = visible[index + expected.length] ?? "";
    if (!/[a-z0-9._-]/i.test(before) && !/[a-z0-9._-]/i.test(after)) return true;
    index = visible.indexOf(expected, index + 1);
  }
  return false;
}

function elementMatchesResumeIdentity(
  element: HTMLElement,
  expectedFileName: string,
): boolean {
  const attributeMatch = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-file-name"),
  ].some((value) => value !== null && visibleResumeNameMatches(value, expectedFileName));
  if (attributeMatch) return true;

  const text = element.textContent?.trim().replace(/\s+/g, " ") ?? "";
  const pdfCount = text.match(/\.pdf\b/gi)?.length ?? 0;
  const ellipsisCount = text.match(/…|\.\.\./g)?.length ?? 0;
  if (pdfCount > 1 || ellipsisCount > 1 || text.length > 360) return false;
  return visibleResumeNameMatches(text, expectedFileName);
}

function looksLikeResumeName(value: string): boolean {
  const normalized = value.trim();
  return /\.pdf$/i.test(normalized) ||
    /(?:\.\.\.|…).{0,12}(?:\.pdf)?$/i.test(normalized);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
