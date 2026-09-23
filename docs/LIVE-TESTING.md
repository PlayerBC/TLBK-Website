# Test ordering on the existing website

Brent has chosen to test the ordering system at https://thelittlebakerkitchen.com.
Use this guide instead of the private-preview addresses in SETUP.md.

The initial setup record below is historical. The site is now live; see the September 23
email acceptance in section 4 and [AUTH-EMAILS.md](AUTH-EMAILS.md). Do not repeat initial
account, deployment or payment-setting changes on the operating shop.

## Initial setup record

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
Keep email signup and Confirm email enabled. The account confirmation template is now
branded as described in [AUTH-EMAILS.md](AUTH-EMAILS.md). Preserve `{{ .ConfirmationURL }}`
when changing confirmation or recovery templates.

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
`tlb-order-maintenance-and-email` is active with schedule `* * * * *` (updated September 23).
You can skip recreating Step 9 for this project. Fulfillment reminders are enabled for
08:00 Asia/Manila on the fulfillment date. They apply to paid, active orders. A qualifying
order added after that time is picked up on a later worker run. Ready-for-pickup messages
are separate notifications queued when staff changes the fulfillment status.

Live email acceptance on September 23 used four clearly labelled temporary database
fixtures without payments or inventory allocations. The natural scheduler sent exactly
one due reminder for the active paid pickup order, and none for the unpaid, completed
or future-date controls. Updating the active fixture to ready-for-pickup and invoking the
normal email queue function delivered the corresponding notification on the next cron
run. This tested scheduling, preparation and delivery; it did not exercise the staff UI
button or payment approval. Both messages were reported delivered by Resend, contained
pickup instructions and a working order link, and repeated cron runs sent no duplicate.
All fixture orders, outbox/history rows, test accounts and private test credentials were
removed afterward. Customer orders, stock, payment records and shop settings were unchanged.
Eight targeted email/worker regression tests also passed.

Then follow **Step 10 of SETUP.md**, using the live shop address:

https://thelittlebakerkitchen.com/shop.html

Use only inboxes you control. Expected totals are **PHP 100.00 for pickup** and
**PHP 150.00 for the configured delivery test**. Check the saved order, upload a test
receipt, approve full payment, verify stock counts and confirm actual inbox delivery.
Pause new orders again after testing.

**You are done when:** both customer and manager see the same saved order and payment
state, the private receipt opens correctly, and the actual emails arrive with working links.
Continue through ACCEPTANCE.md before approving the system for ordinary customer orders.

## Customer booking calendar

The shop's date button opens a calendar styled like the manager calendars. Customers
can browse the current month and the next two calendar months only. For example,
during September the final bookable date is November 30, not a rolling 60-day limit.
The dates follow Philippine time. Same-day ordering is available only for products with
**Allow same-day orders** enabled and **0 full production days**, before the configured
Production schedule cutoff. With no cutoff, it remains available throughout the day.
After the cutoff, these products can be booked from tomorrow, subject to the normal
fulfillment schedule and stock. Other products retain their production lead-time rules.

Before submitting an order, check these controls in the customer shop:

- Open the date picker. Previous months and past dates are unavailable. Today is
  available only when the current basket is eligible for same-day ordering; with an
  empty basket, an eligible product must be available for the selected method.
- Move forward twice from the current month. The next-month button is then disabled.
- Select an allowed date and reopen the calendar; the selected date stays highlighted.
- Check a date closed to new bookings. It cannot be selected. A delivery-only closure
  still permits pickup if the normal pickup schedule allows it.
- Clear the date and select again. Keyboard arrows, Page Up/Down, Escape, and the
  close button should work without allowing a date outside the booking window.
- On mobile, the popup and trigger should fit without sideways scrolling.

The server also rejects new customer quotes and orders outside this window, including
same-day attempts after the cutoff or with an ineligible product. Existing
bookings remain accessible; the manager calendars and staff amendments retain their
existing date controls.

## Same-day products

In **Products**, edit your ready-stock product, set **Full production days** to **0**,
and enable **Allow same-day orders**, then save. This option is off by default; setting
production days to 0 alone does not enable same-day orders. For your shop, enable it
only on Nori chips. If you need to increase its production days later, turn the option
off before saving. The form rejects conflicting settings without changing the product.

Same-day orders use the existing cutoff in **Shop settings → Production schedule**
in Philippine time. Before the cutoff, today can be selected if the date is open and
stock is available. At or after the cutoff, these products become available from
tomorrow; an additional full production day is not added. With no cutoff set, same-day
ordering is allowed throughout the day. A non-production date alone does not close
ready-stock fulfillment; use the booking-closure calendars when you need to close it.

Check these conditions in the customer shop without placing unnecessary real orders:

- Before the cutoff, a basket containing only eligible Nori chips can select today when
  stock and the selected pickup/delivery method are available.
- At or after the cutoff, today is disabled and tomorrow can be selected if otherwise
  available. All dates use Philippine time, including the midnight transition.
- Adding a product without the option blocks same-day checkout for the whole basket.
  The customer must choose a later date or remove that product; items are not removed
  and orders are not split automatically.
- A booking closure, delivery-only closure, pickup-only product, or insufficient stock
  still prevents the corresponding booking. Same-day does not override these rules.
- Saving and reopening the product editor preserves the option. Setting positive
  production days while it is checked shows an error; no product changes are saved.

Use staging for cutoff-time changes and direct API rejection checks, as described in
ACCEPTANCE.md. Existing orders retain their saved dates and payment deadlines.

## 5. Check calendars and delivery options

These checks cover the delivery controls added after the initial setup. Brent has chosen
to test with his actual products on the live shop. Use your own customer account and inbox;
choose operational dates and restrictions you actually intend to save. Broader stress,
invalid-upload and competing-customer tests in ACCEPTANCE.md still belong in staging.

In **Shop settings**, use the calendars to select or deselect individual dates. You can
move between months and select more than one date. Click **Save shop settings**, then reload
to confirm the selected dates were saved.

| Calendar | What selecting a date does |
| --- | --- |
| Additional non-production dates | The day does not count toward a product's required production days. This does not itself close pickup or delivery bookings. |
| Dates closed to new fulfillment bookings | Both pickup and delivery stop accepting new bookings for that date. It can still count as a production day. |
| Dates closed to new delivery bookings | Delivery stops accepting new bookings for that date. Pickup still follows its normal schedule and stock limits. |

Existing orders keep their saved date, fulfillment method and reservation when you close
a date. Open the customer shop in a second browser window and switch between Pickup and
Delivery to check the effect on new orders.

To make a cake or fragile product pickup only:

1. Open **Products**, edit the product, and enable **Pickup only**.
2. Save and reload the customer shop.
3. Add that product to your bag and select Delivery. The shop should explain which product
   requires pickup and prevent delivery checkout. This applies even if the bag also
   contains products that can be delivered.
4. Select Pickup, or remove the pickup-only item yourself, to continue. The shop does not
   split the order or remove products automatically.

To explain your delivery-zone limits:

1. In **Shop settings**, add or edit a delivery zone.
2. Fill in its **Description**, for example:

   > The delivery fee covers one Lalamove motorcycle. If your order needs a larger vehicle
   > or more than one motorcycle, we will contact you to discuss the arrangements.

3. Save the zone. In customer checkout, choose a locality belonging to that zone.
4. Check that the description appears in checkout and Review, keeping any line breaks you
   entered. The displayed delivery fee should still be the fixed fee you configured.
5. For the next order you intentionally submit to your own inbox, check the saved order and
   its email too. They should contain the same description. Editing the zone afterward
   changes future checkouts; it does not rewrite instructions already saved with an order.

The description is a message to the customer. It does not calculate vehicle capacity,
book a courier, add an extra fee, or contact the customer automatically. Any alternative
transport arrangement remains a conversation with your customer.

**You are done when:** the calendar selections persist, pickup remains available on a
delivery-only closure, pickup-only items cannot be submitted for delivery, and the selected
zone's description is readable in checkout, the saved order and the delivered email.
Record unperformed checks as pending. You can review checkout without submitting another
order; submission reserves real stock.

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

At initial setup, queued messages and real orders were empty. That worker test verified
connectivity and maintenance. The later live delivery checks are recorded in section 4.

## References

- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)
