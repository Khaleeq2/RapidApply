import { flushObservationAfterResume } from "../src/observer/observation-flush";

describe("resumed observation flush", () => {
  const inject = vi.fn(async () => undefined);

  beforeEach(() => inject.mockClear());

  it("flushes the live content script without reloading its tab", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject, reload })).resolves.toBe("flushed");
    expect(send).toHaveBeenCalledWith({ type: "rapidapply.flush-observation" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("reinjects the observer when extension reload removed its content script", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ ok: true });
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject, reload })).resolves.toBe("injected");
    expect(inject).toHaveBeenCalledWith(42);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the stored executor tab when Chrome returns no content-script acknowledgement", async () => {
    const send = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject: async () => { throw new Error("inject failed"); }, reload })).resolves.toBe("reloaded");
    expect(reload).toHaveBeenCalledWith(42);
  });

  it("reloads the stored executor tab when the old page helper reports an invalidated runtime", async () => {
    const send = vi.fn(async () => ({ ok: false, reason: "runtime_unavailable" }));
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject: async () => { throw new Error("inject failed"); }, reload })).resolves.toBe("reloaded");
    expect(reload).toHaveBeenCalledWith(42);
  });

  it("does not reload when a live content script explicitly reports a flush failure", async () => {
    const send = vi.fn(async () => ({ ok: false }));
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject, reload })).resolves.toBe("unavailable");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload for an unrelated page transport failure", async () => {
    const send = vi.fn(async () => {
      throw new Error("The browser is shutting down.");
    });
    const reload = vi.fn(async () => undefined);

    await expect(flushObservationAfterResume({ tabId: 42, send, inject, reload })).resolves.toBe("unavailable");
    expect(reload).not.toHaveBeenCalled();
  });

  it("fails closed when the exact-tab reload cannot be started", async () => {
    const send = vi.fn(async () => {
      throw new Error("Receiving end does not exist.");
    });
    const reload = vi.fn(async () => {
      throw new Error("No tab with id: 42.");
    });

    await expect(flushObservationAfterResume({ tabId: 42, send, inject: async () => { throw new Error("inject failed"); }, reload })).resolves.toBe("unavailable");
    expect(reload).toHaveBeenCalledWith(42);
  });
});
