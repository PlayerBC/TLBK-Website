# Requirements and review status

This draft adds ordering to the existing TLB Kitchen static website. It uses the uploaded **Order System Final Draft.docx**, the current conversation, and the implementation contract. The latest instruction makes **Cococart the general workflow reference**; no further reference screenshots are required. Cococart branding is not copied.

The work begins from upstream main `571de6e9fcb51a70bafc1483a0b6fe11752f5198` in a separate checkout/development branch. Existing pages, content, photos, and branding are preserved. The ordering database starts empty and paused. No catalog import/migration is required. Any optional sample experience must be explicitly labelled demo and isolated from the real backend.

**Readiness limit:** a preview without an owner-configured Supabase project, verified email sender, SMTP/API credentials, and running scheduler cannot demonstrate persistent ordering or actual email delivery. Integration code and local technical checks do not substitute for those connected tests. Brent's acceptance testing remains unperformed until he records his results in [ACCEPTANCE.md](ACCEPTANCE.md).

A local clone/development branch is not a GitHub fork. Record the actual fork/branch URL below when it exists. Main and the live website remain unchanged until Brent approves the final result and the respective merge/deployment action.

## Evidence record

| Evidence | Current record / completion field |
| --- | --- |
| Upstream baseline | `BrentChuaTLBK/bakery-website`, main commit above |
| Local development branch | Record final branch in delivery handoff: __________________ |
| Actual GitHub fork and branch | [PlayerBC/TLBK-Website](https://github.com/PlayerBC/TLBK-Website); local `development/ordering-system` push blocked by integration 403 |
| Final reviewed commit | __________________ |
| Preview URL | __________________ |
| Connected staging database and storage | Requires owner setup; record connection check: __________________ |
| Auth email provider and verified sender | Requires owner setup; record actual receipt: __________________ |
| Order email worker / scheduled jobs | Requires owner setup; record delivery and retry checks: __________________ |
| Local technical checks | See DRAFT-STATUS.md: 6 shop-rule, 30 database, 8 mocked Edge checks plus sample browser checks. User UAT remains unperformed. |
| Brent's acceptance results | Not performed/reported in this document; use ACCEPTANCE.md |
| Known implementation gaps at handoff | Record here after final code review: __________________ |
| Approval to merge / deploy live | Not granted by this document |

## Architecture and reused components

The original repository is a static HTML/CSS/JavaScript website. Its pages, existing assets, original content, and navigation remain the base. New `shop.html`, `account.html`, authentication callback/reset pages, and `manage.html` add customer ordering and staff administration. Shared modules under `assets/ordering/` connect those pages to the backend.

Supabase provides PostgreSQL persistence, email/password authentication, storage, and Edge Functions. Database transactions enforce stock, promo, and status rules. Supabase custom SMTP handles authentication emails; Resend handles transactional delivery through the email worker. The owner creates/enables these services and supplies configuration. See [SETUP.md](SETUP.md) and [SERVICES.md](SERVICES.md) for current setup, plans, DNS, and secret placement.

All money is stored/calculated as integer centavos and displayed as PHP with two decimals. Business dates/times use Asia/Manila. Fulfillment dates are calendar dates; payment deadlines and audit events are absolute timestamps displayed in Manila.

## Confirmed requirements and implementation defaults

The first column below identifies actual requirements. The defaults are disclosed implementation choices for review; they are not invented TLB Kitchen operating policies.

| Area | Confirmed requirement | Draft implementation default / pending shop data |
| --- | --- | --- |
| Reference | Existing TLB Kitchen branding; Cococart general ordering workflow | No missing-screenshot dependency; no Cococart branding copy |
| Catalog | Admin creates products; no import | Empty catalog, paused until configured; demo content clearly labelled if offered |
| Lead time | Count eligible production dates before fulfillment; with a configured cutoff, the order day counts before that time | Without a cutoff, production starts tomorrow (Monday + 1 day means Wednesday). Fulfillment day never counts. Same-day requires explicit zero-day product opt-in. |
| Cutoff | Before the configured Manila cutoff, today counts if production is open; at/after cutoff, counting starts tomorrow | With 12 PM cutoff and all production days open, September 19 + 2 days means September 21 before noon, September 22 at/after noon. No extra production day is added. |
| Schedule | Production schedule distinct from fulfillment booking closures | Owner enters real weekdays, exclusions, blocked dates, and quantities; sample values are test-only |
| Capacity | Per product per date; pickup/delivery share; no flavor or order-count stock | Blank/null or missing capacity means unlimited; 0 means no stock; saved totals include held+committed/retained quantities and cannot fall below them. Calendar selects one or more dates; edited product totals apply separately to each date; untouched mixed limits are preserved |
| Delivery | Fixed admin zones, supported-address validation, separate recipient details | Exact structured locality selection plus full address; no automated arbitrary-address geocoding |
| Delivery timing | Date only; window initially 9 AM–6 PM | Configurable text window; no time-slot controls or guaranteed morning arrival |
| Proof | Required secure, validated proof upload; payment reference optional; 15-minute deadline | JPEG/PNG/WebP, maximum 5 MB; successful validated commit must occur strictly before deadline; PDF not allowed in this draft |
| Guest access | Unguessable secure access link | Link grants access to its holder; token is not the human-readable order reference and does not expire with the payment deadline |
| Proof viewing | Private | Staff receives a temporary signed URL, draft lifetime five minutes |
| Account tokens | Secure, expiring verification and single-use password reset | Supabase-authenticated flow; configured lifetimes and redirect URLs documented during owner setup |
| Promo math | Percentage/fixed, subtotal-only minimum/discount, saved rules, one code | Integer centavos; percentage value whole percent; server rounding convention must be recorded and tested |
| Unpaid promo requalification | Below-minimum edit releases unused reservation; no duplicate use | Later qualifying edit reacquires one use for the same order under saved rules/original eligibility if allowance remains; otherwise fails without mutation |
| Existing item pricing | Saved prices for unchanged items; current prices for new configurations | Quantity-only edits retain same configuration's saved unit price |
| Archive/hide | Temporarily unavailable/archived products need not be deleted; submitted snapshots survive | `active=false` is the reversible hide/archive control; retained record and snapshots provide history |
| Cancellation stock | Admin decides whether produced/committed units may be restored | Explicit restore-stock choice for the cancelled order; unpaid held units release once |
| Roles | Secure server-enforced admin permissions | Owner manages catalog/settings/promos/roles; staff handles permitted order/stock actions; no public self-elevation |
| Services | Owner activates services/subscriptions; actual emails required for connected draft testing | Supabase and Resend integrations prepared; provider accounts, sender/DNS, secrets, and jobs need owner setup |

## Traceability matrix

**How to read this table:** API/action and page names describe where the implementation is required by `IMPLEMENTATION-CONTRACT.md`. They do not certify that the action passed runtime testing. At handoff, review the corresponding code and record technical evidence above. Each behavior must also be exercised in the connected preview using the named acceptance cases. A setup-blocked behavior stays blocked rather than being marked complete because a button exists.

| ID | Requirement | Implementation location / action | Acceptance cases | Evidence / prerequisite |
| --- | --- | --- | --- | --- |
| Q01 | Separate main-based development copy, preserve existing website, no live change without approval | Git branch; original HTML/assets; additive shop navigation | A01–A03 | Actual fork/branch and final diff must be recorded |
| Q02 | Complete original website plus ordering preview | Original routes; shop/account/manage pages | A01–A06 | Reachable preview required; unconfigured visual mode is limited |
| Q03 | No product import; labelled demo only | Empty database bootstrap; pause default; optional isolated demo | A03, C01 | Inspect initial database and demo labels |
| Q04 | PHP two decimals and Asia/Manila consistently | Shared formatter; server integer-centavo and calendar logic | A06, R14, D01–D07 | Connected browser/server comparison pending |
| Q05 | Optional guest checkout; verified account required only for promo use | `create_order`, `quote`, Supabase Auth checks | O01, U09, R06–R10 | Supabase configured |
| Q06 | Unique email/password, sign in/out, verify/resend | account/callback pages; Supabase Auth with custom SMTP | U01–U05 | Auth sender/SMTP and actual inbox tests required |
| Q07 | Forgot Password; secure expiring single-use reset | reset page; Supabase Auth recovery | U06–U07 | Configured redirect URLs; actual reset-email receipt required |
| Q08 | Preserve cart/date/checkout through auth | Shared client/account and checkout draft storage | U01–U02, U05, U09 | Browser auth roundtrip required |
| Q09 | Own order history includes awaiting/under-review | `my_orders`, authenticated owner lookup | U08, S02 | Account-bound records; no email-only authorization |
| Q10 | Browse/filter photos/descriptions/options/quantities | `catalog`; shop product/category/dialog/cart | C01–C11 | Real admin-created test products required |
| Q11 | Mixed-box configurable exact count, per-choice surcharges | Product option groups; trusted quote/create validation | C03–C08, R04 | Counted selections; no flavor inventory |
| Q12 | Distinct mixes and min sellable-unit quantity | Cart configuration identity; server minimum/selection checks | C04–C08 | Quantity input and modified-request checks |
| Q13 | Cart quantities/removal/all totals/date errors; no silent removals | Shop cart/checkout; `quote` | C09, C11, O07, D14 | Loading/empty/validation/error UX review |
| Q14 | Full production days anchored at submission | Server lead-time calculator in quote/create | D01–D07 | Actual Monday or controlled staging time harness |
| Q15 | Per-product lead days and longest cart lead; earliest suitable date | `catalog`/`quote` date availability; `create_order` recheck | C11, D01–D07 | Supported dates and per-date capacity configured |
| Q16 | Production exclusions separate from booking closures | Settings production/nonproduction/fulfillment/blocked dates | D02–D03, D11, A04 | Owner enters real operating policy |
| Q17 | One fulfillment date/method; no customer time slots | Checkout schema; shop UI | D04, O06 | No split-order or slot control |
| Q18 | Capacity per product/date, pickup+delivery shared | Date inventory and reservation transaction | D08–D10, X01 | Database transaction/concurrency checks required |
| Q19 | Manual unavailability preserves existing orders | `save_inventory`, `save_product`, `save_settings` | C07, C10, D11–D13 | No destructive historical rewrite |
| Q20 | Server final validation of price/date/quantity/configuration | `quote`, `create_order` | D14, S05, X01–X03 | Client-provided totals untrusted |
| Q21 | Required buyer; optional social; separate delivery recipient/address | Checkout payload; server required-field validation | O01–O04 | Pickup address not required from customer |
| Q22 | Supported fixed-fee delivery zones | `save_zone`; server locality-to-zone match | O02, O05, A04 | Real covered localities/fees await owner data |
| Q23 | Pickup information and delivery-window wording | Settings; shop/order summaries | A04, O01, O06 | Real pickup hours/instructions await owner data |
| Q24 | Manual full initial payment, no gateway/deposit/installments | Settings instructions; order creation/status screens | P01, O07 | No actual payment transfer required in test |
| Q25 | Unique reference, Awaiting payment/Pending confirmation, reserve immediately | Atomic `create_order`; saved deadline | O07, D08–D09, R07 | Persistent database required |
| Q26 | Proof within 15 minutes → Under review, never auto-Paid | `proof-upload` Edge Function; atomic proof commit | P02–P03, P06–P07 | Private storage and upload function configured |
| Q27 | Under-review holds survive staff delay indefinitely | Status-aware expiration/worker | P05, P12 | Test beyond deadline; scheduler active |
| Q28 | No proof → Expired and release once, disable upload | Expiration transaction; worker and lazy checks | P04, P06–P07, X09 | Worker schedule required; exact boundary evidence separate |
| Q29 | Manual approval staff/time/immutable initial amount; commit once | `approve_payment`; payment record; history | P08, P12, X06 | Authorized owner/staff only |
| Q30 | Rejection closes permanently, records reason, releases unredeemed holds | `reject_payment`; secure order message | P09–P12, E03 | Actual rejection email requires sender/worker |
| Q31 | Recovery new order/contact; no automatic instruction to pay twice | Rejected/expired order screens and email templates | P10, E03 | Contact information configured |
| Q32 | Catalog create/edit/hide/archive/photos/order/categories/options/prices | Admin catalog; `save_product`, category actions; product upload | C01–C08, C10 | `active=false` reversible archive/hide; storage configured |
| Q33 | Product-specific daily quantity/availability controls | Admin inventory; `save_inventory` | D08–D12 | Sellable boxes only, no global pool |
| Q34 | Promos percent/fixed/min/cap/account/global/expiry/active | Admin promo editor; `save_promo`; `quote` | R01–R11 | Owner role; verified customer for redemption |
| Q35 | Product+surcharge subtotal only; bounded nonnegative discount | Trusted promo calculation | R01–R05, R14 | Recorded server rounding convention |
| Q36 | Reserve promo only at submission; held+redeemed count; atomic final use | Promo reservation within `create_order` | R06–R08, X02–X03 | Database concurrency check required |
| Q37 | Snapshot original rules/time; later deactivation/expiry cannot revoke hold | Saved promo rules and original eligibility | R09–R10, R13 | Active order preserves original discount |
| Q38 | Approve redeems once; unpaid terminal events release; paid cancellation never restores | Approval/reject/expire/cancel transactions | R08, R12, X06, M18 | Refund label is independent |
| Q39 | Admin edit recalc saved rules, min/cap; history original+revised | `edit_order`; promo reservation/requalification | M11–M14, R13 | No second redemption; original expiry eligibility |
| Q40 | Search/filter orders, upcoming date view, detail/proof/history | `admin_bootstrap`; manage search/filter/detail | M01, M20 | Staff authentication and proof signed URL |
| Q41 | Private staff notes, approval/rejection/cancel/status actions | `add_staff_note`, payment/status/cancel actions | M02, M17–M19 | Verify customer serializers omit private notes |
| Q42 | Edit items/configs/qty/date/method/contact/recipient/address/fee | `edit_order` with reason/revision/idempotency | M03–M10, M16 | Preview total before save; audit before/after |
| Q43 | Admin lead-time bypass with affected date/stock checks | Admin edit validation distinct from customer create | M04–M06 | Lead time only bypassed; unsupported/sold-out target fails |
| Q44 | Contact-only corrections do not revalidate stock/date as new order | `edit_order` identifies affected fields | M03, M10 | Original snapshots/allocations retained |
| Q45 | Atomic delta quantity/date movement with rollback and concurrency control | Transactional `edit_order` and revision guard | M04–M10, M16, X07 | Local DB plus connected replay evidence required |
| Q46 | Saved price for unchanged config, current for new | Item identity/snapshot pricing in edit | M07–M08, C10 | Quantity-only saved-price default disclosed |
| Q47 | Paid edits retain Paid/current progress/original approved amount | `edit_order`; immutable approval record; history | M14–M15, E09 | No extra-payment state/request/email |
| Q48 | Cancel reason and explicit restoration choice; separate Refund label | `cancel_order`, `set_refund_label` | M17–M18, R12, E04 | Label displays fulfillment as Refunded and excludes the full current value from analytics; manual transfer is not performed or confirmed |
| Q49 | Separate payment/fulfillment; explicit ready/dispatched/completed only | `set_fulfillment`; method-aware transition validation | M19, E05–E06 | Fulfillment date never advances status itself |
| Q50 | Customer cannot directly amend/cancel submitted order | Owner/admin authorization; customer contact route | O09, S01–S03 | Server-enforced, not just hidden UI |
| Q51 | CSV export and printable summary | Admin export/print | M20 | Formula-injection handling and privacy review |
| Q52 | Secure guest access and account-owned access; no reference-only leak | `get_order`, secure token, `my_orders`; RLS | O08, U08, S02–S04 | Supabase/private storage configured |
| Q53 | Disable proofs in review/paid/rejected/expired/cancelled | Upload precheck and atomic final state check | P11, S07 | Includes direct endpoint requests |
| Q54 | Actual submission/approval/rejection/cancel/status emails with reference/link | Durable outbox; `email-worker`; Resend | E01–E05, E09–E10 | Sender/API/worker setup and mailbox receipt required |
| Q55 | Manila paid-active due-date reminder; skip terminal/unpaid | Worker current-date/status eligibility | E06–E08, E11 | Reminder enabled/time configured; scheduled worker running |
| Q56 | Reminder date changes and order/date dedupe, stale-queue guard | Persistent reminder key and send-time recheck | E07–E08, E11, X09 | Retry/restart test required |
| Q57 | Pause only new orders, existing secure access/proofs remain | Settings and creation-specific pause check | D13 | Valid existing orders independent of pause |
| Q58 | Persistent DB and admin changes without deployment | Supabase tables, RPCs, Auth, Storage | A04, S10 | External setup pending until owner connects staging |
| Q59 | Admin server roles, own history, private data/proofs | RLS, secured RPCs, `list_staff`/`save_staff`, protected owner assignment | M21–M22, S01–S04 | No service credentials in browser |
| Q60 | Upload contents/type/size on server and private storage | `proof-upload`, `proof-url`; bucket policy | P03, S04, S06–S07 | JPEG/PNG/WebP ≤5 MB; private proof URLs |
| Q61 | Idempotent create/approve/edit/release and simultaneous final unit/use protection | Transactional RPCs; idempotency keys; revision guards | X01–X09 | UI disabling alone is not sufficient evidence |
| Q62 | Preserve history and payment records; secrets absent from code | Order snapshots/audit/payment tables; public config only | C10, M11–M15, S08–S10 | Inspect final repository and customer responses |
| Q63 | Owner-controlled service setup/cost/free options/secrets/DNS walkthrough | SETUP.md and SERVICES.md | A03–A04, U01–U07, E01–E11 | No accounts/billing activated on owner's behalf |
| Q64 | Practical administrator UAT with test data/steps/expected/blank results | ACCEPTANCE.md | All cases | Brent performs/reports results himself |
| Q65 | Honest incomplete/setup-blocked list; approval before merge/live publication | This evidence record; final handoff; SETUP.md | A02, final approval record | Must be updated with actual final delivery evidence |

## Order state contract

Payment and fulfillment are separate fields. Refund is a manually applied/removable label, not a payment or fulfillment state. For analytics, it means a full refund: exclude the latest paid order value, units, rankings and pickup/delivery count. Original payment approvals remain recorded; the actual refund is sent manually.

| Event | Payment afterward | Fulfillment afterward | Stock / promo | Further proof |
| --- | --- | --- | --- | --- |
| Successful new submission | Awaiting payment | Pending confirmation | Hold product/date units and eligible promo once | Allowed before deadline |
| Successful timely proof | Under review | Pending confirmation | Keep holds regardless of review delay | Disabled |
| No successful proof within 15 minutes | Awaiting payment | Expired | Release held units and unused promo once | Disabled |
| Admin approves full initial payment | Paid | Confirmed | Convert held units to committed and promo to redeemed; no second deduction | Disabled |
| Admin rejects initial proof | Rejected | Cancelled | Release held units and unused promo once; preserve reason/history | Permanently disabled |
| Admin cancels unpaid order | Existing unpaid status | Cancelled | Release applicable holds once | Disabled |
| Admin cancels paid order | Paid | Cancelled | Explicit quantity restoration choice; redeemed promo stays counted | Disabled |
| Admin edits paid active order | Paid | Preserve existing progress | Apply only affected quantity deltas; recalculate saved discount; retain initial approved payment record | Disabled |

Permitted fulfillment values are Pending confirmation, Confirmed, Preparing, Ready for pickup, Out for delivery, Completed, Cancelled, and Expired. Staff controls fulfillment progress; the date alone never marks readiness, dispatch, or completion.

## External setup and remaining release gates

| Gate | Owner action / evidence needed | Affected behavior until complete |
| --- | --- | --- |
| GitHub fork/write access | Confirm a real fork under an account with write access and preserve main-based development branch | A local completed change cannot be represented as a pushed fork |
| Supabase staging project | Owner creates/selects project; applies migrations/configuration and public client settings | Persistent catalog/settings/orders, authentication, transactional stock/promos |
| Protected first owner | Register/verify account, then perform documented privileged role assignment | Secure admin access |
| Storage / Edge Functions | Configure buckets/policies; deploy functions and private environment secrets | Image upload, private payment proof, signed staff viewing |
| Authentication SMTP | Verify sender domain; configure custom SMTP and auth redirect URLs/token lifetimes | Actual verification/resend/reset emails |
| Transactional email provider | Owner verifies domain/DNS and configures API secret | Actual order/status emails; an outbox entry alone is not delivery |
| Scheduled worker | Configure authenticated periodic invocation, reminder time, and monitoring | Timely automated expiry, due-date reminders, durable email retries |
| Business settings | Owner supplies actual pickup/payment/contact data, schedules, zones/fees/capacities | Correct real business behavior; demo data is not operational configuration |
| Connected preview UAT | Owner runs checklist, records results, resolves failed/blocked cases | No claim of accepted or production-ready ordering |
| Final repository review / approval | Record final diff/commit, fork URL, merge approval and live deployment approval | No main merge or live-site publication |

Do not add loyalty programs, additional promotions, live payment gateways, deposits/installments, extra-payment workflows, refund processing/ledgers, live courier booking/pricing, flavor inventory, shared stock across dates, order-count capacity, or customer time slots without a new request.
