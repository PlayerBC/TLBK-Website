# Branded account confirmation email

The signup confirmation template is [supabase/templates/confirmation.html](../supabase/templates/confirmation.html). It uses TLB's existing public logo, cream background, brown confirmation button, and a single-column layout for mobile and desktop. The subject is **Confirm your email | The Little Baker Kitchen**.

Both confirmation links retain Supabase's `{{ .ConfirmationURL }}` placeholder. Supabase generates the recipient's verification link when it sends the message. This template does not change account verification, redirects, newsletter consent, or welcome-code eligibility. Newsletter subscribers still join immediately; this email confirms a newly created customer account.

## Live acceptance · September 23, 2026

The owner saved the hosted template. A fresh signup at 15:51 UTC received the branded message from `orders@thelittlebakerkitchen.com`; Resend reported delivery. The actual sent HTML included the existing public logo URL and both confirmation links. Rendering that HTML loaded the logo successfully. The emailed confirmation link verified the temporary account, sign-in worked, and the test session was signed out before removing the account. Earlier test emails still used the default template; the later branded message confirms the saved version is now active.

The logo was reported missing in Supabase's dashboard preview. The public image returned HTTP 200 with valid PNG data with no referrer, a Supabase referrer, and a Gmail referrer. The actual delivered HTML rendered it correctly in Chrome. This verifies the asset and HTML; it is not a screenshot of Gmail's inbox rendering.

## Apply to the hosted project

1. Open **Authentication → Email Templates → Confirm signup** in the [TLB Supabase project](https://supabase.com/dashboard/project/aulhqofjjckwwjmdvqgi/auth/templates).
2. Set the subject to **Confirm your email | The Little Baker Kitchen**.
3. Replace the HTML body with the complete contents of `supabase/templates/confirmation.html`, including the unchanged `{{ .ConfirmationURL }}` placeholders.
4. Preview and save the template.
5. Create a fresh test account using an owner-controlled email, confirm receipt and appearance, and follow its confirmation button. Confirm sign-in works. Already-sent emails keep their original appearance.

Use the existing Resend SMTP configuration and `orders@thelittlebakerkitchen.com` sender for account emails. The newsletter uses `news@thelittlebakerkitchen.com` independently.

Hosted Auth templates are stored in Supabase, separately from the website. Publishing this repository does not update the hosted email template. The connected database/Edge tools cannot edit Auth email configuration; future changes also need to be saved through the dashboard. Do not push the full local `config.toml` to production: its development URLs are intentionally localhost.

## Local preview

The confirmation entry in `supabase/config.toml` loads this HTML for the local Supabase stack. For a browser preview, replace `{{ .ConfirmationURL }}` with an inert example URL in a separate copy. Keep the source template unchanged. The body uses inline email-compatible table layouts, system font fallbacks, image alt text, and a mobile-width button. Its core content and action work with remote images blocked.

References: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [local template configuration](https://supabase.com/docs/guides/local-development/customizing-email-templates).
