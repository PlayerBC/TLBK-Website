# Draft handoff status

This implementation adds an ordering system to the existing website. The live
website and both GitHub main branches remain unchanged. The owner created
[PlayerBC/TLBK-Website](https://github.com/PlayerBC/TLBK-Website); the prepared draft
branch is `development/ordering-system`, based on upstream main
`571de6e9fcb51a70bafc1483a0b6fe11752f5198`.

## What is implemented

- Existing website pages, content, photographs and branding preserved. Thirteen
  original HTML files receive only one Order Online menu link each.
- Customer menu/categories/search, product photos/descriptions, priced options,
  exact-count mixed boxes, dated availability, cart, pickup/delivery and manual
  payment instructions. Secure order pages and receipt/reference uploads.
- Real Supabase account integration: guest ordering, email verification/resend,
  password recovery, verified-account promos and private account order history.
- Persistent PostgreSQL schema, protected RPCs, server prices and validation,
  atomic per-product/date inventory and promo reservations, order snapshots and
  original approved payment records. No live payment gateway or courier API.
- Staff dashboard: products/photos/options/categories, daily quantities, settings,
  delivery zones, promos, order filters, payment review, progress, cancellation,
  separate Refund label, private notes, CSV, print and audited amendments.
- Private Storage uploads, protected proof viewing, durable transactional email
  outbox, reminders, expiry maintenance and Resend integration.
- Review totals are checked again when submitting orders or operational admin
  amendments, so a changed price requires a fresh review.

## What you can inspect now

The separate private preview preserves the complete original website. Its new
shop starts empty because no products are imported. Open `shop.html?demo=1` for
an explicitly labelled sample catalogue and checkout review, or `manage.html`
to inspect the staff forms. Sample products/prices and browser-only demo state
are isolated from the actual catalogue. Sample checkout cannot submit an order.

Preview origin prepared for this draft:
[TLB Kitchen website and ordering preview](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site).
A published URL is confirmed in the accompanying handoff; registration by itself
does not establish a running deployment.

## Still requires your setup and testing

The preview's public Supabase configuration is intentionally blank. No external
service accounts, billing plans, email sender, DNS records, real owner account,
real bank details or production catalogue have been activated by this build.
Until the owner completes [SETUP.md](SETUP.md), the preview cannot persist real
orders/products, perform real signup/recovery, upload proofs, or deliver emails.
Those screens explain setup is pending and disable submissions/saves.

Complete Supabase project/schema/Storage/functions, Resend sender + custom SMTP,
callback/origin configuration, protected owner assignment, business settings and
scheduler. Then redeploy the test preview with only the public project URL/key.
Actual inbox receipt, provider Storage behavior, two-session concurrency and the
full connected browser workflow remain unverified. No claim is made that this
is production-ready or that Brent has passed acceptance tests.

Operational amendments to closed/completed orders remain guarded to avoid
restoring released/consumed quantities accidentally. Audited contact-only
corrections, private notes and the independent Refund label remain available.
Delivery areas use configured city/barangay labels plus a complete street address;
there is no geocoding or live courier price lookup.

## Technical checks completed

- `node --check` on all added browser modules; `git diff --check`.
- `npm test` with the pinned PGlite dependency: **6 shop-rule checks, 30 actual SQL
  contract checks, and 8 mocked Edge Function checks**.
- The actual migration applies to PGlite PostgreSQL with pgcrypto; test stubs
  represent Supabase auth/storage roles. This is not a deployed Supabase project.
- Database cases cover date arithmetic/cutoff, shared daily capacity, promo caps
  and limits, payment deadlines/rejection/approval, privacy/roles, snapshots,
  idempotency, failed amendment rollback, closed contact corrections, and outbox
  leases/reminder invalidation. PGlite is single-connection; hosted concurrency
  remains part of owner-run tests.
- Chromium sample-flow checks: four-cookie/two-Matcha mix adds PHP 60.00; pickup
  and zone-based delivery review totals; explicit sample submission disabled;
  all staff sections/forms; empty real catalogue and setup states; no page
  exceptions; no horizontal overflow at 390px. Desktop/mobile screenshots were
  visually reviewed, including corrected local brand fonts.
- Edge tests mock provider responses; they verify validation, access checks,
  upload-race cleanup, private signed proof links, email contents and idempotency.
  They do not establish actual delivery to a human mailbox.

## Your review and release

[ACCEPTANCE.md](ACCEPTANCE.md) contains 127 practical cases with test data, steps,
expected results and blank result fields for you to complete.
[SERVICES.md](SERVICES.md) explains free options, limits and optional costs.
[README.md](../README.md) includes the merge/deployment walkthrough. A draft pull
request is for review only. Your explicit approval is still required before any
merge into the original main branch or publication to the live domain.

GitHub connection status: write access to `PlayerBC/TLBK-Website` was verified by
successfully creating `development/ordering-system`. The draft is being saved to
that development branch for a draft pull request. The accompanying handoff
confirms the saved commit and pull request once GitHub returns them. Do not change
either main branch while reviewing.
