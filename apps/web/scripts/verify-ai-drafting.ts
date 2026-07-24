import "../src/server/db/config";
import { createProfileSummaryDraft } from "../src/server/ai/profile-summary-draft";

async function main(): Promise<void> {
  const draft = await createProfileSummaryDraft({
    headline: "Product designer focused on B2B SaaS workflows",
    location: "Remote",
    summary: "Designs clear product experiences and collaborates with product teams.",
  });

  if (!draft.summary.trim()) {
    throw new Error("The provider returned an empty summary draft.");
  }

  // Deliberately do not print generated content, source data, or credentials.
  console.log(`AI summary drafting verified with ${draft.provider} / ${draft.model}.`);
}

main().catch(() => {
  console.error("AI summary drafting verification failed. Check provider configuration and connectivity.");
  process.exitCode = 1;
});
