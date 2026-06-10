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

/** Render the invoice as a self-contained card element. */
export function renderInvoiceDetail(inv) {
  const t = inv.totals || {};
  const rateLabel = inv.rateType === "hourly" ? `${money(inv.rate)} / hour` : `${money(inv.rate)} / lesson`;

  // Header band.
  const header = el("div", { class: "inv__head" }, [
    el("div", { class: "inv__from" }, [
      el("div", { class: "inv__bigname" }, inv.billFrom || "Tuition"),
      el("div", { class: "muted" }, "INVOICE"),
    ]),
    el("div", { class: "inv__meta" }, [
      el("div", {}, [el("span", { class: "muted" }, "Invoice No: "), el("strong", {}, inv.invoiceNo || "(draft)")]),
      el("div", { class: "muted" }, inv.invoiceDateISO ? fmtDate(inv.invoiceDateISO) : ""),
      el("div", { class: "muted" }, monthLabel(inv.periodMonth)),
    ]),
  ]);

  // Bill to.
  const billTo = el("div", { class: "inv__billto" }, [
    el("span", { class: "muted" }, "Bill To: "),
    el("strong", {}, inv.billToParent || "Parent"),
    el("span", { class: "muted" }, inv.billToChild ? ` (Student: ${inv.billToChild})` : ""),
  ]);

  // Line items table.
  const rows = (inv.lineItems || []).filter((l) => l.included !== false).map((l) =>
    el("tr", {}, [
      el("td", {}, fmtDate(l.dateISO).replace(/^[A-Za-z]+,?\s*/, "")),
      el("td", {}, `${l.startTime}–${l.endTime}`),
      el("td", { class: "num" }, String(l.durationHours)),
      el("td", {}, l.remarks || ""),
      el("td", { class: "num" }, money(l.amount)),
    ])
  );
  const table = el("table", { class: "inv__table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Date"), el("th", {}, "Time"), el("th", { class: "num" }, "Hrs"),
      el("th", {}, "Remarks"), el("th", { class: "num" }, "Amount"),
    ])),
    el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "5", class: "muted" }, "No lessons this period."))]),
  ]);

  // Totals block.
  const totalsBlock = el("div", { class: "inv__totals" }, [
    totRow("Total Hours", String(t.totalHours ?? 0)),
    totRow("Rate", rateLabel),
    totRow("Total Lesson Fee", money(t.totalLessonFee)),
    totRow(inv.additionalMaterialsLabel || "Additional Materials", money(t.additionalMaterials)),
    el("div", { class: "inv__payable" }, [
      el("span", {}, "Total Payable"),
      el("strong", {}, money(t.totalPayable)),
    ]),
  ]);

  // Paid stamp.
  const card = el("div", { class: "invoice" + (inv.status === "paid" ? " invoice--paid" : "") }, [
    inv.status === "paid" ? el("div", { class: "inv__stamp" }, "FULLY PAID FOR") : null,
    header, billTo, table, totalsBlock,
  ]);

  // PayNow block (issued/unpaid + a positive total + a number set).
  if (inv.payNowId && (t.totalPayable || 0) > 0 && inv.status !== "paid") {
    const qrHolder = el("div", { class: "inv__qr" }, el("div", { class: "muted" }, "QR…"));
    card.appendChild(el("div", { class: "inv__paynow" }, [
      el("div", { class: "pnbadge" }, [
        el("span", { class: "pnbadge__pay" }, "Pay"),
        el("span", { class: "pnbadge__now" }, "Now"),
        el("span", { class: "pnbadge__plus" }, "+ PayLah!"),
      ]),
      qrHolder,
      el("div", { class: "muted inv__qrnote" }, `Pay ${money(t.totalPayable)} to ${inv.payNowId} · Ref: ${inv.invoiceNo || "—"}`),
    ]));
    // Render QR async.
    renderQrCanvas(payloadFor(inv), 160)
      .then((c) => { qrHolder.innerHTML = ""; qrHolder.appendChild(c); })
      .catch(() => { qrHolder.innerHTML = ""; qrHolder.appendChild(el("div", { class: "muted" }, "(QR unavailable)")); });
  }

  return card;
}

function totRow(label, value) {
  return el("div", { class: "inv__totrow" }, [el("span", { class: "muted" }, label), el("span", {}, value)]);
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
