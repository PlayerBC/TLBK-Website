// Edge-only helpers. No secret in this module is sent to the browser.
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function env(name: string): string { return Deno.env.get(name)?.trim() || ""; }

function keyFromDictionary(name: string): string {
  try {
    const values = JSON.parse(env(name) || "{}");
    return String(values.default || Object.values(values)[0] || "");
  } catch { return ""; }
}

export function credentials() {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || keyFromDictionary("SUPABASE_SECRET_KEYS");
  if (!url || !key) throw new HttpError(503, "Backend credentials are not configured.");
  return { url, key };
}

export function cors(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = env("ALLOWED_ORIGINS").split(",").map(x => x.trim()).filter(Boolean);
    if (!allowed.length) throw new HttpError(503, "Allowed website origins are not configured.");
    if (!allowed.includes(origin)) throw new HttpError(403, "This website origin is not allowed.");
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

export function json(data: unknown, status = 200, headers = new Headers()): Response {
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

export function endpoint(handler: (request: Request, headers: Headers) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let headers = new Headers();
    try {
      headers = cors(request);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") throw new HttpError(405, "Use POST for this endpoint.");
      return await handler(request, headers);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // Unanticipated provider errors may contain credentials or payloads; do not expose or log them.
      const message = error instanceof HttpError ? error.message : "The request could not be completed. Please try again.";
      return json({ error: message }, status, headers);
    }
  };
}

export async function service(action: string, payload: Record<string, unknown> = {}, timeoutMs = 15000): Promise<any> {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/rpc/shop_service`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: action, p_payload: payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "The order service is unavailable.";
    throw new HttpError(response.status >= 500 ? 503 : 400, message);
  }
  if (data?.error) throw new HttpError(400, String(data.error));
  return data;
}

export function field(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new HttpError(400, `${name} is required.`);
    return "";
  }
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, `${name} is missing or too long.`);
  return result;
}

export function uuid(value: unknown, name = "Order ID"): string {
  const result = field(value, name, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) {
    throw new HttpError(400, `${name} is invalid.`);
  }
  return result;
}

// Read bounded bytes before parsing multipart/JSON, even for chunked requests.
export async function readBody(request: Request, maximum: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maximum) throw new HttpError(413, "The upload is too large. Images must be 5 MB or smaller.");
  if (!request.body) throw new HttpError(400, "The request body is empty.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new HttpError(413, "The upload is too large. Images must be 5 MB or smaller.");
    }
    parts.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export async function readJson(request: Request): Promise<any> {
  const bytes = await readBody(request, 16384);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "A valid JSON object is required."); }
}

export async function verifiedUser(request: Request, required = false): Promise<string | null> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const publicKeys = [env("SUPABASE_ANON_KEY"), ...Object.values((() => {
    try { return JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") || "{}"); } catch { return {}; }
  })())];
  if (!token || publicKeys.includes(token) || token.startsWith("sb_publishable_")) {
    if (required) throw new HttpError(401, "Sign in with your staff account to continue.");
    return null;
  }
  const { url, key } = credentials();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new HttpError(401, "Your session has expired. Sign in again.");
  return uuid(user.id, "User ID");
}

export async function storageRequest(path: string, method: string, body?: BodyInit, contentType?: string): Promise<any> {
  const { url, key } = credentials();
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
  if (contentType) headers["Content-Type"] = contentType;
  if (method === "POST" && contentType?.startsWith("image/")) headers["x-upsert"] = "false";
  const response = await fetch(`${url}/storage/v1/${path}`, { method, headers, body, signal: AbortSignal.timeout(25000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(502, "Image storage could not complete the request. Please try again.");
  return data;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
