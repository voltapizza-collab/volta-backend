import crypto from "crypto";
import axios from "axios";
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { sendSmtpEmail } from "../services/email.js";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";
import { buildPosPinData, generateSixDigitPin } from "../services/posCredentials.js";

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
const GOOGLE_GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";

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
  "CONTRACT_SENT",
  "ACTIVATED",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFO",
]);

const REVIEW_STATUSES = new Set([
  "IN_REVIEW",
  "CONTRACT_SENT",
  "ACTIVATED",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFO",
]);

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

const getGoogleGeocodingKey = () =>
  process.env.GOOGLE_GEOCODING_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.REACT_APP_GOOGLE_KEY ||
  "";

const resolveGeocodeRegion = (country) => {
  const value = cleanText(country, 16);
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!value || normalized.includes("esp")) return "ES";
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return value;
};

const resolveOnboardingStoreCoordinates = async (formalData = {}) => {
  const key = getGoogleGeocodingKey();
  if (!key) return null;

  const address = [
    cleanText(formalData.businessAddress || formalData.fiscalAddress, 255),
    cleanText(formalData.city, 120),
    cleanText(formalData.postalCode, 32),
    cleanText(formalData.country, 80) || "Espana",
  ]
    .filter(Boolean)
    .join(", ");

  if (!address) return null;

  try {
    const response = await axios.get(GOOGLE_GEOCODING_URL, {
      params: {
        address,
        region: resolveGeocodeRegion(formalData.country),
        key,
      },
    });

    const location = response.data?.results?.[0]?.geometry?.location;
    const latitude = Number(location?.lat);
    const longitude = Number(location?.lng);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    return { latitude, longitude };
  } catch (error) {
    console.warn("[onboarding.geocode] warning:", error?.message || error);
    return null;
  }
};

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

const buildContractUrl = (token) => `${buildFormalUrl(token)}?contract=1`;

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
    "Necesitamos que completes el formulario con CIF/NIF/NIE, datos del responsable y documentacion basica para validar el alta.",
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

const formatContractDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const formalValueLabels = {
  AUTONOMO: "Autonomo",
  SOCIEDAD: "Sociedad",
  PARTNER_DELIVERY: "Reparto gestionado por el partner",
};

const formatFormalValue = (value) => formalValueLabels[value] || value || "-";

const buildContractData = (request) => {
  const formalData = request?.formalData || {};
  const commercialName = formalData.commercialName || request?.businessName || "-";
  const legalName = formalData.legalName || commercialName;
  const contractDate = request?.submittedAt || request?.reviewedAt || request?.createdAt;
  const address = [
    formalData.fiscalAddress || formalData.businessAddress,
    formalData.city,
    formalData.postalCode,
    formalData.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    contractDate: formatContractDate(contractDate),
    legalName: formatFormalValue(legalName),
    commercialName: formatFormalValue(commercialName),
    partnerType: formatFormalValue(formalData.partnerType),
    taxId: formatFormalValue(formalData.taxId),
    address: formatFormalValue(address),
    legalRepresentative: formatFormalValue(formalData.legalRepresentative),
    representativeRole: formatFormalValue(formalData.representativeRole),
    businessEmail: formatFormalValue(formalData.businessEmail || request?.email),
    businessPhone: formatFormalValue(formalData.businessPhone || request?.phone),
    accountHolder: formatFormalValue(formalData.accountHolder),
    iban: formatFormalValue(formalData.iban),
    operationMode: formatFormalValue(formalData.operationMode),
  };
};

const buildContractEmail = (request, contractUrl) => {
  const contract = buildContractData(request);
  const safeContractUrl = escapeHtml(contractUrl);
  const text = [
    `Hola ${request.name},`,
    "",
    `Ya hemos preparado el contrato de adhesion comercial de ${contract.commercialName}.`,
    "Revisalo y aceptalo desde el enlace seguro para continuar con la activacion del backoffice.",
    "",
    `Abrir contrato: ${contractUrl}`,
    "",
    "Cuando lo aceptes, generaremos tus credenciales iniciales y las enviaremos por email.",
    "",
    "Gracias,",
    "Equipo Volta Pizza",
  ].join("\n");

  const html = buildEmailShell({
    title: "Contrato listo para firma",
    preheader: "Revisa y acepta el contrato para activar tu backoffice Volta.",
    bodyHtml: `
      <p style="margin:0 0 14px">Estimado/a <strong>${escapeHtml(request.name)}</strong>:</p>
      <p style="margin:0 0 14px">Ya hemos preparado el contrato de adhesion comercial de <strong>${escapeHtml(contract.commercialName)}</strong>.</p>
      <div style="background:#ffb61c;border-radius:14px;padding:18px;margin:20px 0 22px">
        <div style="color:#3b008b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Siguiente paso</div>
        <div style="margin-top:6px;color:#000000;font-size:22px;line-height:1.25;font-weight:900">Revision y firma del contrato</div>
        <div style="margin-top:8px;color:#2a173f;font-size:14px;line-height:1.5">Cuando lo aceptes, generaremos tus credenciales iniciales para entrar en el backoffice.</div>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;background:#f8f5ff;border:1px solid #decfff;border-radius:12px">
        <tr>
          <td style="padding:14px">
            <div style="color:#3b008b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em">Datos principales</div>
            <div style="margin-top:8px;color:#000000;font-size:14px;line-height:1.6">
              Titular: <strong>${escapeHtml(contract.legalName)}</strong><br>
              CIF/NIF/NIE: <strong>${escapeHtml(contract.taxId)}</strong><br>
              Responsable: <strong>${escapeHtml(contract.legalRepresentative)}</strong><br>
              Email contractual: <strong>${escapeHtml(contract.businessEmail)}</strong>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 22px;text-align:center">
        <a href="${safeContractUrl}" style="display:inline-block;background:#3b008b;color:#ffffff;padding:15px 26px;border-radius:999px;font-weight:900;text-decoration:none;box-shadow:0 8px 18px rgba(59,0,139,.24)">Abrir contrato y firmar</a>
      </p>
      <div style="background:#fff8e7;border-left:5px solid #ffb61c;padding:12px 14px;margin:0 0 20px;color:#3b2c4a;font-size:13px">
        Si el boton no funciona, copia este enlace:<br><a href="${safeContractUrl}" style="color:#6a3df0;word-break:break-all;font-weight:700">${safeContractUrl}</a>
      </div>
      ${buildVoltaSignature()}
    `,
  });

  return { text, html };
};

const CONTRACT_DOCUMENT_VERSION = "volta-adhesion-comercial-v1";

const normalizeIp = (value) =>
  String(value || "")
    .split(",")[0]
    .trim()
    .slice(0, 128);

const buildSignedContractSnapshot = (request, signature, activation = null) => {
  const contract = buildContractData(request);
  const signedAt = signature?.acceptedAt || new Date().toISOString();
  const lines = [
    "CONTRATO DE ADHESION COMERCIAL",
    "",
    `Version documental: ${CONTRACT_DOCUMENT_VERSION}`,
    `Fecha de firma electronica: ${signedAt}`,
    `Firmante: ${contract.legalRepresentative}`,
    `Cargo: ${contract.representativeRole}`,
    `Correo de firma: ${contract.businessEmail}`,
    signature?.ipAddress ? `IP registrada: ${signature.ipAddress}` : null,
    signature?.userAgent ? `Agente tecnico: ${signature.userAgent}` : null,
    "",
    `En fecha ${contract.contractDate}, por medio de aceptacion y firma electronica, Volta Pizza y el Comerciante identificado en este documento formalizan el presente contrato de adhesion comercial, que se regira por las siguientes manifestaciones y clausulas.`,
    "",
    "REUNIDOS",
    "",
    'De una parte, VOLTA PIZZA, S.L.U., con NIF B88818414 y domicilio social en CALLE IRMANS VILLAR, NUM 1, PLANTA 1, PUERTA B, 32005 OURENSE (OURENSE), Espana, representada en este acto por Luigi Vincenzo Roppo Gonzalez, con NIE Z0329461Z, titular o gestora de la plataforma comercial, tecnologica y operativa destinada a la promocion, recepcion, gestion y seguimiento de pedidos de restauracion, en adelante, "Volta".',
    "",
    `De otra parte, ${contract.legalName}, ${contract.partnerType}, con CIF/NIF/NIE ${contract.taxId}, domicilio o local operativo en ${contract.address}, telefono ${contract.businessPhone} y correo electronico ${contract.businessEmail}, representada por ${contract.legalRepresentative}, en calidad de ${contract.representativeRole}, en adelante, el "Comerciante".`,
    "",
    "Las partes se reconocen capacidad suficiente para contratar y obligarse. El Comerciante declara que los datos anteriores son exactos, completos y han sido facilitados por el mismo durante el proceso de alta.",
    "",
    "EXPONEN",
    "",
    "I. Que Volta dispone de una plataforma y de servicios asociados para incorporar negocios de restauracion, organizar su presencia comercial, recibir pedidos y facilitar su gestion.",
    `II. Que el Comerciante desarrolla una actividad de restauracion bajo el nombre comercial ${contract.commercialName} y desea adherirse a las condiciones comerciales de Volta.`,
    "III. Que el presente documento contiene condiciones generales predispuestas por Volta para una pluralidad de relaciones comerciales de la misma naturaleza, sin perjuicio de los datos particulares del Comerciante y de los anexos economicos u operativos que se acepten.",
    "",
    "CLAUSULAS",
    "",
    "1. Naturaleza del contrato",
    "Este contrato es un contrato de adhesion comercial. Su aceptacion por el Comerciante se produce mediante firma electronica o por cualquier otro mecanismo de aceptacion electronica habilitado por Volta que deje constancia de la identidad del firmante, fecha, documento aceptado y trazabilidad de la operacion.",
    "",
    "2. Definiciones",
    '"Plataforma": el sitio web, aplicaciones, paneles, herramientas y canales operados por Volta para la gestion comercial y operativa.',
    '"Comerciante": la persona fisica o juridica que se adhiere a este contrato y ofrece productos de restauracion a traves de Volta.',
    '"Cliente": el usuario final que realiza pedidos o interactua con la oferta comercial del Comerciante.',
    '"Pedido": solicitud de productos realizada por un Cliente y recibida por el Comerciante a traves de la Plataforma.',
    '"Comision": importe, porcentaje, tarifa fija, coste tecnico, coste de pasarela o cargo pactado a favor de Volta por el uso de la Plataforma o servicios asociados.',
    '"Liquidacion": calculo periodico de importes a favor del Comerciante, una vez descontadas comisiones, ajustes, devoluciones, incidencias, impuestos o costes aplicables.',
    "",
    "3. Objeto",
    "El objeto del contrato es regular la adhesion del Comerciante a Volta para la publicacion, promocion, recepcion y gestion de pedidos de su negocio, asi como el uso de las herramientas y procesos que Volta habilite para dicha relacion comercial.",
    "",
    "4. Alta, datos y documentacion",
    "El Comerciante se obliga a facilitar datos reales, completos y actualizados. Volta podra solicitar documentacion de identidad, titularidad, representacion, actividad, cuenta bancaria o cualquier otra razonablemente necesaria para validar el alta, prevenir fraude, cumplir obligaciones legales o proteger la Plataforma.",
    "",
    "5. Modelo operativo",
    "El modelo operativo de Volta consiste en poner a disposicion del Comerciante una plataforma de ventas, gestion comercial, comunicacion con clientes, creacion de ofertas, segmentacion de clientes, gestion de precios, seguimiento de pedidos, acciones promocionales y herramientas de administracion asociadas a su actividad de restauracion.",
    "El Comerciante conserva la direccion de su negocio, la definicion final de su oferta, la preparacion de los productos, la atencion de incidencias propias de su actividad y el cumplimiento de las obligaciones legales, fiscales, sanitarias y laborales que le correspondan.",
    "",
    "6. Comisiones y liquidaciones",
    "Salvo pacto escrito distinto, el importe neto de ventas computable para liquidacion se distribuira de la siguiente manera: noventa por ciento (90%) para el Comerciante, nueve por ciento (9%) para Volta y uno por ciento (1%) para el embajador asociado a la pizzeria, cuando exista.",
    "Esta distribucion no incluye otros cargos, consumos, descuentos, costes o servicios adicionales que puedan generarse por el uso de herramientas o prestaciones complementarias, incluyendo, a titulo enunciativo, hardware o dispositivos utilizados, paquetes de mensajes, acciones Boost, promociones, servicios adicionales, ajustes, devoluciones, incidencias, costes de pasarela o cualquier otro concepto aceptado o generado dentro de la operativa de la Plataforma.",
    `La cuenta declarada para liquidaciones es titularidad de ${contract.accountHolder}, IBAN ${contract.iban}. El Comerciante responde de la exactitud de estos datos y debera comunicar cualquier modificacion antes de que produzca efectos.`,
    "",
    "7. Obligaciones del Comerciante",
    "El Comerciante debera preparar los pedidos aceptados, mantener actualizada su oferta, precios, horarios, disponibilidad, informacion alimentaria y alergenos, atender incidencias, cumplir la normativa sanitaria, fiscal, laboral, de consumo y proteccion de datos que le resulte aplicable, y no utilizar la Plataforma para fines distintos de los autorizados.",
    "",
    "8. Obligaciones de Volta",
    "Volta pondra a disposicion del Comerciante los medios tecnicos y comerciales razonables para la gestion de su presencia en la Plataforma, sin garantizar volumen minimo de pedidos, facturacion, posicionamiento, continuidad absoluta del servicio ni resultados economicos.",
    "",
    "9. Suspension y resolucion",
    "Volta podra suspender el alta, la publicacion, la recepcion de pedidos o las liquidaciones cuando existan datos incompletos, documentacion no validada, riesgo de fraude, incumplimiento legal, incidencias graves, impagos, reclamaciones relevantes o riesgo para clientes, repartidores, terceros o para la Plataforma. Cualquiera de las partes podra resolver el contrato mediante comunicacion escrita con treinta dias naturales de preaviso, sin perjuicio de las cantidades devengadas y obligaciones pendientes.",
    "",
    "10. Comunicaciones",
    `Las comunicaciones contractuales y operativas se remitiran preferentemente por medios electronicos. A efectos de notificaciones al Comerciante se designan el correo ${contract.businessEmail} y el telefono ${contract.businessPhone} como elementos de contacto. El Comerciante se compromete a mantenerlos activos, operativos y actualizados.`,
    "",
    "11. Duracion",
    "El contrato entrara en vigor desde su aceptacion electronica y tendra duracion indefinida, salvo resolucion conforme a la clausula anterior o sustitucion por una nueva version aceptada por el Comerciante.",
    "",
    "12. Ley aplicable y fuero",
    "El contrato se regira por la legislacion espanola. Las partes se someten a los juzgados y tribunales de Madrid, salvo que una norma imperativa establezca otro fuero.",
    "",
    "13. Firma electronica",
    "La firma electronica, aceptacion por codigo, trazabilidad de envio, registro de IP, sello temporal o cualquier mecanismo equivalente habilitado por Volta servira para acreditar la aceptacion del documento por el Comerciante. Cada ejemplar electronico aceptado o firmado tendra valor de original entre las partes.",
    "",
    "FIRMAS",
    "VOLTA: Volta Pizza - Luigi Vincenzo Roppo Gonzalez - firma incorporada en el documento enviado al Comerciante.",
    `COMERCIANTE: ${contract.legalName} - ${contract.legalRepresentative} - ${contract.representativeRole} - ${contract.businessEmail}.`,
    activation ? `BACKOFFICE ACTIVADO: ${activation.partnerName} - usuario ${activation.username}.` : null,
  ].filter(Boolean);

  return {
    title: "Contrato de adhesion comercial",
    version: CONTRACT_DOCUMENT_VERSION,
    status: "SIGNED",
    signedAt,
    signedBy: contract.legalRepresentative,
    signerRole: contract.representativeRole,
    signerEmail: contract.businessEmail,
    commercialName: contract.commercialName,
    legalName: contract.legalName,
    taxId: contract.taxId,
    contentText: lines.join("\n"),
  };
};

const buildCredentialsEmail = (request, activation) => {
  const backofficeUrl = `${publicFrontendUrl()}/backoffice`;
  const posUrl = `${publicFrontendUrl()}/pos`;
  const storefrontUrl = `${publicFrontendUrl()}/${activation.partnerSlug}`;
  const posCredentials = Array.isArray(activation.posCredentials) && activation.posCredentials.length
    ? activation.posCredentials
    : [
        {
          storeName: activation.storeName,
          username: activation.posUsername || activation.partnerName,
          pin: activation.posPin || activation.password,
        },
      ];
  const posTextLines = posCredentials.flatMap((credential) => [
    `Tienda ${credential.storeName}:`,
    `Usuario POS: ${credential.username}`,
    `PIN POS: ${credential.pin}`,
  ]);
  const posHtmlRows = posCredentials
    .map(
      (credential) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #c8f1e4">
            <strong>${escapeHtml(credential.storeName)}</strong><br>
            Usuario: <strong>${escapeHtml(credential.username)}</strong><br>
            PIN: <strong>${escapeHtml(credential.pin)}</strong>
          </td>
        </tr>
      `
    )
    .join("");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    storefrontUrl
  )}`;
  const text = [
    `Hola ${request.name},`,
    "",
    `Bienvenido/a a Volta Pizza. El contrato de ${activation.partnerName} ya esta aceptado y tu acceso inicial esta disponible.`,
    "",
    `Tienda online: ${storefrontUrl}`,
    `QR de tu tienda: ${qrUrl}`,
    "",
    `Backoffice: ${backofficeUrl}`,
    `Usuario: ${activation.username}`,
    `Contrasena: ${activation.password}`,
    "",
    `POS: ${posUrl}`,
    ...posTextLines,
    "",
    "Estas credenciales iniciales son provisionales. Guardalas y contactanos si necesitas cambiarlas. Antes de activar la tienda, revisa que direccion, coordenadas, carta y horarios esten configurados.",
    "",
    "Gracias,",
    "Equipo Volta Pizza",
  ].join("\n");

  const html = buildEmailShell({
    title: "Bienvenido/a a Volta Pizza",
    preheader: "Tu tienda online, QR, backoffice y POS ya estan preparados.",
    bodyHtml: `
      <p style="margin:0 0 14px">Estimado/a <strong>${escapeHtml(request.name)}</strong>:</p>
      <p style="margin:0 0 14px">Contrato aceptado. Bienvenido/a a Volta Pizza: ya tienes preparada la tienda online de <strong>${escapeHtml(activation.partnerName)}</strong>, el acceso al backoffice y el acceso al POS.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0;background:#fff8e7;border:1px solid #ffd789;border-radius:14px">
        <tr>
          <td style="padding:18px;vertical-align:top">
            <div style="color:#a15c00;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Tu tienda online</div>
            <div style="margin-top:10px;color:#000000;font-size:15px;line-height:1.7">
              <a href="${escapeHtml(storefrontUrl)}" style="color:#d97706;font-weight:900;text-decoration:none">${escapeHtml(storefrontUrl)}</a>
            </div>
            <p style="margin:10px 0 0;color:#4b3a1f;font-size:13px;line-height:1.5">Comparte este enlace con tus clientes cuando la tienda este configurada y activa.</p>
          </td>
          <td style="padding:18px;text-align:center;vertical-align:top;width:150px">
            <img src="${escapeHtml(qrUrl)}" width="128" height="128" alt="QR de la tienda online" style="display:block;border:0;margin:0 auto 8px;background:#ffffff;padding:8px;border-radius:10px">
            <div style="color:#4b3a1f;font-size:12px;font-weight:800">QR de tu tienda</div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 16px;background:#f8f5ff;border:1px solid #decfff;border-radius:14px">
        <tr>
          <td style="padding:18px">
            <div style="color:#3b008b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">Backoffice</div>
            <div style="margin-top:10px;color:#000000;font-size:15px;line-height:1.7">
              URL: <a href="${escapeHtml(backofficeUrl)}" style="color:#6a3df0;font-weight:900;text-decoration:none">${escapeHtml(backofficeUrl)}</a><br>
              Usuario: <strong>${escapeHtml(activation.username)}</strong><br>
              Contrasena: <strong>${escapeHtml(activation.password)}</strong>
            </div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;background:#eefaf6;border:1px solid #a7ead7;border-radius:14px">
        <tr>
          <td style="padding:18px">
            <div style="color:#047857;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em">POS para atender pedidos</div>
            <div style="margin-top:10px;color:#000000;font-size:15px;line-height:1.7">
              URL: <a href="${escapeHtml(posUrl)}" style="color:#059669;font-weight:900;text-decoration:none">${escapeHtml(posUrl)}</a><br>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:8px">
                ${posHtmlRows}
              </table>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 22px;text-align:center">
        <a href="${escapeHtml(backofficeUrl)}" style="display:inline-block;background:#3b008b;color:#ffffff;padding:15px 26px;border-radius:999px;font-weight:900;text-decoration:none;box-shadow:0 8px 18px rgba(59,0,139,.24)">Entrar al backoffice</a>
      </p>
      <div style="background:#fff8e7;border-left:5px solid #ffb61c;padding:12px 14px;margin:0 0 20px;color:#3b2c4a;font-size:13px">
        Estas credenciales iniciales son provisionales. Guardalas y contactanos si necesitas cambiarlas. Antes de activar la tienda, revisa que direccion, coordenadas, carta y horarios esten configurados.
      </div>
      ${buildVoltaSignature()}
    `,
  });

  return { text, html };
};

const slugify = (value, fallback = "partner") => {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || fallback;
};

const resolveUniquePartnerSlug = async (tx, baseValue) => {
  const baseSlug = slugify(baseValue, "partner");
  let slug = baseSlug;
  let suffix = 2;

  while (await tx.partner.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

const resolveUniqueStoreSlug = async (tx, partnerId, baseValue) => {
  const baseSlug = slugify(baseValue, "central");
  let slug = baseSlug;
  let suffix = 2;

  while (
    await tx.store.findUnique({
      where: { partnerId_slug: { partnerId, slug } },
      select: { id: true },
    })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

const buildActivationPayload = ({ partner, store, username, password, posPin }) => ({
  partnerId: partner.id,
  storeId: store.id,
  partnerName: partner.name,
  partnerSlug: partner.slug,
  storeName: store.storeName,
  storeSlug: store.slug,
  storeLatitude: store.latitude ?? null,
  storeLongitude: store.longitude ?? null,
  username,
  password,
  posUsername: partner.name,
  posPin,
  posCredentials: [
    {
      storeId: store.id,
      storeName: store.storeName,
      username: partner.name,
      pin: posPin,
    },
  ],
  backofficeUrl: `${publicFrontendUrl()}/backoffice`,
  activatedAt: new Date().toISOString(),
});

const createPartnerActivation = async (tx, request, storeCoordinates = null) => {
  const formalData = request.formalData || {};
  const existingActivation = formalData.activation || null;

  if (existingActivation?.partnerId) {
    const partner = await tx.partner.findUnique({
      where: { id: Number(existingActivation.partnerId) },
      include: { stores: true },
    });

    if (partner) {
      return {
        ...existingActivation,
        partnerName: partner.name,
        partnerSlug: partner.slug,
        storeId: existingActivation.storeId || partner.stores?.[0]?.id || null,
        username: existingActivation.username || partner.slug,
        password: existingActivation.password || partner.slug,
      };
    }
  }

  const partnerName = cleanText(formalData.commercialName || request.businessName, 191);
  const partnerSlug = await resolveUniquePartnerSlug(tx, partnerName);
  const country = cleanText(formalData.country, 80) || "Espana";
  const currency = country.toLowerCase().includes("esp") ? "EUR" : "EUR";

  const partner = await tx.partner.create({
    data: {
      name: partnerName,
      slug: partnerSlug,
      country,
      currency,
      active: true,
      storefrontMode: "commercial-light",
      trackingNotificationSettings: {},
      storefrontButtonConfig: {},
    },
  });

  const storeSlug = await resolveUniqueStoreSlug(tx, partner.id, partnerName);
  const posPin = generateSixDigitPin();
  const storeAddress = cleanText(formalData.businessAddress || formalData.fiscalAddress, 255) || "-";
  const store = await tx.store.create({
    data: {
      partnerId: partner.id,
      slug: storeSlug,
      storeName: partnerName,
      address: storeAddress,
      latitude: storeCoordinates?.latitude ?? null,
      longitude: storeCoordinates?.longitude ?? null,
      city: cleanText(formalData.city, 120) || null,
      zipCode: cleanText(formalData.postalCode, 32) || null,
      email: cleanText(formalData.businessEmail || request.email, 191) || null,
      tlf: cleanText(formalData.businessPhone || request.phone, 64) || null,
      active: false,
      acceptingOrders: false,
      ...buildPosPinData(posPin),
    },
  });

  return buildActivationPayload({
    partner,
    store,
    username: partner.slug,
    password: partner.slug,
    posPin,
  });
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
  if (!representativeRole) missing.push("representativeRole");
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

  router.post("/requests/:id/contract/send", async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_onboarding_request_id" });
      }

      const request = await prisma.onboardingRequest.findUnique({ where: { id } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      if (!request.formalData) {
        return res.status(409).json({ ok: false, error: "formal_data_required" });
      }

      if (["REJECTED", "ACTIVATED"].includes(request.status)) {
        return res.status(409).json({ ok: false, error: "onboarding_request_closed" });
      }

      const contractUrl = buildContractUrl(request.token);
      const contractEmailBody = buildContractEmail(request, contractUrl);
      const contractEmailResult = await sendSmtpEmail({
        to: request.email,
        subject: "Contrato listo para firma - Volta Pizza",
        text: contractEmailBody.text,
        html: contractEmailBody.html,
        replyTo: process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com",
      });

      const now = new Date();
      const updated = await prisma.onboardingRequest.update({
        where: { id },
        data: {
          status: "CONTRACT_SENT",
          reviewedAt: request.reviewedAt || now,
          formalData: {
            ...(request.formalData || {}),
            contractNotification: {
              emailStatus: contractEmailResult.ok
                ? "SENT"
                : contractEmailResult.skipped
                  ? "NOT_CONFIGURED"
                  : "FAILED",
              emailSentAt: contractEmailResult.ok ? now.toISOString() : null,
              emailError: contractEmailResult.ok
                ? null
                : contractEmailResult.reason || "email_send_failed",
              contractUrl,
            },
          },
        },
      });

      return res.json({ ok: true, request: mapRequest(updated) });
    } catch (error) {
      console.error("[onboarding.contract.send] error:", error);
      return res.status(500).json({ ok: false, error: "contract_send_failed" });
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

      if (["CONTRACT_SENT", "ACTIVATED", "APPROVED", "REJECTED"].includes(request.status)) {
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

  router.post("/form/:token/sign-contract", async (req, res) => {
    try {
      const token = cleanText(req.params.token, 191);
      const accepted = parseBoolean(req.body?.acceptedContract);

      if (!accepted) {
        return res.status(400).json({ ok: false, error: "contract_acceptance_required" });
      }

      const request = await prisma.onboardingRequest.findUnique({ where: { token } });

      if (!request) {
        return res.status(404).json({ ok: false, error: "onboarding_request_not_found" });
      }

      if (!request.formalData) {
        return res.status(409).json({ ok: false, error: "formal_data_required" });
      }

      if (request.status !== "CONTRACT_SENT") {
        return res.status(409).json({ ok: false, error: "onboarding_request_not_signable" });
      }

      const contract = buildContractData(request);
      const signedMeta = {
        acceptedAt: new Date().toISOString(),
        acceptedFrom: "public_contract_page",
        documentTitle: "Contrato de adhesion comercial",
        documentVersion: CONTRACT_DOCUMENT_VERSION,
        signerName: contract.legalRepresentative,
        signerRole: contract.representativeRole,
        signerEmail: contract.businessEmail,
        ipAddress: normalizeIp(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress),
        userAgent: cleanText(req.headers["user-agent"], 500),
        contractUrl: buildContractUrl(token),
      };
      const storeCoordinates = await resolveOnboardingStoreCoordinates(request.formalData);

      const activation = await prisma.$transaction(async (tx) => {
        const lockedRequest = await tx.onboardingRequest.findUnique({ where: { token } });

        if (!lockedRequest) {
          const error = new Error("onboarding_request_not_found");
          error.status = 404;
          throw error;
        }

        if (lockedRequest.status !== "CONTRACT_SENT") {
          const error = new Error("onboarding_request_not_signable");
          error.status = 409;
          throw error;
        }

        const nextActivation = await createPartnerActivation(tx, lockedRequest, storeCoordinates);
        const signedContract = buildSignedContractSnapshot(lockedRequest, signedMeta, nextActivation);
        await tx.onboardingRequest.update({
          where: { token },
          data: {
            status: "ACTIVATED",
            reviewedAt: lockedRequest.reviewedAt || new Date(),
            formalData: {
              ...(lockedRequest.formalData || {}),
              contractSignature: {
                ...((lockedRequest.formalData || {}).contractSignature || {}),
                ...signedMeta,
              },
              signedContract,
              activation: nextActivation,
            },
          },
        });

        return nextActivation;
      });

      const signedContract = buildSignedContractSnapshot(request, signedMeta, activation);

      const credentialsEmailBody = buildCredentialsEmail(request, activation);
      const credentialsEmailResult = await sendSmtpEmail({
        to: request.email,
        subject: "Tus accesos Volta: backoffice, tienda y POS",
        text: credentialsEmailBody.text,
        html: credentialsEmailBody.html,
        replyTo: process.env.ONBOARDING_REPLY_TO || "voltapizza@gmail.com",
      });

      const finalRequest = await prisma.onboardingRequest.update({
        where: { token },
        data: {
          formalData: {
            ...(request.formalData || {}),
            contractNotification: (request.formalData || {}).contractNotification || null,
            contractSignature: {
              ...((request.formalData || {}).contractSignature || {}),
              ...signedMeta,
            },
            signedContract,
            activation,
            credentialsNotification: {
              emailStatus: credentialsEmailResult.ok
                ? "SENT"
                : credentialsEmailResult.skipped
                  ? "NOT_CONFIGURED"
                  : "FAILED",
              emailSentAt: credentialsEmailResult.ok ? new Date().toISOString() : null,
              emailError: credentialsEmailResult.ok
                ? null
                : credentialsEmailResult.reason || "email_send_failed",
            },
          },
        },
      });

      return res.json({ ok: true, request: mapRequest(finalRequest), activation, signedContract });
    } catch (error) {
      console.error("[onboarding.contract.sign] error:", error);
      if (error?.status) {
        return res.status(error.status).json({ ok: false, error: error.message });
      }
      return res.status(500).json({ ok: false, error: "contract_sign_failed" });
    }
  });

  return router;
}
