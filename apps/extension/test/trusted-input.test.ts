import {
  attachTrustedLinkedInResume,
  clickTrustedLinkedInAction,
  type TrustedInputTransport,
} from "../src/background/trusted-input";

describe("trusted input", () => {
  it("attaches exactly one managed generated PDF through Chrome's file-input protocol", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const transport: TrustedInputTransport = {
      activateTab: async (tabId) => { calls.push(["activate", tabId]); },
      attach: async (tabId) => { calls.push(["attach", tabId]); },
      detach: async (tabId) => { calls.push(["detach", tabId]); },
      sendCommand: async (tabId, method, params) => {
        calls.push(["command", tabId, method, params]);
        if (method === "Runtime.evaluate") return { result: { objectId: "file-input-object" } };
        return {};
      },
    };
    const fileName = "Taylor_Rivera_Product_Designer_Resume_v1.pdf";

    await expect(attachTrustedLinkedInResume(
      42,
      `/Users/test/Downloads/RapidApply/${fileName}`,
      fileName,
      transport,
    )).resolves.toEqual({ ok: true, fileName });

    expect(calls.map(([kind, , method]) => kind === "command" ? `${kind}:${method}` : kind)).toEqual([
      "activate",
      "attach",
      "command:Runtime.evaluate",
      "command:DOM.setFileInputFiles",
      "command:Runtime.callFunctionOn",
      "detach",
    ]);
    const attachment = calls.find((call) => call[2] === "DOM.setFileInputFiles");
    expect(attachment?.[3]).toEqual({
      files: [`/Users/test/Downloads/RapidApply/${fileName}`],
      objectId: "file-input-object",
    });
  });

  it("refuses arbitrary local file attachment paths", async () => {
    const transport: TrustedInputTransport = {
      activateTab: vi.fn(async () => undefined),
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({})),
    };

    await expect(attachTrustedLinkedInResume(
      42,
      "/Users/test/Documents/other.pdf",
      "Taylor_Rivera_Product_Designer_Resume_v1.pdf",
      transport,
    )).resolves.toEqual({
      ok: false,
      reason: "RapidApply rejected a resume outside its managed download folder.",
    });
    expect(transport.attach).not.toHaveBeenCalled();
  });

  it("dispatches exactly one bounded Easy Apply click and detaches immediately", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const transport: TrustedInputTransport = {
      activateTab: async (tabId) => { calls.push(["activate", tabId]); },
      attach: async (tabId) => { calls.push(["attach", tabId]); },
      detach: async (tabId) => { calls.push(["detach", tabId]); },
      sendCommand: async (tabId, method, params) => {
        calls.push(["command", tabId, method, params]);
        if (method === "Runtime.evaluate") {
          return { result: { value: { ok: true, x: 120.5, y: 240.5 } } };
        }
        return {};
      },
    };

    await expect(clickTrustedLinkedInAction("open_easy_apply", 42, transport))
      .resolves.toEqual({ ok: true });

    expect(calls.map(([kind, , method]) => kind === "command" ? `${kind}:${method}` : kind)).toEqual([
      "activate",
      "attach",
      "command:Runtime.evaluate",
      "command:Input.dispatchMouseEvent",
      "command:Input.dispatchMouseEvent",
      "command:Input.dispatchMouseEvent",
      "command:Runtime.evaluate",
      "command:Input.dispatchKeyEvent",
      "command:Input.dispatchKeyEvent",
      "detach",
    ]);
    const probe = calls.find((call) => call[0] === "command" && call[2] === "Runtime.evaluate");
    expect(probe?.[3]).toEqual(expect.objectContaining({ returnByValue: true }));
    expect((probe?.[3] as Record<string, unknown>).awaitPromise).toBeUndefined();

    const inputCommands = calls
      .filter((call) => call[0] === "command" && call[2] === "Input.dispatchMouseEvent")
      .map((call) => call[3] as { type: string; button: string; x: number; y: number });
    expect(inputCommands).toEqual([
      { type: "mouseMoved", button: "none", buttons: 0, pointerType: "mouse", x: 120.5, y: 240.5 },
      { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, pointerType: "mouse", x: 120.5, y: 240.5 },
      { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, pointerType: "mouse", x: 120.5, y: 240.5 },
    ]);
  });

  it("never sends browser input when the fixed Easy Apply probe cannot verify a target", async () => {
    const sendCommand = vi.fn(async () => ({ result: { value: { ok: false } } }));
    const detach = vi.fn(async () => undefined);
    const transport: TrustedInputTransport = {
      activateTab: vi.fn(async () => undefined),
      attach: vi.fn(async () => undefined),
      detach,
      sendCommand,
    };

    await expect(clickTrustedLinkedInAction("open_easy_apply", 42, transport))
      .resolves.toEqual({
        ok: false,
        reason: "RapidApply could not locate a visible Easy Apply control.",
      });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenLastCalledWith(42, "Runtime.evaluate", expect.any(Object));
    expect(detach).toHaveBeenCalledWith(42);
  });

  it("times out and detaches if Chrome leaves a trusted command unresolved", async () => {
    const detach = vi.fn(async () => undefined);
    const transport: TrustedInputTransport = {
      activateTab: vi.fn(async () => undefined),
      attach: vi.fn(async () => undefined),
      detach,
      sendCommand: vi.fn(() => new Promise(() => undefined)),
    };

    await expect(clickTrustedLinkedInAction("open_easy_apply", 42, transport, { timeoutMs: 5 }))
      .resolves.toEqual({
        ok: false,
        reason: "RapidApply's trusted browser input timed out before LinkedIn confirmed the action.",
      });

    expect(detach).toHaveBeenCalledWith(42);
  });

  it("turns an occupied browser debugging session into an actionable pause reason", async () => {
    const transport: TrustedInputTransport = {
      activateTab: vi.fn(async () => undefined),
      attach: vi.fn(async () => {
        throw new Error("Another debugger is already attached to the tab");
      }),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({})),
    };

    await expect(clickTrustedLinkedInAction("open_easy_apply", 42, transport))
      .resolves.toEqual({
        ok: false,
        reason: "RapidApply could not use trusted browser input because this LinkedIn tab is already being inspected. Close that tab's developer tools and retry.",
      });
  });
});
