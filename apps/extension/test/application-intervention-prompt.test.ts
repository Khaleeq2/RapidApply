import type {
  ApplicationIntervention,
  ApplicationInterventionResponse,
} from "@rapidapply/contracts";
import {
  createApplicationInterventionPrompt,
  type ApplicationInterventionPromptHandlers,
  type ApplicationInterventionPromptHandle,
} from "../src/intervention/prompt";

const intervention: ApplicationIntervention = {
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  jobExternalId: "123456789",
  jobUrl: "https://www.linkedin.com/jobs/view/123456789/",
  jobTitle: "Product Designer",
  company: "Fixture Labs",
  observationFingerprint: "a1b2c3d4",
  field: {
    key: "01020304",
    question: "Which work arrangement do you prefer?",
    kind: "single_select",
    category: "other",
    required: true,
    options: [
      { id: "05060708", label: "Remote" },
      { id: "11121314", label: "Hybrid" },
    ],
  },
  status: "pending",
  deadlineAt: new Date(Date.now() + 15_000).toISOString(),
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
};

describe("application intervention prompt", () => {
  let prompt: ApplicationInterventionPromptHandle | undefined;

  afterEach(() => {
    prompt?.destroy();
    prompt = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps the question UI isolated and saves a selected answer with its chosen memory scope", async () => {
    const onAnswer = vi.fn<
      (response: ApplicationInterventionResponse) => Promise<ApplicationIntervention | undefined>
    >().mockResolvedValue(undefined);
    const harness = createHarness({
      onAnswer,
      onDefer: vi.fn().mockResolvedValue(undefined),
      onTouch: vi.fn().mockResolvedValue(undefined),
    });
    prompt = harness.prompt;

    prompt.show(intervention);

    const host = document.getElementById("rapidapply-application-helper");
    const topLayerDialog = harness.shadow.querySelector("dialog");
    expect(topLayerDialog).toBeInstanceOf(HTMLDialogElement);
    expect((topLayerDialog as HTMLDialogElement).open).toBe(true);
    expect(host?.shadowRoot).toBeNull();
    expect(harness.shadow.querySelector("[role='dialog']")?.textContent).toContain(
      "RapidApply needs one quick answer",
    );
    expect(harness.shadow.querySelector("[data-timer]")?.textContent).toMatch(/s to answer or save for later/);

    const form = harness.shadow.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(harness.shadow.querySelector(".status")?.textContent).toBe("Choose an answer to continue.");
    expect(onAnswer).not.toHaveBeenCalled();

    const select = harness.shadow.querySelector<HTMLSelectElement>("select.field")!;
    select.value = "05060708";
    const scope = harness.shadow.querySelector<HTMLSelectElement>(".memory select")!;
    scope.value = "global";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(onAnswer).toHaveBeenCalledWith({
      answer: { type: "options", optionIds: ["05060708"] },
      rememberScope: "global",
      autoUse: true,
    });
  });

  it("touches the durable timer while the candidate is active, then defers without guessing", async () => {
    const onTouch = vi.fn().mockResolvedValue({
      ...intervention,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    });
    const onDefer = vi.fn().mockResolvedValue(undefined);
    const harness = createHarness({
      onAnswer: vi.fn().mockResolvedValue(undefined),
      onDefer,
      onTouch,
    });
    prompt = harness.prompt;
    prompt.show(intervention);

    const select = harness.shadow.querySelector<HTMLSelectElement>("select.field")!;
    select.dispatchEvent(new Event("focusin", { bubbles: true }));
    await flushPromises();

    expect(onTouch).toHaveBeenCalledTimes(1);
    expect(harness.shadow.querySelector("[data-timer]")?.textContent).toBe(
      "Timer paused while you are answering.",
    );

    const defer = [...harness.shadow.querySelectorAll("button")]
      .find((button) => button.textContent === "Answer later")!;
    defer.click();
    await flushPromises();

    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(harness.shadow.querySelector(".status")?.textContent).toBe("Saved for later review.");
  });
});

function createHarness(handlers: ApplicationInterventionPromptHandlers): {
  prompt: ApplicationInterventionPromptHandle;
  shadow: ShadowRoot;
} {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  let shadow: ShadowRoot | undefined;
  const attachShadow = vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function attach(
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    const result = originalAttachShadow.call(this, init);
    if (this.id === "rapidapply-application-helper") shadow = result;
    return result;
  });
  const prompt = createApplicationInterventionPrompt(document, handlers);
  attachShadow.mockRestore();
  if (!shadow) throw new Error("Prompt did not create its isolated shadow root.");
  return { prompt, shadow };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
