import {
  clickElement,
  clickElementAndWait,
  selectNativeOption,
  setNativeChecked,
  setNativeValue,
  setNativeValueVerified,
  waitForCondition,
  waitForElement,
} from "../src/interactions/dom";

describe("DOM interaction primitives", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("sets text through the native setter and emits framework-compatible events", () => {
    document.body.innerHTML = `<input id="answer">`;
    const input = document.querySelector<HTMLInputElement>("#answer")!;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    setNativeValue(input, "42");

    expect(input.value).toBe("42");
    expect(events).toEqual(["input", "change"]);
  });

  it("re-resolves and retries when a controlled form replaces the input", async () => {
    document.body.innerHTML = `<div id="root"><input id="answer"></div>`;
    const root = document.querySelector<HTMLElement>("#root")!;
    let replaced = false;
    root.querySelector("input")!.addEventListener("input", () => {
      if (replaced) return;
      replaced = true;
      root.innerHTML = `<input id="answer">`;
    });

    const result = await setNativeValueVerified(
      () => root.querySelector<HTMLInputElement>("#answer"),
      "7",
      { settleMs: 0, retryDelayMs: 0 },
    );

    expect(result.attempts).toBe(2);
    expect(root.querySelector<HTMLInputElement>("#answer")!.value).toBe("7");
  });

  it("uses native selection and checked setters", () => {
    document.body.innerHTML = `
      <select id="authorization">
        <option value="">Choose</option>
        <option value="yes">Yes, I am authorized</option>
      </select>
      <input id="consent" type="checkbox">
    `;
    const select = document.querySelector<HTMLSelectElement>("#authorization")!;
    const checkbox = document.querySelector<HTMLInputElement>("#consent")!;

    const option = selectNativeOption(select, { label: "  YES,   I AM AUTHORIZED " });
    setNativeChecked(checkbox, true);

    expect(option.value).toBe("yes");
    expect(select.value).toBe("yes");
    expect(checkbox.checked).toBe(true);
  });

  it("dispatches pointer and mouse preludes before the native click", () => {
    document.body.innerHTML = `<button id="next">Next</button>`;
    const button = document.querySelector<HTMLButtonElement>("#next")!;
    const events: string[] = [];
    for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      button.addEventListener(name, () => events.push(name));
    }

    clickElement(button);

    expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("waits for a verified click result without duplicating the action", async () => {
    document.body.innerHTML = `<button id="next">Next</button><div id="state">before</div>`;
    const button = document.querySelector<HTMLButtonElement>("#next")!;
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
      document.querySelector("#state")!.textContent = "after";
    });

    const result = await clickElementAndWait(
      button,
      () => document.querySelector("#state")?.textContent === "after",
      { postconditionTimeoutMs: 100 },
    );

    expect(result.attempts).toBe(1);
    expect(clicks).toBe(1);
  });

  it("refuses disabled actions", () => {
    document.body.innerHTML = `<button id="submit" disabled>Submit</button>`;
    expect(() => clickElement(document.querySelector<HTMLButtonElement>("#submit")!))
      .toThrow("disabled");
  });

  it("waits for elements and arbitrary bounded conditions", async () => {
    const elementPromise = waitForElement<HTMLDivElement>("#ready", { timeoutMs: 200 });
    queueMicrotask(() => {
      document.body.insertAdjacentHTML("beforeend", `<div id="ready">ready</div>`);
    });
    expect((await elementPromise).textContent).toBe("ready");

    let value = 0;
    queueMicrotask(() => { value = 9; });
    await expect(waitForCondition(() => value || undefined, {
      timeoutMs: 200,
      pollIntervalMs: 1,
      description: "fixture value",
    })).resolves.toBe(9);
  });
});
