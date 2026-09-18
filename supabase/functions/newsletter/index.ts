import { credentials, endpoint, env, field, HttpError, json, readJson, verifiedUser } from "../_shared/server.ts";

// Public capture and secret confirmation tokens; account actions validate Auth JWTs.
// The service credential and provider key never leave this function.
async function service(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/rpc/newsletter_service`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: action, p_payload: payload }), signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) throw new HttpError(503, "Newsletter preferences are temporarily unavailable. Please try again.");
  return data;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
function token(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new HttpError(400, "This newsletter link is invalid. Please request a new one.");
  return value;
}
class ProviderError extends HttpError {
  constructor(public providerStatus: number) {
    super(503, "Newsletter email service is temporarily unavailable. Please try again in a moment.");
  }
}
function provider() {
  const key = env("NEWSLETTER_RESEND_API_KEY") || env("RESEND_API_KEY");
  if (!key) throw new HttpError(503, "Newsletter email delivery is not configured yet.");
  const deadline = Date.now() + 45000;
  let previous = 0;
  return async (path: string, method = "GET", body?: unknown, idempotency?: string): Promise<any> => {
    // Stay within the operation lease and the provider's default request rate.
    const delay = Math.max(0, previous + 600 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (Date.now() + 8000 > deadline) throw new HttpError(503, "Please wait a moment and try again.");
    previous = Date.now();
    const response = await fetch(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(idempotency ? { "Idempotency-Key": idempotency } : {}) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404 && method === "GET") return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new ProviderError(response.status);
    return data;
  };
}
type Provider = ReturnType<typeof provider>;
async function topicPreference(api: Provider, contactId: string, topicId: string): Promise<string | null> {
  let after = "";
  for (let page = 0; page < 10; page++) {
    const topics = await api(`/contacts/${encodeURIComponent(contactId)}/topics?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!Array.isArray(topics?.data)) throw new HttpError(503, "Unable to check newsletter preferences. Please try again.");
    const topic = topics.data.find((item: any) => item.id === topicId);
    if (topic) return topic.subscription;
    if (!topics.has_more) return null;
    after = topics.data.at(-1)?.id;
    if (!after) break;
  }
  throw new HttpError(503, "Unable to check newsletter preferences. Please try again.");
}
async function subscribed(api: Provider, contact: any, topicId: string): Promise<boolean> {
  return Boolean(contact && !contact.unsubscribed && await topicPreference(api, contact.id, topicId) === "opt_in");
}
class PreferenceMismatch extends HttpError {
  constructor() { super(503, "Your newsletter preference could not be verified. Please wait a moment and try again."); }
}
async function verifyPreference(api: Provider, contactId: string, topicId: string, subscription: string) {
  if (await topicPreference(api, contactId, topicId) !== subscription) {
    throw new PreferenceMismatch();
  }
}
async function waitForImport(api: Provider, state: any) {
  if (!state.provider_import_id) {
    // An upload may have succeeded before its response was lost. Never submit a
    // second job: the first could run later and undo a more recent preference.
    throw new HttpError(503, "Your newsletter update needs verification. Please contact TLB for help.");
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const job = await api(`/contacts/imports/${encodeURIComponent(state.provider_import_id)}`);
    if (job?.status === "completed" || job?.status === "failed") {
      const counts = job.counts;
      if (job.status !== "completed" || counts?.total !== 1 || counts.updated !== 1 || counts.created !== 0 || counts.skipped !== 0 || counts.failed !== 0) {
        await service("cancel_operation", { email: state.email, operation_id: state.operation_id, import_terminal: true });
        throw new HttpError(503, "Your newsletter preference could not be updated. Please try again.");
      }
      return;
    }
    if (!["queued", "in_progress"].includes(job?.status)) throw new HttpError(503, "Unable to verify your newsletter update. Please try again.");
    if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new HttpError(503, "Your newsletter update is still processing. Please wait a moment and try again.");
}
async function updatePreference(api: Provider, state: any, contactId: string, topicId: string, subscription: string): Promise<boolean> {
  if (await topicPreference(api, contactId, topicId) === subscription) return false;
  const reserved = await service("mark_import_start", { email: state.email, operation_id: state.operation_id, contact_id: contactId });
  Object.assign(state, reserved);
  if (reserved.started) {
    // A blank unsubscribed cell preserves global suppression. Ordinary contact
    // upserts default it to false, so they must never update existing contacts.
    const csv = `email,unsubscribed\n"${state.email.replace(/"/g, '""')}",\n`;
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), state.provider_import_filename);
    form.append("column_map", JSON.stringify({ email: "email", unsubscribed: "unsubscribed" }));
    form.append("on_conflict", "upsert");
    form.append("topics", JSON.stringify([{ id: topicId, subscription }]));
    let job;
    try { job = await api("/contacts/imports", "POST", form); }
    catch (error) {
      if (error instanceof ProviderError && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.providerStatus)) {
        await service("cancel_operation", { email: state.email, operation_id: state.operation_id, import_terminal: true });
      }
      throw error instanceof HttpError ? error : new HttpError(503, "Your newsletter update needs verification. Please contact TLB for help.");
    }
    if (typeof job?.id !== "string") throw new HttpError(503, "Your newsletter update needs verification. Please contact TLB for help.");
    state.provider_import_id = job.id;
    const recorded = await service("mark_import_id", { email: state.email, operation_id: state.operation_id,
      provider_import_filename: state.provider_import_filename, provider_import_id: job.id });
    if (recorded.recorded !== true) throw new HttpError(503, "Your newsletter update needs verification. Please contact TLB for help.");
  }
  await waitForImport(api, state);
  return true;
}
async function finishPreference(api: Provider, state: any, config: any, imported: boolean) {
  const contact = await api(`/contacts/${encodeURIComponent(state.email)}`);
  if (!contact || (state.contact_id && contact.id !== state.contact_id)) {
    if (imported) await service("cancel_operation", { email: state.email, operation_id: state.operation_id, import_terminal: true });
    throw new HttpError(503, "Unable to verify your newsletter contact. Please try again.");
  }
  const confirming = state.operation_kind === "confirm";
  if (confirming && contact.unsubscribed) {
    await service("cancel_operation", { email: state.email, operation_id: state.operation_id, import_terminal: imported });
    throw new HttpError(409, "Your address is opted out of all TLB marketing emails. Use the preferences link in a previous newsletter or contact TLB to rejoin.");
  }
  try { await verifyPreference(api, contact.id, config.topic_id, confirming ? "opt_in" : "opt_out"); }
  catch (error) {
    if (imported && error instanceof PreferenceMismatch) {
      // The job is terminal: release it so a newer user action can retry. A
      // transient read failure keeps the same job for safe recovery instead.
      await service("cancel_operation", { email: state.email, operation_id: state.operation_id, import_terminal: true });
    }
    throw error;
  }
  await service(confirming ? "finish_confirm" : "finish_unsubscribe", {
    email: state.email, operation_id: state.operation_id, import_terminal: imported,
    ...(confirming ? { contact_id: contact.id, unsubscribe_token_hash: await digest(randomToken()) } : {}),
  });
}
async function resumePreference(api: Provider, state: any, config: any) {
  await waitForImport(api, state);
  await finishPreference(api, state, config, true);
}
async function configuration(): Promise<any> {
  const config = await service("configuration");
  if (!config.topic_id || !config.segment_id || !/^https:\/\/[^/]+\/?$/.test(config.site_url || "")) {
    throw new HttpError(503, "Newsletter signup is not available yet. Please try again later.");
  }
  return config;
}
const generic = { ok: true, message: "Check your inbox for a confirmation email. If it does not arrive, check spam or try again later." };

Deno.serve(endpoint(async (request, headers) => {
  const body = await readJson(request);
  const action = field(body.action, "Action", 32, true);
  if (action === "subscribe") {
    if (body.website) return json(generic, 200, headers);
    const email = field(body.email, "Email", 254, true).toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const source = field(body.source, "Source", 40) || "website";
    if (!["website", "homepage", "shop_popup", "account_signup", "account"].includes(source)) throw new HttpError(400, "Unknown signup source.");
    const config = await configuration();
    const api = provider();
    const sender = env("NEWSLETTER_FROM") || env("EMAIL_FROM");
    if (!sender) throw new HttpError(503, "Newsletter email delivery is not configured yet.");
    const confirmation = randomToken();
    // Hash the gateway address with a server-only salt; no raw IP is retained.
    // Email and global limits also apply when a proxy address is unavailable/spoofed.
    const address = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 128);
    const state = await service("request", { email, source, token_hash: await digest(confirmation), ip_hash: await digest(`${credentials().key}:${address}`) });
    if (state.send) {
      // A sending-only key could deliver a link that can never add a contact.
      // Check management permission after rate limiting, before sending that link.
      const topic = await api(`/topics/${encodeURIComponent(config.topic_id)}`);
      if (!topic || topic.default_subscription !== "opt_out") throw new HttpError(503, "Newsletter signup is not available yet. Please try again later.");
      const link = `${config.site_url.replace(/\/$/, "")}/newsletter.html#confirm=${confirmation}`;
      await api("/emails", "POST", {
        from: sender, to: [email], subject: "Confirm your TLB newsletter subscription",
        text: `Thanks for signing up for the TLB newsletter! Confirm your email to receive new treats, seasonal menus, and special offers.\n\n${link}\n\nThis link expires in 24 hours. If you did not request this, ignore this email. You will not be subscribed. You can unsubscribe from any newsletter.`,
        html: `<html><body style="margin:0;padding:32px;background:#fff9f2;color:#402b1e;font-family:Arial,sans-serif"><main style="max-width:520px;margin:auto"><h1>Fresh from TLB Kitchen</h1><p>Confirm your email to hear about new treats, seasonal menus, and special offers.</p><p><a href="${link}" style="display:inline-block;background:#714029;color:white;padding:14px 22px;border-radius:8px">Confirm my subscription</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email. You will not be subscribed.</p><p>You can unsubscribe from any newsletter.</p><p>The Little Baker Kitchen</p></main></body></html>`,
      }, `newsletter-confirm-${state.request_id}`);
    }
    return json(generic, 200, headers);
  }

  if (["status", "popup_claim", "popup_seen"].includes(action)) {
    const userId = await verifiedUser(request);
    if (!userId) throw new HttpError(401, "Sign in to manage your newsletter preferences.");
    if (action !== "status") return json(await service(action, { user_id: userId }), 200, headers);
    let state = await service("status", { user_id: userId });
    if (state.provider_import_pending) {
      const pending = await service("resume_import", { email: state.email });
      if (pending.busy) throw new HttpError(409, "Your newsletter update is still processing. Please wait a moment and try again.");
      if (pending.resume_import) await resumePreference(provider(), pending, await configuration());
      state = await service("status", { user_id: userId });
    }
    if (state.status === "subscribed") {
      const config = await configuration();
      const api = provider();
      const contact = await api(`/contacts/${encodeURIComponent(state.email)}`);
      if (!await subscribed(api, contact, config.topic_id)) {
        const result = await service("reconcile", { email: state.email, status: "unsubscribed", revision: state.revision });
        if (!result.updated) throw new HttpError(409, "Your preferences changed. Please refresh and try again.");
        state.status = "unsubscribed";
      }
    }
    return json({ email: state.email, status: state.status === "none" ? "not_subscribed" : state.status, popup_seen: state.popup_seen }, 200, headers);
  }

  if (action === "confirm" || action === "unsubscribe") {
    const config = await configuration();
    const api = provider();
    let identity: Record<string, unknown>;
    if (action === "unsubscribe" && !body.token) {
      const userId = await verifiedUser(request);
      if (!userId) throw new HttpError(401, "Sign in to manage your newsletter preferences.");
      identity = { user_id: userId };
    } else identity = { token_hash: await digest(token(body.token)) };
    let state = await service(action === "confirm" ? "begin_confirm" : "begin_unsubscribe", identity);
    if (state.resume_import) {
      await resumePreference(api, state, config);
      state = await service(action === "confirm" ? "begin_confirm" : "begin_unsubscribe", identity);
    }
    if (state.valid === false) throw new HttpError(410, "This newsletter link has expired or has already been replaced. Please request a new one.");
    if (state.busy) throw new HttpError(409, "Your newsletter preferences are being updated. Please wait a moment and try again.");
    if (state.done) return json({ ok: true, status: "unsubscribed" }, 200, headers);
    if (state.resume_import) throw new HttpError(409, "Your newsletter preferences are being updated. Please try again.");
    state.operation_kind = action;
    let contact = await api(`/contacts/${encodeURIComponent(state.email)}`);
    if (action === "confirm") {
      if (state.already_subscribed) {
        if (!await subscribed(api, contact, config.topic_id)) throw new HttpError(410, "You have unsubscribed since using this link. Please request a new confirmation email to rejoin.");
        return json({ ok: true, status: "subscribed" }, 200, headers);
      }
      if (contact?.unsubscribed) {
        await service("cancel_operation", { email: state.email, operation_id: state.operation_id });
        throw new HttpError(409, "Your address is opted out of all TLB marketing emails. Use the preferences link in a previous newsletter or contact TLB to rejoin.");
      }
      if (!contact) {
        contact = await api("/contacts", "POST", { email: state.email, segments: [{ id: config.segment_id }], topics: [{ id: config.topic_id, subscription: "opt_in" }] });
        if (!contact?.id) throw new HttpError(503, "Subscription could not be confirmed. Please try again in a moment.");
        await verifyPreference(api, contact.id, config.topic_id, "opt_in");
      } else {
        await api(`/contacts/${encodeURIComponent(contact.id)}/segments/${encodeURIComponent(config.segment_id)}`, "POST");
        state.contact_id = contact.id;
        const imported = await updatePreference(api, state, contact.id, config.topic_id, "opt_in");
        await finishPreference(api, state, config, imported);
        return json({ ok: true, status: "subscribed" }, 200, headers);
      }
      if (!contact?.id) throw new HttpError(503, "Subscription could not be confirmed. Please try again in a moment.");
      const unsubscribeToken = randomToken();
      await service("finish_confirm", { email: state.email, operation_id: state.operation_id, contact_id: contact.id, unsubscribe_token_hash: await digest(unsubscribeToken) });
      return json({ ok: true, status: "subscribed" }, 200, headers);
    }
    if (contact) {
      state.contact_id = contact.id;
      const imported = await updatePreference(api, state, contact.id, config.topic_id, "opt_out");
      await finishPreference(api, state, config, imported);
      return json({ ok: true, status: "unsubscribed" }, 200, headers);
    }
    await service("finish_unsubscribe", { email: state.email, operation_id: state.operation_id });
    return json({ ok: true, status: "unsubscribed" }, 200, headers);
    // Ambiguous network failures deliberately retain the lease until expiry.
  }
  throw new HttpError(400, "Unknown newsletter action.");
}));
