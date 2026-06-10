// Invoices view.
//   - TUTOR: generate a monthly draft per student, edit line items + materials,
//     issue (assign number, make parent-visible), mark paid, view/print.
//   - PARENT: read-only list of their own child's issued/paid invoices, with a
//     PayNow QR for the total and a Paid/Unpaid status.

import { el, clear, fmtDate, toDateInputValue } from "../util.js";
import { modal, toast, statusPill, confirmModal } from "./components.js";
import { payNowButton } from "./paynow-ui.js";
import { openInvoiceModal } from "./invoice-detail.js";
import { computeTotals } from "../data/invoice-math.js";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
function monthLabel(pm) {
  const [y, m] = String(pm || "").split("-").map(Number);
  return y ? new Date(y, m - 1, 1).toLocaleDateString([], { month: "short", year: "numeric" }) : pm;
}

export class InvoicesView {
  constructor(mount, provider, viewer) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = viewer;
    this.isTutor = viewer.role === "tutor";
  }

  async render() {
    clear(this.mount);
    this.mount.appendChild(
      el("div", { class: "section__head" }, [
        el("h1", {}, "Invoices"),
        el("p", { class: "muted" }, this.isTutor
          ? "Generate a monthly invoice per student, then issue it for the parent to see and pay."
          : "Invoices from your tutor."),
      ])
    );

    if (this.isTutor) this.mount.appendChild(await this._generateBar());

    this.list = el("div", { class: "reqlist" });
    this.mount.appendChild(this.list);
    await this._load();
  }

  async _generateBar() {
    let students = [];
    try { students = await this.provider.listAllStudents(); } catch (_) {}
    const sel = el("select", { class: "field__input" }, students.map((s) => el("option", { value: s.id }, s.name)));
    const now = new Date();
    const month = el("input", { class: "field__input", type: "month", value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` });
    const gen = el("button", { class: "btn btn--primary", type: "button" }, "Generate draft");
    gen.addEventListener("click", async () => {
      if (!sel.value) { toast("Add a student first (Manage).", "error"); return; }
      gen.disabled = true;
      try {
        const draft = await this.provider.buildMonthlyInvoiceDraft(sel.value, month.value);
        gen.disabled = false;
        if (!draft.lineItems.length) {
          toast(`No lessons for ${draft.studentName} in ${monthLabel(draft.periodMonth)}.`, "info");
          return;
        }
        this._openEditor(draft);
      } catch (e) { gen.disabled = false; toast(e.message, "error"); }
    });
    return el("div", { class: "invgen" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Student"), sel]),
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Month"), month]),
      el("div", { class: "invgen__btn" }, gen),
    ]);
  }

  async _load() {
    clear(this.list);
    this.list.appendChild(el("div", { class: "grid__loading" }, "Loading…"));
    let invoices;
    try { invoices = await this.provider.listInvoices(); }
    catch (e) { clear(this.list); this.list.appendChild(el("div", { class: "error" }, e.message)); return; }
    clear(this.list);
    if (!invoices.length) {
      this.list.appendChild(el("div", { class: "grid__empty" }, this.isTutor ? "No invoices yet. Generate one above." : "No invoices yet."));
      return;
    }
    for (const inv of invoices) this.list.appendChild(this._card(inv));
  }

  _card(inv) {
    const head = el("div", { class: "req__head" }, [
      el("span", { class: "pill pill--kind" }, inv.invoiceNo || "Draft"),
      statusPill(inv.status),
    ]);
    const who = el("div", { class: "req__who" }, [
      el("strong", {}, inv.studentName),
      el("span", { class: "muted" }, ` · ${monthLabel(inv.periodMonth)} · ${money(inv.totals.totalPayable)}`),
    ]);

    const actions = el("div", { class: "req__actions" }, []);
    const view = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "View");
    view.addEventListener("click", () => this._openView(inv));
    actions.appendChild(view);

    if (this.isTutor) {
      if (inv.status === "draft") {
        const edit = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "Edit");
        edit.addEventListener("click", () => this._openEditor(inv));
        const issue = el("button", { class: "btn btn--primary btn--sm", type: "button" }, "Issue");
        issue.addEventListener("click", () => this._issue(inv));
        actions.append(edit, issue);
      } else if (inv.status === "issued") {
        const mark = el("button", { class: "btn btn--primary btn--sm", type: "button" }, "Mark paid");
        mark.addEventListener("click", () => this._markPaid(inv, true));
        actions.appendChild(mark);
      } else if (inv.status === "paid") {
        const unmark = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "Mark unpaid");
        unmark.addEventListener("click", () => this._markPaid(inv, false));
        actions.appendChild(unmark);
      }
    } else {
      // Parent: pay button when issued + payable.
      if (inv.status === "issued" && inv.payNowId && inv.totals.totalPayable > 0) {
        actions.appendChild(payNowButton("Pay with PayNow", () => ({
          payNowId: inv.payNowId, payeeName: inv.billFrom, amount: inv.totals.totalPayable, reference: inv.invoiceNo,
        })));
      }
    }

    return el("div", { class: `req req--${inv.status === "paid" ? "approved" : inv.status === "issued" ? "pending" : "draft"}` }, [head, who, actions]);
  }

  _openView(inv) {
    openInvoiceModal(inv);
  }

  async _issue(inv) {
    const ok = await confirmModal(
      `This invoice for ${inv.studentName} becomes visible to the parent and can no longer be edited.`,
      { title: "Issue invoice?", confirmLabel: "Issue" }
    );
    if (!ok) return;
    try {
      await this.provider.issueInvoice(inv.id);
      toast("Invoice issued.", "success");
      this._load();
    } catch (e) { toast(e.message, "error"); }
  }

  async _markPaid(inv, paid) {
    try {
      await this.provider.setInvoicePaid(inv.id, paid);
      toast(paid ? "Marked paid." : "Marked unpaid.", "success");
      this._load();
    } catch (e) { toast(e.message, "error"); }
  }

  // --------------------------------------------------------------------- //
  // Draft editor (tutor)
  // --------------------------------------------------------------------- //
  _openEditor(draft) {
    // Working copy.
    const inv = JSON.parse(JSON.stringify(draft));
    inv.invoiceDateISO = inv.invoiceDateISO || new Date().toISOString();

    const invoiceNo = el("input", { class: "field__input", type: "text", placeholder: "(auto on issue)", value: inv.invoiceNo || "" });
    const invDate = el("input", { class: "field__input", type: "date", value: toDateInputValue(new Date(inv.invoiceDateISO)) });
    const billTo = el("input", { class: "field__input", type: "text", placeholder: "Parent name", value: inv.billToParent || "" });

    // Line items table (editable amount + remarks + remove).
    const tbody = el("tbody", {});
    const totalsEl = el("div", { class: "inv__totals inv__totals--edit" });
    const matAmount = el("input", { class: "field__input rateinput", type: "number", min: "0", step: "0.01", value: inv.additionalMaterials || 0 });
    const matLabel = el("input", { class: "field__input", type: "text", value: inv.additionalMaterialsLabel || "Additional Materials" });

    const recompute = () => {
      inv.additionalMaterials = Math.max(0, Number(matAmount.value) || 0);
      inv.additionalMaterialsLabel = matLabel.value.trim() || "Additional Materials";
      const t = computeTotals(inv);
      clear(totalsEl);
      totalsEl.append(
        row("Total hours", String(t.totalHours)),
        row("Total lesson fee", money(t.totalLessonFee)),
        row(inv.additionalMaterialsLabel, money(t.additionalMaterials)),
        el("div", { class: "inv__payable" }, [el("span", {}, "Total Payable"), el("strong", {}, money(t.totalPayable))])
      );
    };

    const renderRows = () => {
      clear(tbody);
      inv.lineItems.forEach((l, idx) => {
        if (l.included === false) return;
        const amt = el("input", { class: "field__input rateinput", type: "number", min: "0", step: "0.01", value: l.amount });
        amt.addEventListener("input", () => { l.amount = Number(amt.value) || 0; recompute(); });
        const rem = el("input", { class: "field__input", type: "text", value: l.remarks || "" });
        rem.addEventListener("input", () => { l.remarks = rem.value; });
        const del = el("button", { class: "chip__x", type: "button", title: "Remove line" }, "×");
        del.addEventListener("click", () => { inv.lineItems[idx].included = false; renderRows(); recompute(); });
        tbody.appendChild(el("tr", {}, [
          el("td", {}, fmtDate(l.dateISO).replace(/^[A-Za-z]+,?\s*/, "")),
          el("td", {}, `${l.startTime}–${l.endTime}`),
          el("td", { class: "num" }, String(l.durationHours)),
          el("td", {}, amt),
          el("td", {}, rem),
          el("td", {}, del),
        ]));
      });
    };

    matAmount.addEventListener("input", recompute);
    matLabel.addEventListener("input", recompute);
    renderRows();
    recompute();

    const table = el("table", { class: "inv__table inv__table--edit" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Date"), el("th", {}, "Time"), el("th", { class: "num" }, "Hrs"),
        el("th", {}, "Amount"), el("th", {}, "Remarks"), el("th", {}, ""),
      ])),
      tbody,
    ]);

    const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, "Save draft");
    const issueBtn = el("button", { class: "btn btn--primary", type: "button" }, "Save & issue");

    const collect = () => {
      inv.invoiceNo = invoiceNo.value.trim();
      inv.invoiceDateISO = invDate.value ? new Date(invDate.value).toISOString() : inv.invoiceDateISO;
      inv.billToParent = billTo.value.trim();
      inv.additionalMaterials = Math.max(0, Number(matAmount.value) || 0);
      inv.additionalMaterialsLabel = matLabel.value.trim() || "Additional Materials";
      return inv;
    };

    const { close } = modal(`Invoice — ${inv.studentName} · ${monthLabel(inv.periodMonth)}`, [
      el("div", { class: "form__row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Invoice No"), invoiceNo]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Invoice date"), invDate]),
      ]),
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Bill to (parent)"), billTo]),
      el("div", { class: "inv__scroll" }, table),
      el("div", { class: "form__row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Materials label"), matLabel]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Materials amount"), matAmount]),
      ]),
      totalsEl,
    ], [saveBtn, issueBtn]);

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = issueBtn.disabled = true;
      try {
        await this.provider.saveInvoice(collect());
        close(); toast("Draft saved.", "success"); this._load();
      } catch (e) { saveBtn.disabled = issueBtn.disabled = false; toast(e.message, "error"); }
    });
    issueBtn.addEventListener("click", async () => {
      const ok = await confirmModal(
        "This invoice becomes visible to the parent and can't be edited after issuing.",
        { title: "Save and issue?", confirmLabel: "Save & issue" }
      );
      if (!ok) return;
      saveBtn.disabled = issueBtn.disabled = true;
      try {
        const saved = await this.provider.saveInvoice(collect());
        await this.provider.issueInvoice(saved.id);
        close(); toast("Invoice issued.", "success"); this._load();
      } catch (e) { saveBtn.disabled = issueBtn.disabled = false; toast(e.message, "error"); }
    });
  }
}

function row(label, value) {
  return el("div", { class: "inv__totrow" }, [el("span", { class: "muted" }, label), el("span", {}, value)]);
}
