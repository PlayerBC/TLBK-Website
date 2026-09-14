# Optional services and costs

The website remains static HTML/CSS/JavaScript. Supabase provides persistent ordering data, accounts, private proof storage, protected server functions, and scheduled jobs. Resend delivers account emails through Supabase SMTP and order emails through its HTTPS API. There is no payment gateway or courier integration.

No account, paid plan, domain purchase, email send, or external backend has been activated by this implementation. The owner completes the setup in [SETUP.md](SETUP.md). A disconnected preview cannot prove persistence, account email receipt, or scheduled delivery.

Prices checked against official pages on September 12, 2026; amounts below are USD service charges, separate from the shop's PHP prices. Confirm the displayed plan and taxes before accepting billing.

| Service | Suitable free option | Material limitations | Optional paid starting point |
|---|---|---|---|
| Supabase | $0/month; 2 active projects; 500 MB database/project; 50,000 monthly active Auth users; 1 GB storage; 5 GB uncached + 5 GB cached egress; 500,000 Edge invocations | Pauses after a week of inactivity. No automatic backups or uptime SLA. | Pro from $25/month for first project; additional projects from $10/month; usage charges may apply. |
| Resend transactional email | $0/month; 3,000 emails/month; 100/day; 3 verified domains | Daily cap resets at midnight UTC. Each recipient counts separately, including CC/BCC; inbound email also counts. Auth and order mail share the account quota. | Pro $20/month for 50,000 emails; no daily cap; additional emails $0.90/1,000 on paid plans. |
| Sending domain | An existing domain you own can be used | You need DNS access. A shared preview hostname is not an owned email domain. | If needed, the owner purchases a domain separately; registrar price varies. |

Sources: [Supabase pricing](https://supabase.com/pricing), [Resend pricing](https://resend.com/pricing), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).

Supabase custom SMTP is available on Free. Its bundled test sender only emails organization team addresses, currently at two messages/hour. Custom SMTP starts with a separate 30 messages/hour Supabase limit, adjustable in Auth Rate Limits; Resend limits still apply. General customer verification and resets therefore require custom SMTP. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Resend requires an owned, verified sending domain for ordinary recipients. `onboarding@resend.dev` is restricted to the Resend account's own address and cannot serve customer email generally. Use a sending subdomain and the exact generated DNS records. [Domain verification](https://resend.com/docs/add-a-domain), [test-domain limitation](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

At three customer messages per completed order (submission, approval, reminder), 33 orders use 99 emails; account mail and readiness/cancellation notices reduce that daily capacity. This is an illustrative calculation, not a traffic guarantee. Free quotas can stop sending. A free Supabase project that pauses also stops backend jobs, so the owner must monitor the test project and choose any production upgrade themselves.

The worker runs in short batches. Free Edge Functions have 256 MB RAM, a 150-second worker limit, and two seconds actual CPU per request. A five-minute cron schedule is 8,928 worker invocations in a 31-day month before manual runs (calculation), within the free invocation allowance. [Function limits](https://supabase.com/docs/guides/functions/limits), [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).

Queued messages are stored durably. A provider ID records that Resend accepted a message; it does not prove inbox receipt. The worker reuses an event key for retries, and the database remembers completion. Resend's idempotency window is 24 hours, so old uncertain attempts stop for investigation rather than automatically risking a duplicate. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

The application timezone is Asia/Manila. Resend's daily quota reset remains UTC; this corresponds to 8:00 AM Manila. No additional timezone service is needed. User-facing features use PHP to two decimal places, with integer centavos stored in the database.
