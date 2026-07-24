interface AuthEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Local development keeps email delivery free and observable. Production can
 * use Resend without adding a provider SDK to the application bundle.
 */
export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const mode = process.env.AUTH_EMAIL_MODE ?? (process.env.NODE_ENV === "production" ? "resend" : "console");

  if (mode === "console") {
    console.info(`[RapidApply auth email] ${email.subject} -> ${email.to}\n${email.text}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL are required when AUTH_EMAIL_MODE=resend.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the auth email with status ${response.status}.`);
  }
}
