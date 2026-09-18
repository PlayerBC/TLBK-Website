# Beginner setup guide: TLB Kitchen ordering draft

> **Current route for Brent:** DNS and HTTPS are restored, and testing will use the existing website. Follow [LIVE-TESTING.md](LIVE-TESTING.md) for the remaining steps and exact live URLs. The original private preview could not be republished. The database, three backend functions and five-minute automatic processing are already installed in **TLB Kitchen System**; do not reinstall them. Return to Steps 8 and 10 below for the test product and order checks, using the live shop address.

This guide is for Brent, starting with no website setup experience. You do not need to write the website code. You will create service accounts, enter settings, and copy a few prepared commands.

**Start with Step 1 only.** Finish its checkpoint before moving on. You can pause between steps and ask for help with a screenshot of your screen. Keep passwords, secret keys and private order links out of screenshots.

Links to official documentation are optional background. Follow the numbered steps here as your main path.

The preview already opens, but its database and email services are not connected yet. Sample checkout cannot submit orders. Completing this guide makes the separate preview ready for functionality tests. It does not launch ordering on your live website.

## Your route through setup

| Step | What you will accomplish |
| --- | --- |
| [1. Create your test project](#step-1-create-your-test-project) | Give the system somewhere to save information. |
| [2. Install the database](#step-2-install-the-database) | Add the prepared tables and access rules. |
| [3. Set up the email sender](#step-3-set-up-the-email-sender) | Allow TLB Kitchen to send emails. |
| [4. Set up account emails](#step-4-set-up-account-emails) | Configure verification and password-reset links. |
| [5. Install the backend functions](#step-5-install-the-backend-functions) | Enable uploads, private proof viewing and order emails. |
| [6. Connect the preview](#step-6-connect-the-preview) | Let the website use your test project. |
| [7. Enable your administrator account](#step-7-enable-your-administrator-account) | Give your verified bakery account owner access. |
| [8. Add your first test product](#step-8-add-your-first-test-product) | Set prices, delivery fees and dated quantities. |
| [9. Turn on automatic processing](#step-9-turn-on-automatic-processing) | Process emails, expiry and reminders. |
| [10. Place your first test order](#step-10-place-your-first-test-order) | Check the complete customer-to-admin workflow. |

## Before you begin

| Website | Its job | Your account there |
| --- | --- | --- |
| [GitHub draft branch](https://github.com/PlayerBC/TLBK-Website/tree/development/ordering-system) | Stores the website code and this guide. | Your existing `PlayerBC` account. |
| [Supabase dashboard](https://supabase.com/dashboard) | Stores orders, products, photos and bakery customer accounts. | A service account you create. |
| [Resend](https://resend.com) | Sends account and order emails. | A service account you create. |
| Your domain provider | Controls settings for `thelittlebakerkitchen.com`, including permission to send email. | Whoever manages your domain must have access. |

Your **Supabase service login** and your eventual **bakery administrator login** are separate accounts. Creating the Supabase project does not automatically make you an administrator in the bakery website.

Have your Windows computer, an inbox you control, and access to your domain settings available. Use Free options where available and suitable for testing; check the displayed plan before agreeing to billing. [SERVICES.md](SERVICES.md) explains quotas and paid alternatives. This setup does not need a new domain or a payment gateway.

**How to copy instructions:** copy the text inside a code box, without the backtick marks. Replace placeholders such as `YOUR_TEST_PROJECT_REF` with your own value. Field names such as `EMAIL_FROM` must stay exactly as written. Run one command at a time and check the result.

## Step 1: Create your test project

**Goal:** create an empty, separate home for the draft's data.

1. Open the [Supabase dashboard](https://supabase.com/dashboard). Create an account or sign in.
2. If asked to create an **organization**, use `TLB Kitchen`. An organization is simply the folder that holds your projects. Choose Free if offered and suitable for your test.
3. Choose **New project** and enter:

| Field | What to enter |
| --- | --- |
| Organization | The organization you just created. |
| Project name | `TLB Kitchen Test` |
| Database password | Generate a strong password and save it in your password manager. This is different from your Supabase login password. |
| Region | A nearby available region, such as Singapore if listed. |

4. Create the project and wait until its dashboard is ready.
5. Open the project's **Connect** panel or API settings and locate the **Project URL**. It looks like `https://YOUR_PROJECT_REF.supabase.co`.
6. In **Settings → API Keys**, copy the **Publishable key**, usually beginning `sb_publishable_`. If the project offers legacy keys, the `anon` key is also supported. Do not choose `secret` or `service_role`.
7. Record the **Project reference / Reference ID** from project settings. It is the identifier in the project URL, without `https://` or `.supabase.co`.

The URL and publishable key are the two public values the website needs. Secret/service-role keys have greater access and must stay out of the website. [Supabase key guide](https://supabase.com/docs/guides/getting-started/api-keys).

**You are done when:** you can open `TLB Kitchen Test` and have its URL, publishable key, reference ID and privately saved database password.

**If stuck:** send the screen's labels, with secret values hidden. Do not delete and recreate projects to fix an unfamiliar screen.

## Step 2: Install the database

**Goal:** give the project its product, order and account-management structure. A database holds the saved records; SQL is the instruction text that creates their structure.

1. In GitHub, open the prepared [database setup file](https://github.com/PlayerBC/TLBK-Website/blob/development/ordering-system/supabase/migrations/202609130001_ordering.sql).
2. Click **Raw** to see only the file's text. Press **Ctrl+A**, then **Ctrl+C** to copy the entire file.
3. In Supabase, check that the selected project is **TLB Kitchen Test**.
4. Open **SQL Editor**, create a new query, and paste the copied text.
5. Click **Run** once. This file is for a fresh test project. If you already ran it successfully, skip this file instead of running it again.
6. For a fresh project, open the [database migrations folder](https://github.com/BrentChuaTLBK/bakery-website/tree/main/supabase/migrations). Run each later `.sql` file once, in filename order, using a new SQL Editor query for each. These updates include contact-number validation and the 15-minute payment deadline. On an existing project, check which updates have already been applied before running anything.
7. Open **Storage** and check the two folders, called *buckets*:

| Bucket | Required access | Why |
| --- | --- | --- |
| `product-images` | Public | Customers need to see product pictures. |
| `payment-proofs` | Private | Only authorized staff should view payment receipts. |

The script creates a private `tlb` database schema, meaning a group of tables, and the public functions the website uses. Leave API exposed-schema settings unchanged. Do not expose `tlb` or add broad access rules yourself.

**You are done when:** SQL Editor reports success, both buckets exist with the correct access, and no red error remains. An empty product catalog is expected.

**If stuck:** copy the error text. Do not run the script repeatedly or reset the database. We need to identify what failed first.

## Step 3: Set up the email sender

**Goal:** give the system permission to send email using a domain you own.

1. Create an account at [Resend](https://resend.com), using an inbox you control. Choose its Free transactional-email option if suitable for your tests.
2. Open **Domains → Add Domain**.
3. Use a dedicated sending subdomain. For example, `mail.thelittlebakerkitchen.com` is a proposed name, not something already configured. If that name already serves another system, have us review it before choosing the sender.
4. Resend displays DNS records. **DNS** is your domain's settings directory. Open the website where those settings are managed and find its DNS records page.
5. Add the generated records, matching their type, name, value and any priority field. Follow [Resend's instructions for your DNS provider](https://resend.com/docs/add-a-domain). Providers differ in whether they append the domain to the Name field; check the resulting full record name.
6. Return to Resend and wait for the sending domain to show **Verified**. Add its recommended DMARC email-authentication record using the linked instructions.

This adds email settings. Keep existing website records, nameservers and mailbox records in place. If you do not know who manages DNS, show the domain-management screen so we can guide you. Only Resend's generated values will verify your domain; this guide does not contain replacement DNS values.

After verification, choose a sender on that exact subdomain:

| Used for | Example, only after that domain is verified |
| --- | --- |
| Sender email | `orders@mail.thelittlebakerkitchen.com` |
| Sender with display name | `TLB Kitchen <orders@mail.thelittlebakerkitchen.com>` |

In Resend, open **API Keys**, create a key for sending email, and save it privately. Restrict it to your verified domain if offered. Keep email click tracking disabled so it does not rewrite secure account/order links.

Resend's `onboarding@resend.dev` test sender is restricted to your own Resend account address and cannot serve ordinary customers. [Test-sender explanation](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

**You are done when:** your domain is Verified, you have chosen the sender, and its API key is saved privately. Domain verification alone does not prove an email reached your inbox.

## Step 4: Set up account emails

**Goal:** make verification and password recovery work.

### Enter the mail settings

In **Supabase → Authentication → Email**, look under **Notifications** for **SMTP Settings** and enable custom SMTP. SMTP is the connection that hands an email to the sending service.

| Field | What to enter |
| --- | --- |
| Sender name | `TLB Kitchen` |
| Sender email | Your verified sender email, without the display name or angle brackets. |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | The private Resend API key from Step 3, not your login password. |

Save the settings. [Official Resend/Supabase instructions](https://resend.com/docs/send-with-supabase-smtp).

In Supabase's email sign-in provider settings, keep email/password signup and **Confirm email** enabled. Set minimum password length to **10** and email link/OTP expiry to **3600 seconds**. Leave the default confirmation and recovery templates, including `{{ .ConfirmationURL }}`, intact.

Supabase's built-in test sender has recipient restrictions. Custom SMTP is needed for ordinary customer tests; sending limits still apply. [Supabase email-service explanation](https://supabase.com/docs/guides/auth/auth-smtp).

### Set where email links return

Open **Authentication → URL Configuration**. Replace the localhost Site URL and add both redirect entries. A *redirect* is the page opened after someone uses an email link.

| Field | Copy this value |
| --- | --- |
| Site URL | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/` |
| Redirect URL, first entry | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/auth-callback.html` |
| Redirect URL, second entry | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/reset-password.html` |

Save all three. Add the redirect URLs separately without a wildcard such as `*`. These are for this particular private preview. [Redirect settings](https://supabase.com/docs/guides/auth/redirect-urls).

**You are done when:** mail settings are saved, email confirmation is enabled, and all three URLs match. Actual verification is tested in Step 7, after connecting the preview.

## Step 5: Install the backend functions

**Goal:** install three prepared programs for uploads, private proof viewing and order emails. Supabase calls them *Edge Functions*.

This is the most technical step. The Windows route below includes the commands you need. It uses your hosted test project and does not need a local database or Docker.

### A. Download the correct website copy

1. Open the [development branch](https://github.com/PlayerBC/TLBK-Website/tree/development/ordering-system).
2. Check that the branch selector reads **development/ordering-system**.
3. Click the green **Code** button, then **Download ZIP**. The existing website includes many photos, so this download can be large.
4. In Windows File Explorer, right-click the ZIP and choose **Extract All**.
5. Open the extracted folder until you see `package.json`, `assets`, `docs` and `supabase` together. Keep the entire folder, including `supabase/functions/_shared`.

### B. Open PowerShell in that folder

1. Install **Node.js LTS** using the **Windows installer** from [nodejs.org](https://nodejs.org/en/download). Use its normal Node/npm installation; extra native-development tools are not needed here.
2. Close any existing PowerShell window after installation.
3. In File Explorer, open the extracted website folder. Click the address bar, type `powershell`, then press Enter. This opens a command window in that folder.
4. Copy and run this check:

```powershell
Test-Path .\supabase\config.toml
```

The result must be **True**. If it is False, return to A.5 and find the correct folder.

Run these commands separately:

```powershell
node --version
```

```powershell
npx.cmd supabase@latest --version
```

Each should print a version. If the second command asks to download Supabase, type **y**, then Enter. Using `npx.cmd` avoids the common PowerShell script-policy error. Supabase requires Node 20 or newer with this installation method. [CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started).

### C. Sign in and select the test project

Run:

```powershell
npx.cmd supabase@latest login
```

Complete the browser sign-in instructions. If a personal access token is requested, enter it privately in the command window; do not send it in chat.

Then run:

```powershell
npx.cmd supabase@latest projects list
```

Find **TLB Kitchen Test** and compare its reference with Step 1. Replace `YOUR_TEST_PROJECT_REF` below with that ID, then run:

```powershell
npx.cmd supabase@latest link --project-ref YOUR_TEST_PROJECT_REF
```

If asked for a database password, enter the one saved in Step 1. Wait for a successful link before proceeding. [Supabase deployment instructions](https://supabase.com/docs/guides/functions/deploy).

### D. Add the functions' private settings

Generate one random worker token in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

This prints a 64-character value. Save it privately as **TLB test worker token** before copying anything else. It acts as the password between the automatic scheduler and email worker. Generate it once and reuse the same value in Step 9.

In **Supabase → Edge Functions → Secrets**, add:

| Name, copy exactly | Value |
| --- | --- |
| `RESEND_API_KEY` | Your private sending key from Resend. |
| `EMAIL_FROM` | Your verified sender with display name, such as `TLB Kitchen <orders@mail.thelittlebakerkitchen.com>`. |
| `EMAIL_WORKER_TOKEN` | The exact random worker token you just saved. |
| `ALLOWED_ORIGINS` | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site` |

An *origin* is a website's base address: this value has no page path and no trailing slash. Supabase supplies its own `SUPABASE_...` credentials automatically; leave those managed entries alone. [Function secrets](https://supabase.com/docs/guides/functions/secrets).

### E. Upload the three functions

In the same PowerShell window, run each command separately and wait for success:

```powershell
npx.cmd supabase@latest functions deploy proof-upload --use-api
```

```powershell
npx.cmd supabase@latest functions deploy proof-url --use-api
```

```powershell
npx.cmd supabase@latest functions deploy email-worker --use-api
```

`--use-api` prepares the upload on Supabase's servers, so Docker is not needed. [Deploy command reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

The prepared `supabase/config.toml` supplies settings including `verify_jwt = false` for these three functions. Their code performs its own customer, staff or worker authorization. Keep those settings and the shared code unchanged. Copying only an `index.ts` file into the dashboard is insufficient. [Function configuration](https://supabase.com/docs/guides/functions/deploy#function-configuration).

**You are done when:** Supabase's Edge Functions page lists `proof-upload`, `proof-url` and `email-worker` as deployed. Deployment alone does not prove mail or uploads work.

**If stuck:** send the command and error with credentials hidden. Step 2 already installed the database. Do not add `db push`, `db reset`, `init`, `start` or `config push` commands from another tutorial.

## Step 6: Connect the preview

**Goal:** make the website use the backend you configured.

Give your coding assistant these two public values, clearly labelled:

| Public value | What it should look like |
| --- | --- |
| Supabase Project URL | `https://YOUR_PROJECT_REF.supabase.co` |
| Supabase Publishable key | Begins `sb_publishable_`, or is explicitly labelled legacy `anon`. |

Your assistant can update `assets/ordering/config.js` on the development branch and rebuild and publish the private preview. You do not need to edit the JavaScript yourself.

**A GitHub save alone does not update this separate preview.** Wait for confirmation that the preview was republished with the public configuration, then refresh. The Resend key, worker token, database password and Supabase secret/service-role keys do not belong in this file or a chat message.

Open the [connected shop](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/shop.html), without `?demo=1`. The backend-setup-pending notice should disappear. Ordering may still be paused and the catalog empty; both are expected here.

**You are done when:** the republished preview connects, and the [bakery account page](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/account.html) allows registration.

The preview is private. A ChatGPT/preview-host access prompt may appear before the bakery website loads. Customer sign-in happens inside the bakery website after that. New browser profiles may need to sign into the preview host too. Keep access private for your own tests; adding other testers is a separate hosting-access decision.

## Step 7: Enable your administrator account

**Goal:** create your bakery login and give it owner access.

1. Open the [bakery account page](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/account.html). Register your email with a password of at least 10 characters.
2. Check your actual inbox and spam. Open the verification link in a browser that can access the private preview, then sign in.
3. In **Supabase → TLB Kitchen Test → SQL Editor**, create a new query.
4. Copy this code, replace only `YOUR-VERIFIED-OWNER-EMAIL` with the exact email you registered, and run it:

```sql
insert into tlb.staff (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = lower('YOUR-VERIFIED-OWNER-EMAIL')
  and email_confirmed_at is not null
on conflict (user_id) do update set role = 'owner';

select u.email, s.role
from tlb.staff s join auth.users u on u.id = s.user_id;
```

5. The result table must show your correct email with role **owner**.
6. Open or refresh the [staff dashboard](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/manage.html). Sign in using that bakery account if asked.

**You are done when:** your owner account can save settings in the dashboard.

**If stuck:** no owner row usually means the email was unverified or did not match. Fix that before retrying. Do not turn off confirmation or assign the role to another address. Additional staff must also register and verify before you grant their roles in admin.

## Step 8: Add your first test product

**Goal:** keep the first order simple enough to spot an incorrect result.

Open **Shop settings** in admin. Use clearly labelled test details and your own inbox. These are test fixtures, not real product prices or payment accounts.

| Setting | First-test value |
| --- | --- |
| Shop name | `TLB Kitchen — TEST ONLY` |
| Contact email / number | Your own inbox and contact number. |
| Ordering website URL | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/` |
| Pickup address / opening hours | Clearly labelled test pickup details. |
| Manual payment instructions | `DEMO — TEST ONLY. Do not transfer money. Upload a labelled test image and DEMO reference.` |
| Production and pickup/delivery weekdays | For this first test, enable all seven Production weekdays and all seven Pickup & delivery weekdays. Leave cutoff blank. Set your actual operating days later. |
| Pause new orders | Keep checked until the product, quantities and scheduler are ready. |

Save. The **Ordering website URL** here supplies order-email links. It is separate from the Supabase Auth Site URL in Step 4; both need the preview address.

In **Products → Categories → + Add category**, enter the name `DEMO`, leave Display order at `0`, and save. Then return to Products, choose **Add product**, and enter:

| Product field | Enter |
| --- | --- |
| Name | `DEMO — Test Cookie Box` |
| Category | Select `DEMO`. |
| Description | `TEST ONLY. One box. Not a real sale.` |
| Base price · PHP | `100.00` |
| Minimum sellable units | `1` |
| Full production days | `1` |
| Menu display order | `0` |
| Show this product in the shop | Checked. |
| Photo | Your own JPEG, PNG or WebP, at most 5 MB. |
| Option groups | Leave empty for this first test. |

Save, refresh, and check the product is still there. Product photos are public: use product imagery rather than private documents.

In **Daily quantities**, choose the product and a future fulfillment date. Choose a date at least a week away and ensure it is open in settings. Set From and Through to that same date, quantity **5**, and **Available**, then save.

Quantity is per product **per fulfillment date**. A date without an allocation is unavailable. Pickup and delivery share those five boxes. With the cutoff blank, production starts tomorrow: Monday submission with one Tuesday production day means Wednesday at the earliest. With a configured cutoff, the order day counts before the cutoff if it is open for production; at or after the cutoff, counting starts tomorrow. For example, with a 12 PM cutoff and all production days open, a two-day product ordered September 19 is eligible September 21 before noon or September 22 at/after noon. Fulfillment is always after the last counted production day.

In **Shop settings → Delivery zones → + Add zone**, enter Zone name `DEMO delivery`, put `Demo City / Demo Barangay` on one line in the localities field, set the fee to **PHP 50.00**, and check **Allow delivery**. Save it and configure the delivery window. One box with no promo should total **PHP 100.00** for pickup or **PHP 150.00** for delivery.

**You are done when:** the product, photo, test zone and dated quantity remain saved after refresh. Keep new orders paused until Step 9 is complete.

## Step 9: Turn on automatic processing

**Goal:** send queued order emails, expire unpaid orders and check reminders without leaving a browser open.

A *scheduler*, also called Cron, runs the email worker every five minutes. [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).

When a customer submits valid payment proof and the order becomes **Under review**, every verified account assigned **Staff** or **Owner** receives an individual review email. Recipients follow the accounts in **Staff access** automatically; the business contact email is not the recipient list. These notifications include the order reference, customer name, fulfillment date/method, ordered products with quantities and selected options, unit and line prices, subtotal, discount and promo code (when present), delivery fee, order total, and a link to the admin dashboard, where staff sign-in is required. They are independent of the fulfillment-day reminder setting.

Review emails use the next available worker cycle; queue volume and retries can delay delivery. The sender skips queued alerts if the recipient loses their role or verified email address, or if the order has already been approved, rejected, or cancelled. No notification is sent merely for starting a proof upload, and existing orders are not backfilled when this feature is installed.

### Enable the required extensions

In **Supabase → Database → Extensions**, enable `pg_cron`, `pg_net` and `supabase_vault` if needed. They provide scheduling, server requests and secure settings storage. Vault is Supabase's private store for secrets. [Cron](https://supabase.com/docs/guides/cron), [Vault](https://supabase.com/docs/guides/database/vault).

### Save the three scheduler values

In SQL Editor, first run this check, which shows names only:

```sql
select name from vault.secrets
where name in ('tlb_project_url', 'tlb_publishable_key', 'tlb_email_worker_token');
```

If there are no rows, use the next code box. Replace all three placeholders with your saved values. The worker token must be the **same value from Step 5**, not a new token.

```sql
select vault.create_secret('YOUR_SUPABASE_PROJECT_URL', 'tlb_project_url');
select vault.create_secret('YOUR_PUBLIC_PUBLISHABLE_KEY', 'tlb_publishable_key');
select vault.create_secret('YOUR_PRIVATE_RANDOM_WORKER_TOKEN', 'tlb_email_worker_token');
```

If names already exist, edit those entries in Vault instead of creating duplicates. If unsure, ask for help with the name-only result. Keep the query containing your actual token out of shared screenshots.

### Create the scheduled job

Run this in SQL Editor. There are **no placeholders to replace** in this box:

```sql
select cron.schedule(
  'tlb-order-maintenance-and-email',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'tlb_project_url') || '/functions/v1/email-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                 where name = 'tlb_publishable_key'),
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'tlb_email_worker_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
```

Confirm it exists:

```sql
select jobname, schedule, active from cron.job
where jobname = 'tlb-order-maintenance-and-email';
```

**You are done when:** one job appears with schedule `*/5 * * * *` and `active` true. An active job alone does not prove email delivery; Step 10 checks that.

Allow several minutes for order email. Each run processes up to three messages; larger queues take more runs. Provider limits apply to account and order mail. Keep this five-minute interval for initial setup.

New orders have a 15-minute payment-proof deadline. Orders placed before this change keep their original deadline. Expired unpaid reservations are released before the next successful shop or checkout API response; scheduled maintenance also cleans them up every five minutes. A proof received on time stays **Under review** until staff acts, even after the deadline. Reminders apply to active paid orders due that day in **Asia/Manila**.

For an already-open shop, publish the matching website payment instructions before activating the shorter backend deadline. A shorter deadline reduces unpaid stock holds, but guest repeat orders and unverified receipt uploads still need separate abuse controls. The system does not automatically verify that an uploaded receipt represents a real payment.

## Step 10: Place your first test order

**Goal:** prove that data travels from checkout to your dashboard and inbox.

1. In Shop settings, uncheck **Pause new orders** and save.
2. Use one browser profile for the owner and another for the customer. Two ordinary tabs may share a bakery login. Let the second profile access the private preview first, then keep it signed out of the bakery account for a guest order.
3. Open the [connected shop](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/shop.html). The address must not contain `?demo=1`.
4. Choose your allocated date, add one `DEMO — Test Cookie Box`, select pickup and use an inbox you control for the buyer. The total should be **PHP 100.00**.
5. Review and submit once. Save the order reference and keep its private link to yourself.
6. Refresh the order page and open the order in admin. Both should show the same saved order, total and **Awaiting payment** status. The initial order email should arrive after processing.
7. Upload a JPEG/PNG/WebP marked `DEMO — TEST ONLY`, at most 5 MB. Leave the payment reference blank, or enter `DEMO-REF-001` to test a supplied reference. No transfer is needed. Payment should become **Under review**.
8. In admin, open **Daily quantities** and select the test date: **Held + approved** should be `1` and **Remaining** should be `4`. View the order's private proof and select **Approve full payment**. Check **Paid / Confirmed**, the approval email, and that the stock counts remain `1` and `4`.
9. Repeat with delivery to your test locality and a clearly labelled test address. One box without a promo should total **PHP 150.00**. After that second order, the date's stock counts should be `2` held/approved and `3` remaining.
10. Pause new orders again when you finish if you do not want further test submissions.

**You are done with the first test when:** both orders survive refresh, customer/admin totals agree, proof and approval work, and actual emails reach your inbox with working links.

This first pass is not full acceptance. Continue with [ACCEPTANCE.md](ACCEPTANCE.md): 127 cases with expected results. Record **Pass / Fail / Blocked**, order references and screenshots. No cases have been marked passed on your behalf.

## Next tests before approving the system

| Test | Result to check |
| --- | --- |
| Verification and recovery | Actual messages arrive. New password works; old password and reused/expired reset links fail. |
| Cart continuity | Sign-in and verification preserve cart, date and entered details. |
| Privacy | Customers see only their own orders and cannot access staff functions or another order's proof. |
| Rejection | Rejected proof cancels the order, releases stock and sends the reason. It cannot be resubmitted. |
| No-proof expiry | After 15 minutes and maintenance, the order expires and stock/unredeemed promo holds return once. |
| Timely proof | Proof submitted on time stays Under review beyond 15 minutes until staff decides. |
| Promos | Minimum, percentage cap, expiry and account/global limits work. Delivery is excluded from discounts. |
| Last available box | Two customers try to submit for one remaining box together; only one succeeds. |
| Paid-order edits | Revised items/date/total save while payment remains Paid. Differences are settled manually; Refund is a label. |
| Fulfillment emails | Readiness messages match admin changes. Due-date reminders arrive once; moved, cancelled or completed orders receive no obsolete reminder. |

The 44 local automated checks passed during development. They do not prove your hosted project, inbox delivery or simultaneous customer orders work. Complete connected tests before approving a merge or live-domain release. Your current website and main branches remain separate from this setup.

## If something does not work

| What you see | What to check first |
| --- | --- |
| Different Supabase/Resend menu labels | Provider screens change. Send the screen and step number with private values hidden instead of guessing another operation. |
| `node` is not recognized | Install Node LTS, close PowerShell and reopen it. |
| PowerShell says scripts are disabled | Use `npx.cmd` exactly as shown; no execution-policy change is needed. |
| `Test-Path` returns False | Open the extracted folder directly containing `supabase` and `package.json`. |
| Deploy requests Docker or cannot find shared imports | Include `--use-api`, use the correct folder and retain `_shared`. |
| Backend setup pending / disabled saves | Check Step 6, the public values, and whether the preview was republished. |
| Empty shop or unavailable dates | Check active products, dated quantities, open weekdays, closed dates and full production days. Sample products are never imported. |
| Account email missing | Check sender verification, SMTP, inbox/spam, Resend logs and Supabase Auth limits. |
| Order email missing | Check functions, worker secrets, scheduler results, business website URL and the admin email queue. |
| Email link opens localhost or the wrong site | Recheck Step 4 URLs, the republished configuration and admin's Ordering website URL. |
| Admin access denied | Verify your bakery email and check the owner row. Supabase service login is not bakery owner login. |
| Proof upload/view fails | Check image type/size, deadline, order state, private bucket and deployed functions. Payment reference is optional. |

**When asking for help, send:** step number, button/command used, exact error and a screenshot with secret values hidden. Do not send a full private guest-order URL; it contains an access token.

<details>
<summary>Advanced checks: scheduler and email delivery</summary>

After a failed order-email test, inspect processing with these read-only queries:

```sql
select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job
               where jobname = 'tlb-order-maintenance-and-email')
order by start_time desc limit 10;

select id, status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 10;
```

A successful Cron SQL run means the request was queued. Check its HTTP response and Edge Function logs too. A 401 response can mean the two worker-token values differ. Do not share request headers or decrypted Vault values.

In Resend logs, accepted/sent means the provider accepted the message; delivered means the recipient server accepted it. Check inbox and spam to confirm receipt. Inspect both Supabase Auth limits and Resend's quota if sending stops. [SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).

Failed order messages retry with backoff using the same event identifier. Old or uncertain deliveries can stop for investigation. Do not reset queue statuses blindly: compare the event/provider ID with Resend logs first. Its duplicate-prevention window is 24 hours. [Idempotency explanation](https://resend.com/docs/dashboard/emails/idempotency-keys).

For deliberate bounce tests, use [Resend's documented test addresses](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing). Simulated events do not prove a message reached your inbox.

To stop the scheduler when intentionally shutting down testing:

```sql
select cron.unschedule('tlb-order-maintenance-and-email');
```

</details>

## Keep track of your progress

- [ ] Test project created; public values and private passwords saved separately.
- [ ] Database installed once; product images public and proof bucket private.
- [ ] Sending domain verified and account mail configured.
- [ ] Three backend functions deployed with the correct secrets.
- [ ] Preview republished with public configuration.
- [ ] Bakery email verified and owner access confirmed.
- [ ] Test product, dated quantity and delivery zone saved.
- [ ] Scheduler enabled and its request checked.
- [ ] Pickup/delivery orders, proof, approval and actual emails checked.
- [ ] Full acceptance results recorded and remaining issues resolved.

Keep this guide as your place marker. Account setup, DNS changes, purchases and service activation remain under your control. A production move later needs separately reviewed settings, exact live email callbacks, backup arrangements and your release approval; it is not part of this test setup.
