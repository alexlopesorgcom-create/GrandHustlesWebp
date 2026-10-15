"use strict";

// Server-only Resend transport. Not called until the email outbox worker is enabled.
// Never expose RESEND_API_KEY to browser bundles or commit it to Git.
async function sendWithResend(message, options = {}) {
  const key = options.apiKey || process.env.RESEND_API_KEY;
  const from = options.from || process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new Error("Resend is not configured");
  if (!message || typeof message.to !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to) ||
      typeof message.subject !== "string" || !message.subject ||
      typeof message.html !== "string" || !message.html) {
    throw new Error("Invalid email message");
  }
  const headers = {
    Authorization: "Bearer " + key,
    "Content-Type": "application/json"
  };
  if (options.idempotencyKey) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(options.idempotencyKey)) {
      throw new Error("Invalid email idempotency key");
    }
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const fetcher = options.fetch || fetch;
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from, to: [message.to], subject: message.subject,
      html: message.html, text: message.text || undefined
    })
  });
  if (!response.ok) throw new Error("Resend delivery request failed: " + response.status);
  const result = await response.json();
  if (!result || typeof result.id !== "string") throw new Error("Resend returned no message ID");
  return result.id;
}
module.exports = { sendWithResend };
