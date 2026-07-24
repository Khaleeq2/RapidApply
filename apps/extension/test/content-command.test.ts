import { waitForContentCommand } from "../src/background/content-command";

describe("waitForContentCommand", () => {
  it("returns the content-script acknowledgement", async () => {
    await expect(waitForContentCommand(
      async () => ({ ok: true }),
      { timeoutMs: 50 },
    )).resolves.toEqual({ kind: "response", value: { ok: true } });
  });

  it("captures a rejected command without leaving the controller pending", async () => {
    await expect(waitForContentCommand(
      async () => { throw new Error("receiving end does not exist"); },
      { timeoutMs: 50 },
    )).resolves.toEqual({ kind: "error", reason: "receiving end does not exist" });
  });

  it("bounds an acknowledgement that never arrives", async () => {
    await expect(waitForContentCommand(
      () => new Promise<never>(() => undefined),
      { timeoutMs: 1 },
    )).resolves.toEqual({ kind: "timeout" });
  });
});
