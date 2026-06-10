// -----------------------------------------------------------------------------
// Invoice money math — SHARED, pure, used by both providers AND the views, so
// the on-screen preview, the persisted totals, and the PDF all agree.
//
// Rule: round each LINE to 2dp, then SUM the rounded lines — so the printed rows
// add up exactly to the printed total. Durations round to the nearest 0.25h
// (tuition convention). additionalMaterials is clamped >= 0.
// -----------------------------------------------------------------------------

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const round025 = (n) => Math.round((Number(n) || 0) * 4) / 4;

/** Hours between two ISO times, rounded to nearest 0.25 (DST-agnostic: pure ms). */
export function durationHours(startISO, endISO) {
  return round025((new Date(endISO) - new Date(startISO)) / 3_600_000);
}

/** Per-line fee for a given rate mode. */
export function lineAmount(durationHrs, rate, rateType) {
  return round2(rateType === "hourly" ? (Number(durationHrs) || 0) * rate : rate);
}

/**
 * Compute the totals block from an invoice's lineItems + additionalMaterials.
 * Only lines with included !== false count. @returns the totals object.
 */
export function computeTotals(inv) {
  const lines = (inv.lineItems || []).filter((l) => l.included !== false);
  const totalHours = round2(lines.reduce((s, l) => s + (Number(l.durationHours) || 0), 0));
  const lessonCount = lines.length;
  const totalLessonFee = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const additionalMaterials = Math.max(0, round2(inv.additionalMaterials));
  const totalPayable = round2(totalLessonFee + additionalMaterials);
  return { totalHours, lessonCount, totalLessonFee, additionalMaterials, totalPayable };
}

/** "HH:mm" local time from an ISO string. */
export function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "YYYY-MM" for a month, from "YYYY-MM" or any ISO instant inside the month. */
export function monthKey(monthISO) {
  if (/^\d{4}-\d{2}$/.test(monthISO)) return monthISO;
  const d = new Date(monthISO);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** [startISO, endISO) bounds (local) for a "YYYY-MM" month key. */
export function monthBounds(monthISO) {
  const key = monthKey(monthISO);
  const [y, m] = key.split("-").map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0); // first instant of next month
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Initials for the invoice number, from a payee name. "Ms Huang" -> "MH". */
export function payeeInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.map((p) => p[0]).join("").replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 3) || "INV";
}

/** Compose the invoice number: {INITIALS}{YYMM}-{NN}. */
export function invoiceNumber(payeeName, monthKeyStr, nn) {
  const [y, m] = monthKeyStr.split("-");
  const yymm = y.slice(2) + m;
  return `${payeeInitials(payeeName)}${yymm}-${String(nn).padStart(2, "0")}`;
}
