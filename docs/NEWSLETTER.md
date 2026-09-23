# TLB newsletter setup and acceptance

The newsletter is for new products, seasonal menus, and promotions. Account verification and order/payment/pickup emails continue independently. This feature captures consent and manages preferences; it does not create or send a marketing campaign.

## Welcome discount and reporting · September 23, 2026

New subscriber addresses receive one unique code in their welcome email: 5% off products and option surcharges, minimum product subtotal PHP 300, maximum discount PHP 100, delivery excluded. It expires exactly 30 days after activation and allows one paid redemption. Checkout requires a verified account with the same email address; buyer form fields cannot satisfy that restriction. Existing promo reservation and cancellation rules apply.

New codes contain six uppercase letters/numbers, always with both types and without ambiguous I/O/0/1 characters. Generation retries collisions with any existing promo. Previously issued long codes remain valid. Signup leads with a bold **5% off** headline and a short invitation. Discount terms are in the welcome email, with the code prominent and conditions in aligned rows. The minimum is labelled **Minimum purchase**. Email-worker v15 contains this wording update.

The migration marks every existing subscriber row ineligible, including pending and previously unsubscribed addresses. Newly created rows default to eligible. Subscription activation, code issuance, the permanent subscriber-to-promo binding, and the welcome outbox entry commit together. Repeat signup or unsubscribe/rejoin cannot create a second code or reset its expiry. Old subscribers and rejoining subscribers still get the appropriate normal welcome without a new discount. Tokens and code details are not returned in public signup responses.

The owner dashboard separates **Regular promo codes** and **Newsletter welcome codes**. Newsletter reporting includes all issued codes, including ones later disabled or deleted. Used counts paid redemptions even after cancellation/refund; reserved counts unpaid uses awaiting payment/review. Active codes are currently available to redeem; expired unused codes exclude used or still-reserved codes. Product sales are current paid product subtotals less discounts, excluding delivery, cancelled/expired orders and full-refund labels. Discounts given follow those same eligible orders. Figures are all time; Refresh reloads order changes and expiry statuses update automatically while the page is open.

Backend deployed: migration `newsletter_welcome_discount` (remote version `20260923141444`, source `20260923140252_newsletter_welcome_discount.sql`), then `short_newsletter_welcome_codes` (remote version `20260923142529`, source `20260923141944_short_newsletter_welcome_codes.sql`), and email-worker v14. The newsletter endpoint remains v9. Deploy the email renderer before the SQL migrations on another environment, then publish the changed static files together. No existing subscribers were emailed. Live signup/issuance/report checks and two unique six-character code checks ran inside transactions and rolled back their fixtures; the six pre-existing subscriber records remained ineligible. Real inbox delivery was not exercised. Security advisories were unchanged.

Validation: 216 backend checks, 68 Edge tests, offer metric unit tests, desktop/mobile dashboard and newsletter tests, and product-description/flavor checks at 1440px, 390px and 320px. `npm run test:newsletter` includes welcome rendering and dashboard coverage; run backend checks separately with `npm run test:backend`.

## Immediate signup rollout · September 19, 2026

The immediate-subscription migration is installed, with newsletter Edge Function v9 and email-worker v12 active. Publish the matching homepage, shop, newsletter page, and account files together. The existing worker schedule runs every five minutes; welcome delivery uses that queue and may take a few minutes.

Validation: 169 database checks, 67 Edge tests, newsletter browser scenarios, and the static build pass. A production transaction verified activation plus one queued welcome and duplicate handling, then rolled back its fixture. Live inert requests verified the new response and rejected invalid email, unauthenticated preferences, and unauthorized worker calls. Existing subscriber, pending subscriber, order, and outbox counts were unchanged. Security advisor findings match the prior baseline. Real inbox delivery was not exercised during this rollout; no test email or campaign was sent.

## Customer behavior

- The homepage and `newsletter.html` offer a newsletter signup form. No account or purchase is required.
- Account signup has an optional, initially unchecked newsletter checkbox. Choosing the newsletter subscribes immediately and queues a welcome email. Account verification remains separate.
- Signed-in customers can subscribe or unsubscribe in **My account**. Saving a checked newsletter preference subscribes immediately; no confirmation email is required.
- The shop can show a dismissible signup popup after five seconds, once the page is ready and no product or checkout dialog is open. Closing it counts as having seen it.
- For a signed-in, verified account, a database record makes the popup a once-ever prompt across browsers/devices. For a guest, local browser storage records that it was shown without an expiry. Clearing storage, private browsing, or using another browser/device can show it again. When guest browser storage is unavailable, the popup is suppressed and the normal signup forms remain available. There is no anonymous cross-device identity tracking.
- Demo pages and order-status links do not show the popup. Customers can still subscribe through the normal form after dismissing it.

Submitting a valid form immediately opts the contact into the newsletter and records consent. The same database transaction activates the subscription and queues a welcome email. Repeat signup by an already active contact succeeds without another welcome. Welcome delivery uses the existing email worker with a stable event key, retry limits, and an unsubscribe link. An email delivery failure does not undo the subscription. Unsubscribe and provider suppression are rechecked before welcome delivery.

Already pending subscriptions are not bulk activated. Submitting a form again subscribes them immediately. Previously issued, unexpired confirmation links still work and require an explicit button click; opening a link alone never changes a preference. Account verification is unchanged.

The private outbox retains the welcome's unsubscribe token so every retry has the same body. Subscriber rows store only token hashes; browser responses never contain these tokens. The consent version is `tlb-newsletter-v2-single-opt-in`. Historical `confirmed` event/operation names now mean activation and do not imply email verification for this consent version.

## Resend configuration

Use these existing resources; do not recreate them or import all customers as subscribers.

| Setting | Value |
| --- | --- |
| Topic | `TLB Newsletter` |
| Topic ID | `6863284f-d41d-4ccf-b9a8-f6f196c4a4b6` |
| Topic default subscription | `opt_out` |
| Topic visibility | `private` (subscribed contacts can see it on their unsubscribe page) |
| Newsletter segment ID | `9c281ec2-ae4a-474a-8067-cf5afabc79a3` |
| Website origin | `https://thelittlebakerkitchen.com` |

On signup, the backend adds the contact to this segment and opts them into this topic. An account unsubscribe opts them out of this topic; segment membership can remain. Other topic subscriptions and global unsubscribe settings are preserved. A contact who previously opted out of all TLB marketing is not silently resubscribed: signup explains that they must use an existing Resend preference link or contact TLB to rejoin. Resolve that request only with the contact's consent.

Resend's global unsubscribe setting overrides individual topic preferences. An `opt_out` topic default requires explicit opt-in. [Resend topics](https://resend.com/docs/dashboard/topics/introduction), [unsubscribe preferences](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list).

The account page checks Resend when its stored state is subscribed, and records a provider opt-out locally. Broadcast recipient filtering remains Resend's responsibility even before the customer next visits their account.

## Deploy the backend before publishing the forms

Use the existing **TLB Kitchen System** Supabase project (`aulhqofjjckwwjmdvqgi`). Do not reset or reinstall the ordering database.

1. Apply the newsletter migrations in order, after their prerequisites: `supabase/migrations/20260918134354_newsletter_subscriptions.sql`, then `supabase/migrations/20260918165306_newsletter_durable_imports.sql`, then (after all ordering prerequisites) `supabase/migrations/20260919081558_newsletter_immediate_subscription.sql`. The first creates private newsletter configuration, subscriber, consent-event, and popup records plus the service-only RPC. The second records pending provider imports so retries cannot submit conflicting jobs. The last migration adds immediate signup and durable welcome delivery. Deploy the updated `email-worker` and shared modules before the updated `newsletter` function so queued welcomes have a renderer. Keep the existing worker schedule and custom token authorization. The `tlb` schema stays unexposed; browser roles receive no table or RPC access.
2. Set the resource IDs and production origin in SQL Editor:

   ```sql
   update tlb.newsletter_config
   set topic_id = '6863284f-d41d-4ccf-b9a8-f6f196c4a4b6',
       segment_id = '9c281ec2-ae4a-474a-8067-cf5afabc79a3',
       site_url = 'https://thelittlebakerkitchen.com'
   where singleton = true;
   ```

3. Configure the Edge Function secrets below. Enter secret values through Supabase's secret settings or your existing secure deployment process; do not put them in GitHub files, screenshots, frontend JavaScript, or chat.
4. Deploy `supabase/functions/newsletter/index.ts` as the **newsletter** Edge Function, including its shared module dependency. `supabase/config.toml` sets `[functions.newsletter] verify_jwt = false` so guests can subscribe and use previously issued links. Account actions still validate the bearer token with Supabase Auth inside the handler, and derive the email from the verified account.
5. Check the configuration with a controlled test inbox, then publish the frontend files together, including `newsletter.html`, the newsletter scripts/styles, and the homepage, shop, and account changes. A GitHub Pages publication alone does not install the SQL migration or Edge Function.

| Server setting | Purpose |
| --- | --- |
| `NEWSLETTER_RESEND_API_KEY` | Optional dedicated Resend **Full Access** API key for sending welcomes and managing contacts, topics, and segment membership. Preferred when set. |
| `RESEND_API_KEY` | Fallback when the newsletter-specific key is absent. An existing sending-only key is insufficient for contact/preferences operations. |
| `NEWSLETTER_FROM` | Optional verified sender address for newsletter welcomes, for example `TLB Kitchen <hello@YOUR_VERIFIED_DOMAIN>`. Preferred when set. |
| `EMAIL_FROM` | Existing verified sender used when `NEWSLETTER_FROM` is absent. |
| `ALLOWED_ORIGINS` | Comma-separated permitted website origins, including `https://thelittlebakerkitchen.com`. Preserve existing origins needed by the ordering functions. |
| Supabase server credentials | Existing project-provided URL and service-role/secret credentials; never a frontend setting. |

For a preview, use that preview's exact origin in the newsletter configuration and allowed origins so unsubscribe links return to the intended website. Restore the production origin before production acceptance. Do not change production email redirects merely to test an unrelated preview.

The current GitHub connector can write to `PlayerBC/TLBK-Website` but cannot push to `BrentChuaTLBK/bakery-website`. Deliver the change through a fork branch and a pull request against the original repository. The original repository owner must merge/publish it. A commit or pull request only in the fork does not update the live original website.

## Send a newsletter later

Campaigns remain a deliberate action in Resend; this installation does not schedule one.

For every future Broadcast, choose **both** the newsletter segment above and the **TLB Newsletter** topic. A segment alone is not proof of current topic consent, because unsubscribed contacts can retain segment membership. Do not select all contacts or the unrelated General segment as a substitute.

Include Resend's built-in **Unsubscribe Footer**. For a custom Broadcast template, the link target is `{{{RESEND_UNSUBSCRIBE_URL}}}`. Resend supplies the recipient-specific preference link. Do not substitute the website's signup page for an unsubscribe link. Preview the footer and recipient settings before sending. [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction), [segment and unsubscribe-link guidance](https://resend.com/docs/dashboard/segments/introduction).

## Local verification

Run the repository's backend contract tests and Edge tests using the Node version required by their runners. Backend tests use the pinned `@electric-sql/pglite` dependency from `tests/backend/package.json`. A dependency install outside the repository is supported through `PGLITE_PACKAGE_ROOT`:

```powershell
$env:PGLITE_PACKAGE_ROOT = 'C:/path/to/scratch-with-pglite-package-json'
node tests/backend/run.mjs
node tests/edge/run.mjs
```

The backend runner applies all migrations to an ephemeral local database. The Edge tests mock external services. Neither is a substitute for the controlled-inbox acceptance below. Never use real customer addresses for test fixtures.

## Manual acceptance before considering it ready

Use inboxes you control and a test account. Do not send a campaign to the newsletter segment during acceptance.

| Check | Required result |
| --- | --- |
| Homepage form on desktop and mobile | Clear purpose and immediate success message; no layout overflow; one welcome reaches the controlled inbox. |
| Submit signup | Newsletter opt-in is stored immediately and one welcome is queued. Other marketing preferences are unchanged. |
| Open an old confirmation link only | The page requests an explicit click. Provider preferences remain unchanged until that click. |
| Use an old unexpired confirmation link | The page succeeds; the contact is in the newsletter segment with **TLB Newsletter** opted in; account preference shows subscribed. |
| Confirm a used link again | It is safe and cannot undo an intervening unsubscribe. |
| Invalid, replaced, or expired link | Clear failure and a route to sign up again; no subscription change. Test expiry locally rather than editing live customer records. |
| Account signup, checkbox unchecked | Account creation/verification succeeds and no newsletter subscription or welcome is requested. |
| Account signup, checkbox checked | The newsletter subscribes immediately and a welcome is queued; the account verification email remains separate. Newsletter failure does not make account creation appear to fail or require creating it again. |
| Shop popup | Shows once after the delay, can be dismissed with its close button or Escape, and does not cover product/checkout dialogs. |
| Guest revisit | Popup stays dismissed in the same browser. A clean browser profile may show it once. |
| Signed-in revisit | Popup stays dismissed across a second browser/device for the same verified account. A different account has its own record. |
| Account unsubscribe | Only the newsletter topic becomes opted out. Other topic settings and transactional account/order email behavior are preserved. |
| Resend preferences unsubscribe | Account page reconciles the opt-out on its next visit. A fresh form submission is needed to rejoin this topic. |
| Existing global opt-out | Signup does not clear it or reactivate other topics. The customer gets a useful explanation. |
| Repeated requests | Active subscriptions succeed without another welcome. Rate-limited or busy requests clearly ask the customer to retry. New signup attempts are limited to one per minute and three per hour per address, 20 per hour per hashed source address, and 100 per hour overall. |
| Provider outage or partial failure | Safe error, no secrets exposed, and no false success. A busy update can require waiting 90 seconds before retrying. Pending imports survive lease expiry; retry resumes the same job. Verify eventual provider and account state agree. |
| Unknown import result | A lost upload response blocks further preference jobs until an operator recovers that exact import ID. The system must not submit a second import or clear the marker merely because 90 seconds elapsed. |
| Completed import with wrong result | Failed row counts or a definite contact/topic mismatch return an error and release the terminal job for a later explicit retry. Transient read failures retain the job for verification. |
| Authorization | A guest or another account cannot retrieve preferences or change the test account's settings. |
| Broadcast preparation only | A draft/test preview selects the exact newsletter segment and topic and contains the built-in unsubscribe footer. No live campaign is sent. |

Record the browser/device, action, result, and timestamp. Keep keys, confirmation links, and customer details out of screenshots and public reports. Unsubscribe the controlled test contact after acceptance if it should not receive future newsletters; retain consent/audit records.

If signup reports unavailable, check the migration/config row, function deployment, allowed origin, verified sender, and Full Access key permissions. If a retry says the preference is being updated, wait for the 90-second operation lease before retrying. This wait does not expire a pending provider import. If the message says the update needs verification, use the operator recovery procedure below. Do not repeatedly rotate links, clear unsubscribe flags, or bulk opt customers in to diagnose a failure.

## Historical acceptance finding: topic updates accepted without taking effect

During controlled live acceptance on 19 September 2026 (Manila time), Resend returned HTTP 200 and `{object: "contact_topics", id: ...}` for topic-update requests, but subsequent provider reads still showed the previous subscription. Both documented contact-ID and email-address paths produced this result, including a separate connector request. The topic remained opted in more than 20 minutes later despite matching contact and topic IDs. The original website had reported an unsubscribe and saved it locally without changing the provider preference.

The request body is a bare array: `[{"id":"TOPIC_ID","subscription":"opt_out"}]`. This matches the [current REST cURL example](https://resend.com/docs/api-reference/contacts/update-contact-topics), the [Node SDK implementation](https://github.com/resend/resend-node/blob/main/src/contacts/topics/contact-topics.ts#L32), and [Resend member's OpenAPI correction PR #103](https://github.com/resend/resend-openapi/pull/103). That unmerged PR identifies the object-with-`topics` schema as specification drift. Testing the wrapper `{"topics":[...]}` returned HTTP 422 `validation_error`; it is not a fix. The cause of the accepted but ineffective raw-array request remains unresolved.

The earlier deployed mitigation verifies stored topic state after writes and new-contact creation, returning HTTP 503 for a no-op instead of claiming success. The new implementation replaces existing-contact topic PATCH requests with a one-row CSV import through `POST /contacts/imports`. It supplies only the email, a blank `unsubscribed` cell, and the requested newsletter topic, with `on_conflict=upsert`. Resend documents that blank unsubscribe values on re-import preserve existing global opt-outs. An isolated live import changed the controlled fixture's topic to `opt_out` while preserving global `unsubscribed=true` and both name fields. Ordinary `POST /contacts` upserts are unsuitable for this update: a separate controlled probe reset an existing global opt-out when that field was omitted. [Resend import preservation guidance](https://resend.com/migrate/mailchimp), [official multipart import implementation](https://github.com/resend/resend-node/blob/main/src/contacts/imports/contact-imports.ts).

The database reserves an operation-specific import filename before upload and records the returned import ID. While that marker exists, confirmation, unsubscribe, new confirmation requests, and reconciliation cannot replace the job, even after the 90-second request lease expires. Retries poll the same import. Success requires a terminal `completed` job with exactly one updated row, zero created/skipped/failed rows, the same contact ID, and the requested topic verified by a fresh provider read. A confirming contact must also remain globally eligible. A terminal mismatch releases the operation without reporting success; a transient read failure retains it for retry. This serializes this application's jobs; it does not lock changes made independently in Resend.

**Status: the automatic newsletter flow is repaired and has passed live acceptance.** Newsletter Edge Function **v8** is deployed with source SHA-256 `2831043805112e715d5b41061bc2db5652234fcec743657c2817b8721b7c8068`, and the durable-import migration is live. The browser unsubscribe returned HTTP 200 in about 8.7 seconds; Resend changed the newsletter topic from `opt_in` to `opt_out`. An unrelated private test topic remained opted in, global `unsubscribed=true` and name fields were preserved, and newsletter segment membership remained. The database became unsubscribed and cleared the operation/import fields. A globally opted-out contact's reconfirmation was rejected with HTTP 409. An initial provider GET timeout happened before mutation; retry after the 90-second lease succeeded.

The updated local suites pass **58 Edge tests and 120 database checks**. Live RPC grants deny both browser roles and permit the service role. Fresh normal confirmation passed with HTTP 200 in about 20.7 seconds and verified provider/database subscription. Final automatic unsubscribe passed with HTTP 200 in about 7.7 seconds: newsletter `opt_out`, global `unsubscribed=false` preserved, unrelated fixture topic still `opt_in`, and database confirmation tokens/import/operation fields cleared. Replaying the used confirmation returned HTTP 410 in about 0.9 seconds. The original controlled user remains newsletter opted out. Final repair-fixture cleanup is complete; the corresponding production source merge remains required before future backend deployments. No campaign was sent. Ordering remains independent of this newsletter validation. Every eventual newsletter Broadcast must select **both** the dedicated newsletter segment and **TLB Newsletter** topic; segment membership alone does not establish current consent.

Cleanup passed. The original controlled user's newsletter topic remains `opt_out`. The separate repair fixture is newsletter opted out and was deliberately globally suppressed after acceptance; its unsubscribe-token hash was removed and audit history retained. The private auxiliary test topic was deleted, and an independent topic list contains only TLB Newsletter. The original expired test operation was cancelled. The diagnostic endpoint now requires JWT verification and returns HTTP 410 without reading the Resend secret or performing mutations. Local private probe/token JSON files were removed and their absence verified. No test email campaign was sent.

### Recover an import whose upload response was lost

An upload timeout or lost response can leave a durable filename without an import ID. The provider may still execute that job. **Never submit a replacement import, clear the marker, or infer failure from elapsed time.** Contact-import GET/list responses do not document a filename field, so list results cannot reliably recover the job by filename.

1. As an authorized operator, inspect the single affected subscriber in Supabase SQL Editor. Record its `operation_id`, `operation_kind`, `provider_import_filename`, `provider_import_started_at`, and current `provider_import_id` privately. Do not select token hashes or unrelated contacts.
2. Find the exact `POST /contacts/imports` request in Resend API logs, matching the operation-specific filename, timestamp, and affected contact. Recover its response import ID and check that exact job with `GET /contacts/imports/{id}`. Do not attach a guessed or merely recent import. If acceptance cannot be established, keep the operation blocked and investigate with Resend support.
3. When its existing request lease has expired, acquire a recovery lease:

   ```sql
   select public.newsletter_service('resume_import', jsonb_build_object(
     'email', 'AFFECTED_EMAIL'
   ));
   ```

   Inspect the result. Continue only when `resume_import` is `true` and the returned operation and filename match the exact job established above. If `busy` is true, allow the current request to finish; do not override its lease.
4. Within that 90-second lease, attach the verified provider ID using the service-only RPC:

   ```sql
   select public.newsletter_service('mark_import_id', jsonb_build_object(
     'email', 'AFFECTED_EMAIL',
     'operation_id', 'EXACT_OPERATION_UUID',
     'provider_import_filename', 'tlb-newsletter-EXACT_OPERATION_UUID.csv',
     'provider_import_id', 'VERIFIED_PROVIDER_IMPORT_UUID'
   ));
   ```

   Require `recorded=true`. The RPC rejects an expired lease, a mismatched operation/filename, or replacement of an already recorded different import ID.
5. Allow the recovery lease to expire, then retry the account action or revisit account preferences. The handler polls the recorded job and applies its normal counts/contact/topic checks before completing the local state. Verify the provider and account state agree. Retain the consent history and record the recovery without publishing customer details or secrets.

### Compact reproduction for provider support

1. Use a controlled test contact that is opted in to the newsletter topic. Record the contact ID and exact topic ID privately; verify the starting state with `GET /contacts/{contact_id}/topics`.
2. Send `PATCH /contacts/{contact_id}/topics` with `Content-Type: application/json` and body `[{"id":"TOPIC_ID","subscription":"opt_out"}]`. The observed response is HTTP 200 with `object: "contact_topics"` and an `id`.
3. Repeat the GET. The observed topic remains `opt_in`, including after more than 20 minutes. The documented email-address path gives the same result. The object-wrapped body instead returns HTTP 422 `validation_error`.
4. Provide request timestamps, provider request/log IDs, sanitized bodies/statuses, and before/after topic state to Resend support. Keep API keys, authorization headers, customer addresses, and confirmation links out of public reports. Ask why the accepted mutation does not persist and request a verified supported correction.

The replacement import flow has now passed automatic unsubscribe and separately confirmed resubscription with matching provider/database state and preserved unrelated preferences. Repair acceptance used token links on mobile `newsletter.html`; the signed-in account UI was not rerun live after this repair. The raw-array PATCH behavior remains a separate provider-support issue. Repair-fixture cleanup is complete, consent history is retained, and the original controlled user's opt-out remains confirmed. No campaign was needed for these checks.
