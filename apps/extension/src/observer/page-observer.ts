import type { AdapterObservation, SiteAdapter } from "../adapters/types";

export interface PageObserverOptions {
  adapter: SiteAdapter;
  document: Document;
  location: Location;
  onObservation: (observation: AdapterObservation) => boolean | void | Promise<boolean | void>;
  debounceMs?: number;
  heartbeatMs?: number;
  /**
   * Lifecycle signal from the content-script runtime. A content script can be
   * replaced while its page remains open (for example after an unpacked
   * extension reload), so every long-lived observer must stop with that old
   * runtime instead of continuing to send messages through it.
   */
  signal?: AbortSignal;
}

export interface PageObserverController {
  flush(): Promise<boolean>;
  stop(): void;
}

/**
 * LinkedIn is an SPA, so URL and modal states can change without a full page
 * navigation. Mutations trigger debounced inspection; a low-frequency heartbeat
 * recovers from changes that do not touch the observed DOM subtree.
 */
export function startPageObserver({
  adapter,
  document,
  location,
  onObservation,
  debounceMs = 350,
  heartbeatMs = 5_000,
  signal,
}: PageObserverOptions): PageObserverController {
  let timeout: number | undefined;
  let heartbeat: number | undefined;
  let stopped = false;
  let lastFingerprint: string | null = null;
  let lastUrl = location.href;
  let delivery = Promise.resolve(true);

  const hasStopped = () => stopped || signal?.aborted === true;

  const inspect = async (force = false): Promise<boolean> => {
    if (hasStopped()) {
      stop();
      return false;
    }
    const url = new URL(location.href);
    if (!adapter.matches(url)) return false;
    const observation = adapter.inspect({ document, url });
    if (!force && observation.fingerprint === lastFingerprint && location.href === lastUrl) return true;
    lastFingerprint = observation.fingerprint;
    lastUrl = location.href;
    delivery = delivery
      .then(async () => {
        if (hasStopped()) return false;
        const delivered = await onObservation(observation);
        if (hasStopped() || delivered === false) {
          // A content-script runtime can be invalidated while its page remains
          // open. Stop the heartbeat after the first failed delivery; keeping
          // it alive only floods the console and hides the real transition
          // failure behind an endless stream of identical observations.
          stop();
          return false;
        }
        return true;
      })
      .catch(() => {
        stop();
        return false;
      });
    return delivery;
  };

  const schedule = () => {
    if (hasStopped()) {
      stop();
      return;
    }
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => void inspect(), debounceMs);
  };

  const mutationObserver = new MutationObserver(schedule);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver.disconnect();
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("hashchange", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("input", schedule, true);
    document.removeEventListener("change", schedule, true);
    document.removeEventListener("click", schedule, true);
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    if (timeout !== undefined) window.clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
  };

  if (!hasStopped()) {
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-disabled", "aria-expanded", "aria-hidden", "class", "disabled", "value"],
    });

    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);
    document.addEventListener("click", schedule, true);
    heartbeat = window.setInterval(() => void inspect(true), heartbeatMs);
    signal?.addEventListener("abort", stop, { once: true });
    void inspect(true);
  } else {
    stop();
  }

  return {
    flush: () => inspect(true),
    stop,
  };
}
