# Ordering implementation contract

Draft based on upstream main 571de6e9fcb51a70bafc1483a0b6fe11752f5198. Original static site stays; ordering is additive. Empty catalog by default, no imported products. Optional explicitly labelled demo is separate from real backend. PHP amounts in integer centavos in API/DB, 2 decimals in UI. Asia/Manila dates/times. Supabase Auth + PostgreSQL + Storage + Edge Functions, Resend SMTP/API. No accounts/billing activated by this build.

## File ownership and public client

- Root: `shop.html`, `assets/ordering/shop.js`, `assets/ordering/ordering.css`, original navigation links, integration.
- Backend: `supabase/migrations/*` and SQL tests, schema and all DB/RPC logic.
- Services: `supabase/functions/*`, `supabase/config.toml`, docs/SETUP.md, docs/SERVICES.md, scheduler setup; coordinate SQL helper functions directly with backend agent.
- Admin UI: `manage.html`, `assets/ordering/manage.js`, `assets/ordering/manage.css`.
- Account/client: `account.html`, `auth-callback.html`, `reset-password.html`, `assets/ordering/client.js`, `assets/ordering/account.js`, `assets/ordering/config.js`.
- QA guide agent: docs/ACCEPTANCE.md, docs/REQUIREMENTS.md.

Browser client exports `api(action, payload={}, token=null)`, `auth`, `ready`, `configured`, `money(cents)`, `escapeHtml(value)`, `manilaDate(value?)`, `formatDate(ISOdate)`, `toast(message,type?)`, `upload(file, {kind,order_id,token,payment_reference})`. `auth` is Supabase client.auth or null; `ready` resolves auth initialization. Import Supabase JS from a pinned ESM CDN module only when configured so disconnected preview renders. config.js exports `config={supabaseUrl:'',supabasePublishableKey:''}`. api calls RPC `shop_api` with `p_action, p_payload, p_token`. Throw Error with server message on failures; server returns data directly. Auth session automatically forwarded by Supabase SDK. No service key in browser.

All pages use shared CSS and consistent header logo at assets/img/brands/Hat.png; main shop link shop.html, account account.html, staff manage.html. Body #toast-region live region added by client. Shared CSS classes: page-shell, topbar, brand, nav-links, panel, button, button-secondary, button-quiet, field, field-row, muted, eyebrow, badge, empty-state, notice, danger, success, section-heading, table-wrap, data-table, dialog-actions. Root supplies CSS.

## Product shape

`{id:uuid,name,description,category_id:uuid|null,price_cents:integer,min_quantity:integer,lead_days:integer,active:boolean,photos:string[],option_groups:[],sort_order:integer}`.
Each option group `{id:string,label:string,required_count:integer,choices:[{id:string,label:string,surcharge_cents:integer,active:boolean}]}`. required_count=1 is single choice; >1 uses counted mix summing exactly required_count. Products can have multiple groups. Selection payload maps group ids to choice counts: `{flavour:{classic:4,matcha:2}}`. Surcharges per sellable unit. Only box/product stock, never flavor stock.
Categories `{id,name,sort_order}`.
Inventory `{product_id,date:YYYY-MM-DD,capacity:integer,available:boolean,reserved?:integer,remaining?:integer}`. Every sellable date requires explicit capacity row; missing row means unavailable. Shared pickup/delivery inventory.

## Settings shape

`{shop_name:'The Little Baker Kitchen',paused:true,pause_message,pickup_address,contact_email,contact_phone,payment_instructions,delivery_window:'9:00 AM – 6:00 PM',production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],cutoff_time:null,reminder_time:'08:00',reminders_enabled:false,owner_email,site_url}`. Sunday=0. Default paused until owner sets operational details; no fabricated bank details. Cutoff is disabled by default: production counting starts tomorrow. With a cutoff configured, count the order date when submission is strictly before the cutoff in Manila and the date is eligible for production; at/after the cutoff start tomorrow, without increasing the required day count. Production weekdays and nonproduction exclusions always apply. Fulfillment follows the final counted production date. Zero-day products without same-day opt-in still start tomorrow. No customer time slots. delivery zones `{id,name,localities:[string],fee_cents,active}`; locality is explicit selectable city/barangay combined label, matched exactly server-side.

## API actions

`catalog` payload `{date?}` -> `{products,categories,settings,zones,inventory}`. inventory can cover next 90 days; ignore private settings owner_email. `quote` payload checkout as below -> `{items,subtotal_cents,discount_cents,delivery_cents,total_cents,promo,earliest_date?}`; no reservations at quote. Error stock/date detail actionable; never silently remove/change cart.

Checkout payload `{items:[{product_id,quantity,selections}],fulfillment_date,method:'pickup'|'delivery',buyer:{name,email,phone,social_platform:'facebook'|'instagram'|'na',social_username},recipient:{name,phone}?,address:{locality,line1,line2?,postal_code?}?,instructions?,promo_code?,idempotency_key:uuid}`. `create_order` -> order including access_token only for successful submission/retry. Random secure token digest stored for access; privacy policy table prevents unauthorized reads.
New customer orders require an explicit social platform and a trimmed nonblank username/profile name (maximum 100 characters). Facebook/Instagram may use `N/A`; platform `na` requires `N/A` (case-insensitive). Quotes can omit social contact. Existing orders with both social fields blank remain editable; replaying an identical previously successful submission remains valid.

`get_order` payload `{order_id}` with token or authenticated owner/admin -> order. `my_orders` -> array of own orders; authenticated email user, not email-only lookup. Guest order does not silently attach just by same email.

Order shape `{id,reference,created_at,fulfillment_date,method,buyer,recipient,address,instructions,items,subtotal_cents,discount_cents,delivery_cents,total_cents,promo_snapshot,payment_status,fulfillment_status,payment_deadline,proof_path,payment_reference,paid_amount_cents,refund_label,revision,history:[],access_token?}`. Item snapshots `{product_id,name,quantity,selections,selection_labels:[],unit_price_cents,line_total_cents}`. Payment statuses awaiting_payment,under_review,paid,rejected. Fulfillment pending_confirmation,confirmed,preparing,ready_for_pickup,out_for_delivery,completed,cancelled,expired. History rows `{at,actor,action,reason,before?,after?}`.

`admin_bootstrap` -> `{role,products,categories,settings,zones,inventory,promos,orders}` (role owner or staff). Staff can order operations/stock, owner also catalog/settings/promos/roles. Server must enforce.
`save_product` payload `{product:<shape>}` -> product; new id absent generate.
`save_category` payload `{category:<shape>}` -> category; `delete_category` payload `{id}` safely clear category refs.
`save_inventory` payload `{rows:[{product_id,date,capacity,available}]}` -> rows. Cannot reduce below held+committed allocations. Mark unavailable does not alter orders.
`save_settings` payload `{settings:<shape>}` -> settings.
`save_zone` payload `{zone:<shape>}` -> zone; deactivate for removal.
Promo `{id,code,kind:'percent'|'fixed',value:integer,min_subtotal_cents:integer,cap_cents:integer|null,per_account_limit:integer,global_limit:integer,expires_at:ISOtimestamp,active:boolean}`; percent value is whole percent (1-100), fixed value centavos.
`save_promo` payload `{promo:<shape>}` -> promo.
`approve_payment` payload `{order_id,revision,idempotency_key}` -> order. Only under_review, one approved initial payment; reserved stock becomes committed, no second subtraction; original approved amount fixed.
`reject_payment` payload `{order_id,revision,reason,idempotency_key}` -> order (Rejected + Cancelled, release all held, permanent proofdisable).
`set_fulfillment` payload `{order_id,revision,status,idempotency_key}` -> order; method-specific allowed progress, only Paid and active, no date autochanges.
`cancel_order` payload `{order_id,revision,reason,restore_stock:boolean,idempotency_key}` -> order. Paid remainsPaid; redeemedpromo not restored; produced quantity returns only explicit true. Unpaid always releases.
`set_refund_label` payload `{order_id,revision,enabled:boolean,reason,idempotency_key}` -> order; updates the label only in storage. Analytics treats an enabled label on a paid order as a full refund: exclude its entire current value, units and fulfillment method from net sales reporting. Admin and customer fulfillment badges, admin fulfillment filters and CSV exports show **Refunded** while the label is enabled; the stored fulfillment progress is preserved and reappears when the label is removed. Refunded orders are excluded from upcoming fulfillment lists and the progress selector is hidden until the label is removed. Manual money transfers, stock, stored payment/fulfillment states and promo usage are unchanged.
`edit_order` payload `{order_id,revision,reason,idempotency_key,changes:<partial checkout payload plus delivery_cents override>}` -> order. Preserve same config prices (incl qtyonly edits), current price for new config. Bypass lead but validate changed stock/date; contact-only not revalidate. Atomic delta allocations, rollback on failure. Saved promo rules recalculated; original eligibilitytimestamp; paid redemption persists incl zero discount; unpaid below min releases, requalification reacquires one sameorder reservation if capacity. Paid+fulfillmentprogress+originalpaidamount unchanged. Event old/new calculation.
`list_staff` -> array `{user_id,email,role}`; `save_staff` payload `{email,role:'owner'|'staff'|'none'}` only owner; existing verified user needed. Cannot remove final owner. First owner assigned manually via protected SQL after verifying signup, not public setup URL.

## Edge API

`proof-upload` POST multipart file,kind='proof'|'product',order_id,token,payment_reference (optional). Missing or blank references are saved as null; supplied text is trimmed and limited to 200 characters. A valid proof image remains required. Access Authorization supplied session or anon key; proof guest allowed securely, product admin-only. Validate image magic PNG/JPEG/WebP max5MB. Private proof bucket, public product images bucket; random filenames. Validate status both before storage and atomically at proof commit; delete object on race/failure. Returns `{order}` for proof, `{url,path}` for product. Uploaded proof before deadline Under review indefinitely. Token is never URL query to third-party endpoint.
`proof-url` authenticated admin POST `{order_id}` -> `{url}` expiring5min. No public proof URLs.
`email-worker` secret worker token only; expire no-proof holds and queue due reminders (server-side periodic jobs also lazy expiration in order transactions), claim outbox, recheck due date/status, deliver with Resend idempotency keys, durable sent guard, retry backoff. Auth emails by Supabase custom SMTP. Failed configuration/delivery visible to admin (add email status bootstrap as necessary); never report email sent merely because queued.

Successful `commit_proof` queues `order_review_required` in the same transaction for every verified `tlb.staff` owner/staff account. Deduplicate normalized recipient addresses and use a durable `review:<order_id>:<revision>:<address_hash>` event key. Store the review summary, saved item names/quantities/selection labels/unit and line prices, subtotal/discount/delivery/total and promo code, shop name/site URL, and recipient account IDs; do not include customer access tokens, proof storage paths, or private history. `prepare_email` rechecks current role, verified address and unresolved review status; stale notifications become skipped. Staff emails link to `manage.html` and require normal authentication. The feature uses the existing scheduler independently of fulfillment reminders and does not backfill old orders.
Services/backend agents coordinate service-only RPC helper signatures, outbox schema and cron. RPC helpers revoked from public except explicitly authorized methods. RLS private tables; public read only via function. Auth.uid()/verified auth.users email checked for promos/owner history/admin.

## Preview

Real integration starts empty and paused. Unconfigured mode must explicitly say backend setup pending and never pretend accounts/emails/orders are persisted. May include optional opt-in demonstration sample data explicitly labelled and isolated, but live catalog has no samples. User activation of external services needed. Preserve original site navigation/content/photos and no deployment to live/main without approval.

## Integration refinements

Actual item `selection_labels` are objects `{group,label,quantity,surcharge_cents}`; render their count and surcharge. Order operational snapshots are flat fields (`payment_instructions`, `pickup_address`, `pickup_hours`, `pickup_instructions`, `delivery_window`, `contact_email`, `contact_phone`). `preview_edit_order` accepts order_id,revision,changes and returns a proposed order with preview:true. Browser `create_order` and operational `edit_order` submit `expected_quote` containing items/subtotal_cents/discount_cents/delivery_cents/total_cents; the DB compares these to current trusted calculations before writing, requiring review again if changed. Closed orders allow audited contact-only corrections; changes to closed order items/date/method remain guarded. `add_staff_note` is private.

## Required social contact rollout

For an existing live shop, apply `20260918054801_require_social_contact.sql` first to accept N/A while retaining the current checkout. Publish the matching checkout/admin assets next. Once the updated checkout is live, apply `20260918055004_enforce_social_contact_checkout.sql` to enforce required social contact for new submissions on the server. Both migrations are needed for a complete rollout; do not run the strict second stage ahead of the checkout update. A fresh installation can apply both before opening the shop.
