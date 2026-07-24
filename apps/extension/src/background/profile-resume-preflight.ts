import { attachTrustedLinkedInResume } from "./trusted-input";

export interface ProfileResumePreflightResult {
  ok: boolean;
  action: "already_exists" | "uploaded" | "failed";
  reason?: string;
}

/**
 * Inspects or uploads the candidate's target resume on LinkedIn's Application Settings page
 * before campaign execution begins. Bypasses Finder dialogs during active job applications.
 */
export async function ensureLinkedInProfileResumeUploaded(
  tabId: number,
  absolutePath: string,
  fileName: string,
): Promise<ProfileResumePreflightResult> {
  try {
    // Edge Case 1 & 2: Check if target resume is ALREADY uploaded on LinkedIn Settings
    try {
      const check = await chrome.tabs.sendMessage(tabId, {
        type: "rapidapply.check-profile-resume",
        fileName,
      });
      if (check && (check as { verified?: boolean }).verified) {
        return { ok: true, action: "already_exists" };
      }
    } catch {
      // Tab may still be loading
    }

    const attached = await attachTrustedLinkedInResume(tabId, absolutePath, fileName);
    if (!attached.ok) {
      return { ok: false, action: "failed", reason: attached.reason };
    }

    // Poll up to 5,000ms (25 attempts x 200ms) for LinkedIn to finish async upload
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        const verified = await chrome.tabs.sendMessage(tabId, {
          type: "rapidapply.verify-resume-attachment",
          fileName,
        });
        if (verified && (verified as { verified?: boolean }).verified) {
          return { ok: true, action: "uploaded" };
        }
      } catch {
        // Tab may still be processing
      }
    }

    return {
      ok: false,
      action: "failed",
      reason: "LinkedIn did not confirm the profile resume upload.",
    };
  } catch (error) {
    return {
      ok: false,
      action: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
