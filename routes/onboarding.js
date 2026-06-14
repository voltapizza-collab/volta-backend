import crypto from "crypto";
import express from "express";
import { sendSmtpEmail } from "../services/email.js";

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

const buildOnboardingEmail = (request, formalUrl) => {
  const text = [
    `Hola ${request.name},`,
    "",
    "Hemos recibido tu solicitud de onboarding en Volta Pizza.",
    "Para avanzar necesitamos conocer mejor tu negocio y validar algunos datos legales minimos antes de crear el acceso.",
    "",
    `Completa la solicitud formal aqui: ${formalUrl}`,
    "",
    "Gracias,",
    "Equipo Volta Pizza",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f172a;line-height:1.5">
      <h2 style="margin:0 0 12px;color:#3b008b">Solicitud de onboarding recibida</h2>
      <p>Hola ${request.name},</p>
      <p>Hemos recibido tu solicitud de onboarding en Volta Pizza.</p>
      <p>Para avanzar necesitamos conocer mejor tu negocio y validar algunos datos legales minimos antes de crear el acceso.</p>
      <p>
        <a href="${formalUrl}" style="display:inline-block;background:#ffb61c;color:#1f172a;padding:12px 16px;border-radius:8px;font-weight:700;text-decoration:none">
          Completar solicitud formal
        </a>
      </p>
      <p style="font-size:13px;color:#5d5668">Si el boton no funciona, copia este enlace:<br>${formalUrl}</p>
      <p>Gracias,<br>Equipo Volta Pizza</p>
    </div>
  `;

  return { text, html };
};

const buildFormalData = (body) => {
  const legalName = cleanText(body?.legalName, 191);
  const taxId = cleanText(body?.taxId, 64).toUpperCase();
  const legalRepresentative = cleanText(body?.legalRepresentative, 191);
  const representativeId = cleanText(body?.representativeId, 64).toUpperCase();
  const representativeRole = cleanText(body?.representativeRole, 120);
  const fiscalAddress = cleanText(body?.fiscalAddress, 255);
  const businessAddress = cleanText(body?.businessAddress, 255);
  const city = cleanText(body?.city, 120);
  const postalCode = cleanText(body?.postalCode, 32);
  const country = cleanText(body?.country, 80) || "Espana";
  const businessPhone = cleanText(body?.businessPhone, 64);
  const businessEmail = cleanText(body?.businessEmail, 191).toLowerCase();
  const website = cleanText(body?.website, 255);
  const numberOfStores = cleanText(body?.numberOfStores, 32);
  const monthlyOrdersEstimate = cleanText(body?.monthlyOrdersEstimate, 64);
  const currentPlatforms = cleanText(body?.currentPlatforms, 500);
  const notes = cleanLongText(body?.notes, 4000);
  const acceptedTerms = body?.acceptedTerms === true;
  const acceptedCompliance = body?.acceptedCompliance === true;

  const missing = [];
  if (!legalName) missing.push("legalName");
  if (!taxId) missing.push("taxId");
  if (!legalRepresentative) missing.push("legalRepresentative");
  if (!representativeId) missing.push("representativeId");
  if (!representativeRole) missing.push("representativeRole");
  if (!fiscalAddress) missing.push("fiscalAddress");
  if (!businessAddress) missing.push("businessAddress");
  if (!city) missing.push("city");
  if (!postalCode) missing.push("postalCode");
  if (!country) missing.push("country");
  if (!businessPhone) missing.push("businessPhone");
  if (!isEmail(businessEmail)) missing.push("businessEmail");
  if (!acceptedTerms) missing.push("acceptedTerms");
  if (!acceptedCompliance) missing.push("acceptedCompliance");

  return {
    data: {
      legalName,
      taxId,
      legalRepresentative,
      representativeId,
      representativeRole,
      fiscalAddress,
      businessAddress,
      city,
      postalCode,
      country,
      businessPhone,
      businessEmail,
      website,
      numberOfStores,
      monthlyOrdersEstimate,
      currentPlatforms,
      notes,
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

  router.post("/form/:token", async (req, res) => {
    try {
      const token = cleanText(req.params.token, 191);
      const request = await prisma.onboardingRequest.findUnique({ where: { token } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      if (["APPROVED", "REJECTED"].includes(request.status)) {
        return res.status(409).json({ ok: false, error: "onboarding_request_closed" });
      }

      const { data, missing } = buildFormalData(req.body);
      if (missing.length) {
        return res.status(400).json({ ok: false, error: "formal_data_missing", missing });
      }

      const updated = await prisma.onboardingRequest.update({
        where: { token },
        data: {
          formalData: data,
          status: "FORM_COMPLETED",
          submittedAt: new Date(),
        },
      });

      return res.json({ ok: true, request: mapRequest(updated) });
    } catch (error) {
      console.error("[onboarding.form.submit] error:", error);
      return res.status(500).json({ ok: false, error: "onboarding_form_submit_failed" });
    }
  });

  return router;
}
