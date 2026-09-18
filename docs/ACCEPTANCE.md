# Administrator acceptance checklist

This is Brent's checklist for the **preview environment**. No scenario below has been marked passed on Brent's behalf. A working screen, a code check, and a delivered email are different evidence. Record what actually happens; use **Blocked** when configuration or a feature is missing.

Do not run these scenarios against the live shop. Test accounts, products, proof images, addresses, and payment instructions must say **DEMO — TEST ONLY**. Do not make real transfers. The real catalog starts empty; nothing is imported from the existing website.

| Test record | Enter before starting |
| --- | --- |
| Preview URL | ______________________________ |
| Development branch / commit | ______________________________ |
| Tester and Manila date/time | ______________________________ |
| Browser / mobile device | ______________________________ |
| Supabase staging project | ______________________________ |
| Verified sender / email provider | ______________________________ |
| Email worker / scheduler configured | ______________________________ |
| Overall outcome and unresolved issues | ______________________________ |

For each test, fill **Actual / result / issue** with observed behavior, Pass / Fail / Blocked, and an issue reference. Keep screenshots, references, and mailbox timestamps as evidence. Do not put passwords, access tokens, payment images, or private customer data in a public GitHub issue.

## 1. Prepare the preview

Read [SETUP.md](SETUP.md) and [REQUIREMENTS.md](REQUIREMENTS.md). The owner creates accounts, chooses plans, verifies the sender domain, and configures secrets. Paid services are enabled only by the owner. An unconfigured visual preview cannot demonstrate persistent orders, secure accounts, uploaded proofs, or actual email delivery.

Use a separate staging database and sender. Confirm the preview is connected to that database before adding test records. Create the first verified owner through the protected setup instructions; a public sign-up must never grant admin access.

Create these fixtures through admin. These are proposed test values, not TLB Kitchen's real products, prices, bank details, production schedule, or service areas.

| Fixture | Demo value |
| --- | --- |
| Customer A and Customer B | Two inboxes you control, each with a separate verified account; use different browser profiles |
| Unverified Customer C | A third controlled inbox; leave unverified initially |
| Staff S | Separate verified staff account, assigned the staff role by the owner |
| Category | `DEMO — Cookies` |
| Product A | `DEMO — Mixed Cookie Box`; PHP 300.00 base; minimum 1 box; lead time 1 full production day |
| Product A selections | Group `Flavour`, exactly 6; Classic +PHP 0.00 each, Matcha +PHP 30.00 each |
| Product B | `DEMO — Celebration Box`; PHP 500.00; minimum 2 boxes; lead time 3 full production days; no options |
| Product C | `DEMO — Single Treat`; PHP 100.00; minimum 1; lead time 0; no options |
| Date D | A future supported fulfillment date after every tested product's lead time; start with capacity A=10, B=10, C=10 |
| Date E | Another future supported date; separately set A=10, B=10, C=10 |
| Baseline schedule | All production and fulfillment weekdays enabled; no exceptions; cutoff disabled |
| Demo zone | `DEMO — Test Area`; covered locality `DEMO City / DEMO Barangay`; fee PHP 120.00 |
| Unsupported locality | Any locality that is not configured in a supported zone |
| Buyer | `DEMO Buyer A`; an email you control; a clearly labelled test phone number |
| Recipient | `DEMO Recipient B`; a different test phone number; separate address fields |
| Pickup / contacts | Explicit demo address, hours, instructions, and contact details you control |
| Payment instructions | `DEMO — Do not transfer money. Upload the test receipt for acceptance testing.` |
| Delivery window | 9:00 AM–6:00 PM |
| PCT10 | 10%; minimum PHP 1,000.00; cap PHP 200.00; account limit 5; total limit 20; expiry after testing |
| FIX500 | Fixed PHP 500.00; minimum PHP 0.00; account limit 5; total limit 20; expiry after testing |
| LASTUSE | 10%; minimum PHP 0.00; account limit 1; total limit 1; expiry after testing |
| Proof fixtures | JPEG, PNG, and WebP images saying `DEMO — NOT A PAYMENT`; each below 5 MB |
| Invalid proof fixtures | Plain text renamed `.jpg`; SVG; PDF; a valid image larger than 5 MB |

Set real operational details only after acceptance. Reset date quantities, promo limits, and unrelated test orders between scenarios so earlier holds do not change expected numbers. Cancel test orders through the supported admin flow; do not delete payment history directly. All dates and times below are **Asia/Manila**.

## 2. Existing website and configuration

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| A01 | Open preview home, About, pastries, custom orders, dessert bar, party carts, blog, testimonials, FAQ, contact, and a missing URL. Follow their existing links. | Original content, branding, navigation, and existing behavior remain available; ordering is additive. | __________________ |
| A02 | Compare live website and main with the preview branch; inspect repository base and changes. | Development starts from upstream main `571de6e9fcb51a70bafc1483a0b6fe11752f5198`; changes are isolated. A local clone is not represented as a completed GitHub fork. No merge or live deployment has occurred. | __________________ |
| A03 | Open an unconfigured preview, then the configured staging preview with a new empty database. | Unconfigured mode clearly says setup pending. Configured catalog is empty and ordering is paused until owner setup. Any optional demonstration is explicitly labelled and isolated from real orders. | __________________ |
| A04 | Configure business contact, pickup address, instructions, opening hours, payment methods/details/instructions, delivery window, reminder time, and schedules. Reload shop in another session. | Values persist and reach customer screens without editing code or redeploying. No invented live payment account appears. | __________________ |
| A05 | Open shop and checkout on a narrow mobile screen and desktop; deliberately trigger loading, empty, success, and validation states. Use keyboard navigation. | Readable amounts/photos, usable controls and dialogs, visible focus, labelled fields, clear errors; no clipped checkout controls or accidental horizontal overflow. | __________________ |
| A06 | Compare price, proof deadline, order time, promo expiry, and fulfillment date across devices in different local time zones. | PHP amounts always have two decimals; business dates/times remain Manila. Browser time zone does not change server eligibility. | __________________ |

## 3. Catalog, choices, and cart

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| C01 | Create demo category and Products A–C with the fixture values; add descriptions and multiple labelled demo photos. Open the shop. | Products appear in the correct category with correct names, descriptions, prices, photos, ordering information, and selected-date availability. | __________________ |
| C02 | Replace one photo, reorder photos, remove a photo, change category and display order. Reload shop. | Changes persist and appear without a deployment; removed photos no longer appear in the product gallery. | __________________ |
| C03 | On Product A select 4 Classic + 2 Matcha. | Selection count is 6; surcharge is PHP 60.00; unit price is PHP 360.00 before adding. | __________________ |
| C04 | Add two units of that mix, then one unit with 6 Classic. Open cart. | Two distinct configurations remain distinguishable: 2 × PHP 360.00 and 1 × PHP 300.00, subtotal PHP 1,020.00; displayed flavor counts describe each box. | __________________ |
| C05 | Attempt Product A with totals 5 and 7; submit negative/fractional quantities if possible through a modified request. | Invalid configurations are rejected on the server; no order or reservation is created. Exact configured selection count is enforced. | __________________ |
| C06 | Change Product A's required count to 4 and configure another choice surcharge. Create a fresh cart configuration. | Counts and prices follow admin settings; neither count 6 nor the example flavors are hard-coded. | __________________ |
| C07 | Mark Matcha unavailable, then hide/temporarily disable Product A. Try a fresh checkout with an old cart. | New unavailable choices/products cannot be submitted; the error names the affected item. Already-submitted order details remain intact. | __________________ |
| C08 | Attempt to buy one Product B; then buy two. | Minimum quantity applies to sellable boxes. One fails; two succeeds when date/capacity allow. Mixed-box inner counts do not satisfy a box minimum. | __________________ |
| C09 | Increase/decrease cart quantities, remove one line, reload, and reopen checkout. | Correct selections and totals persist; cart supports empty state; no submitted order is created until submission. | __________________ |
| C10 | Submit an unpaid order; then change catalog price, description, options, and archive that product. Open the saved order. | Saved product details, configuration, unit prices, and totals remain unchanged. Archive preserves history. | __________________ |
| C11 | Select a date before browsing; change to an unavailable date with items already in cart. | Product/date availability and reasons are shown; affected items remain in cart. Customer must choose a suitable date or explicitly remove items. | __________________ |
| C12 | Enable **Pickup only** on a product, save, reload its editor and browse the shop with Pickup selected. | The setting persists; the product is clearly marked pickup only and can be ordered for an otherwise available pickup date. | __________________ |
| C13 | Put that pickup-only product and a delivery-eligible product in one cart, then select Delivery. Repeat with a stale checkout opened before the setting changed. | Delivery is blocked for the whole cart with an explanation naming the affected product. The customer can choose Pickup or remove it; no automatic split order, silent removal, or submission occurs. The server rejects a direct delivery quote/order attempt as well. | __________________ |
| C14 | Disable **Pickup only**, save and reload the shop. | Delivery is available again when the date, zone and stock permit it. Existing saved orders are not changed by either setting change. | __________________ |

## 4. Full production days and date capacity

Run the Monday example on an actual Monday in the preview or through an explicitly controlled staging test harness. Changing a browser clock does not change server time and does not prove the rule. Record a scheduled test as Blocked / pending until it is performed.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| D01 | With Tuesday production enabled and cutoff disabled, submit Product A on Monday. Compare Tuesday and Wednesday. | Tuesday is unavailable; Wednesday is earliest, if capacity and fulfillment availability permit. Monday placement and Wednesday fulfillment do not count as production days. | __________________ |
| D02 | Repeat D01 with Tuesday marked non-production. | Tuesday is skipped; Wednesday becomes production and Thursday is earliest, assuming open dates. | __________________ |
| D03 | Restore Tuesday production but block Tuesday only from further fulfillment bookings. Repeat D01. | Tuesday still counts as production; earliest remains Wednesday. Booking closures and non-production dates are separate. | __________________ |
| D04 | Add A and B to one cart on a Monday with all dates open. | The entire order uses one date; B's three full production days require Friday earliest. No split date or method is silently introduced. | __________________ |
| D05 | Configure a cutoff at a practical upcoming Manila time. Attempt just before, at, and after it. | Before cutoff, an eligible order day counts; at/after cutoff, production starts tomorrow. With a noon cutoff and all production days open, a two-day product ordered September 19 is eligible September 21 before noon or September 22 at/after noon. Excluding September 19 makes September 22 earliest on either side of noon. Server submission time controls the boundary. | __________________ |
| D06 | Put Product C with zero lead time and **Allow same-day orders** disabled into a cart. Attempt same-day fulfillment. | Same-day remains unavailable. Zero production days alone does not enable it; existing cutoff and date/capacity rules still apply. | __________________ |
| D07 | Submit before cutoff, upload proof, approve on a later day. | Lead-time eligibility remains anchored to order creation. Approval does not move the fulfillment date or restart production counting. | __________________ |
| D08 | With A capacity 10 on D and E, order three A boxes for D. Inspect capacity. | D remaining=7; E remaining=10. Inner flavor counts do not affect inventory. | __________________ |
| D09 | Add two pickup A boxes and two delivery A boxes for D. | Both methods draw from the same D capacity; no independent pickup/delivery pool or order-count limit exists. | __________________ |
| D10 | Configure no capacity row for A on another date, then configure capacity zero on another date. | Both dates are unavailable for A; missing capacity never means unlimited. | __________________ |
| D11 | Mark A unavailable on D after an order exists; block D globally afterward. | New selections are blocked. Existing order, reservation, valid payment access, and history remain unchanged. | __________________ |
| D12 | Attempt to lower D capacity below its current held plus committed units. | Capacity edit is rejected with a useful explanation; existing orders are not removed or silently changed. | __________________ |
| D13 | Pause new orders while a valid awaiting-payment order exists. Visit existing order link and submit valid proof before deadline. | New orders are blocked; existing order access, payment instructions, and valid proof submission work. Main website stays online. | __________________ |
| D14 | Leave a cart open; another session consumes remaining capacity or staff blocks the date. Submit the stale cart. | Server rejects the unavailable request with an actionable explanation; no partial order, stock hold, or promo hold survives failure. | __________________ |
| D15 | Use the **Non-production dates** calendar to select two dates in different months; toggle one off, save, and reload. Navigate and select with a keyboard too. | Selected dates are visibly identified and persist across month navigation and saving; toggling removes only that date. These dates stop counting toward product lead time, without automatically becoming booking closures. | __________________ |
| D16 | Use **Closed to new fulfillment bookings** to select a date and save. Check Pickup and Delivery for that date, then remove the selection and save. | Both methods reject new bookings while selected. Reopening restores otherwise eligible bookings. The separate production calendar and existing orders are unchanged. | __________________ |
| D17 | Use **Delivery unavailable dates** to close only delivery on a date that otherwise permits both methods. Switch between Pickup and Delivery in the customer shop. | Delivery is unavailable on that date; pickup remains available subject to normal lead time and stock. The backend also rejects a stale/direct delivery submission. Other dates are unaffected. | __________________ |
| D18 | Load existing saved date exceptions, add a delivery closure, and save another business setting. Reopen all three calendars and a previously submitted order on the closed date. | Existing selections survive; saving one calendar does not overwrite the others. The submitted order keeps its date, method, payment state and stock allocation. | __________________ |

## 5. Guest checkout, pickup, and delivery

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| O01 | As a guest without a promo, buy one Product A mix (4 Classic + 2 Matcha), select pickup D, and enter required buyer details. | No account or delivery address is required. Pickup address/hours/instructions appear. Total is PHP 360.00. | __________________ |
| O02 | Choose delivery instead, select the configured demo locality, and enter separate recipient name, phone, and complete address. | Recipient fields are separate from buyer fields. Fee is PHP 120.00; total PHP 480.00. | __________________ |
| O03 | Leave each required buyer field blank, then each required delivery recipient/address field blank. Leave optional instructions blank. Try leaving the social platform unchosen or the username blank. | Required omissions, including social contact, are identified. Instructions may remain blank. Pickup never requires a delivery address. | __________________ |
| O04 | Choose Facebook or Instagram and enter a username/profile name or N/A. Then select the N/A platform. Add delivery instructions. | Social contact saves and displays accurately in permitted order views. N/A fills the contact field automatically. Before choosing a platform the contact box is disabled. Older orders with blank social details remain editable; N/A remains N/A in admin edits. | __________________ |
| O05 | Try unsupported locality or tamper with a request to submit an unrecognized locality and lower delivery fee. | Server rejects unsupported delivery and derives the zone fee from saved zone settings; no trusted client-supplied fee. | __________________ |
| O06 | Inspect pickup and delivery date controls and wording. | Date only, no time slots. Delivery says arrival can be anytime 9 AM–6 PM (or configured window), with no guaranteed exact or morning arrival. | __________________ |
| O07 | Review checkout, then submit once. Save reference and secure link. | Items/options, subtotal, promo/discount, delivery fee, and final total are visible before submission. Server creates one reference; Awaiting payment + Pending confirmation; proof deadline is creation + exactly 15 minutes. | __________________ |
| O08 | Open saved guest secure link in a signed-out browser. | Guest can view only that order and valid payment actions without creating an account; link remains usable for status after the proof deadline. | __________________ |
| O09 | Try editing/cancelling a submitted order as its customer. | Customer cannot directly amend or cancel it; contact details explain how to request help. | __________________ |
| O10 | Enter a two-line delivery-zone description, such as a motorcycle-capacity/contact note, and save. Choose a locality in that zone in checkout, then open Review. | The selected zone's description appears with its line breaks in checkout and review. It is explanatory text; it does not add a charge or alter the configured fixed delivery fee. | __________________ |
| O11 | Switch to another zone with a different description, a zone with no description, and then Pickup. Include harmless `<b>text</b>` in a staging description. | The text follows the selected zone, disappears when blank or using Pickup, and displays HTML-like input as plain text. No previous zone's instructions remain visible. | __________________ |
| O12 | Submit a delivery order with a description, then edit that zone's description. Reopen the order and prepare a fresh checkout for the same zone. | The saved order retains the submitted zone name/description and fee. New checkout uses the updated description. A deliberate admin fulfillment/zone change is reviewed and saved as an order edit. | __________________ |

## 6. Accounts and real authentication emails

Use your controlled inboxes. Inspect spam/junk as well as inbox. A queue record is not evidence of email receipt. Do not mark these passed if the provider or sender is not configured.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| U01 | Add a cart, date, buyer/recipient/address details, and draft promo intent. Start registration with Customer C's unique email and password. | Registration starts without losing checkout state; verification email actually arrives with a secure expiring link. | __________________ |
| U02 | Open the verification link, sign in if needed, and return to checkout. | Account becomes verified; cart, selections, date, method, and entered details remain available. Final submission still rechecks current availability. | __________________ |
| U03 | Request a replacement verification email; use the latest valid link. Test an expired link after its configured lifetime. | Replacement mail actually arrives; valid link works and expired link fails safely with a resend path. Record configured expiry and actual evidence. | __________________ |
| U04 | Attempt registration using an existing email, including different letter case. | No second independent account for the same normalized email; response does not expose unrelated private account data. | __________________ |
| U05 | Sign in and out with a cart in progress. | Sessions change correctly; checkout draft remains. Signing out does not expose another account's history. | __________________ |
| U06 | Use Forgot Password; open received reset link, set a new password, sign in with it, and reuse the consumed link. | Actual email arrives. New password works; used link cannot reset again. | __________________ |
| U07 | Test reset link after configured expiry, and Forgot Password for an unregistered controlled address. | Expired link cannot reset; recovery is clear; public response does not reveal private account information. | __________________ |
| U08 | Customer A submits one awaiting-payment order and one under-review order. Open account history, then sign in as B. | A sees both pending states and own order details. B cannot see A's history or details. Guest orders do not attach solely because an email text matches. | __________________ |
| U09 | From signed-out or unverified state, enter a promo during checkout; then sign in/verify. | Promo requires a signed-in verified account; cart/date/fields survive the authentication flow. Ordinary guest orders remain available. | __________________ |

## 7. Manual payment, expiry, and release

The normal expiry test really takes 15 minutes. For a precise deadline race, use a controlled staging test harness with server timestamps; browser observation alone may be insufficient to prove an exact millisecond boundary. Do not change the production clock or edit live payment rows to accelerate a test.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| P01 | Open a newly submitted order. Compare payment methods/account details/instructions with admin settings. | Full initial payment instructions appear; no gateway, deposit, installment, courier charge lookup, or live payment occurs. | __________________ |
| P02 | Before deadline upload a valid demo JPEG/PNG/WebP with the payment reference blank. Repeat on another order with `DEMO-REF-001`. Attempt submission without an image. | Valid images submit with or without a reference and can be approved; missing images are rejected. Payment changes only to Under review; fulfillment remains Pending confirmation; stock and promo holds remain. Further proof upload is disabled. | __________________ |
| P03 | Try missing reference, disguised text `.jpg`, SVG, PDF, oversized image, and missing file. | Server rejects with clear format/size/reference errors. No successful proof state is recorded; deadline continues. Allowed types are JPEG/PNG/WebP, maximum 5 MB. | __________________ |
| P04 | Leave an order without successful proof for more than 15 minutes; run normal scheduler and refresh. | Fulfillment becomes Expired; payment remains Awaiting payment; stock and unused promo release once; upload disabled. Original reference/history retained. | __________________ |
| P05 | Upload valid proof before deadline, wait beyond 15 minutes (and ideally review next day). | Under review persists indefinitely until staff action; no expiry due to slow review; holds remain counted once. | __________________ |
| P06 | Complete proof just before deadline; separately begin upload before deadline but let validated submission complete at/after it. Record server times. | Only proof successfully committed before deadline is accepted. At/after deadline fails; an upload start alone does not preserve the hold. | __________________ |
| P07 | Have the expiry worker and proof submission compete near deadline in staging. | One consistent outcome: timely committed proof remains Under review with holds, or expired order rejects proof and releases holds once. No accepted late proof or orphaned state. | __________________ |
| P08 | Owner/staff approves valid under-review full payment. Inspect available quantity and history. | Paid + Confirmed; same quantity hold becomes committed without a second deduction; reserved promo becomes redeemed once; approved amount/staff/time are retained. | __________________ |
| P09 | Reject another under-review payment with reason `DEMO — payment reference cannot be verified`. | Rejected + Cancelled; reason/staff/time/history retained; held stock and unused promo released once; proof resubmission permanently unavailable. | __________________ |
| P10 | Open rejected and expired orders; follow recovery guidance. Place a new order if desired. | Contact details and new-order route are available. If money was already sent, customer is told to contact staff, not automatically pay again. New order has new reference and fresh validations. | __________________ |
| P11 | Visit proof endpoint/UI for Under review, Paid, Rejected, Expired, and Cancelled orders. | Upload is disabled and server rejects direct retries for all these states. Hiding a control alone is insufficient. | __________________ |
| P12 | Repeatedly refresh expired/rejected orders and rerun expiry; retry approval of a paid order. | No duplicate stock release, deduction, approval record, promo redemption, or notification event. | __________________ |

## 8. Promo arithmetic and lifetime

Use fresh orders and deliberately reset fixture limits between independent scenarios. Promo limits count **held + redeemed** uses.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| R01 | Verified A applies PCT10 to five Classic boxes, subtotal PHP 1,500.00; add delivery. | Discount PHP 150.00; pickup total PHP 1,350.00; delivery total PHP 1,470.00. Fee is excluded from discount. | __________________ |
| R02 | Apply PCT10 to ten Classic boxes, subtotal PHP 3,000.00; give date enough capacity first. | Discount capped at PHP 200.00; pickup total PHP 2,800.00. | __________________ |
| R03 | Configure temporary exact-price demo items to create subtotals PHP 999.99 and PHP 1,000.00; apply PCT10. | PHP 999.99 fails minimum; PHP 1,000.00 receives PHP 100.00 off. Adding delivery cannot meet a product-subtotal minimum. | __________________ |
| R04 | Apply PCT10 to three A boxes of 4 Classic + 2 Matcha, subtotal PHP 1,080.00. | Surcharges count toward minimum and discount; discount PHP 108.00. | __________________ |
| R05 | Apply FIX500 to one PHP 300.00 Classic box and add delivery. | Discount is PHP 300.00, never above product subtotal; final total is PHP 120.00 with delivery, PHP 0.00 pickup. | __________________ |
| R06 | Enter, remove, and re-enter a valid code repeatedly without submitting. Try a second code. | No use is consumed by preview; only one code can apply at a time. Invalid/expired/minimum/limit errors are understandable. | __________________ |
| R07 | Submit LASTUSE once without proof; attempt another use from A and B. | The held use counts toward account/global limits; second use fails, despite first not yet being paid. | __________________ |
| R08 | Expire, reject, or cancel the unpaid LASTUSE order; try a new qualifying order. | Unredeemed allowance returns once and can be reserved again. | __________________ |
| R09 | Reserve a valid promo, then deactivate it or allow expiry before approving payment. | Existing active order keeps its saved discount/rules and can be approved. A new order cannot use inactive/expired code. | __________________ |
| R10 | Attempt submit immediately before, exactly at, and after configured promo expiry using controlled server timing. | Eligibility uses original submission instant in Manila; only submission before expiry qualifies. Code entry time is irrelevant. | __________________ |
| R11 | Reactivate an unexpired code, then attempt to reactivate one whose expiry remains past. Explicitly extend expiry. | Unexpired reactivation works; a past-expiry code remains unavailable until expiry itself is edited. | __________________ |
| R12 | Approve a discounted order, then cancel it and apply/remove Refund label. | Redeemed use remains counted throughout. Cancellation/Refund never restores it. | __________________ |
| R13 | After submission edit the promo's value/minimum/cap, then inspect old order and its eventual admin edit. | Old order retains saved rules and original calculation. Intentional order edit recalculates against its saved rules, not current promo settings. | __________________ |
| R14 | Inspect a percentage calculation with fractional centavo result. | Discount follows the documented server rounding convention once at order-discount level; UI and stored total match to two decimals. | __________________ |

## 9. Admin operations and intentional edits

Start each edit from a fresh active order and record old date, items, totals, reservation counts, payment state, fulfillment state, revision, and original approved amount. An edit reason is optional. Leave it blank to record `N/A`, or add a note such as `DEMO — customer requested change`. The before/after values, staff member and timestamp are still recorded.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| M01 | Search by reference and customer; filter payment, fulfillment, date, pickup/delivery, Refund; inspect upcoming dates. | Results match filters and support daily production planning. Order details include buyer/recipient, saved selections/prices, totals, proof/reference, notes, and history. | __________________ |
| M02 | Add private staff note; reopen as customer and guest. | Authorized staff see persistent note; customer responses, printed customer views, and emails do not expose private notes. | __________________ |
| M03 | After booking, block its date and change catalog price; correct only buyer phone/name/email in admin and click Save changes once. | No separate preview or total confirmation is required. Contact correction succeeds without re-running lead time/date/stock as a new checkout. Saved prices and allocations remain unchanged. | __________________ |
| M04 | Move an active order to an otherwise supported next-day date that customer lead time would reject; give target capacity. | Admin bypasses minimum lead time. Quantity moves from old date to new once, and history records old/new date, reason, staff, time. | __________________ |
| M05 | Attempt the same move to a sold-out or unsupported date. | Entire edit fails; original order/date/totals/promo/reservations remain unchanged. No partial release. | __________________ |
| M06 | Add a product whose lead time would be too long for the existing order date but has available configured capacity. | Admin can add it; affected stock/date/configuration checks still apply. Customer submission cannot make the same lead-time exception. | __________________ |
| M07 | Increase/decrease quantity of an unchanged configuration after catalog price changes. | Only affected quantity delta changes; saved unit price is retained for that configuration. | __________________ |
| M08 | Add a new configuration or new product after a catalog price change; click Save changes. Cancel the total confirmation, then try again and confirm. | Checks run automatically. A changed total opens a styled confirmation showing current and new totals. Keep editing, the close button, or Escape leaves the saved order unchanged. A blank reason is saved as N/A; an entered note is preserved. New configurations use current prices; unchanged configurations retain saved prices. Unchanged totals save without confirmation. | __________________ |
| M09 | Change pickup to supported delivery on the same date; enter recipient/address and applicable fee. | Delivery details/fee update; same product/date units are counted once, with no release/re-reserve double count. | __________________ |
| M10 | Make one edit containing both a valid contact change and an impossible quantity/date change. | Entire transaction fails; contact fields and all other previous state remain unchanged. | __________________ |
| M11 | Edit an unpaid PCT10 order from PHP 1,500.00 to PHP 900.00 product subtotal. | Discount becomes PHP 0.00; unused promo reservation releases. Original and revised subtotal/discount/fee/total are retained in history. | __________________ |
| M12 | Restore qualifying subtotal on that unpaid order after its promo use was released; repeat after another order consumes the final allowance. | Proposed default reacquires one reservation for the same order using saved rules/original eligibility if capacity remains. If capacity is gone, save fails clearly and existing order stays intact; no silent extra promo use. | __________________ |
| M13 | Edit already-paid discounted order below the saved minimum. | Revised discount becomes zero; existing redeemed promo use stays counted. No second redemption or restored allowance. | __________________ |
| M14 | Mark a paid order Preparing; change its items/total/date. Inspect payment and history. | Payment remains Paid and fulfillment remains Preparing. Revised total displays; original approved amount stays immutable. No fabricated payment, additional proof, balance block, or extra-payment email. | __________________ |
| M15 | Repeat M14 from Ready for pickup / Out for delivery where method still matches. | Existing fulfillment progress remains; date alone does not reset or advance it. | __________________ |
| M16 | Open same revision in two staff sessions. Save different edits from each. | First valid save succeeds; stale conflicting save is rejected clearly. No lost update or corrupted stock/promo totals. | __________________ |
| M17 | Cancel unpaid order with reason; cancel a paid order once with stock restore and another without restore. | Unpaid holds return once. Paid remains Paid; explicit restore returns eligible units, no-restore leaves produced units unavailable. Reasons/staff/time retained. | __________________ |
| M18 | Repeatedly cancel same order. Toggle Refund label on and off, then filter it. | No duplicate release; Refund is independently filterable/removable. Apply the label to a Confirmed order: admin list/detail, customer page and CSV display Refunded, the Fulfillment filter finds it under Refunded rather than Confirmed, and it leaves upcoming fulfillment lists. Remove the label: the previous status returns. It excludes a paid order’s full latest value, units and method from analytics; cancelled orders are not deducted twice. Removing it restores reporting only for eligible paid orders. Actual transfers remain manual. | __________________ |
| M19 | Move Paid → Preparing → Ready for pickup for pickup; Paid → Preparing → Out for delivery for delivery; mark Completed manually. Try wrong-method status. | Explicit authorized transitions work; wrong-method readiness is rejected; no calendar-only transition. | __________________ |
| M20 | Export CSV and print summary; use demo name beginning with `=1+1`. | Export includes required order details and quoted values; spreadsheet formula-like input is neutralized. Print is readable, with saved options/totals/reference. No unintended private-note exposure. | __________________ |
| M21 | As staff S, perform permitted order/stock actions; attempt owner-only settings/catalog/promos/role changes using both UI and a direct request. | Server enforces role permissions; hidden controls are not the only protection. | __________________ |
| M22 | As owner add/remove a verified staff role; attempt to remove final owner. | Role changes apply securely; final owner cannot be removed; ordinary registration never becomes admin. | __________________ |

## 10. Concurrency and retries

Use separate browser profiles or a normal window plus a private window. Separate tabs in one profile share authentication and are insufficient for different-customer tests. For timing races, prepare both checkout screens completely before the final click.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| X01 | Set one available A box for a fresh date. Session A prepares pickup; session B prepares delivery of the same product/date. Click submit as close together as possible. | Exactly one order succeeds. Other receives sold-out error. One unit total held; no negative availability, partial loser order, or loser promo reservation. | __________________ |
| X02 | Give ample stock but set a fresh promo global limit=1. Verified A and B both prepare eligible checkout with it and submit together. | Exactly one promo order succeeds; final allowance cannot be consumed twice. Failed attempt leaves no stock hold. | __________________ |
| X03 | Use one account in two sessions with per-account promo limit=1 and global limit high. Submit together. | At most one held/redeemed use for that account; per-account race is protected independently of global limit. | __________________ |
| X04 | Double-click Submit; simulate a connection interruption after send and retry the same pending submission. | One reference, one order, one set of stock/promo reservations. Retried identical idempotency key returns original result. | __________________ |
| X05 | For a reproducible request replay, use browser Developer Tools → Network, find the successful `create_order` RPC request, copy/replay the exact request locally with the same idempotency key. Do not share its credentials/token. | Response identifies the same order; no extra reservation or order email event. A deliberately new order needs a new idempotency key and receives fresh validation. | __________________ |
| X06 | Two admin sessions approve the same under-review order simultaneously; replay the successful approval request with same key. | One immutable approval/payment record, one redemption, one held→committed conversion. Retry is harmless or reports already completed; no second deduction. | __________________ |
| X07 | Retry an identical successful admin edit request with its same key; separately submit two different edits with the same old revision. | Identical retry does not reapply deltas/history. Conflicting stale edit is rejected. | __________________ |
| X08 | Compete approval and cancellation/rejection for the same order. | One permitted transition wins atomically. Final status, payment record, stock, promo, and history agree; loser gets a clear conflict. | __________________ |
| X09 | Run expiry/notification worker twice or trigger a retry after a temporary failure. | Holds release once; events/reminders are not duplicated; unsuccessful delivery is not marked sent. | __________________ |

If the UI prevents duplicate clicks, that is helpful but does not prove server idempotency. Record X05–X08 as pending until request replay or coordinated sessions have actually exercised the backend.

## 11. Actual order emails and reminders

Before each scenario, record reference, customer inbox, action time in Manila, worker run time, provider result, and receipt time. Check spam. Mail appearing only in an outbox/admin preview does not pass receipt tests. Provider rate limits, verified sender/DNS, SMTP, and worker secrets are setup prerequisites.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| E01 | Submit a guest order to a controlled inbox. Wait for the configured worker interval. | Actual email arrives with reference, summary, payment instructions, deadline, secure access link; link works signed out. | __________________ |
| E02 | Approve another order's initial payment. | Actual confirmation email says Paid / Confirmed and includes reference plus secure link; no duplicate on retried approval. | __________________ |
| E03 | Reject proof with a recorded reason. | Actual rejection/cancellation email contains reason, reference, secure link, contact route, and appropriate new-order guidance; no resubmit invitation or automatic demand to pay again. | __________________ |
| E04 | Cancel an order, including a previously-paid one. | Actual cancellation notice includes reason/reference/link; it does not claim a refund was processed. | __________________ |
| E05 | Set a pickup order Ready for pickup and a delivery order Out for delivery. | Each explicit staff action sends the matching actual status notification with reference/link. Date arrival alone never sends a readiness claim. | __________________ |
| E06 | Set reminder time a few minutes ahead in Manila. Arrange paid active orders due today through admin date edits with valid capacities. Include unpaid, under-review, cancelled, expired, completed, and tomorrow controls. | Only paid active orders due today get reminder after configured time; controls do not. Reference/link and method instructions are present. | __________________ |
| E07 | Before reminder send, move a due order from old date to a later supported date; inspect queue and eventual receipt. | No old-date reminder is sent, including already-queued stale work. Updated date governs the later reminder. | __________________ |
| E08 | On the new due date run/retry worker repeatedly; move an order away and back to the same date after one reminder was sent. | At most one reminder per order/date; restart/retry does not duplicate it. | __________________ |
| E09 | Edit a paid order so its displayed total rises, then wait for all pending mail. | No automatic extra-payment request/email, second proof-approval flow, or balance-due block appears. | __________________ |
| E10 | In staging only, temporarily configure a bad email credential or pause worker, submit an order, then restore it. | Order remains saved. Delivery failure/pending state is visible and not reported as sent; durable queue retries after repair without duplicate successful mail. | __________________ |
| E11 | Change an order date or cancel/complete it after reminder enqueue but before send. | Sender rechecks current date/status and skips stale or ineligible reminder. | __________________ |
| E12 | Receive a delivery order email with a two-line zone description; change the zone description before a later payment/status email. Compare with a pickup order and an older order without zone text. | Delivery emails use the order's saved zone text with readable line breaks and escaped HTML, even after zone settings change. Pickup emails omit delivery-zone text. Older orders do not acquire new instructions. This text does not change the recorded fee or total. | __________________ |
| E13 | Submit valid payment proof with two verified team accounts assigned Owner and Staff. Leave fulfillment reminders off. | Each account receives one individual review email on the next available worker cycle, containing reference, customer name, fulfillment details, total, and an authenticated admin-dashboard link. Customer tokens and private proof URLs are absent. Retrying the request or worker does not duplicate the event. | __________________ |
| E14 | In staging, remove one recipient's role or change its verified email after queueing, and resolve a second order before sending. | The removed/changed recipient and resolved-order alerts are skipped. Other authorized recipients still receive the unresolved review alert. New verified staff/owner assignments receive alerts for future proof submissions. | __________________ |

## 12. Privacy, upload protection, and server validation

Use only your own demo accounts/orders/files. These are checks within the preview you control, not instructions to probe unrelated sites.

| ID | Steps | Expected result | Actual / result / issue |
| --- | --- | --- | --- |
| S01 | Open admin signed out; sign in as ordinary A; attempt an admin API action directly. | No private admin data/actions are available; server authorization rejects access. | __________________ |
| S02 | As A request B's order ID, alter an order reference, and request B's proof access. | IDs/references alone cannot grant access. Account history is scoped to authenticated owner; proof is private. | __________________ |
| S03 | Remove/change a character in a guest secure token; use only a known reference. | Private order details and upload access are denied. A valid secure link intentionally grants access to its holder and must be kept private. | __________________ |
| S04 | Open a private proof storage path without authorization; obtain an authorized admin preview, then retest its signed URL after expiry. | No public proof object; authorized temporary URL works only for its limited lifetime (draft default five minutes). | __________________ |
| S05 | Modify a checkout request's price, surcharge, discount, fee, quantity, fulfillment date, or promo eligibility fields. | Server calculates trusted totals and validates all business rules; no client override creates a cheaper/invalid order. | __________________ |
| S06 | Upload forbidden/disguised/oversized files through direct upload endpoint; try product-image upload as customer. | Server content/type/size and role checks reject attempts, independently of file picker restrictions. | __________________ |
| S07 | Let an upload fail its final order-state check after storage transfer, such as racing expiry. | No successful proof state is shown; failed/orphaned object is cleaned up and private data does not become public. | __________________ |
| S08 | Enter harmless HTML-like text such as `<b>DEMO</b>` in names/notes/description fields. | Text displays safely; it does not execute or change page behavior. Customer responses do not include staff-only notes. | __________________ |
| S09 | Inspect public repository and browser configuration/network requests. | Only public project URL/publishable key appear client-side. Service role, SMTP/Resend secrets, worker token, and passwords are absent from public code. | __________________ |
| S10 | Edit products/settings, create an order, sign out, restart browser, and reopen from another device. | Configured data/order persist in backend; behavior is not solely local browser storage. | __________________ |

## 13. Review and approval record

| Review item | Owner record |
| --- | --- |
| Business defaults accepted/changed: cutoff, zero-day lead behavior, structured delivery localities, proof formats/limit, promo requalification | __________________ |
| Actual pickup/payment/contact details and production/fulfillment schedule entered | __________________ |
| Every failed/blocked test and issue disposition | __________________ |
| Actual verification/reset/order/status/reminder emails received | __________________ |
| GitHub fork/development branch URL confirmed | __________________ |
| Final reviewed commit and preview URL | __________________ |
| Approval to merge into main, if granted | __________________ |
| Approval to deploy live, if granted | __________________ |

Review the merge and deployment walkthrough in [SETUP.md](SETUP.md). A completed checklist is evidence for your decision; it is not automatic permission to merge, publish, activate billing, or replace the live website. Record approval separately after the preview is satisfactory.


### Customer calendar booking window

- [ ] The customer date picker uses the cream and caramel calendar style, with a visible selected date and unavailable dates disabled.
- [ ] Calendar navigation stays between the current Manila month and the second following month; previous months and later months cannot be reached using buttons or keyboard.
- [ ] Today is selectable only before the Production schedule cutoff (or throughout the day with no cutoff), with an eligible same-day basket and available stock/method. Every item requires **Allow same-day orders** and **0 full production days**. An empty basket requires an eligible available product. Past dates remain disabled.
- [ ] At or after the cutoff, same-day products can be booked from tomorrow, subject to schedule and stock. Zero-day products without the option also start tomorrow; zero days alone never enables same-day orders.
- [ ] The last date of the second following month is allowed when schedule, lead time and stock permit it; the next day is rejected.
- [ ] Manila midnight, month/year rollover and leap years update these bounds correctly. Stale saved dates cannot bypass them.
- [ ] Customer quote/create reject out-of-window dates without reserving stock or queueing an email. Existing bookings and authorized staff amendments remain available.
- [ ] The popup works by keyboard and on mobile, returns focus after closing, and does not reset the basket.

### Same-day product eligibility

- [ ] Existing products default to same-day disabled. Enabling the option with 0 full production days saves and survives editor reopening, option-group edits and photo edits.
- [ ] Attempt to save a checked same-day option with positive production days. The form explains how to resolve the conflict and makes no save request; a direct API attempt is rejected too.
- [ ] In staging, test before, exactly at, and after the Manila Production schedule cutoff. Eligible same-day orders are accepted only before it; exactly at the cutoff is too late. Unset cutoff permits today throughout the day.
- [ ] An eligible zero-day product does not gain an extra full production day after cutoff; tomorrow is available if its fulfillment method/date and stock allow it.
- [ ] Mixed carts containing any ineligible product cannot quote or submit for today. The customer sees the conflict; products are not silently removed or split into separate orders.
- [ ] Same-day eligibility cannot bypass a global booking closure, method-specific closure, pickup-only restriction, stock limit, or paused shop. A non-production date alone does not block ready-stock fulfillment.
- [ ] Stale open checkouts cannot submit today after the cutoff or after the product option is disabled; rejected requests reserve no stock and queue no email. Existing saved orders and paid states remain unchanged.

### Analytics refunds and fulfillment mix

- [ ] A paid order with a Refund label contributes zero sales, units, product-ranking value and pickup/delivery count, including when already completed. Original payment approval stays visible.
- [ ] Applying the label to an edited order excludes its latest total, including delivery after discounts. Removing it restores the latest values if paid and not cancelled/expired.
- [ ] Cancelled plus Refund-labelled orders are excluded once. An unpaid labelled order cannot reduce sales or add a monetary refund.
- [ ] Pickup and delivery percentages count only paid orders excluding cancellations, expiry and full refunds. They show 0% when none qualify.
- [ ] Refund changes appear in the original placement-date period. Refresh loads another staff member’s changes.
