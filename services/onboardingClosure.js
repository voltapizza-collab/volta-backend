import crypto from 'node:crypto';
import { installmentAmounts, validPosPrice } from './onboardingCommercial.js';
import * as stripe from './stripe.js';
import { SMS_SELL_PRICE_EUR } from './smsCredits.js';

export const closureError = (message, status = 409) => Object.assign(new Error(message), { status });
const requireValue = (condition, message) => { if (!condition) throw closureError(message); };
const text = (value, min = 1, max = 30000) => {
  requireValue(typeof value === 'string' && value.trim().length >= min && value.length <= max, 'offer_text_required');
  return value.trim();
};
const cents = value => { requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 1000000, 'invalid_offer_amount'); return value; };
const money = value => `${(value / 100).toFixed(2)} EUR`;
const iso = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
const date = value => {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'delivery_date_required');
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value, 'delivery_date_required');
  return value;
};
const available = offer => requireValue(!offer.pos.delivery || offer.pos.delivery.latest >= today(), 'delivery_offer_expired');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// MySQL JSON changes object-key order. Arrays retain their contractual sequence.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hasClosure = request => Boolean(request?.formalData?.closure);
export const signsBeforePayment = offer => offer?.workflow === 'SIGN_PAY_ACTIVATE';
export const commercialRequest = request => Boolean(request?.formalData?.commercialCatalog || request?.formalData?.commercialSelection || request?.formalData?.onboardingDraft);
const getClosure = request => request.formalData?.closure;
const editable = request => requireValue(!['ACTIVATED', 'APPROVED', 'REJECTED'].includes(request.status), 'onboarding_request_closed');
const documentKeys = ['id','revision','currency','vatIncluded','pos','sms','lines','totalCents','signatureDays','refundDays','documentText','publishedAt'];
const offerHash = offer => {
  const data = Object.fromEntries(documentKeys.map(key => [key, offer[key]]));
  if (offer.workflow) data.workflow = offer.workflow;
  if (offer.hashAlgorithm === 'sha256-canonical-json-v1') return digest(canonical({ ...data, hashAlgorithm: offer.hashAlgorithm }));
  requireValue(!offer.hashAlgorithm, 'offer_integrity_failed');
  return digest(data); // Preserve legacy versions without rewriting accepted documents.
};
export const verifyOffer = offer => requireValue(offer && offerHash(offer) === offer.hash, 'offer_integrity_failed');

export function buildClosureOffer(request, input, revision = 1) {
  const signatureFirst = input.workflow === 'SIGN_PAY_ACTIVATE';
  requireValue(input.approved === true, 'offer_approval_required');
  const selection = request.formalData?.commercialSelection;
  requireValue(selection && selection.status !== 'DRAFT' && request.submittedAt, 'submitted_selection_required');
  const mode = selection.pos.mode;
  requireValue(['PURCHASE','INSTALLMENTS','RENT_QUOTE'].includes(mode), 'invalid_pos_choice');
  const rental = mode === 'RENT_QUOTE';
  if (!rental) requireValue(validPosPrice(input.posTotalCents), 'invalid_pos_price');
  requireValue(['IN_STOCK', 'REPLENISHMENT'].includes(input.stockStatus), 'stock_confirmation_required');
  const delivery = signatureFirst ? null : { status: input.stockStatus, expected: date(input.deliveryExpected), latest: date(input.deliveryLatest),
    reference: text(input.supplyReference, 3, 200), terms: text(input.supplyTerms, 30, 4000) };
  if (delivery) requireValue(delivery.expected >= today() && delivery.latest >= delivery.expected, 'delivery_date_required');
  const payments = mode === 'INSTALLMENTS' ? installmentAmounts(selection.pos.installmentCount, input.posTotalCents)
    : mode === 'PURCHASE' ? [input.posTotalCents] : Array(36).fill(cents(input.rentCents));
  const pos = { mode, payments, firstCents: rental ? cents(input.rentCents) : payments[0], depositCents: rental ? cents(input.depositCents) : 0,
    totalCents: payments.reduce((a, b) => a + b, 0), durationMonths: rental ? 36 : null,
    ownershipTransfer: rental ? 'AFTER_TERM_AND_FULL_PAYMENT' : null, delivery,
    previousPriceCents: selection.pos.totalCents ?? null,
    priceChanged: !rental && selection.pos.totalCents !== input.posTotalCents,
    cancellationTerms: rental ? (signatureFirst ? input.cancellationTerms || 'Se aplica la cláusula de resolución del contrato general.' : text(input.cancellationTerms, 30, 4000)) : null,
    terms: signatureFirst ? input.equipmentTerms || '' : text(input.equipmentTerms, 30, 8000), ownership: rental ? 'VOLTA' : 'PURCHASE', interestPercent: rental ? null : 0 };
  requireValue(pos.firstCents > 0, 'rent_price_required');
  // Legacy offers retain their recharge. New onboarding selections leave recharges to the existing SMS tool.
  const smsRequested = selection.sms?.initialRecharge !== 'SEPARATE' && selection.sms?.requested !== false;
  const sms = { initialRecharge: smsRequested ? 'INCLUDED' : 'SEPARATE', amountCents: smsRequested ? cents(input.smsCents) : 0,
    credits: smsRequested ? input.smsCredits : 0, unit: 'SMS_SEGMENT', unitPriceEur: selection.sms?.unitPriceEur || SMS_SELL_PRICE_EUR };
  requireValue(!smsRequested || (sms.amountCents > 0 && Number.isSafeInteger(sms.credits) && sms.credits > 0 && sms.credits <= 100000), 'sms_package_required');
  if (!signatureFirst) {
    requireValue(Number.isInteger(input.signatureDays) && input.signatureDays >= 1 && input.signatureDays <= 60, 'signature_deadline_required');
    requireValue(Number.isInteger(input.refundDays) && input.refundDays >= 1 && input.refundDays <= 30, 'refund_deadline_required');
  }
  const lines = [{ code: 'POS', label: rental ? 'POS: primera mensualidad de renting (36 meses)' : mode === 'INSTALLMENTS' ? 'POS: primera cuota' : 'Compra del POS', amountCents: pos.firstCents },
    ...(pos.depositCents ? [{ code: 'DEPOSIT', label: 'Fianza reembolsable del POS', amountCents: pos.depositCents }] : []),
    ...(smsRequested ? [{ code: 'SMS', label: `Recarga inicial: ${sms.credits} partes de SMS`, amountCents: sms.amountCents }] : [])];
  const f = request.formalData;
  const content = [
    `CONTRATO VOLTA — VERSIÓN ${revision}`,
    `Comerciante: ${f.legalName}. NIF: ${f.taxId}. Negocio: ${f.commercialName}.`,
    `Representante: ${f.legalRepresentative}, ${f.representativeRole}. Correo: ${f.businessEmail}.`,
    `Domicilio: ${f.businessAddress}, ${f.postalCode}, ${f.city}, ${f.country}.`,
    text(input.generalTerms, 200),
    'CONDICIONES PARTICULARES. Prevalecen en materia económica sobre las condiciones generales anteriores.',
    'Ventas: 90 % del ticket para el comercio, 9 % para Volta y 1 % para el embajador. POS y SMS se pagan aparte; no se descuentan del 90 %.',
    `Liquidaciones: ${signatureFirst ? input.settlementTerms || 'Conforme a las condiciones generales del contrato' : text(input.settlementTerms, 30, 4000)}. Sobre cobros efectivos y fondos disponibles; Volta no anticipa fondos.`,
    `Cuenta declarada: ${f.accountHolder}, ${f.iban}.`,
    'EQUIPO POS',
    rental ? `Renting: 36 mensualidades de ${money(pos.firstCents)}, IVA incluido. Total: ${money(pos.totalCents)}, IVA incluido. Duración de 36 meses desde la entrega operativa; primer mes por adelantado y restantes mensualmente desde esa entrega. La espera anterior a la entrega no devenga mensualidades y desplaza el inicio, fin y vencimientos restantes. Propiedad de Volta durante el plazo; al finalizar los 36 meses y completar las 36 mensualidades se transmite automáticamente al Comerciante sin precio residual ni mensualidad 37. No hay transmisión a los 24 meses ni al alcanzar el precio de venta al contado. Fianza reembolsable: ${money(pos.depositCents)}. Cancelación anticipada: ${pos.cancellationTerms}`
      : `Compra: ${money(pos.totalCents)} IVA incluido. ${payments.length > 1 ? `Sin intereses. Cuotas: ${payments.map(money).join(', ')}. Primera cuota antes de firmar; restantes cada mes a partir del primer pago.` : 'Pago completo antes de la firma.'}`,
    ...(pos.priceChanged ? [`Precio propuesto en fase 2: ${money(pos.previousPriceCents)}. Precio de esta oferta: ${money(pos.totalCents)}. Revisa y acepta el cambio antes de pagar.`] : []),
    delivery ? `Suministro sujeto al stock de Volta en las tres modalidades. Disponibilidad confirmada: ${delivery.status === 'IN_STOCK' ? 'en stock' : 'reposición con fecha comprometida'}. Referencia: ${delivery.reference}. Entrega prevista: ${delivery.expected}. Fecha límite: ${delivery.latest}. Pagar o firmar no garantiza entrega inmediata.` : 'El suministro del POS está sujeto al stock disponible de Volta. Volta confirma el suministro durante la revisión y comunica la entrega al comercio. El pago no implica una entrega física inmediata.',
    'Las compras al contado con pago íntegro confirmado tienen prioridad entre asignaciones pendientes, respetando equipos ya asignados y fechas comprometidas. Sin stock ni fecha de reposición comprometible, el expediente espera sin exigir pago inicial.',
    delivery ? `Retraso, nueva fecha y cancelación por falta de suministro: ${delivery.terms}` : input.supplyTerms || '',
    pos.terms,
    'Las cuotas o rentas futuras se abonarán por enlaces de pago separados. Este pago inicial no autoriza cargos automáticos ni paga las cuotas futuras. La compra o transmisión del equipo no concede una licencia perpetua del servicio Volta.',
    'SISTEMA DE NOTIFICACIONES SMS. Volta dispone de una herramienta de gestión, notificación y comunicación por SMS, cuyo uso es opcional. El comercio puede utilizarla mediante recargas de saldo por paquetes. El precio por parte y los paquetes aplicables se muestran antes de cada recarga conforme a la tarifa vigente, que puede variar. Un mensaje puede consumir varias partes según su longitud y caracteres. El alta no obliga a utilizar SMS ni a recargar saldo.',
    ...(smsRequested ? [`Recarga incluida en esta oferta: ${sms.credits} partes por ${money(sms.amountCents)}, IVA incluido. Se acreditan tras pago y firma.`]
      : ['Las recargas SMS se gestionan por separado desde el backoffice y no se incluyen en este pago inicial.']),
    'PAGO PREVIO Y FINALIZACIÓN',
    `Hoy se abonan: ${lines.map(line => `${line.label}: ${money(line.amountCents)}`).join('; ')}. Total: ${money(lines.reduce((sum, line) => sum + line.amountCents, 0))}.`,
    `Al aceptar y pagar, el comercio acepta estas condiciones de pago previo y su vinculación a esta versión. Debe completar la firma en ${input.signatureDays} días desde el cobro.`,
    `Antes de la firma no se entrega el equipo ni se consumen créditos SMS. Puede solicitar cancelación desde esta página. Si no firma en plazo, el alta queda bloqueada para resolver la cancelación. Volta tramitará la devolución íntegra de lo cobrado antes del alta en un máximo de ${input.refundDays} días desde la solicitud de cancelación o el vencimiento del plazo de firma. La llegada a la cuenta dependerá de la entidad de pago.`,
    'La firma posterior confirma el contrato completo de esta versión. Los cambios requieren una nueva aceptación. El justificante de pago y el contrato permanecerán disponibles en este enlace privado.',
  ].filter(Boolean).join('\n\n');
  const documentText = signatureFirst ? content
    .replace('Primera cuota antes de firmar', 'Primera cuota después de firmar')
    .replace('Pago completo antes de la firma.', 'Pago completo después de la firma.')
    .replace(/PAGO PREVIO Y FINALIZACIÓN[\s\S]*$/, `FIRMA, PAGO Y ALTA\n\nEl comercio firma este contrato antes de abonar el pago inicial de ${money(lines.reduce((sum, line) => sum + line.amountCents, 0))}. La firma sin pago deja el expediente pendiente de pago. Una vez confirmado el cobro, Volta prepara el alta y envía automáticamente el acceso, el QR y las instrucciones de inicio y entrega. La tienda debe prepararse antes de abrir pedidos. El contrato firmado y el justificante permanecen disponibles en este enlace privado.`) : content;
  const offer = { id: crypto.randomUUID(), revision, hashAlgorithm: 'sha256-canonical-json-v1', currency: 'EUR', vatIncluded: true, pos, sms, lines,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0), signatureDays: input.signatureDays,
    refundDays: input.refundDays ?? null, documentText, publishedAt: iso(), ...(signatureFirst ? { workflow: 'SIGN_PAY_ACTIVATE', signatureDays: null } : {}) };
  return { ...offer, hash: offerHash(offer) };
}

export async function lockedClosure(db, requestId, fn) {
  return db.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM OnboardingRequest WHERE id = ? FOR UPDATE', requestId);
    const request = await tx.onboardingRequest.findUnique({ where: { id: requestId } });
    requireValue(request, 'onboarding_request_not_found');
    return fn(tx, request);
  });
}
const save = (tx, request, closure, extra = {}) => tx.onboardingRequest.update({ where: { id: request.id },
  data: { ...extra, formalData: { ...request.formalData, closure } } });

export function closureView(request) {
  const c = getClosure(request);
  if (!c) return null;
  const p = c.payment;
  const first = signsBeforePayment(c.offer);
  const signed = c.status === 'SIGNED' || (first && request.formalData?.contractSignature?.offerHash === c.offer.hash);
  const deadline = !first && p?.paidAt ? new Date(new Date(p.paidAt).getTime() + c.offer.signatureDays * 86400000).toISOString() : null;
  const overdue = c.status !== 'SIGNED' && deadline && Date.now() > new Date(deadline).getTime();
  return { offer: c.offer, consented: c.consent?.offerHash === c.offer.hash, status: c.status,
    payment: p ? { method: p.method, status: p.status, amountCents: p.amountCents, paidAt: p.paidAt,
      receipt: p.receipt || p.sessionId || null, refundStatus: p.refundStatus || null } : null,
    signatureDeadline: deadline, overdue: Boolean(overdue),
    canSign: first ? !signed && c.status === 'OFFERED' : c.status === 'PAID' && p?.status === 'PAID' && !overdue && c.consent?.offerHash === c.offer.hash,
    signed, activated: request.status === 'ACTIVATED', signedAt: c.signedAt || null,
    signerName: request.formalData?.contractSignature?.signerName || null,
    cancelRequested: Boolean(c.cancelRequestedAt),
    refundDueAt: c.offer.refundDays && (c.cancelRequestedAt || (overdue && deadline))
      ? new Date(new Date(c.cancelRequestedAt || deadline).getTime() + c.offer.refundDays * 86400000).toISOString() : null };
}

export function createClosureService(db, deps = stripe) {
  const load = async id => db.onboardingRequest.findUnique({ where: { id } });
  const assertCurrent = (request, hash) => {
    editable(request); const c = getClosure(request); verifyOffer(c?.offer);
    requireValue(hash === c.offer.hash, 'offer_changed'); return c;
  };
  async function publish(id, body, actor = null) {
    return lockedClosure(db, id, async (tx, request) => {
      editable(request);
      const old = getClosure(request);
      requireValue(!old || body.replacesOfferHash === old.offer.hash, 'offer_changed');
      requireValue(!old || !signsBeforePayment(old.offer) || request.formalData.contractSignature?.offerHash !== old.offer.hash, 'signed_contract_cannot_change');
      requireValue(!old?.payment || ['EXPIRED', 'REFUNDED'].includes(old.payment.status), 'resolve_existing_payment_first');
      const offer = buildClosureOffer(request, body, (old?.offer.revision || 0) + 1);
      const { history: oldHistory, ...previous } = old || {};
      return save(tx, request, { offer, approvedBy: actor, status: 'OFFERED', history: old ? [...(oldHistory || []), previous] : [] }, { status: 'CONTRACT_SENT' });
    });
  }
  async function consent(id, hash, evidence) {
    return lockedClosure(db, id, async (tx, request) => {
      const c = assertCurrent(request, hash);
      requireValue(!signsBeforePayment(c.offer), 'contract_signature_required');
      requireValue(!['CANCEL_REQUESTED','CANCELLED','REFUND_PENDING','REFUNDED','REVERSED'].includes(c.status), 'closure_cancelled');
      if (c.consent?.offerHash === hash) return request;
      return save(tx, request, { ...c, consent: { offerHash: hash, acceptedAt: iso(), ip: evidence.ip, userAgent: evidence.userAgent }, status: 'ACCEPTED' });
    });
  }
  async function sync(id) {
    const request = await load(id); const c = getClosure(request); const p = c?.payment;
    if (!p || p.method !== 'STRIPE' || !p.sessionId) return request;
    const session = await deps.retrieveCheckoutSession(p.sessionId);
    requireValue(session.metadata?.requestId === String(id) && session.metadata.offerHash === c.offer.hash &&
      session.metadata.paymentId === p.id && session.amount_total === c.offer.totalCents && session.currency === 'eur', 'payment_mismatch');
    let state = session.status === 'expired' ? 'EXPIRED' : session.payment_status === 'paid' && session.status === 'complete' ? 'PAID' : 'PENDING';
    let settledAt;
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (state === 'PAID') {
      requireValue(intentId, 'payment_intent_missing');
      const intent = await deps.retrieveOnboardingIntent(intentId);
      requireValue(intent.status === 'succeeded' && intent.amount_received === c.offer.totalCents && intent.currency === 'eur', 'payment_not_settled');
      requireValue(intent.latest_charge && typeof intent.latest_charge === 'object', 'charge_verification_required');
      settledAt = intent.latest_charge.created ? new Date(intent.latest_charge.created * 1000).toISOString() : iso();
      if (intent.latest_charge?.disputed || intent.latest_charge?.amount_refunded > 0) state = 'REVERSED';
    }
    let refundStatus = p.refundStatus;
    if (p.refundId) {
      const refund = await deps.retrieveOnboardingRefund(p.refundId); refundStatus = refund.status;
      if (refund.status === 'succeeded') state = 'REFUNDED';
    }
    return lockedClosure(db, id, async (tx, latest) => {
      const live = getClosure(latest); requireValue(live?.payment?.id === p.id && live.offer.hash === c.offer.hash, 'payment_changed');
      // A concurrent cancel/refund must never be undone by an older Stripe read.
      if (live.payment.refundId !== p.refundId || live.payment.refundRequestedAt !== p.refundRequestedAt) return latest;
      if (['PAID','REFUND_PENDING','REVERSED','REFUNDED'].includes(live.payment.status) && ['PENDING','EXPIRED'].includes(state)) return latest;
      if (['REVERSED','REFUNDED'].includes(live.payment.status) && !['REVERSED','REFUNDED'].includes(state)) return latest;
      if (live.payment.status === 'REFUNDED') state = 'REFUNDED';
      if (live.payment.refundRequestedAt && state === 'PAID') state = 'REFUND_PENDING';
      const payment = { ...live.payment, status: state, intentId, refundStatus,
        paidAt: state === 'PAID' ? live.payment.paidAt || settledAt : live.payment.paidAt };
      const status = live.status === 'SIGNED' ? 'SIGNED' : ['REVERSED','REFUNDED'].includes(state) ? state
        : live.cancelRequestedAt ? 'CANCEL_REQUESTED' : state === 'PAID' ? 'PAID' : live.status;
      return save(tx, latest, { ...live, payment, status });
    });
  }
  async function checkout(id, hash, returnUrl) {
    await sync(id);
    const reserved = await lockedClosure(db, id, async (tx, request) => {
      const c = assertCurrent(request, hash);
      requireValue(c.consent?.offerHash === hash, 'prepayment_consent_required');
      if (signsBeforePayment(c.offer)) requireValue(request.formalData.contractSignature?.offerHash === hash, 'contract_signature_required');
      requireValue(!c.cancelRequestedAt && !['REFUNDED','REVERSED','CANCELLED','REFUND_PENDING'].includes(c.status), 'closure_cancelled');
      if (c.payment?.status === 'PAID') return request;
      if (c.payment && c.payment.status !== 'EXPIRED') {
        requireValue(c.payment.method === 'STRIPE', 'payment_method_locked'); return request;
      }
      available(c.offer);
      const payment = { id: crypto.randomUUID(), method: 'STRIPE', status: 'CREATING', amountCents: c.offer.totalCents,
        createdAt: iso(), returnUrl };
      return save(tx, request, { ...c, payment, status: 'PAYMENT_PENDING', attempts: [...(c.attempts || []), ...(c.payment ? [c.payment] : [])] });
    });
    const c = getClosure(reserved), p = c.payment;
    if (p.status === 'PAID') return { paid: true };
    if (p.sessionId) {
      const session = await deps.retrieveCheckoutSession(p.sessionId);
      return { url: session.status === 'open' ? session.url : null, pending: session.status !== 'open' };
    }
    // Never recreate an uncertain operation beyond Stripe's idempotency retention window.
    requireValue(Date.now() - new Date(p.createdAt).getTime() < 23 * 3600000, 'payment_reconciliation_required');
    const session = await deps.createOnboardingCheckout({ request: reserved, offer: c.offer, payment: p, returnUrl: p.returnUrl });
    const attached = await lockedClosure(db, id, async (tx, request) => {
      const live = getClosure(request); requireValue(live.payment.id === p.id, 'payment_changed');
      return save(tx, request, { ...live, payment: { ...live.payment, sessionId: session.id, status: live.payment.status === 'CREATING' ? 'PENDING' : live.payment.status } });
    });
    requireValue(!getClosure(attached).cancelRequestedAt, 'closure_cancelled');
    return { url: session.url };
  }
  async function cash(id, hash, receipt, actor) {
    return lockedClosure(db, id, async (tx, request) => {
      const c = assertCurrent(request, hash);
      requireValue(c.consent?.offerHash === hash, 'prepayment_consent_required');
      if (signsBeforePayment(c.offer)) requireValue(request.formalData.contractSignature?.offerHash === hash, 'contract_signature_required');
      requireValue(!c.cancelRequestedAt && !['REFUNDED','REVERSED','CANCELLED'].includes(c.status), 'closure_cancelled');
      if (c.payment?.method === 'CASH' && c.payment.status === 'PAID' && c.payment.receipt === receipt) return request;
      requireValue(!c.payment || c.payment.status === 'EXPIRED', 'resolve_existing_payment_first');
      requireValue(c.offer.pos.mode === 'PURCHASE', 'cash_only_for_purchase');
      available(c.offer);
      return save(tx, request, { ...c, status: 'PAID', payment: { id: crypto.randomUUID(), method: 'CASH', status: 'PAID',
        amountCents: c.offer.totalCents, receipt: text(receipt, 3, 200), paidAt: iso(), confirmedBy: actor } });
    });
  }
  async function cancel(id, hash) {
    return lockedClosure(db, id, async (tx, request) => {
      const c = assertCurrent(request, hash);
      if (['CANCELLED','REFUNDED'].includes(c.status)) return request;
      return save(tx, request, { ...c, status: 'CANCEL_REQUESTED', cancelRequestedAt: c.cancelRequestedAt || iso() });
    });
  }
  async function refund(id, hash, cashReceipt, actor) {
    await sync(id);
    let request = await load(id), c = assertCurrent(request, hash);
    requireValue(c.cancelRequestedAt || closureView(request).overdue, 'cancellation_required');
    if (c.payment?.method === 'STRIPE' && c.payment.sessionId && ['PENDING','EXPIRED'].includes(c.payment.status)) {
      const session = await deps.retrieveCheckoutSession(c.payment.sessionId);
      if (session.status === 'open') await deps.expireOnboardingSession(session.id);
      request = await sync(id); c = getClosure(request);
    }
    const reserved = await lockedClosure(db, id, async (tx, row) => {
      const live = assertCurrent(row, hash), p = live.payment;
      if (!p || p.status === 'EXPIRED') return save(tx, row, { ...live, status: 'CANCELLED' });
      if (p.status === 'REFUNDED') return row;
      requireValue(['PAID','REFUND_PENDING'].includes(p.status), 'payment_reconciliation_required');
      if (p.method === 'CASH') return save(tx, row, { ...live, status: 'REFUNDED', payment: { ...p, status: 'REFUNDED',
        refundReceipt: text(cashReceipt, 3, 200), refundedAt: iso(), refundedBy: actor } });
      return save(tx, row, { ...live, status: 'REFUND_PENDING', payment: { ...p, status: 'REFUND_PENDING', refundRequestedAt: p.refundRequestedAt || iso() } });
    });
    c = getClosure(reserved);
    if (c.status !== 'REFUND_PENDING') return reserved;
    requireValue(Date.now() - new Date(c.payment.refundRequestedAt).getTime() < 23 * 3600000 || c.payment.refundId, 'refund_reconciliation_required');
    const result = c.payment.refundId ? await deps.retrieveOnboardingRefund(c.payment.refundId)
      : await deps.refundOnboardingPayment({ intentId: c.payment.intentId, amount: c.offer.totalCents, key: `onboarding-refund-${c.payment.id}`, requestId: id });
    return lockedClosure(db, id, async (tx, row) => {
      const live = getClosure(row); requireValue(live.payment.id === c.payment.id && live.status !== 'SIGNED', 'payment_changed');
      return save(tx, row, { ...live, status: result.status === 'succeeded' ? 'REFUNDED' : 'REFUND_PENDING',
        payment: { ...live.payment, refundId: result.id, refundStatus: result.status,
          status: result.status === 'succeeded' ? 'REFUNDED' : 'REFUND_PENDING', refundAllocation: live.offer.lines } });
    });
  }
  async function signingCheck(id, hash) {
    const request = await sync(id); const c = assertCurrent(request, hash);
    requireValue(closureView(request).canSign, 'initial_payment_required'); verifyOffer(c.offer); return request;
  }
  async function reconcile(id, sessionId, refundId) {
    const request = await load(id), c = getClosure(request), p = c?.payment;
    requireValue(p?.method === 'STRIPE', 'stripe_payment_required');
    let session, refund;
    if (sessionId) {
      session = await deps.retrieveCheckoutSession(sessionId);
      requireValue(session.metadata?.paymentId === p.id && session.metadata.requestId === String(id) && session.metadata.offerHash === c.offer.hash &&
        session.currency === 'eur' && session.amount_total === c.offer.totalCents, 'payment_mismatch');
    }
    if (refundId) {
      requireValue(p.refundRequestedAt && p.intentId, 'refund_not_requested');
      refund = await deps.retrieveOnboardingRefund(refundId);
      requireValue(refund.payment_intent === p.intentId && refund.amount === c.offer.totalCents && refund.currency === 'eur', 'refund_mismatch');
    }
    await lockedClosure(db, id, async (tx, row) => {
      const live = getClosure(row); requireValue(live.payment.id === p.id, 'payment_changed');
      return save(tx, row, { ...live, payment: { ...live.payment, ...(session ? { sessionId: session.id } : {}), ...(refund ? { refundId: refund.id } : {}) } });
    });
    return sync(id);
  }
  return { publish, consent, checkout, sync, cash, cancel, refund, signingCheck, reconcile };
}
