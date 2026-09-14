import { credentials, endpoint, field, HttpError, json, readBody, service, storageRequest, uuid, verifiedUser } from "../_shared/server.ts";
import { imageType, MAX_IMAGE_BYTES } from "../_shared/images.ts";

Deno.serve(endpoint(async (request, headers) => {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;")) throw new HttpError(400, "Send an image using a multipart form.");
  const bytes = await readBody(request, MAX_IMAGE_BYTES + 65536);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HttpError(400, "The upload form is invalid."); }
  const kind = field(form.get("kind"), "Upload type", 16, true);
  if (!["proof", "product"].includes(kind)) throw new HttpError(400, "Choose a payment proof or product image.");
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) throw new HttpError(400, "Choose one image to upload.");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Images must be 5 MB or smaller.");
  const contents = new Uint8Array(await file.arrayBuffer());
  const image = imageType(contents);
  const userId = await verifiedUser(request, kind === "product");
  const orderId = kind === "proof" ? uuid(form.get("order_id")) : null;
  const token = field(form.get("token"), "Order access token", 256);
  const paymentReference = field(form.get("payment_reference"), "Payment reference", 200, kind === "proof");
  const authorization = await service("authorize_upload", { kind, order_id: orderId, token, user_id: userId });
  if (!authorization?.allowed) throw new HttpError(403, "You cannot upload an image for this request.");
  const bucket = kind === "proof" ? "payment-proofs" : "product-images";
  const path = `${kind === "proof" ? orderId : userId}/${crypto.randomUUID()}.${image.extension}`;
  await storageRequest(`object/${bucket}/${path}`, "POST", contents, image.mime);
  if (kind === "product") {
    return json({ path, url: `${credentials().url}/storage/v1/object/public/${bucket}/${path}` }, 201, headers);
  }
  try {
    // Locks and validates the order again, closing the upload/expiry/rejection race.
    const order = await service("commit_proof", { order_id: orderId, token, user_id: userId, path, payment_reference: paymentReference });
    return json({ order }, 201, headers);
  } catch (error) {
    try { await storageRequest(`object/${bucket}`, "DELETE", JSON.stringify({ prefixes: [path] }), "application/json"); }
    catch { /* The object remains private if cleanup is temporarily unavailable. */ }
    throw error;
  }
}));
