import crypto from "crypto";
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { sendSmtpEmail } from "../services/email.js";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";

const MAX_DOCUMENTS = 8;
const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const REQUIRED_DOCUMENT_TYPES = ["IDENTITY", "FISCAL"];
const OPTIONAL_DOCUMENT_TYPES = ["BANK", "REPRESENTATION", "HEALTH"];
const DOCUMENT_TYPES = new Set([...REQUIRED_DOCUMENT_TYPES, ...OPTIONAL_DOCUMENT_TYPES]);
const DOCUMENT_TYPE_LABELS = {
  IDENTITY: "Documento de identidad del responsable",
  FISCAL: "Documento fiscal o societario",
  BANK: "Justificante de titularidad bancaria",
  REPRESENTATION: "Poder o documento de representacion",
  HEALTH: "Licencia o autorizacion sanitaria",
  OTHER: "Documento de soporte",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_SIZE_BYTES,
    files: MAX_DOCUMENTS,
  },
});

const PUBLIC_STATUSES = new Set([
  "RECEIVED",
  "EMAIL_SENT",
  "FORM_COMPLETED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFO",
]);

const REVIEW_STATUSES = new Set(["IN_REVIEW", "APPROVED", "REJECTED", "NEEDS_INFO"]);

const cleanText = (value, max = 500) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const cleanLongText = (value, max = 4000) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const cleanIban = (value) =>
  String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 34);

const isLikelyIban = (value) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(String(value || ""));

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const parseBoolean = (value) =>
  value === true || ["true", "1", "on", "yes"].includes(String(value || "").toLowerCase());

const normalizeDocumentType = (value) => {
  const type = String(value || "").trim().toUpperCase();
  return DOCUMENT_TYPES.has(type) ? type : "OTHER";
};

const toArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

const publicFrontendUrl = () =>
  (
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.STOREFRONT_URL ||
    "https://voltapizza.com"
  )
    .trim()
    .replace(/\/$/, "");

const buildFormalUrl = (token) => `${publicFrontendUrl()}/onboarding/${encodeURIComponent(token)}`;

const mapRequest = (request) => ({
  id: request.id,
  token: request.token,
  name: request.name,
  businessName: request.businessName,
  email: request.email,
  phone: request.phone,
  message: request.message,
  status: request.status,
  emailStatus: request.emailStatus,
  emailSentAt: request.emailSentAt,
  emailError: request.emailError,
  formalData: request.formalData,
  submittedAt: request.submittedAt,
  reviewedAt: request.reviewedAt,
  reviewerNote: request.reviewerNote,
  formalUrl: buildFormalUrl(request.token),
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const buildEmailShell = ({ title, preheader, bodyHtml, footerHtml = "" }) => `
  <div style="margin:0;padding:0;background:#f3efff;color:#000000;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f3efff">
      <tr>
        <td align="center" style="padding:30px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border:1px solid #decfff;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(59,0,139,0.18)">
            <tr>
              <td style="background:#3b008b;padding:0">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                  <tr>
                    <td align="center" style="background:#ffb61c;padding:30px 24px 26px;border-bottom:7px solid #6a3df0">
                      <div style="font-size:38px;line-height:1;font-weight:900;color:#3b008b;letter-spacing:0">Volta Pizza</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:18px 24px 20px;background:#3b008b">
                      <div style="color:#ffb61c;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Onboarding</div>
                      <div style="margin-top:6px;color:#ffffff;font-size:28px;line-height:1.2;font-weight:900">${escapeHtml(title)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 34px 34px;color:#000000;font-size:15px;line-height:1.6">
                ${bodyHtml}
                ${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
`;

const buildVoltaSignature = () => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #decfff">
    <tr>
      <td style="padding-top:18px">
        <div style="color:#000000;font-size:14px;line-height:1.5">Gracias,</div>
        <div style="margin-top:4px;color:#3b008b;font-size:18px;line-height:1.2;font-weight:900">Equipo Volta Pizza</div>
        <div style="margin-top:8px;color:#4b405a;font-size:13px;line-height:1.5">
          THE PIZZA SALE ENGINE<br>
          <a href="mailto:${escapeHtml(process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com")}" style="color:#6a3df0;text-decoration:none;font-weight:700">${escapeHtml(process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com")}</a>
          <span style="color:#ffb61c;font-weight:900"> | </span>
          <a href="https://voltapizza.com" style="color:#6a3df0;text-decoration:none;font-weight:700">voltapizza.com</a>
        </div>
      </td>
    </tr>
  </table>
`;

const buildOnboardingEmail = (request, formalUrl) => {
  const safeName = escapeHtml(request.name);
  const safeBusinessName = escapeHtml(request.businessName);
  const safeFormalUrl = escapeHtml(formalUrl);
  const text = [
    `Hola ${request.name},`,
    "",
    `Hemos recibido la solicitud de ${request.businessName} en Volta Pizza.`,
    "Tu proceso entra ahora en la fase 2: validacion basica de datos legales y operativos.",
    "Necesitamos que completes el formulario con CIF/NIF/NIE, datos del responsable, direccion fiscal y documentacion basica para validar el alta.",
    "",
    `Sube la informacion aqui: ${formalUrl}`,
    "",
    "Gracias,",
    "Equipo Volta Pizza",
  ].join("\n");

  const html = buildEmailShell({
    title: "Solicitud recibida",
    preheader: "Tu proceso de onboarding en Volta Pizza entra en fase 2.",
    bodyHtml: `
      <p style="margin:0 0 14px">Estimado/a <strong>${safeName}</strong>:</p>
      <p style="margin:0 0 14px">Hemos recibido la solicitud de <strong>${safeBusinessName}</strong> en Volta Pizza.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0 22px;background:#ffb61c;border-radius:14px">
        <tr>
          <td style="padding:18px 18px">
            <div style="color:#3b008b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Estado actual</div>
            <div style="margin-top:6px;color:#000000;font-size:22px;line-height:1.25;font-weight:900">Entramos en fase 2</div>
            <div style="margin-top:8px;color:#2a173f;font-size:14px;line-height:1.5">Validaremos datos legales y operativos minimos antes de activar el acceso.</div>
          </td>
        </tr>
      </table>

      <div style="margin:0 0 12px;color:#3b008b;font-size:18px;font-weight:900;text-align:center">Que necesitamos de ti</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;margin:0 0 18px">
        <tr>
          <td width="44" valign="top" style="width:44px">
            <div style="background:#3b008b;color:#ffffff;border-radius:999px;width:34px;height:34px;line-height:34px;text-align:center;font-weight:900">1</div>
          </td>
          <td style="background:#f8f5ff;border:1px solid #decfff;border-radius:12px;padding:12px 14px">
            <strong style="color:#000000">Identificacion fiscal</strong><br>
            <span style="color:#4b405a;font-size:14px">CIF/NIF/NIE o identificador fiscal del titular.</span>
          </td>
        </tr>
        <tr>
          <td width="44" valign="top" style="width:44px">
            <div style="background:#6a3df0;color:#ffffff;border-radius:999px;width:34px;height:34px;line-height:34px;text-align:center;font-weight:900">2</div>
          </td>
          <td style="background:#f8f5ff;border:1px solid #decfff;border-radius:12px;padding:12px 14px">
            <strong style="color:#000000">Responsable autorizado</strong><br>
            <span style="color:#4b405a;font-size:14px">Datos de la persona que representa legalmente el negocio.</span>
          </td>
        </tr>
        <tr>
          <td width="44" valign="top" style="width:44px">
            <div style="background:#ffb61c;color:#3b008b;border-radius:999px;width:34px;height:34px;line-height:34px;text-align:center;font-weight:900">3</div>
          </td>
          <td style="background:#f8f5ff;border:1px solid #decfff;border-radius:12px;padding:12px 14px">
            <strong style="color:#000000">Documento de soporte</strong><br>
            <span style="color:#4b405a;font-size:14px">Un documento basico de titularidad o representacion del negocio.</span>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 22px;text-align:center">
        <a href="${safeFormalUrl}" style="display:inline-block;background:#3b008b;color:#ffffff;padding:15px 26px;border-radius:999px;font-weight:900;text-decoration:none;box-shadow:0 8px 18px rgba(59,0,139,.24)">Completar fase 2</a>
      </p>
      <div style="background:#fff8e7;border-left:5px solid #ffb61c;padding:12px 14px;margin:0 0 20px;color:#3b2c4a;font-size:13px">
        Si el boton no funciona, copia este enlace:<br><a href="${safeFormalUrl}" style="color:#6a3df0;word-break:break-all;font-weight:700">${safeFormalUrl}</a>
      </div>
      ${buildVoltaSignature()}
    `,
  });

  return { text, html };
};

const buildReviewEmail = (request) => {
  const text = [
    `Hola ${request.name},`,
    "",
    `Hemos recibido la informacion de ${request.businessName}.`,
    "Tu proceso de onboarding ya esta en revision por el equipo de Volta Pizza.",
    "Si necesitamos algun dato adicional, te contactaremos por este mismo correo.",
    "",
    "Gracias,",
    "Equipo Volta Pizza",
  ].join("\n");

  const html = buildEmailShell({
    title: "Onboarding en revision",
    preheader: "Hemos recibido tu informacion y el proceso esta en revision.",
    bodyHtml: `
      <p style="margin:0 0 14px">Estimado/a <strong>${escapeHtml(request.name)}</strong>:</p>
      <p style="margin:0 0 14px">Hemos recibido la informacion de <strong>${escapeHtml(request.businessName)}</strong>.</p>
      <div style="background:#ffb61c;border-radius:14px;padding:20px 18px;margin:20px 0 22px;text-align:center">
        <div style="margin:0 0 8px;color:#3b008b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Estado actual</div>
        <div style="color:#000000;font-size:23px;font-weight:900">En proceso de revision</div>
        <div style="margin-top:8px;color:#2a173f;font-size:14px">Nuestro equipo revisara los datos y el documento adjunto.</div>
      </div>
      <p style="margin:0">Si necesitamos algun dato adicional, te contactaremos por este mismo correo.</p>
    `,
    footerHtml: buildVoltaSignature(),
  });

  return { text, html };
};

const sanitizeFileName = (value) =>
  cleanText(value, 180).replace(/[^\w.\- ]+/g, "_") || "documento";

const uploadOnboardingDocument = async (file, request, documentType = "OTHER") => {
  if (!ALLOWED_DOCUMENT_TYPES.has(file.mimetype)) {
    const error = new Error("invalid_onboarding_document_type");
    error.status = 400;
    throw error;
  }

  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    {
      folder: `volta/onboarding/${request.id}`,
      resource_type: "auto",
      type: "authenticated",
      use_filename: true,
      unique_filename: true,
      filename_override: sanitizeFileName(file.originalname),
      context: {
        onboardingRequestId: String(request.id),
        businessName: request.businessName,
        documentType,
      },
    }
  );

  return {
    type: documentType,
    label: DOCUMENT_TYPE_LABELS[documentType] || DOCUMENT_TYPE_LABELS.OTHER,
    name: sanitizeFileName(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
    publicId: result.public_id,
    resourceType: result.resource_type,
    url: cloudinary.url(result.public_id, {
      resource_type: result.resource_type,
      type: "authenticated",
      secure: true,
      sign_url: true,
    }),
    uploadedAt: new Date().toISOString(),
  };
};

const deleteOnboardingDocuments = async (request) => {
  const documents = Array.isArray(request?.formalData?.supportingDocuments)
    ? request.formalData.supportingDocuments
    : [];

  await Promise.all(
    documents
      .filter((document) => document?.publicId)
      .map((document) =>
        cloudinary.uploader
          .destroy(document.publicId, {
            resource_type: document.resourceType || "image",
            type: "authenticated",
          })
          .catch((error) => {
            console.warn("[onboarding.documents.delete] warning:", error?.message || error);
          })
      )
  );
};

const buildFormalData = (body, supportingDocuments = []) => {
  const partnerType = ["AUTONOMO", "SOCIEDAD"].includes(String(body?.partnerType || "").toUpperCase())
    ? String(body.partnerType).toUpperCase()
    : "";
  const legalName = cleanText(body?.legalName, 191);
  const taxId = cleanText(body?.taxId, 64).toUpperCase();
  const legalRepresentative = cleanText(body?.legalRepresentative, 191);
  const representativeId = cleanText(body?.representativeId, 64).toUpperCase();
  const representativeRole = cleanText(body?.representativeRole, 120);
  const fiscalAddress = cleanText(body?.fiscalAddress, 255);
  const commercialName = cleanText(body?.commercialName, 191);
  const businessAddress = cleanText(body?.businessAddress, 255);
  const city = cleanText(body?.city, 120);
  const postalCode = cleanText(body?.postalCode, 32);
  const country = cleanText(body?.country, 80) || "Espana";
  const businessPhone = cleanText(body?.businessPhone, 64);
  const businessEmail = cleanText(body?.businessEmail, 191).toLowerCase();
  const accountHolder = cleanText(body?.accountHolder, 191);
  const iban = cleanIban(body?.iban);
  const website = cleanText(body?.website, 255);
  const numberOfStores = cleanText(body?.numberOfStores, 32);
  const monthlyOrdersEstimate = cleanText(body?.monthlyOrdersEstimate, 64);
  const currentPlatforms = cleanText(body?.currentPlatforms, 500);
  const notes = cleanLongText(body?.notes, 4000);
  const acceptedTerms = parseBoolean(body?.acceptedTerms);
  const acceptedCompliance = parseBoolean(body?.acceptedCompliance);

  const missing = [];
  const documentsByType = new Set(
    supportingDocuments.map((document) => normalizeDocumentType(document?.type))
  );
  if (!partnerType) missing.push("partnerType");
  if (!legalName) missing.push("legalName");
  if (!taxId) missing.push("taxId");
  if (!legalRepresentative) missing.push("legalRepresentative");
  if (!representativeId) missing.push("representativeId");
  if (!representativeRole) missing.push("representativeRole");
  if (!fiscalAddress) missing.push("fiscalAddress");
  if (!commercialName) missing.push("commercialName");
  if (!businessAddress) missing.push("businessAddress");
  if (!city) missing.push("city");
  if (!postalCode) missing.push("postalCode");
  if (!country) missing.push("country");
  if (!businessPhone) missing.push("businessPhone");
  if (!isEmail(businessEmail)) missing.push("businessEmail");
  if (!accountHolder) missing.push("accountHolder");
  if (!isLikelyIban(iban)) missing.push("iban");
  REQUIRED_DOCUMENT_TYPES.forEach((type) => {
    if (!documentsByType.has(type)) missing.push(`document:${type}`);
  });
  if (!acceptedTerms) missing.push("acceptedTerms");
  if (!acceptedCompliance) missing.push("acceptedCompliance");

  return {
    data: {
      partnerType,
      legalName,
      taxId,
      legalRepresentative,
      representativeId,
      representativeRole,
      fiscalAddress,
      commercialName,
      businessAddress,
      city,
      postalCode,
      country,
      businessPhone,
      businessEmail,
      accountHolder,
      iban,
      operationMode: "PARTNER_DELIVERY",
      website,
      numberOfStores,
      monthlyOrdersEstimate,
      currentPlatforms,
      notes,
      supportingDocuments,
      acceptedTerms,
      acceptedCompliance,
      submittedFrom: "formal_onboarding_form",
    },
    missing,
  };
};

export default function onboardingRoutes(prisma) {
  const router = express.Router();

  router.post("/requests", async (req, res) => {
    try {
      const name = cleanText(req.body?.name, 191);
      const businessName = cleanText(req.body?.business || req.body?.businessName, 191);
      const email = cleanText(req.body?.email, 191).toLowerCase();
      const phone = cleanText(req.body?.phone, 64) || null;
      const message = cleanLongText(req.body?.message, 4000) || null;

      if (!name || !businessName || !isEmail(email)) {
        return res.status(400).json({ ok: false, error: "invalid_onboarding_request" });
      }

      const token = crypto.randomBytes(24).toString("hex");
      const request = await prisma.onboardingRequest.create({
        data: {
          token,
          name,
          businessName,
          email,
          phone,
          message,
        },
      });

      const formalUrl = buildFormalUrl(token);
      const emailBody = buildOnboardingEmail(request, formalUrl);
      const emailResult = await sendSmtpEmail({
        to: email,
        subject: "Solicitud de onboarding recibida - Volta Pizza",
        text: emailBody.text,
        html: emailBody.html,
        replyTo: process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com",
      });

      const updated = await prisma.onboardingRequest.update({
        where: { id: request.id },
        data: emailResult.ok
          ? {
              status: "EMAIL_SENT",
              emailStatus: "SENT",
              emailSentAt: new Date(),
              emailError: null,
            }
          : {
              emailStatus: emailResult.skipped ? "NOT_CONFIGURED" : "FAILED",
              emailError: emailResult.reason || "email_send_failed",
            },
      });

      return res.status(201).json({ ok: true, request: mapRequest(updated) });
    } catch (error) {
      console.error("[onboarding.requests.create] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_request_failed" });
    }
  });

  router.get("/requests", async (req, res) => {
    try {
      const status = cleanText(req.query?.status, 32).toUpperCase();
      const where = PUBLIC_STATUSES.has(status) ? { status } : {};
      const requests = await prisma.onboardingRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      return res.json({ ok: true, requests: requests.map(mapRequest) });
    } catch (error) {
      console.error("[onboarding.requests.list] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_list_failed" });
    }
  });

  router.patch("/requests/:id/status", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = cleanText(req.body?.status, 32).toUpperCase();
      const reviewerNote = cleanLongText(req.body?.reviewerNote, 4000) || null;

      if (!Number.isInteger(id) || id <= 0 || !PUBLIC_STATUSES.has(status)) {
        return res.status(400).json({ ok: false, error: "invalid_status_update" });
      }

      const updated = await prisma.onboardingRequest.update({
        where: { id },
        data: {
          status,
          reviewerNote,
          reviewedAt: REVIEW_STATUSES.has(status) ? new Date() : undefined,
        },
      });

      return res.json({ ok: true, request: mapRequest(updated) });
    } catch (error) {
      console.error("[onboarding.requests.status] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_status_failed" });
    }
  });

  router.delete("/requests/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_onboarding_request_id" });
      }

      const request = await prisma.onboardingRequest.findUnique({ where: { id } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      await deleteOnboardingDocuments(request);
      await prisma.onboardingRequest.delete({ where: { id } });

      return res.json({ ok: true, deletedId: id });
    } catch (error) {
      console.error("[onboarding.requests.delete] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_delete_failed" });
    }
  });

  router.get("/form/:token", async (req, res) => {
    try {
      const token = cleanText(req.params.token, 191);
      const request = await prisma.onboardingRequest.findUnique({ where: { token } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      return res.json({ ok: true, request: mapRequest(request) });
    } catch (error) {
      console.error("[onboarding.form.get] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_form_failed" });
    }
  });

  router.post("/form/:token", upload.array("documents", MAX_DOCUMENTS), async (req, res) => {
    try {
      const token = cleanText(req.params.token, 191);
      const request = await prisma.onboardingRequest.findUnique({ where: { token } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      if (["APPROVED", "REJECTED"].includes(request.status)) {
        return res.status(409).json({ ok: false, error: "onboarding_request_closed" });
      }

      const existingDocuments = Array.isArray(request.formalData?.supportingDocuments)
        ? request.formalData.supportingDocuments
        : [];
      const incomingFiles = req.files || [];
      const incomingTypes = toArray(req.body?.documentTypes).map(normalizeDocumentType);
      const incomingDocumentPlaceholders = incomingFiles.map((_, index) => ({
        type: incomingTypes[index] || "OTHER",
      }));
      const documentsForValidation = [
        ...existingDocuments,
        ...incomingDocumentPlaceholders,
      ];
      const precheck = buildFormalData(req.body, documentsForValidation);

      if (precheck.missing.length) {
        return res.status(400).json({ ok: false, error: "formal_data_missing", missing: precheck.missing });
      }

      const uploadedDocuments = [];

      for (const [index, file] of incomingFiles.entries()) {
        uploadedDocuments.push(
          await uploadOnboardingDocument(file, request, incomingTypes[index] || "OTHER")
        );
      }

      const supportingDocuments = uploadedDocuments.length
        ? [...existingDocuments, ...uploadedDocuments].slice(0, MAX_DOCUMENTS)
        : existingDocuments;
      const { data } = buildFormalData(req.body, supportingDocuments);

      const reviewEmailBody = buildReviewEmail(request);
      const reviewEmailResult = await sendSmtpEmail({
        to: request.email,
        subject: "Onboarding en revision - Volta Pizza",
        text: reviewEmailBody.text,
        html: reviewEmailBody.html,
        replyTo: process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com",
      });

      const updated = await prisma.onboardingRequest.update({
        where: { token },
        data: {
          formalData: {
            ...data,
            reviewNotification: {
              emailStatus: reviewEmailResult.ok
                ? "SENT"
                : reviewEmailResult.skipped
                  ? "NOT_CONFIGURED"
                  : "FAILED",
              emailSentAt: reviewEmailResult.ok ? new Date().toISOString() : null,
              emailError: reviewEmailResult.ok
                ? null
                : reviewEmailResult.reason || "email_send_failed",
            },
          },
          status: "IN_REVIEW",
          submittedAt: new Date(),
        },
      });

      return res.json({ ok: true, request: mapRequest(updated) });
    } catch (error) {
      console.error("[onboarding.form.submit] error:", error);
      if (error?.status === 400) {
        return res.status(400).json({ ok: false, error: error.message || "invalid_onboarding_document" });
      }
      if (error?.status === 503) {
        return res.status(503).json({ ok: false, error: "document_upload_not_configured" });
      }
      return res.status(500).json({ ok: false, error: "onboarding_form_submit_failed" });
    }
  });

  return router;
}
