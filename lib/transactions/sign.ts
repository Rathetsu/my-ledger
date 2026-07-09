// Re-apply the ledger sign convention when a plain row is edited. Expense is
// always negative, income always positive; every other plain type (opening,
// adjustment) keeps the row's existing sign (spec §3: editing preserves sign).
export function signedAmountForEdit(
  type: string,
  currentMinor: number,
  magnitudeMinor: number,
): number {
  const mag = Math.abs(magnitudeMinor)
  if (type === 'expense') return -mag
  if (type === 'income') return mag
  return currentMinor < 0 ? -mag : mag
}
