import { v2 as cloudinary } from "cloudinary";
import { assertCloudinaryConfigured } from "./cloudinaryConfig.js";
import { LOGO_MAX_BYTES, logoError } from "./logoImageProcessing.js";

export function uploadLogoAsset(buffer, partnerId, kind) {
  assertCloudinaryConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: "image",
      folder: `volta/partners/${partnerId}/branding/${kind}` }, (error, result) => {
      if (error) reject(error);
      else resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.on("error", reject);
    stream.end(buffer);
  });
}

export async function loadStoredLogo(partner, fetchImage = fetch) {
  const source = partner.brandLogoOriginalUrl || partner.brandLogoUrl;
  const publicId = partner.brandLogoOriginalPublicId || partner.brandLogoPublicId;
  let url;
  try { url = new URL(source); } catch { throw logoError("No hay un logo original disponible. Sube el archivo."); }
  // Only fetch the stored Cloudinary asset for this business, never a client-supplied URL.
  if (url.protocol !== "https:" || url.host !== "res.cloudinary.com" || url.username || url.password ||
      !publicId?.startsWith(`volta/partners/${partner.id}/branding/`) ||
      !decodeURIComponent(url.pathname).includes(`/image/upload/`) ||
      !decodeURIComponent(url.pathname).includes(`/${publicId}.`)) {
    throw logoError("No podemos recuperar este original. Sube el archivo desde tu equipo.");
  }
  const response = await fetchImage(url.href, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw logoError("No pudimos recuperar el original. Reintenta o sube el archivo.", 502);
  if (Number(response.headers.get("content-length")) > LOGO_MAX_BYTES) {
    await response.body.cancel();
    throw logoError("El logo debe pesar como máximo 8 MB.", 413);
  }
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > LOGO_MAX_BYTES) throw logoError("El logo debe pesar como máximo 8 MB.", 413);
    parts.push(chunk);
  }
  return { buffer: Buffer.concat(parts) };
}
