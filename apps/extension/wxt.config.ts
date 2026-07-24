import { defineConfig } from "wxt";

export default defineConfig({
  manifest: () => ({
      name: "RapidApply Browser Helper",
      description: "Connects your RapidApply campaign to a supported browser workflow.",
      version: "0.1.0",
      // Some modern pages ignore synthetic DOM click events. The debugger
      // transport is limited in code to a static allowlist of non-submit actions
      // and detached after each verified action.
      permissions: [
        "storage",
        "unlimitedStorage",
        "debugger",
        "downloads",
        "scripting",
      ],
      host_permissions: [
        "http://localhost:3000/*",
        "http://localhost:3001/*",
        "https://rapidapply.so/*",
        "https://www.rapidapply.so/*",
        "https://www.linkedin.com/*",
      ],
    }),
});
