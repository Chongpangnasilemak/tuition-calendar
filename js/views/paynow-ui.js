// PayNow QR modal — shows a styled PayNow/PayLah badge + a scannable QR for a
// given amount/reference, generated entirely client-side. Shared by the tutor
// dashboard and the parent lesson view.

import { el } from "../util.js";
import { modal, toast } from "./components.js";
import { buildPayNowPayload, normaliseMobile } from "../paynow.js";
import { renderQrCanvas } from "../qr.js";

/** A small, recognizable PayNow/PayLah badge (no copyrighted image assets). */
function payNowBadge() {
  return el("div", { class: "pnbadge" }, [
    el("span", { class: "pnbadge__pay" }, "Pay"),
    el("span", { class: "pnbadge__now" }, "Now"),
    el("span", { class: "pnbadge__plus" }, "+ PayLah!"),
  ]);
}

/**
 * Open the PayNow QR modal.
 * @param {{ payNowId:string, payeeName?:string, amount?:number, reference?:string }} opts
 */
export function openPayNowModal({ payNowId, payeeName, amount, reference }) {
  if (!payNowId) {
    toast("No PayNow number set yet. The tutor can add it in Manage → Payment.", "error");
    return;
  }
  const proxy = normaliseMobile(payNowId);
  let payload;
  try {
    payload = buildPayNowPayload({
      proxy: payNowId,
      amount: amount && amount > 0 ? Number(amount) : undefined,
      reference: reference || "",
      merchantName: payeeName || "Tuition",
    });
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  const qrHolder = el("div", { class: "pnqr" }, el("div", { class: "muted" }, "Generating QR…"));
  const amountLine = amount && amount > 0
    ? el("div", { class: "pnqr__amt" }, `Amount: $${Number(amount).toFixed(2)}`)
    : el("div", { class: "pnqr__amt muted" }, "Amount: enter in your banking app");

  const body = [
    payNowBadge(),
    qrHolder,
    amountLine,
    reference ? el("div", { class: "pnqr__ref muted" }, `Reference: ${reference}`) : null,
    el("div", { class: "pnqr__to muted" }, `Pay to: ${proxy}${payeeName ? " (" + payeeName + ")" : ""}`),
    el("p", { class: "pnqr__hint muted" }, "Scan with PayLah!, your bank app, GrabPay or any SGQR app. Payment goes directly to the tutor."),
  ].filter(Boolean);

  modal("Pay with PayNow / PayLah", body, []);

  // Render the QR (async — the library loads from a CDN on first use).
  renderQrCanvas(payload, 240)
    .then((canvas) => {
      qrHolder.innerHTML = "";
      qrHolder.appendChild(canvas);
    })
    .catch(() => {
      qrHolder.innerHTML = "";
      qrHolder.appendChild(el("div", { class: "error" }, "Couldn't render the QR. Check your connection."));
      // Fallback: show the raw payload so it's not a dead end.
      qrHolder.appendChild(el("textarea", { class: "field__input", rows: "3", readonly: true }, payload));
    });
}

/** A button that opens the PayNow modal. */
export function payNowButton(label, getOpts) {
  const btn = el("button", { class: "btn btn--paynow btn--sm", type: "button" }, [
    el("span", { class: "btn__pnicon", "aria-hidden": "true" }, "$"),
    label,
  ]);
  btn.addEventListener("click", () => openPayNowModal(getOpts()));
  return btn;
}
