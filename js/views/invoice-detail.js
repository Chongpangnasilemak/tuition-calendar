// Shared invoice DETAIL renderer + print-to-PDF. Used by the tutor "View",
// the parent "View invoice", and printing — so screen and PDF are identical.
// Modeled on the real invoice MH260601.
//
// All invoice text is rendered via el()/text nodes (never innerHTML), since
// names/remarks can be parent-influenced.

import { el, fmtDate } from "../util.js";
import { modal, toast } from "./components.js";
import { buildPayNowPayload } from "../paynow.js";
import { renderQrCanvas } from "../qr.js";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

function monthLabel(periodMonth) {
  const [y, m] = String(periodMonth || "").split("-").map(Number);
  if (!y) return periodMonth || "";
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

/** Render the invoice as a self-contained, professional document element. */
export function renderInvoiceDetail(inv) {
  const t = inv.totals || {};
  const rateLabel = inv.rateType === "hourly" ? `${money(inv.rate)} / hour` : `${money(inv.rate)} / lesson`;
  const paid = inv.status === "paid";

  // --- Accent header band: business name + INVOICE | invoice no + dates ---
  const header = el("div", { class: "inv__band" }, [
    el("div", { class: "inv__brand" }, [
      el("div", { class: "inv__biz" }, inv.billFrom || "Tuition"),
      el("div", { class: "inv__tag" }, "Private Tuition"),
    ]),
    el("div", { class: "inv__title" }, [
      el("div", { class: "inv__word" }, "INVOICE"),
      el("div", { class: "inv__no" }, inv.invoiceNo || "DRAFT"),
    ]),
  ]);

  // --- Meta strip: dates + status ---
  const meta = el("div", { class: "inv__metastrip" }, [
    metaCell("Invoice date", inv.invoiceDateISO ? fmtDate(inv.invoiceDateISO) : "—"),
    metaCell("Billing period", monthLabel(inv.periodMonth)),
    metaCell("Status", paid ? "Paid" : (inv.status === "issued" ? "Unpaid" : "Draft")),
  ]);

  // --- From / Bill To two columns ---
  const parties = el("div", { class: "inv__parties" }, [
    el("div", { class: "inv__party" }, [
      el("div", { class: "inv__plabel" }, "From"),
      el("div", { class: "inv__pname" }, inv.billFrom || "Tuition"),
    ]),
    el("div", { class: "inv__party" }, [
      el("div", { class: "inv__plabel" }, "Bill to"),
      el("div", { class: "inv__pname" }, inv.billToParent || "Parent"),
      inv.billToChild ? el("div", { class: "inv__psub" }, `Student: ${inv.billToChild}`) : null,
    ]),
  ]);

  // --- Line-items table ---
  const rows = (inv.lineItems || []).filter((l) => l.included !== false).map((l) =>
    el("tr", {}, [
      el("td", {}, fmtDate(l.dateISO).replace(/^[A-Za-z]+,?\s*/, "")),
      el("td", {}, `${l.startTime} – ${l.endTime}`),
      el("td", { class: "num" }, String(l.durationHours)),
      el("td", {}, l.remarks || ""),
      el("td", { class: "num" }, money(l.amount)),
    ])
  );
  const table = el("table", { class: "inv__table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Date"), el("th", {}, "Time"), el("th", { class: "num" }, "Hours"),
      el("th", {}, "Remarks"), el("th", { class: "num" }, "Amount"),
    ])),
    el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "5", class: "muted inv__empty" }, "No lessons this period."))]),
  ]);

  // --- Totals (right-aligned, Total Payable emphasized) ---
  const totals = el("div", { class: "inv__totalswrap" }, el("div", { class: "inv__totals" }, [
    totRow("Total hours", String(t.totalHours ?? 0)),
    totRow("Rate", rateLabel),
    totRow("Total lesson fee", money(t.totalLessonFee)),
    (t.additionalMaterials || 0) > 0 ? totRow(inv.additionalMaterialsLabel || "Additional materials", money(t.additionalMaterials)) : null,
    el("div", { class: "inv__payable" }, [
      el("span", {}, "Total Payable"),
      el("strong", {}, money(t.totalPayable)),
    ]),
  ].filter(Boolean)));

  const card = el("div", { class: "invoice" + (paid ? " invoice--paid" : "") }, [
    paid ? el("div", { class: "inv__stamp" }, "PAID") : null,
    header, meta, parties, table, totals,
  ]);

  // --- PayNow block (issued + unpaid + positive total + number set) ---
  if (inv.payNowId && (t.totalPayable || 0) > 0 && !paid) {
    const qrHolder = el("div", { class: "inv__qr" }, el("div", { class: "muted" }, "QR…"));
    card.appendChild(el("div", { class: "inv__pay" }, [
      el("div", { class: "inv__payleft" }, [
        el("div", { class: "pnbadge" }, [
          el("span", { class: "pnbadge__pay" }, "Pay"),
          el("span", { class: "pnbadge__now" }, "Now"),
          el("span", { class: "pnbadge__plus" }, "+ PayLah!"),
        ]),
        el("div", { class: "inv__payinfo" }, [
          el("div", {}, [el("span", { class: "muted" }, "Amount  "), el("strong", {}, money(t.totalPayable))]),
          el("div", { class: "muted" }, `To ${inv.payNowId}`),
          el("div", { class: "muted" }, `Ref ${inv.invoiceNo || "—"}`),
        ]),
      ]),
      qrHolder,
    ]));
    renderQrCanvas(payloadFor(inv), 150)
      .then((c) => { qrHolder.innerHTML = ""; qrHolder.appendChild(c); })
      .catch(() => { qrHolder.innerHTML = ""; qrHolder.appendChild(el("div", { class: "muted" }, "(QR unavailable)")); });
  }

  // --- Footer note ---
  card.appendChild(el("div", { class: "inv__foot" }, paid
    ? "Thank you — this invoice has been fully paid."
    : "Please scan the PayNow code or transfer the total to the number above. Thank you!"));

  return card;
}

function metaCell(label, value) {
  return el("div", { class: "inv__metacell" }, [
    el("div", { class: "inv__metalabel" }, label),
    el("div", { class: "inv__metaval" }, value),
  ]);
}
function totRow(label, value) {
  return el("div", { class: "inv__totrow" }, [el("span", {}, label), el("span", { class: "num" }, value)]);
}

function payloadFor(inv) {
  return buildPayNowPayload({
    proxy: inv.payNowId,
    amount: (inv.totals || {}).totalPayable,
    reference: inv.invoiceNo || "",
    merchantName: inv.billFrom || "Tuition",
  });
}

/** Open the invoice in a modal with Print (+ optional extra footer buttons). */
export function openInvoiceModal(inv, extraFooter = []) {
  const printBtn = el("button", { class: "btn btn--ghost", type: "button" }, "🖨 Print / PDF");
  printBtn.addEventListener("click", () => printInvoice(inv));
  modal(inv.invoiceNo || "Invoice", renderInvoiceDetail(inv), [printBtn, ...extraFooter]);
}

/**
 * Print the invoice to PDF via the OS print dialog. We render into a #print-root
 * node, AWAIT the QR (so it's not blank), print, then clean up on afterprint or
 * error. A @media print stylesheet (app.css) isolates #print-root.
 */
export async function printInvoice(inv) {
  const root = el("div", { id: "print-root" }, renderInvoiceDetail(inv));
  document.body.appendChild(root);
  // Wait for the QR canvas to exist (renderInvoiceDetail kicked it off async).
  await new Promise((r) => setTimeout(r, 350));
  // If the QR holder is still empty, give it one more beat.
  if (root.querySelector(".inv__qr") && !root.querySelector(".inv__qr canvas")) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const cleanup = () => { if (document.body.contains(root)) document.body.removeChild(root); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  try {
    window.print();
  } catch (_) {
    toast("Couldn't open the print dialog.", "error");
  }
  // Fallback cleanup (some mobile browsers never fire afterprint).
  setTimeout(cleanup, 60000);
}
