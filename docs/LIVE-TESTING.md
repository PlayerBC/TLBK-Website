# Test ordering on the existing website

Brent has chosen to test the ordering system at https://thelittlebakerkitchen.com.
Use this guide instead of the private-preview addresses in SETUP.md.

## Current progress

- The existing website works over HTTPS. The www address redirects to the root domain.
- GitHub Pages publishes the original repository's `main` branch, from `/(root)`.
- Cloudflare has four DNS-only GitHub A records at the root and a DNS-only www CNAME to `brentchuatlbk.github.io`.
- The ordering draft is connected to the TLB Kitchen System Supabase project.
- All three backend functions are deployed. Email signup and email confirmation are enabled.
- Automatic processing is active every five minutes. The first two scheduled runs succeeded, and their worker requests returned HTTP 200. The empty-queue worker check also completed with no errors and no emails sent.
- Ordering is paused. No bakery accounts, owners, products or orders exist yet.
- The ordering pages have not been published: `/shop.html` and `/account.html` currently return 404.

These are setup checks, not proof that a customer order or email delivery works.

## 1. Connect the live address

In **Supabase → TLB Kitchen System → Authentication → URL Configuration**, save:

| Field | Copy this value |
| --- | --- |
| Site URL | `https://thelittlebakerkitchen.com/` |
| Redirect URL, first entry | `https://thelittlebakerkitchen.com/auth-callback.html` |
| Redirect URL, second entry | `https://thelittlebakerkitchen.com/reset-password.html` |

Add the redirects separately, without wildcards. This live-only testing route does not need preview redirects.
Keep email signup and Confirm email enabled. Keep the default confirmation and recovery
templates, including `{{ .ConfirmationURL }}`, intact.

Next, open **Edge Functions → Secrets** and edit `ALLOWED_ORIGINS` to this single value:

```text
https://thelittlebakerkitchen.com
```

Save it with no spaces or trailing slashes. The live origin was rejected during the
pre-publication check; payment-proof upload and private receipt viewing need this setting.
The www address redirects to the root, so a separate www entry is not needed.

The backend **Ordering website URL** already uses `https://thelittlebakerkitchen.com`.
Keep that address when saving Shop settings later.

**You are done when:** the three Auth URLs are saved and the live origin passes the
upload preflight check. This chat cannot directly edit Auth URL settings or Edge Function
secrets; Brent saves those in the Supabase dashboard.

## 2. Publish the prepared ordering pages

The connected GitHub account can write to `PlayerBC/TLBK-Website`, but has read-only
access to `BrentChuaTLBK/bakery-website`. GitHub rejected creating the original-repository
pull request through this connection. The original repository owner must create and merge
that request, or grant the connected account the needed repository and app permissions.

Sign into GitHub as **BrentChuaTLBK**, then open:

https://github.com/BrentChuaTLBK/bakery-website/compare/main...PlayerBC:development/ordering-system?expand=1

Check these selections before creating the pull request:

| Field | Select |
| --- | --- |
| Base repository | `BrentChuaTLBK/bakery-website` |
| Base branch | `main` |
| Head repository | `PlayerBC/TLBK-Website` |
| Compare branch | `development/ordering-system` |

If GitHub does not show both repositories, choose **compare across forks** and select
the values above. Use **Add ordering system for supervised testing** as the title.

The draft PR #1 in PlayerBC/TLBK-Website targets only the fork's main branch.
Merging that PR alone does not publish to the original website.

Review and merge the original-repository PR, then wait for the Pages deployment to finish.
Publishing these files adds the order pages and Order Online navigation links; the backend's
Pause new orders setting remains on.

**You are done when:** these pages open and use the connected project:

- https://thelittlebakerkitchen.com/shop.html
- https://thelittlebakerkitchen.com/account.html
- https://thelittlebakerkitchen.com/manage.html

Keep the existing GitHub Pages source, custom domain and Cloudflare website records.

## 3. Create your bakery administrator account

After publication:

1. Open https://thelittlebakerkitchen.com/account.html.
2. Choose **Create account** and use an inbox you control with a password of at least 10 characters.
3. Open the verification email, confirm the address, and sign in.
4. Tell your assistant the exact email address you registered. Do not send your password.
   Owner access will be assigned only to that verified account.
5. Open https://thelittlebakerkitchen.com/manage.html.

Your Supabase service login does not automatically create a bakery administrator account.

**You are done when:** your verified bakery account can open and use the manager dashboard.

## 4. Prepare the first order

Follow **Step 8 of SETUP.md** for the labelled test product, dated quantity and delivery zone.
Use `https://thelittlebakerkitchen.com/` as the Ordering website URL.

Keep **Pause new orders** checked while setting up. Enter clearly labelled test payment
instructions; no bank transfer is needed for the test.

Automatic processing is already configured in TLB Kitchen System. The job
`tlb-order-maintenance-and-email` is active with schedule `*/5 * * * *`.
Its worker authenticated and completed an empty-queue test successfully. You can skip
recreating Step 9 for this project. Fulfillment reminders remain disabled until you choose
to enable them in Shop settings.

Then follow **Step 10 of SETUP.md**, using the live shop address:

https://thelittlebakerkitchen.com/shop.html

Use only inboxes you control. Expected totals are **PHP 100.00 for pickup** and
**PHP 150.00 for the configured delivery test**. Check the saved order, upload a test
receipt, approve full payment, verify stock counts and confirm actual inbox delivery.
Pause new orders again after testing.

**You are done when:** both customer and manager see the same saved order and payment
state, the private receipt opens correctly, and the actual emails arrive with working links.
Continue through ACCEPTANCE.md before approving the system for ordinary customer orders.

## Restore point

The original main commit before publication is:

`571de6e9fcb51a70bafc1483a0b6fe11752f5198`

A matching restore branch is saved at:

https://github.com/PlayerBC/TLBK-Website/tree/backup/live-before-ordering-20260914

The draft preserves the existing CNAME, photographs and styling. Existing brochure pages
receive Order Online navigation links. Reverting a publication merge restores the previous
website files; Supabase settings and saved orders are separate.

## Scheduler implementation notes

The project uses Supabase Cron, pg_net and Vault. The worker token is read inside the
database when scheduling a request; it is not stored in GitHub or shown in this guide.
Vault holds `tlb_project_url`, `tlb_publishable_key` and `tlb_email_worker_token`.

The `net` schema is not exposed through the Data API. A browser-role request for it
was rejected with HTTP 406 / PGRST106. Keep the API exposed schemas unchanged.
This is the boundary protecting the managed request queue from the website.

A permission-hardening migration was recorded. Cron restrictions took effect; the
`net` revokes could not remove grants issued by Supabase's managed owner. Do not treat
that migration as proof of restricted SQL-role access to `net`. The connected
`postgres` role does not own those managed objects. Do not expose `net` or add an
arbitrary-SQL RPC; further changes to managed grants require Supabase support.

Queued messages and real orders are still empty. The worker test verifies connectivity
and maintenance, not delivery to an inbox.

## References

- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)
