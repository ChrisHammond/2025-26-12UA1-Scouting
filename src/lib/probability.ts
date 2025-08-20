/**
 * Simple logistic win probability based on rating difference.
 * Tune SCALE to make the curve steeper/flatter for your rating system.
 */
const SCALE = 6; // higher -> flatter curve. 6-10 works well for MHR-style ratings.
export function winProb(rA: number, rB: number): number {
  const diff = (rA ?? 0) - (rB ?? 0);
  return 1 / (1 + Math.exp(-diff / SCALE));
}
export function pct(p: number): string {
  if (Number.isNaN(p)) return "—";
  return Math.round(p * 100).toString() + "%";
}
