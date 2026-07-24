import { sendReviewOnlyFillWithRetry } from "../src/observer/review-only-fill-message";

describe("review-only fill message delivery", () => {
  it("retries a not-yet-ready page helper and returns its valid result", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Receiving end does not exist."))
      .mockRejectedValueOnce(new Error("The message port closed before a response was received."))
      .mockResolvedValueOnce({
        ok: true,
        result: {
          appliedFieldKeys: ["phone"],
          alreadySatisfiedFieldKeys: [],
          blocked: [],
        },
      });
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(sendReviewOnlyFillWithRetry({ plans: [], send, wait })).resolves.toEqual({
      ok: true,
      result: {
        appliedFieldKeys: ["phone"],
        alreadySatisfiedFieldKeys: [],
        blocked: [],
      },
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "rapidapply.apply-review-only-answers",
      plans: [],
    });
    expect(wait).toHaveBeenNthCalledWith(1, 150);
    expect(wait).toHaveBeenNthCalledWith(2, 300);
  });

  it("does not retry a semantic fill failure", async () => {
    const send = vi.fn().mockResolvedValue({
      ok: false,
      reason: "A phone number still needs user input.",
    });
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(sendReviewOnlyFillWithRetry({ plans: [], send, wait })).resolves.toEqual({
      ok: false,
      reason: "A phone number still needs user input.",
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails closed after incomplete page-helper responses", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, result: {} });
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(sendReviewOnlyFillWithRetry({ plans: [], send, wait })).resolves.toEqual({
      ok: false,
      reason: "RapidApply received an incomplete response from its LinkedIn page helper.",
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("reports a specific reason when the page helper never becomes reachable", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Receiving end does not exist."));
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await expect(sendReviewOnlyFillWithRetry({ plans: [], send, wait })).resolves.toEqual({
      ok: false,
      reason: "RapidApply is waiting for its LinkedIn page helper to become ready.",
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
