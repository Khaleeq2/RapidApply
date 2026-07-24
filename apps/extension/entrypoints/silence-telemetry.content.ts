import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["https://www.linkedin.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") return;

    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request)?.url ?? "";

      if (url.startsWith("chrome-extension:") && url.includes("invalid")) {
        return Promise.resolve(new Response(null, { status: 200, statusText: "OK" }));
      }

      return originalFetch.call(this, input, init);
    };
  },
});
