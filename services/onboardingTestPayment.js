import crypto from 'node:crypto';
import { closureError, signsBeforePayment, verifyOffer } from './onboardingClosure.js';

// Offline administrative operation only. Never exposed through the public form.
// It records an operational payment simulation; it cannot sign or activate a request.
export function prepareSimulatedPayment(request, { offerHash, reason, actor }) {
  const f = request.formalData || {}, c = f.closure;
  if (actor?.role !== 'global_admin' || !actor.username || String(reason || '').trim().length < 10) throw closureError('test_payment_audit_required');
  verifyOffer(c?.offer);
  if (request.status !== 'CONTRACT_SENT' || !signsBeforePayment(c.offer) || c.offer.hash !== offerHash ||
      !['OFFERED', 'CANCEL_REQUESTED'].includes(c.status) || c.payment || f.contractSignature || f.signedContract || f.activation ||
      c.offer.sms.credits > 0 || c.offer.sms.amountCents > 0) throw closureError('test_payment_not_eligible');
  const at = new Date().toISOString(), id = crypto.randomUUID();
  return { ...f,
    testOperations: [...(f.testOperations || []), { id, type: 'PAYMENT_SIMULATION', at, actor, reason: reason.trim(),
      offerHash, previousStatus: c.status, previousCancelRequestedAt: c.cancelRequestedAt || null, receivedCents: 0 }],
    closure: { ...c, status: 'OFFERED', cancelRequestedAt: null,
      payment: { id, method: 'SIMULATED', status: 'PAID', simulated: true, amountCents: c.offer.totalCents,
        receivedCents: 0, simulatedAt: at, receipt: `TEST-NO-CHARGE-${request.id}-${id}`, confirmedBy: actor } },
  };
}
