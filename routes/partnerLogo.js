import express from "express";
import multer from "multer";
import { LOGO_MAX_BYTES, logoError, prepareLogo } from "../services/logoImageProcessing.js";
import { replacePartnerLogo } from "../services/partnerLogo.js";

export function createPartnerLogoRouter({ getPartner, saveLogo, uploadAsset, removeAsset, loadOriginal, onCleanupError = console.error }) {
  const router = express.Router({ mergeParams: true });
  const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1, fields: 3 } }).single("logo");
  router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const run = (preview, current) => async (req, res, next) => {
    try {
      const partnerId = Number(req.params.partnerId);
      if (!Number.isSafeInteger(partnerId) || partnerId <= 0) throw logoError("Negocio no válido.");
      const partner = await getPartner(partnerId);
      if (!partner) throw logoError("No encontramos la pizzería.", 404);
      const option = req.body?.removeBackground;
      if (option != null && !["true", "false", true, false].includes(option)) throw logoError("Opción de fondo no válida.");
      const removeBackground = option !== "false" && option !== false;
      const sourceId = partner.brandLogoOriginalPublicId || partner.brandLogoPublicId;
      if (current && !preview && (!sourceId || req.body?.sourceId !== sourceId)) {
        throw logoError("El logo cambió. Abre de nuevo su vista previa.", 409);
      }
      const file = current ? await loadOriginal(partner) : req.file;
      const prepared = await prepareLogo(file?.buffer, { removeBackground });
      if (preview) {
        return res.json({ previewUrl: `data:image/png;base64,${prepared.buffer.toString("base64")}`,
          status: prepared.status, width: prepared.width, height: prepared.height,
          ...(current ? { sourceId, originalUrl: partner.brandLogoOriginalUrl || partner.brandLogoUrl } : {}) });
      }
      await replacePartnerLogo({
        partner,
        upload: async () => {
          let original;
          try {
            original = current
              ? { url: partner.brandLogoOriginalUrl || partner.brandLogoUrl, publicId: sourceId }
              : await uploadAsset(file.buffer, partnerId, "originals");
            const processed = await uploadAsset(prepared.buffer, partnerId, "prepared");
            return { ...processed, originalUrl: original.url, originalPublicId: original.publicId,
              status: prepared.status, createdAssetIds: [processed.publicId, ...(!current ? [original.publicId] : [])] };
          } catch (error) {
            if (original && !current) await removeAsset(original.publicId).catch(onCleanupError);
            throw error;
          }
        },
        save: logo => saveLogo(partnerId, logo, partner.brandLogoPublicId),
        remove: removeAsset, onCleanupError,
      });
      return res.json(await getPartner(partnerId));
    } catch (error) { next(error); }
  };
  router.post("/preview", multipart, run(true, false));
  router.post("/preview-current", express.json({ limit: "2kb" }), run(true, true));
  router.post("/process-current", express.json({ limit: "2kb" }), run(false, true));
  router.post("/", multipart, run(false, false));
  router.use((error, req, res, next) => {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || (error instanceof multer.MulterError ? 400 : 500);
    res.status(status).json({ error: error.code === "LIMIT_FILE_SIZE" ? "El logo debe pesar como máximo 8 MB."
      : status < 500 ? error.message : "No pudimos guardar el logo. El anterior sigue disponible." });
  });
  return router;
}
