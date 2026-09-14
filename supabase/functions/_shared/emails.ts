import { HttpError } from "./server.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (value: unknown) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(Number(value || 0) / 100);
const date = (value: string, includeTime = false) => {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T12:00:00+08:00` : value);
  if (Number.isNaN(parsed.getTime())) return "See your order page";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", ...(includeTime ? { timeStyle: "short" as const } : {}) }).format(parsed) + (includeTime ? " (Asia/Manila)" : "");
};
const lines = (value: unknown) => escape(value).replace(/\n/g, "<br>");
const selections = (item: any): string => (Array.isArray(item.selection_labels) ? item.selection_labels : [])
  .map((choice: any) => typeof choice === "string" ? choice : `${choice.group ? `${choice.group}: ` : ""}${choice.label || "Option"}${choice.quantity ? ` × ${choice.quantity}` : ""}${Number(choice.surcharge_cents) ? ` (+${money(choice.surcharge_cents)} each)` : ""}`)
  .join(", ");

export function renderEmail(payload: any): { html: string; text: string } {
  const order = payload?.order;
  const settings = { ...payload?.settings };
  // Preserve fulfillment and payment instructions saved with the submitted order.
  for (const key of ["payment_instructions", "pickup_address", "pickup_hours", "pickup_instructions", "delivery_window", "contact_email", "contact_phone"]) {
    if (order?.[key] !== undefined && order[key] !== null) settings[key] = order[key];
  }
  if (!order?.id || !order?.reference || !order?.access_token || !settings?.site_url) {
    throw new HttpError(503, "Email configuration is incomplete: set the site URL and confirm the saved order access token.");
  }
  let site: URL;
  try { site = new URL(settings.site_url); } catch { throw new HttpError(503, "Configure a valid HTTPS site URL in Business settings."); }
  if (site.protocol !== "https:" || site.username || site.password) throw new HttpError(503, "Order emails require an HTTPS site URL.");
  site.search = "";
  site.hash = "";
  site.pathname = `${site.pathname.replace(/\/$/, "")}/`;
  const access = new URL("shop.html", site);
  access.hash = new URLSearchParams({ order: order.id, token: order.access_token }).toString();
  const link = access.toString();
  const contact = [settings.contact_email, settings.contact_phone].filter(Boolean).join(" · ");
  const reason = [...(order.history || [])].reverse().find((event: any) => event.reason && !event.private)?.reason || payload.reason || "See your order page for details.";
  let heading: string;
  let message: string;
  let instructions = "";
  switch (payload.event_type) {
    case "order_submitted":
      heading = "Your order has been received";
      message = "Your order is awaiting full initial payment and manual approval. Submit your payment proof and payment reference through the secure order link before the deadline. Uploading proof places the payment under review; it does not confirm payment.";
      instructions = `Payment instructions:\n${settings.payment_instructions || "Open your order page for payment instructions."}\n\nPayment-proof deadline: ${date(order.payment_deadline, true)}.`;
      break;
    case "payment_approved":
      heading = "Payment approved · order confirmed";
      message = "Our team approved your full initial payment. Your order is confirmed for the fulfillment date below.";
      break;
    case "payment_rejected":
      heading = "Payment rejected · order cancelled";
      message = `Our team could not approve the initial payment. This order is now closed and cannot accept more proof. Reason: ${reason}`;
      instructions = "You may place a new order, which will be checked against current prices and availability, or contact us directly. If you already transferred funds, contact us about that payment before making any further payment.";
      break;
    case "order_cancelled":
      heading = "Your order has been cancelled";
      message = `Reason: ${reason}`;
      instructions = "Cancellation does not confirm a refund. Our team handles any refund directly with you; contact us with questions about an existing payment.";
      break;
    case "order_expired":
      heading = "Your payment-proof deadline has expired";
      message = "No payment proof was submitted before the 60-minute deadline. This order has expired and its unpaid reservations have been released. The order can no longer accept payment proof.";
      instructions = "Place a new order or contact us directly. If you already transferred funds, contact us about that payment before making any further payment.";
      break;
    case "fulfillment_reminder":
      heading = "Your order is scheduled for today";
      message = `Your paid order is scheduled for ${order.method === "delivery" ? "delivery" : "pickup"} today. This reminder does not change the order's fulfillment status.`;
      break;
    case "ready_for_pickup":
      heading = "Your order is ready for pickup";
      message = "Our team has marked your order ready for pickup. Please follow the pickup instructions below.";
      break;
    case "out_for_delivery":
      heading = "Your order is out for delivery";
      message = "Our team has marked your order out for delivery. An exact arrival time is not guaranteed. Contact us if you have questions.";
      break;
    default:
      heading = "Your order has been updated";
      message = "Our team updated your order. Open the secure order page to review the current details and history. For an order already paid, payment remains recorded and our team handles any difference directly with you.";
  }
  const fulfillment = order.method === "delivery"
    ? `Delivery window: ${settings.delivery_window || "See your order page"}. Arrival can be anytime within this window; no exact time is guaranteed.\n${[order.recipient?.name, order.recipient?.phone, order.address?.line1, order.address?.line2, order.address?.locality, order.address?.postal_code].filter(Boolean).join("\n")}`
    : [settings.pickup_address, settings.pickup_hours && `Opening hours: ${settings.pickup_hours}`, settings.pickup_instructions].filter(Boolean).join("\n");
  const items = Array.isArray(order.items) ? order.items : [];
  const itemText = items.map((item: any) => `${item.quantity} × ${item.name}${selections(item) ? ` (${selections(item)})` : ""} — ${money(item.line_total_cents)}`).join("\n");
  const totals = `Product subtotal: ${money(order.subtotal_cents)}\nDiscount: ${money(order.discount_cents)}\nDelivery fee: ${money(order.delivery_cents)}\nCurrent order total: ${money(order.total_cents)}`;
  const text = `${settings.shop_name || "The Little Baker Kitchen"}\n${heading}\nOrder reference: ${order.reference}\n\n${message}\n\n${instructions ? `${instructions}\n\n` : ""}Fulfillment: ${date(order.fulfillment_date)} · ${order.method}\n${fulfillment}\n\n${itemText}\n\n${totals}\n\nView your order securely:\n${link}\n\nKeep this link private; it grants access to this order.\nFor changes, cancellations, or payment concerns, contact us${contact ? `: ${contact}` : " using the details on your order page"}.`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff8f2;font-family:Arial,sans-serif;color:#342320"><table role="presentation" width="100%" style="padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:white;border:1px solid #eedbd2;border-radius:12px"><tr><td style="padding:28px"><p style="color:#af4947;font-weight:bold">${escape(settings.shop_name || "The Little Baker Kitchen")}</p><h1 style="font-size:25px;line-height:1.25">${escape(heading)}</h1><p><strong>Order ${escape(order.reference)}</strong></p><p style="line-height:1.6">${escape(message)}</p>${instructions ? `<p style="line-height:1.6;background:#fff8f2;padding:16px">${lines(instructions)}</p>` : ""}<h2 style="font-size:18px">${escape(date(order.fulfillment_date))} · ${escape(order.method)}</h2><p style="line-height:1.6">${lines(fulfillment)}</p><table width="100%" style="border-collapse:collapse">${items.map((item: any) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eedbd2">${escape(item.quantity)} × ${escape(item.name)}${selections(item) ? `<br><small>${escape(selections(item))}</small>` : ""}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #eedbd2;white-space:nowrap">${escape(money(item.line_total_cents))}</td></tr>`).join("")}</table><p style="line-height:1.7">${lines(totals)}</p><p style="margin:28px 0"><a href="${escape(link)}" style="background:#af4947;color:#fff;padding:13px 20px;text-decoration:none;border-radius:6px;display:inline-block">View your order</a></p><p style="font-size:12px;color:#695955;line-height:1.5">Keep this link private; it grants access to this order.</p><p style="font-size:14px;line-height:1.6">For changes, cancellations, or payment concerns, contact us${contact ? `: ${escape(contact)}` : " using the details on your order page"}.</p></td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}
