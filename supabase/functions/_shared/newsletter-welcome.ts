import { HttpError } from "./server.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function renderNewsletterWelcome(payload: any): { html: string; text: string } {
  const settings = payload?.settings;
  let site: URL;
  try { site = new URL(settings?.site_url); } catch { throw new HttpError(503, "Newsletter welcome needs a valid site URL."); }
  if (site.protocol !== "https:" || site.username || site.password || !/^[a-f0-9]{64}$/.test(payload.unsubscribe_token || "")) {
    throw new HttpError(503, "Newsletter welcome needs an HTTPS site URL and unsubscribe link.");
  }
  const shop = settings.shop_name || "The Little Baker Kitchen";
  const menu = new URL("/shop.html", site).toString();
  const unsubscribe = new URL("/newsletter.html", site);
  unsubscribe.hash = `unsubscribe=${payload.unsubscribe_token}`;
  const message = "Thanks for subscribing to the TLB newsletter. You’re on the list! We’ll send occasional news about new treats, seasonal menus, and special offers.";
  const footer = [settings.pickup_address, settings.contact_email, settings.contact_phone].filter(Boolean).join(" · ");
  const text = `${shop}\nWelcome to our kitchen!\n\n${message}\n\nExplore the menu:\n${menu}\n\nYou can unsubscribe anytime:\n${unsubscribe}\n\n${footer}`;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to the TLB newsletter</title></head><body style="margin:0;background:#fff8f2;font-family:Arial,sans-serif;color:#342320"><table role="presentation" width="100%" style="padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:560px;background:white;border:1px solid #eedbd2;border-radius:12px"><tr><td style="padding:28px"><p style="color:#af4947;font-weight:bold">${escape(shop)}</p><h1 style="font-size:26px;line-height:1.25">Welcome to our kitchen!</h1><p style="line-height:1.6">${escape(message)}</p><p style="margin:28px 0"><a href="${escape(menu)}" style="background:#af4947;color:#fff;padding:13px 20px;text-decoration:none;border-radius:6px;display:inline-block">Explore the menu</a></p><p style="font-size:13px;line-height:1.6">You can <a href="${escape(unsubscribe.toString())}" style="color:#714029">unsubscribe anytime</a>.</p><p style="font-size:12px;color:#695955;line-height:1.5">${escape(footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}

// Marketing preferences may change while a welcome is queued. Fail closed on
// provider errors and retry later; never restore a suppressed contact to send it.
export async function newsletterWelcomeAllowed(email: string, topicId: string, key: string): Promise<boolean> {
  if (!topicId) throw new HttpError(503, "Newsletter topic is missing from the welcome message.");
  const get = async (path: string): Promise<any> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new HttpError(503, "Unable to verify newsletter preference before welcome delivery.");
    return data;
  };
  const contact = await get(`/contacts/${encodeURIComponent(email)}`);
  if (!contact || contact.unsubscribed) return false;
  if (!contact.id) throw new HttpError(503, "Unable to verify the newsletter contact.");
  let after = "";
  for (let page = 0; page < 10; page++) {
    const topics = await get(`/contacts/${encodeURIComponent(contact.id)}/topics?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!Array.isArray(topics?.data)) throw new HttpError(503, "Unable to verify newsletter topics.");
    const topic = topics.data.find((item: any) => item.id === topicId);
    if (topic) {
      await new Promise(resolve => setTimeout(resolve, 600));
      return topic.subscription === "opt_in";
    }
    if (!topics.has_more) return false;
    after = topics.data.at(-1)?.id;
    if (!after) break;
  }
  throw new HttpError(503, "Unable to finish verifying newsletter topics.");
}
