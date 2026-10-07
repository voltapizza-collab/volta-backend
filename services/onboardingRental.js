// Payments in advance: first instalment after signing, no interest before delivery.
// Subsequent instalments fall monthly from operational delivery, as in existing renting.
export function rentalPlan(principalCents, months) {
  if (!Number.isSafeInteger(principalCents) || principalCents < 100 || principalCents > 1000000 ||
      !Number.isInteger(months) || months < 1 || months > 12) throw new Error('invalid_rental_plan');
  const rate = 0.01;
  const regular = Math.round(principalCents * rate / (1 - Math.pow(1 + rate, -months)) / (1 + rate));
  let balance = principalCents;
  const schedule = Array.from({ length: months }, (_, index) => {
    const interestCents = index === 0 ? 0 : Math.round(balance * rate);
    const paymentCents = index === months - 1 ? balance + interestCents : regular;
    const principalPaidCents = paymentCents - interestCents;
    balance -= principalPaidCents;
    return { month: index, paymentCents, interestCents, principalCents: principalPaidCents, balanceCents: balance };
  });
  const payments = schedule.map(row => row.paymentCents);
  const totalCents = payments.reduce((sum, value) => sum + value, 0);
  return { months, monthlyCents: payments[0], payments, schedule, totalCents,
    principalCents, interestCents: totalCents - principalCents,
    monthlyInterestPercent: 1, annualNominalPercent: 12, annualEffectivePercent: 12.682503,
    firstPaymentTiming: 'UPFRONT', commissionCents: 0 };
}
