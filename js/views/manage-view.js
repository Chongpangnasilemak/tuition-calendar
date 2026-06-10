// Manage view (TUTOR only): roster + onboarding.
//   - Add a new student to the roster.
//   - Create a parent invite (email + which child) -> generates a code the
//     parent redeems to get linked. The parent never links themselves.
//   - See existing students and the status of invites.

import { el, clear, fmtDateTime } from "../util.js";
import { modal, toast } from "./components.js";

export class ManageView {
  constructor(mount, provider, viewer) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = viewer;
  }

  async render() {
    clear(this.mount);
    if (this.viewer.role !== "tutor") {
      this.mount.appendChild(el("div", { class: "error" }, "Tutor only."));
      return;
    }

    this.mount.appendChild(
      el("div", { class: "section__head" }, [
        el("h1", {}, "Manage"),
        el("p", { class: "muted" }, "Add students and invite parents to connect to their child."),
      ])
    );

    const actions = el("div", { class: "manage__actions" }, [
      el("button", { class: "btn btn--primary", type: "button", onClick: () => this._openAddStudent() }, "+ Add student"),
      el("button", { class: "btn", type: "button", onClick: () => this._openInvite() }, "✉ Invite a parent"),
    ]);
    this.mount.appendChild(actions);

    this.body = el("div", { class: "manage__body" });
    this.mount.appendChild(this.body);
    await this._load();
  }

  async _load() {
    clear(this.body);
    this.body.appendChild(el("div", { class: "grid__loading" }, "Loading…"));
    let students = [];
    let invites = [];
    let pay = { payNowId: "", payeeName: "" };
    try {
      [students, invites, pay] = await Promise.all([
        this.provider.listAllStudents(),
        this.provider.listInvites(),
        this.provider.getPaymentSettings().catch(() => ({ payNowId: "", payeeName: "" })),
      ]);
    } catch (e) {
      clear(this.body);
      this.body.appendChild(el("div", { class: "error" }, e.message));
      return;
    }
    clear(this.body);

    // Payment (PayNow) settings.
    this._renderPayment(pay);

    // Students (with per-lesson rate for PayNow).
    this.body.appendChild(el("h2", { class: "manage__h2" }, `Students (${students.length})`));
    if (!students.length) {
      this.body.appendChild(el("p", { class: "muted" }, "No students yet. Add your first one above."));
    } else {
      const list = el("div", { class: "stulist" });
      for (const s of students) list.appendChild(this._studentRow(s));
      this.body.appendChild(list);
    }

    // Invites
    this.body.appendChild(el("h2", { class: "manage__h2" }, `Parent invites (${invites.length})`));
    if (!invites.length) {
      this.body.appendChild(el("p", { class: "muted" }, "No invites yet."));
    } else {
      const list = el("div", { class: "reqlist" });
      for (const inv of invites) list.appendChild(this._inviteCard(inv));
      this.body.appendChild(list);
    }
  }

  _renderPayment(pay) {
    const id = el("input", { class: "field__input", type: "tel", placeholder: "e.g. 85182829 (PayNow mobile)", value: pay.payNowId || "" });
    const nm = el("input", { class: "field__input", type: "text", placeholder: "Payee name (shown on QR)", value: pay.payeeName || "" });
    const save = el("button", { class: "btn btn--primary btn--sm", type: "button" }, "Save");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await this.provider.savePaymentSettings({ payNowId: id.value.trim(), payeeName: nm.value.trim() });
        toast("Payment details saved.", "success");
        save.disabled = false;
      } catch (e) { save.disabled = false; toast(e.message, "error"); }
    });
    this.body.appendChild(el("div", { class: "paysettings" }, [
      el("h2", { class: "manage__h2" }, "Payment (PayNow / PayLah)"),
      el("p", { class: "muted" }, "Parents will see a PayNow QR for the lesson amount. Payment goes straight to your bank — you mark it Paid when it arrives."),
      el("div", { class: "form__row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "PayNow mobile / UEN"), id]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Payee name"), nm]),
      ]),
      el("div", { class: "paysettings__save" }, save),
    ]));
  }

  _studentRow(s) {
    const rate = el("input", { class: "field__input rateinput", type: "number", min: "0", step: "1", value: s.rate || 0, title: "Rate (SGD)" });
    const rtSel = el("select", { class: "field__input ratetype" }, [
      el("option", { value: "perLesson", ...(s.rateType !== "hourly" ? { selected: true } : {}) }, "/ lesson"),
      el("option", { value: "hourly", ...(s.rateType === "hourly" ? { selected: true } : {}) }, "/ hour"),
    ]);
    const save = async () => {
      try { await this.provider.setStudentRate(s.id, Number(rate.value) || 0, rtSel.value); toast(`${s.name}'s rate saved.`, "success"); }
      catch (e) { toast(e.message, "error"); }
    };
    let saveTimer = null;
    const debounced = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 50); };
    rate.addEventListener("change", debounced);
    rtSel.addEventListener("change", debounced);
    const del = el("button", { class: "chip__x", type: "button", title: `Remove ${s.name}` }, "×");
    del.addEventListener("click", async () => {
      if (!confirm(`Remove ${s.name}? This deletes their lessons and unlinks their parents. This can't be undone.`)) return;
      del.disabled = true;
      try {
        const res = await this.provider.removeStudent(s.id);
        toast(`Removed ${s.name}${res?.removedLessons ? ` and ${res.removedLessons} lesson(s)` : ""}.`, "success");
        this._load();
      } catch (e) { del.disabled = false; toast(e.message, "error"); }
    });
    return el("div", { class: "sturow" }, [
      el("span", { class: "sturow__name" }, s.name),
      el("span", { class: "sturow__rate" }, [el("span", { class: "muted" }, "$"), rate, rtSel]),
      del,
    ]);
  }

  _inviteCard(inv) {
    const code = el("code", { class: "invite__code" }, inv.code);
    const copy = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "Copy code");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(inv.code);
        toast("Code copied.", "success");
      } catch (_) {
        toast(`Code: ${inv.code}`, "info");
      }
    });

    return el("div", { class: `req req--${inv.status === "redeemed" ? "approved" : "pending"}` }, [
      el("div", { class: "req__head" }, [
        el("span", { class: "pill pill--kind" }, "Invite"),
        el("span", { class: `pill pill--${inv.status === "redeemed" ? "approved" : "pending"}` }, inv.status),
      ]),
      el("div", { class: "req__who" }, [
        el("strong", {}, inv.studentName),
        el("span", { class: "muted" }, ` · for ${inv.parentName || inv.parentEmail}`),
      ]),
      el("div", { class: "invite__row" }, [
        el("span", { class: "muted" }, "Code: "),
        code,
        copy,
      ]),
      el("div", { class: "req__meta muted" }, [
        `Email: ${inv.parentEmail} · created ${fmtDateTime(inv.createdISO)}`,
      ]),
      inv.status === "pending"
        ? el("p", { class: "muted invite__hint" }, "Ask the parent to sign in with this email and enter the code on their login screen.")
        : null,
    ]);
  }

  // --------------------------------------------------------------------- //
  _openAddStudent() {
    const name = el("input", { class: "field__input", type: "text", placeholder: "Student's name" });
    const subject = el("input", { class: "field__input", type: "text", placeholder: "Main subject (optional)" });
    const rate = el("input", { class: "field__input", type: "number", min: "0", step: "1", placeholder: "0", value: "" });
    const rtSel = el("select", { class: "field__input" }, [
      el("option", { value: "perLesson" }, "Per lesson"),
      el("option", { value: "hourly" }, "Per hour"),
    ]);
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Add student");

    const { close } = modal(
      "Add a student",
      [
        el("div", { class: "form" }, [
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Name"), name]),
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
          el("div", { class: "form__row" }, [
            el("label", { class: "field" }, [el("span", { class: "field__label" }, "Rate (SGD)"), rate]),
            el("label", { class: "field" }, [el("span", { class: "field__label" }, "Charged"), rtSel]),
          ]),
        ]),
      ],
      [submit]
    );
    submit.addEventListener("click", async () => {
      if (!name.value.trim()) {
        toast("Please enter a name.", "error");
        return;
      }
      submit.disabled = true;
      try {
        await this.provider.addStudent({ name: name.value.trim(), subject: subject.value.trim(), rate: Number(rate.value) || 0, rateType: rtSel.value });
        close();
        toast("Student added.", "success");
        this._load();
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  async _openInvite() {
    let students = [];
    try {
      students = await this.provider.listAllStudents();
    } catch (e) {
      toast(e.message, "error");
      return;
    }
    if (!students.length) {
      toast("Add a student first.", "error");
      return;
    }

    const select = el("select", { class: "field__input" },
      students.map((s) => el("option", { value: s.id }, s.name)));
    const email = el("input", { class: "field__input", type: "email", placeholder: "parent@example.com" });
    const pname = el("input", { class: "field__input", type: "text", placeholder: "Parent's name (optional)" });
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Create invite");

    const { close } = modal(
      "Invite a parent",
      [
        el("p", { class: "muted" }, "This creates a code that links the parent's login to this child. The parent enters it on their login screen."),
        el("div", { class: "form" }, [
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Child"), select]),
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Parent email"), email]),
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Parent name"), pname]),
        ]),
      ],
      [submit]
    );

    submit.addEventListener("click", async () => {
      if (!email.value.trim()) {
        toast("Please enter the parent's email.", "error");
        return;
      }
      submit.disabled = true;
      try {
        const inv = await this.provider.createInvite({
          studentId: select.value,
          parentEmail: email.value.trim(),
          parentName: pname.value.trim(),
        });
        close();
        this._showInviteCreated(inv);
        this._load();
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  _showInviteCreated(inv) {
    const code = el("div", { class: "invite__bigcode" }, inv.code);
    const copy = el("button", { class: "btn btn--primary", type: "button" }, "Copy code");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(inv.code);
        toast("Code copied.", "success");
      } catch (_) {
        toast(`Code: ${inv.code}`, "info");
      }
    });
    modal(
      "Invite created",
      [
        el("p", {}, [`Share this code with `, el("strong", {}, inv.parentName || inv.parentEmail), ` (for ${inv.studentName}):`]),
        code,
        el("p", { class: "muted" }, "They sign in with their email, then enter this code to connect to their child."),
      ],
      [copy]
    );
  }
}
