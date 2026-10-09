import crypto from 'node:crypto';
import express from 'express';
import { lockedClosure } from '../services/onboardingClosure.js';
import { newOnboardingCatalog } from '../services/onboardingPricing.js';

export const isDemoRequest = row => row?.formalData?.requestKind === 'DEMO';
const clean = (value, max) => String(value || '').trim().slice(0, max);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const failure = (message, status = 409) => Object.assign(new Error(message), { status });

export function buildDemoEmail(row) {
  const message = `Hola ${row.name},\n\nHemos recibido la solicitud de demostración de ${row.businessName}. Te contactaremos para conocer tu pizzería y mostrarte el motor de venta online y sus herramientas comerciales.\n\nEsta solicitud no inicia el alta, no requiere documentos y no genera ningún pago.\n\nEquipo Volta Pizza\nEl motor para vender pizzas por Internet`;
  return { text: message, html: `<div style="font-family:Arial,sans-serif;color:#291048;max-width:600px"><h1 style="color:#3b008b">Solicitud de demostración recibida</h1>${message.split('\n\n').map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>` };
}

export default function demoRequestsRoutes(prisma, { mail, mapRequest, buildOnboardingEmail, buildFormalUrl }) {
  const router = express.Router();
  router.post('/demo-requests', async (req, res) => {
    try {
      const name = clean(req.body?.name, 191);
      const businessName = clean(req.body?.business, 191);
      const email = clean(req.body?.email, 191).toLowerCase();
      if (!name || !businessName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_demo_request' });
      const row = await prisma.onboardingRequest.create({ data: {
        token: crypto.randomBytes(24).toString('hex'), name, businessName, email,
        phone: clean(req.body?.phone, 64) || null, message: clean(req.body?.message, 4000) || null,
        status: 'RECEIVED', formalData: { requestKind: 'DEMO', source: 'landing', requestedAt: new Date().toISOString() },
      } });
      const result = await mail({ to: email, subject: 'Tu demostración de Volta Pizza', ...buildDemoEmail(row), replyTo: 'contacto@voltapizza.com' });
      // Keep the inquiry even if confirmation delivery fails. It remains in Global Manager.
      await prisma.onboardingRequest.update({ where: { id: row.id }, data: {
        emailStatus: result.ok ? 'SENT' : result.skipped ? 'NOT_CONFIGURED' : 'FAILED',
        emailSentAt: result.ok ? new Date() : null, emailError: result.ok ? null : result.reason || 'email_send_failed',
      } });
      return res.status(201).json({ ok: true }); // No onboarding token, prices or form URL in a demo response.
    } catch (error) {
      console.error('[demo-requests.create]', error?.message);
      return res.status(500).json({ error: 'demo_request_failed' });
    }
  });

  router.post('/requests/:id/invite-onboarding', async (req, res) => {
    try {
      if (req.webSession?.role !== 'global_admin') return res.status(403).json({ error: 'admin_required' });
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1 || req.body?.requestedByBusiness !== true) return res.status(400).json({ error: 'onboarding_invitation_confirmation_required' });
      const attempt = crypto.randomUUID();
      const row = await lockedClosure(prisma, id, async (tx, current) => {
        if (!isDemoRequest(current)) {
          if (current.formalData?.demoInvitation?.emailStatus === 'SENT') return null;
          throw failure('not_a_demo_request');
        }
        const previous = current.formalData.demoInvitation;
        if (previous?.emailStatus === 'SENDING' && Date.now() - new Date(previous.startedAt).getTime() < 120000) throw failure('invitation_in_progress');
        if (current.status === 'REJECTED') throw failure('demo_request_closed');
        const commercialCatalog = current.formalData.commercialCatalog || await newOnboardingCatalog(tx);
        return tx.onboardingRequest.update({ where: { id }, data: { formalData: { ...current.formalData, commercialCatalog,
          demoInvitation: { attempt, emailStatus: 'SENDING', startedAt: new Date().toISOString(), requestedByBusiness: true },
        } } });
      });
      if (!row) return res.json({ ok: true, request: await mapRequest(await prisma.onboardingRequest.findUnique({ where: { id } })) });
      const result = await mail({ to: row.email, subject: 'Tu invitación para iniciar el alta en Volta Pizza',
        ...buildOnboardingEmail(row, buildFormalUrl(row.token)), replyTo: process.env.ONBOARDING_REPLY_TO || 'contacto@voltapizza.com' });
      const updated = await lockedClosure(prisma, id, async (tx, current) => {
        if (current.formalData?.demoInvitation?.attempt !== attempt) return current;
        return tx.onboardingRequest.update({ where: { id }, data: {
          ...(result.ok ? { status: 'EMAIL_SENT', emailStatus: 'SENT', emailSentAt: new Date(), emailError: null } : {}),
          formalData: { ...current.formalData, requestKind: result.ok ? 'ONBOARDING' : 'DEMO',
            demoInvitation: { ...current.formalData.demoInvitation, emailStatus: result.ok ? 'SENT' : 'FAILED', error: result.ok ? null : result.reason || 'email_send_failed' } },
        } });
      });
      return res.status(result.ok ? 200 : 503).json({ ok: Boolean(result.ok), request: await mapRequest(updated), ...(result.ok ? {} : { error: 'invitation_email_failed' }) });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'invitation_failed' });
    }
  });

  // A demo record must not enter document, contract, checkout or activation endpoints.
  router.use(async (req, res, next) => {
    const form = /^\/form\/([^/]+)(?:\/|$)/.exec(req.path);
    const request = /^\/requests\/([^/]+)(?:\/|$)/.exec(req.path);
    if (!form && !request) return next();
    try {
      const requestId = request ? Number(decodeURIComponent(request[1])) : null;
      if (request && (!Number.isSafeInteger(requestId) || requestId < 1)) return res.status(400).json({ error: 'invalid_request_id' });
      const row = await prisma.onboardingRequest.findUnique({ where: form ? { token: decodeURIComponent(form[1]) } : { id: requestId } });
      if (!isDemoRequest(row)) return next();
      if (request && row.formalData.demoInvitation?.emailStatus === 'SENDING' &&
          Date.now() - new Date(row.formalData.demoInvitation.startedAt).getTime() < 120000) return res.status(409).json({ error: 'invitation_in_progress' });
      if (request && ((req.method === 'DELETE' && req.path === `/requests/${request[1]}`) ||
          (req.method === 'PATCH' && req.path === `/requests/${request[1]}/status` && ['RECEIVED', 'IN_REVIEW', 'REJECTED'].includes(req.body?.status)))) return next();
      return res.status(form ? 404 : 409).json({ error: 'demo_request_not_onboarding' });
    } catch { return res.status(503).json({ error: 'demo_request_unavailable' }); }
  });
  return router;
}
