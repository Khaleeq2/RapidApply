import type { AdapterObservation, SiteAdapter } from "../src/adapters/types";
import { startPageObserver } from "../src/observer/page-observer";

const observation: AdapterObservation = {
  adapterId: "fixture",
  adapterVersion: "1",
  observedAt: "2026-07-22T00:00:00.000Z",
  pageType: "job_detail",
  path: "/jobs/view/1/",
  queryKeys: [],
  title: "Fixture job",
  fingerprint: "12345678",
  fields: [],
  actions: [],
  validationMessages: [],
};

const adapter: SiteAdapter = {
  id: "fixture",
  version: "1",
  matches: () => true,
  inspect: () => observation,
  checkpoint: () => ({
    name: "fixture-observation",
    attempt: 1,
    updatedAt: "2026-07-22T00:00:00.000Z",
  }),
};

describe("page observer delivery", () => {
  it("returns a positive flush acknowledgement only when the observation is delivered", async () => {
    const onObservation = vi.fn(async () => true);
    const controller = startPageObserver({
      adapter,
      document,
      location: window.location,
      onObservation,
      heartbeatMs: 60_000,
    });

    await expect(controller.flush()).resolves.toBe(true);
    controller.stop();
  });

  it("returns a negative flush acknowledgement when the page helper cannot deliver", async () => {
    const onObservation = vi.fn(async () => false);
    const controller = startPageObserver({
      adapter,
      document,
      location: window.location,
      onObservation,
      heartbeatMs: 60_000,
    });

    await expect(controller.flush()).resolves.toBe(false);
    controller.stop();
  });

  it("stops its heartbeat and delivery loop when the content-script runtime is aborted", async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = new AbortController();
      const onObservation = vi.fn(async () => true);
      const controller = startPageObserver({
        adapter,
        document,
        location: window.location,
        onObservation,
        heartbeatMs: 25,
        signal: lifecycle.signal,
      });

      await vi.advanceTimersByTimeAsync(0);
      const callsBeforeAbort = onObservation.mock.calls.length;
      expect(callsBeforeAbort).toBeGreaterThan(0);

      lifecycle.abort();
      await expect(controller.flush()).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(200);

      expect(onObservation).toHaveBeenCalledTimes(callsBeforeAbort);
    } finally {
      vi.useRealTimers();
    }
  });
});
