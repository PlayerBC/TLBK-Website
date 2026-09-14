import { credentials, endpoint, HttpError, json, readJson, service, storageRequest, uuid, verifiedUser } from "../_shared/server.ts";

Deno.serve(endpoint(async (request, headers) => {
  const userId = await verifiedUser(request, true);
  const body = await readJson(request);
  const orderId = uuid(body.order_id);
  const result = await service("authorize_proof_read", { order_id: orderId, user_id: userId });
  const path = result?.path;
  if (typeof path !== "string" || !path.startsWith(`${orderId}/`) || path.includes("..")) throw new HttpError(404, "This order has no available payment proof.");
  const signed = await storageRequest(`object/sign/payment-proofs/${path}`, "POST", JSON.stringify({ expiresIn: 300 }), "application/json");
  const signedPath = signed?.signedURL || signed?.signedUrl;
  if (typeof signedPath !== "string") throw new HttpError(502, "Could not open the private proof. Please try again.");
  return json({ url: signedPath.startsWith("https://") ? signedPath : `${credentials().url}/storage/v1${signedPath}`, expires_in: 300 }, 200, headers);
}));
