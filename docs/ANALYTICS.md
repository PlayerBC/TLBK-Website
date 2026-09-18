# Kitchen analytics

Open **Kitchen dashboard → Analytics**. The page is available to the same signed-in owners and staff who can view orders.

Choose Today, Last 7 days, Last 30 days, This month, All time, or Custom dates. Custom dates need **Apply dates**. All dates use Manila time and refer to **when the order was placed**, not its pickup/delivery date or the date its payment was approved.

| Figure | What it counts |
| --- | --- |
| Number of orders | Every order placed in the selected period, including unpaid, cancelled and expired orders. |
| Sales | Latest order totals for paid orders, excluding cancelled, expired and Refund-labelled orders. Includes discounts and delivery fees. Completed orders remain included. |
| Customers | Distinct buyer email addresses on the paid orders counted in sales. Email is trimmed and matched without case sensitivity, combining guest and signed-in purchases using the same address. Missing emails do not create an invented customer. This is purchasing customers, not registered accounts or visitors. |
| Completed orders | Orders counted in sales whose latest fulfillment status is Completed. The period still uses placement date, not completion date. |
| Repeat customers | Customers with at least two orders counted in sales within the selected period. This is not a lifetime repeat-purchase count. |
| Promo uses | Orders counted in sales with both a saved promo code and a positive current discount, once per order regardless of quantity. |
| Average order value | Sales divided by the number of paid orders excluding cancellations, expiry and full refunds. An empty paid-order set shows a dash. |
| Units ordered | Latest product quantities in the orders counted in sales. One box/pouch is one sellable unit. |
| Top products | Top ten products by units, combining different flavors/options under their parent product. Ties use item value, then name. Item value is before order discounts and excludes delivery. |
| Order status | Completed, paid-to-fulfill, awaiting-payment, review, expired and cancelled counts. Refunded orders are excluded from completed and pending work. Expired/cancelled percentages use all selected orders. |
| Sales breakdown | Product subtotal, discounts, delivery fees and sales from qualifying paid orders. |
| Promo code use | Top ten saved codes by qualifying discounted order count, then discount value and code. Shows orders and discounts per code; the badge counts all distinct codes used. Deleted or inactive codes still appear if saved on a qualifying order. |
| Pickup versus delivery | Current fulfillment method for paid orders only, excluding cancelled, expired and Refund-labelled orders. Percentages use this same eligible paid-order count, not all orders. |
| Sales over time | Current sales and the number of qualifying paid orders attributed to placement dates. The chart tooltip and **View exact figures → Paid orders** exclude unpaid, cancelled, expired and Refund-labelled orders, matching sales. Completed paid orders remain included. Long date ranges group into weeks or months. |

## How edits affect analytics

Saving an order edit changes the quantities, sales, average and product ranking the next time Analytics renders with that saved order. Opening Analytics fetches fresh data, and **Refresh analytics** picks up changes saved by another team member. The update time is shown on the page. This is a current-state report: editing an older order changes the figures for its original placement period.

Cancelling a paid order excludes it from sales, customer and repeat-customer counts, completed orders, promo performance, units, product rankings and the pickup/delivery breakdown.

A **Refund label means a full refund for analytics**. It excludes the order from sales, customers, repeat customers, completed orders, promo performance, average order value, units, product rankings, trends and the pickup/delivery breakdown. Removing the label restores those figures if the order remains paid and is not cancelled or expired. A cancelled order is already excluded, so the label cannot deduct it twice.

Original approval totals, refund-value totals, paid-with-refund counts and differences above/below original approvals are no longer shown in Analytics. Original payment records remain available in individual orders. Applying a refund label updates the original order-placement period, not a separate refund-date period.

Promo analytics measures discounted sales in the selected period. It does not replace redemption-limit accounting: previously redeemed uses can remain counted against a promo limit after cancellation or an amendment removes the discount. Editing an order's email, completion status or promo discount updates the corresponding analytics for its placement period. Buyer details are used to calculate counts and are not displayed in the report.

This page reports order values, not profit or a cash ledger. All calculations use the authenticated admin order data already available to the dashboard; this feature does not change orders, stock, payments, or email delivery.

## Quick check after publishing

1. Open Analytics and select **All time**. Compare the total order count with Orders using cleared filters.
2. Check that unpaid and expired orders do not increase sales.
3. Choose a paid order and check its latest total and quantities against the relevant placement-date report.
4. With local fixtures, check that two qualifying orders using the same email count as one customer and one repeat customer. A promo counts once per discounted order regardless of quantity. Change the date range: repeat customers need two qualifying orders inside that range.
5. Use a custom date range that contains no orders. Counts and sales should be zero, average order value should show a dash, and the promo panel should explain that no paid orders used a discount.

Use local fixtures for destructive test scenarios. Do not cancel real customer orders solely to test reporting.

Website visitors are separate from order analytics. **Website visitors** shows **Visitors today** and **Active visitors · last 30 minutes** across the website’s tracked pages, using Google’s aggregate user counts. These figures refresh every minute while Analytics is visible and do not follow the order date filter. Today uses the Google Analytics property timezone shown on the card; standard report processing may lag behind Realtime. The cards need a private server reporting connection; until configured, they show a setup message and —, not invented zeros. Follow [TRAFFIC.md](TRAFFIC.md) to connect and verify them.
