// Dashboard (TUTOR only): a lightweight summary of lessons + hours, with a
// manual paid / unpaid flag per lesson. No money movement — just a view of the
// schedule and a way to track who has paid.

import { el, clear, mondayOf, addDays, fmtDateTime, fmtDate } from "../util.js";
import { toast } from "./components.js";
import { payNowButton } from "./paynow-ui.js";
import { durationHours, lineAmount } from "../data/invoice-math.js";

export class DashboardView {
  constructor(mount, provider, viewer) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = viewer;
    this.range = "week"; // "week" | "month"
  }

  async render() {
    clear(this.mount);
    if (this.viewer.role !== "tutor") {
      this.mount.appendChild(el("div", { class: "error" }, "Tutor only."));
      return;
    }
    this.mount.appendChild(
      el("div", { class: "section__head" }, [
        el("h1", {}, "Dashboard"),
        el("p", { class: "muted" }, "Lessons, hours, and who's paid. (Mark paid manually — no payments are processed.)"),
      ])
    );

    const toggle = el("div", { class: "week__nav" }, [
      this._rangeBtn("This week", "week"),
      this._rangeBtn("This month", "month"),
    ]);
    this.mount.appendChild(toggle);

    this.summary = el("div", { class: "dash__summary" });
    this.list = el("div", { class: "reqlist" });
    this.mount.appendChild(this.summary);
    this.mount.appendChild(this.list);
    await this._load();
  }

  _rangeBtn(label, range) {
    const b = el("button", { class: "btn btn--ghost btn--sm" + (this.range === range ? " is-active" : ""), type: "button" }, label);
    b.addEventListener("click", () => { this.range = range; this.render(); });
    return b;
  }

  _rangeBounds() {
    const now = new Date();
    if (this.range === "week") {
      const start = mondayOf(now);
      return [start, addDays(start, 7)];
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return [start, end];
  }

  async _load() {
    clear(this.summary);
    clear(this.list);
    this.list.appendChild(el("div", { class: "grid__loading" }, "Loading…"));
    const [start, end] = this._rangeBounds();
    let lessons;
    try {
      lessons = await this.provider.listLessonsInRange(start.toISOString(), end.toISOString());
      this._pay = await this.provider.getPaymentSettings();
    } catch (e) {
      clear(this.list);
      this.list.appendChild(el("div", { class: "error" }, e.message));
      return;
    }
    clear(this.list);

    if (!this._pay || !this._pay.payNowId) {
      this.summary.appendChild(el("p", { class: "muted dash__paynote" },
        "💡 Add your PayNow number in Manage → Payment to show a pay button on each lesson."));
    }

    // Summary stats.
    const totalMins = lessons.reduce((m, l) => m + (new Date(l.endISO) - new Date(l.startISO)) / 60000, 0);
    const hours = (totalMins / 60).toFixed(1).replace(/\.0$/, "");
    const unpaid = lessons.filter((l) => !l.paid).length;
    this.summary.appendChild(el("div", { class: "dash__stats" }, [
      this._stat(String(lessons.length), "lessons"),
      this._stat(hours, "hours"),
      this._stat(String(unpaid), "unpaid", unpaid > 0 ? "warn" : "ok"),
    ]));

    if (!lessons.length) {
      this.list.appendChild(el("div", { class: "grid__empty" }, "No lessons in this period."));
      return;
    }
    for (const l of lessons) this.list.appendChild(this._row(l));
  }

  _stat(value, label, tone) {
    return el("div", { class: "stat" + (tone ? " stat--" + tone : "") }, [
      el("div", { class: "stat__value" }, value),
      el("div", { class: "stat__label" }, label),
    ]);
  }

  _row(l) {
    const pill = el("button", {
      class: "paidpill " + (l.paid ? "paidpill--paid" : "paidpill--unpaid"),
      type: "button",
      title: "Click to toggle paid/unpaid",
    }, l.paid ? "Paid" : "Unpaid");
    pill.addEventListener("click", async () => {
      const next = !l.paid;
      pill.disabled = true;
      try {
        await this.provider.setLessonPaid(l.id, next);
        l.paid = next;
        pill.className = "paidpill " + (next ? "paidpill--paid" : "paidpill--unpaid");
        pill.textContent = next ? "Paid" : "Unpaid";
        pill.disabled = false;
        // refresh the unpaid count
        this._refreshUnpaidStat();
      } catch (e) {
        pill.disabled = false;
        toast(e.message, "error");
      }
    });

    // Rate-type-aware amount (hourly: hours×rate, else flat per-lesson rate).
    const amount = l.rateType === "hourly"
      ? lineAmount(durationHours(l.startISO, l.endISO), l.rate, "hourly")
      : (l.rate && l.rate > 0 ? l.rate : 0);

    const actions = [pill];
    // PayNow button (only when a number is set + the lesson isn't paid yet).
    if (this._pay && this._pay.payNowId && !l.paid) {
      actions.unshift(payNowButton("PayNow", () => ({
        payNowId: this._pay.payNowId,
        payeeName: this._pay.payeeName,
        amount,
        reference: `${l.studentName} ${fmtDate(l.startISO).replace(/^[A-Za-z]+,?\s*/, "")}`,
      })));
    }

    return el("div", { class: "req" }, [
      el("div", { class: "dash__row" }, [
        el("div", {}, [
          el("strong", {}, l.studentName),
          l.subject ? el("span", { class: "muted" }, ` · ${l.subject}`) : null,
          l.rate ? el("span", { class: "muted" }, ` · $${l.rate}${l.rateType === "hourly" ? "/hr" : ""}`) : null,
          (l.rateType === "hourly" && amount) ? el("span", { class: "muted" }, ` = $${amount.toFixed(2)}`) : null,
          el("div", { class: "req__meta muted" }, fmtDateTime(l.startISO)),
        ]),
        el("div", { class: "dash__actions" }, actions),
      ]),
    ]);
  }

  _refreshUnpaidStat() {
    // Cheap recompute from the DOM pills.
    const pills = [...this.list.querySelectorAll(".paidpill--unpaid")];
    const statEl = this.summary.querySelector(".stat--warn, .stat:nth-child(3)");
    if (statEl) {
      const v = statEl.querySelector(".stat__value");
      if (v) v.textContent = String(pills.length);
      statEl.classList.toggle("stat--warn", pills.length > 0);
      statEl.classList.toggle("stat--ok", pills.length === 0);
    }
  }
}
