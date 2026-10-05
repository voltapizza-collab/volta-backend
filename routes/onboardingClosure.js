import express from 'express';
import { SMS_SELL_PRICE_EUR } from '../services/smsCredits.js';
import { closureView, createClosureService, lockedClosure, closureError } from '../services/onboardingClosure.js';
import * as stripe from '../services/stripe.js';
import { readOnboardingPricing, updateOnboardingPricing } from '../services/onboardingPricing.js';
import { offerDefaults, onboardingSmsPackages, onboardingSmsPricing } from '../services/onboardingDefaults.js';
import { reviewContract } from '../services/onboardingReview.js';

export default function onboardingClosureRoutes(db, { mapRequest, draftContract, stripeDeps = stripe, completePaid = async row => row }) {
  const router = express.Router(), service = createClosureService(db, stripeDeps);
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (error) { console.error('[onboarding.closure]', error.message); res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : 'closure_temporarily_unavailable' }); }
  };
  const requestFor = async req => {
    const where = req.params.token ? { token: req.params.token } : { id: Number(req.params.id) };
    const row = await db.onboardingRequest.findUnique({ where });
    if (!row) throw closureError('onboarding_request_not_found', 404); return row;
  };
  const admin = req => { if (req.webSession?.role !== 'global_admin') throw closureError('admin_required', 403); };
  const actor = req => ({ role: 'global_admin', username: process.env.VOLTA_ADMIN_USERNAME || 'admin', ip: req.ip });
  router.get('/pricing', handle(async (req, res) => {
    admin(req); const pricing = await readOnboardingPricing(db), price = pricing.defaults?.smsUnitPriceEur || SMS_SELL_PRICE_EUR;
    res.json({ pricing, smsPackages: onboardingSmsPackages(price), smsPricing: onboardingSmsPricing(price) });
  }));
  router.post('/pricing', handle(async (req, res) => {
    admin(req); const pricing = await updateOnboardingPricing(db, req.body, actor(req).username); const price = pricing.defaults?.smsUnitPriceEur || SMS_SELL_PRICE_EUR;
    res.json({ pricing, smsPackages: onboardingSmsPackages(price), smsPricing: onboardingSmsPricing(price) });
  }));
  router.get('/requests/:id/offer-draft', handle(async (req, res) => {
    admin(req); const row = await requestFor(req), pricing = await readOnboardingPricing(db);
    const generalTerms = draftContract(row), price = pricing.defaults?.smsUnitPriceEur || SMS_SELL_PRICE_EUR;
    res.json({ generalTerms, defaults: offerDefaults(row, pricing, generalTerms), pricingRevision: pricing.revision, smsPackages: onboardingSmsPackages(price), smsPricing: onboardingSmsPricing(price) });
  }));
  router.get('/requests/:id/review-contract', handle(async (req, res) => {
    admin(req); const row = await requestFor(req);
    const review = reviewContract(row, await readOnboardingPricing(db), draftContract(row));
    res.json({ offer: review.offer, fingerprint: review.fingerprint });
  }));
  router.post('/requests/:id/offer', handle(async (req, res) => {
    admin(req); const row = await requestFor(req);
    const updated = await service.publish(row.id, req.body, actor(req));
    res.json({ ok: true, request: await mapRequest(updated) });
  }));
  router.post('/requests/:id/cash-payment', handle(async (req, res) => {
    admin(req); if (req.body.confirmReceived !== true) throw closureError('cash_confirmation_required');
    const row = await requestFor(req); const updated = await service.cash(row.id, req.body.offerHash, req.body.receipt, actor(req));
    res.json({ ok: true, request: await mapRequest(await completePaid(updated)) });
  }));
  router.post('/requests/:id/resolve-cancellation', handle(async (req, res) => {
    admin(req); if (req.body.confirmRefund !== true) throw closureError('refund_confirmation_required');
    const row = await requestFor(req); const updated = await service.refund(row.id, req.body.offerHash, req.body.cashReceipt, actor(req));
    res.json({ ok: true, request: await mapRequest(updated) });
  }));
  router.post('/requests/:id/reconcile-payment', handle(async (req, res) => {
    admin(req); const row = await requestFor(req);
    const updated = await service.reconcile(row.id, req.body.sessionId, req.body.refundId);
    res.json({ ok: true, request: await mapRequest(await completePaid(updated)) });
  }));
  router.post('/form/:token/closure/consent', handle(async (req, res) => {
    if (req.body.accepted !== true) throw closureError('prepayment_consent_required');
    const row = await requestFor(req);
    const updated = await service.consent(row.id, req.body.offerHash, { ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 500) });
    res.json({ ok: true, request: await mapRequest(updated) });
  }));
  router.post('/form/:token/closure/checkout', handle(async (req, res) => {
    if (!stripeDeps.isStripeCheckoutConfigured() || !process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET) throw closureError('onboarding_payments_not_configured', 503);
    const row = await requestFor(req);
    const base = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL;
    if (!base || !/^https?:\/\//.test(base)) throw closureError('frontend_url_not_configured', 503);
    const result = await service.checkout(row.id, req.body.offerHash, `${base.replace(/\/$/, '')}/onboarding/${encodeURIComponent(row.token)}?contract=1`);
    res.json({ ok: true, ...result });
  }));
  router.post('/form/:token/closure/refresh', handle(async (req, res) => {
    const row = await requestFor(req); res.json({ ok: true, request: await mapRequest(await completePaid(await service.sync(row.id))) });
  }));
  router.post('/form/:token/closure/cancel', handle(async (req, res) => {
    const row = await requestFor(req); res.json({ ok: true, request: await mapRequest(await service.cancel(row.id, req.body.offerHash)) });
  }));
  router.post('/stripe/webhook', handle(async (req, res) => {
    const signature = req.get('stripe-signature') || '';
    const timestamp = Number(signature.match(/(?:^|,)t=(\d+)/)?.[1]);
    if (!process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) throw closureError('bad_stripe_signature', 400);
    let event;
    try { event = stripeDeps.constructStripeWebhookEvent(req.rawBody, signature, process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET); }
    catch { throw closureError('bad_stripe_signature', 400); }
    const obj = event.data?.object;
    let metadata = obj?.metadata, sessionId = event.type.startsWith('checkout.session.') ? obj.id : null;
    if (/^(charge\.(refunded|dispute\.)|refund\.)/.test(event.type) && obj?.payment_intent) {
      metadata = (await stripeDeps.retrieveOnboardingIntent(obj.payment_intent)).metadata;
    }
    if (metadata?.purpose !== 'onboarding_initial') return res.json({ received: true });
    const id = Number(metadata.requestId);
    if (!Number.isSafeInteger(id) || id <= 0) throw closureError('payment_mismatch', 400);
    await lockedClosure(db, id, async (tx, row) => {
      const c = row.formalData?.closure;
      if (!c || c.offer.hash !== metadata.offerHash || c.payment?.id !== metadata.paymentId) {
        // Old expired attempts never mutate the current offer or grant any access.
        return;
      }
      if (sessionId && !c.payment.sessionId) await tx.onboardingRequest.update({ where: { id }, data: {
        formalData: { ...row.formalData, closure: { ...c, payment: { ...c.payment, sessionId } } },
      } });
    });
    await completePaid(await service.sync(id));
    res.json({ received: true });
  }));
  return router;
}
