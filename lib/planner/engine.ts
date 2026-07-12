// ponytail: positive-only by construction (interest/means/payments are >= 0); do not reuse on signed values — lib/currency/convert.ts has the half-away-from-zero variant for those.
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

export function interestOn(balanceMinor: number, apr: number): number {
  // apr is percent per year (12 = 12%); simple monthly interest apr/12 per the planner ADR
  return roundHalfUp((balanceMinor * apr) / 1200)
}

export function jitPayment(balanceMinor: number, apr: number, n: number): number {
  // smallest level monthly payment that clears balanceMinor in n payments at apr/12;
  // ceil guarantees the deadline is met despite integer rounding (the last payment is capped at the balance)
  const r = apr / 1200
  if (r === 0) return Math.ceil(balanceMinor / n)
  return Math.ceil((balanceMinor * r) / (1 - (1 + r) ** -n))
}
