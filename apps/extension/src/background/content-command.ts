export type ContentCommandResult<T> =
  | { kind: "response"; value: T }
  | { kind: "timeout" }
  | { kind: "error"; reason: string };

/**
 * A content-script response is a control-plane acknowledgement, not proof
 * that a third-party page changed. Keep that acknowledgement bounded so a
 * stale or interrupted content-script port cannot strand the campaign before
 * its independent page-state observer has a chance to recover.
 */
export function waitForContentCommand<T>(
  send: () => Promise<T>,
  {
    timeoutMs,
    fallbackReason = "RapidApply could not reach the LinkedIn page helper.",
  }: {
    timeoutMs: number;
    fallbackReason?: string;
  },
): Promise<ContentCommandResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ContentCommandResult<T>) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = globalThis.setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

    void send().then(
      (value) => finish({ kind: "response", value }),
      (error: unknown) => finish({
        kind: "error",
        reason: error instanceof Error && error.message
          ? error.message.slice(0, 300)
          : fallbackReason,
      }),
    );
  });
}
