import crypto from 'node:crypto';
import { buildClosureOffer, closureError } from './onboardingClosure.js';
import { offerDefaults } from './onboardingDefaults.js';

// Prices are taken from the merchant's saved selection, never from browser amounts.
export function reviewContract(request, pricing, generalTerms) {
  const defaults = offerDefaults(request, pricing, generalTerms);
  const pos = request.formalData?.commercialSelection?.pos;
  if (!pos || !request.submittedAt) throw closureError('submitted_selection_required');
  const input = { ...defaults, approved: true, workflow: 'SIGN_PAY_ACTIVATE', stockStatus: 'IN_STOCK',
    rentCents: pos.monthlyRentCents ?? defaults.rentCents,
    depositCents: pos.depositCents ?? defaults.depositCents ?? 0 };
  if (pos.mode === 'RENT_QUOTE' && !(input.rentCents > 0)) throw closureError('rent_price_required');
  const offer = buildClosureOffer(request, input, (request.formalData?.closure?.offer.revision || 0) + 1);
  const fingerprint = crypto.createHash('sha256').update(offer.documentText).digest('hex');
  return { input, offer, fingerprint };
}
