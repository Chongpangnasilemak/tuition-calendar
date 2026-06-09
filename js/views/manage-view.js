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
    try {
      [students, invites] = await Promise.all([
        this.provider.listAllStudents(),
        this.provider.listInvites(),
      ]);
    } catch (e) {
      clear(this.body);
      this.body.appendChild(el("div", { class: "error" }, e.message));
      return;
    }
    clear(this.body);

    // Students
    this.body.appendChild(el("h2", { class: "manage__h2" }, `Students (${students.length})`));
    if (!students.length) {
      this.body.appendChild(el("p", { class: "muted" }, "No students yet. Add your first one above."));
    } else {
      this.body.appendChild(
        el("div", { class: "chips" }, students.map((s) => el("span", { class: "chip" }, s.name)))
      );
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
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Add student");

    const { close } = modal(
      "Add a student",
      [
        el("div", { class: "form" }, [
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Name"), name]),
          el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
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
        await this.provider.addStudent({ name: name.value.trim(), subject: subject.value.trim() });
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
