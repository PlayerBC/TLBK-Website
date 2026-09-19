import { constantTimeEqual, env, HttpError, json, service } from "../_shared/server.ts";
import { renderEmail } from "../_shared/emails.ts";
import { newsletterWelcomeAllowed } from "../_shared/newsletter-welcome.ts";

// This endpoint has its own non-public worker credential. It does not accept a
// browser user, anonymous key, or order token as authority to send messages.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const secret = env("EMAIL_WORKER_TOKEN");
  const provided = request.headers.get("x-worker-token") || "";
  if (secret.length < 32) return json({ error: "Email worker authorization is not configured." }, 503);
  if (!constantTimeEqual(provided, secret)) return json({ error: "Worker authorization required." }, 401);
  const stats = { accepted: 0, skipped: 0, failed: 0, acknowledgement_pending: 0, maintenance: null as any };
  try {
    stats.maintenance = await service("maintenance", {}, 8000);
    const claimed = await service("claim_emails", { limit: 3 }, 8000);
    if (!Array.isArray(claimed)) throw new Error("Invalid claim response");
    for (const row of claimed) {
      let accepted = false;
      try {
        const firstAttempt = row.first_attempt_at || row.created_at;
        if (firstAttempt && Date.now() - new Date(firstAttempt).getTime() >= 23 * 60 * 60 * 1000) {
          await service("email_failed", { id: row.id, lease_token: row.lease_token, terminal: true, error: "Automatic retry stopped before the provider idempotency window expires. Check Resend logs before retrying manually." }, 8000);
          stats.failed++;
          continue;
        }
        const current = await service("prepare_email", { id: row.id, lease_token: row.lease_token }, 8000);
        if (current?.skip) { stats.skipped++; continue; }
        if (!current?.payload) throw new HttpError(503, "The leased message could not be validated before delivery.");
        const message = current;
        const welcome = message.payload.event_type === "newsletter_welcome";
        const key = (welcome && env("NEWSLETTER_RESEND_API_KEY")) || env("RESEND_API_KEY");
        const sender = (welcome && env("NEWSLETTER_FROM")) || env("EMAIL_FROM");
        if (!key || !sender) throw new HttpError(503, "Email delivery is waiting for RESEND_API_KEY and EMAIL_FROM configuration.");
        if (!message.to_email || !message.event_key) throw new HttpError(503, "The email outbox is missing a recipient or event key.");
        const rendered = renderEmail(message.payload);
        if (welcome && !await newsletterWelcomeAllowed(message.to_email, message.payload.topic_id, key)) {
          await service("email_skipped", { id: row.id, lease_token: row.lease_token, reason: "Newsletter recipient has opted out or no longer exists." }, 8000);
          stats.skipped++;
          continue;
        }
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": message.event_key },
          body: JSON.stringify({ from: sender, to: [message.to_email], subject: String(message.subject || "TLB Kitchen order update").replace(/[\r\n]/g, " "), ...rendered }),
          signal: AbortSignal.timeout(12000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id) {
          throw new HttpError(502, `Email provider did not accept this message (HTTP ${response.status}${typeof result?.name === "string" ? `, ${result.name.replace(/[^a-zA-Z0-9_-]/g, "")}` : ""}). Check sender verification, limits, and Resend logs.`);
        }
        accepted = true;
        // A provider ID means accepted for delivery, not proof of inbox receipt.
        await service("email_sent", { id: row.id, lease_token: row.lease_token, provider_id: result.id }, 8000);
        stats.accepted++;
      } catch (error) {
        const message = accepted ? "Provider accepted the message, but saving its acknowledgement failed. Retry the same event key; check Resend logs before manual intervention."
          : error instanceof HttpError ? error.message : "Temporary network or provider error. Delivery is unconfirmed; retry uses the same idempotency key.";
        if (accepted) stats.acknowledgement_pending++;
        stats.failed++;
        try { await service("email_failed", { id: row.id, lease_token: row.lease_token, error: message }, 8000); }
        catch { /* The lease expires so a later worker can retry the same key. */ }
      }
    }
    return json(stats, !env("RESEND_API_KEY") || !env("EMAIL_FROM") ? 503 : 200);
  } catch {
    return json({ ...stats, error: "Email maintenance could not complete. Check the Edge Function and database setup; unacknowledged leases remain retryable." }, 503);
  }
});
