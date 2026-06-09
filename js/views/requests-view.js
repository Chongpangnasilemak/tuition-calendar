// Requests view.
//   - Parent: a list of their OWN submitted requests with status.
//   - Tutor: ALL pending + resolved requests, with Approve / Decline buttons.

import { el, clear, fmtDateTime } from "../util.js";
import { statusPill, kindPill, toast } from "./components.js";

export class RequestsView {
  constructor(mount, provider, viewer) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = viewer;
  }

  async render() {
    clear(this.mount);
    const isTutor = this.viewer.role === "tutor";
    this.mount.appendChild(
      el("div", { class: "section__head" }, [
        el("h1", {}, isTutor ? "Incoming requests" : "My requests"),
        el(
          "p",
          { class: "muted" },
          isTutor
            ? "Approve or decline parents' reschedule and additional-lesson requests."
            : "Reschedule and additional-lesson requests you've submitted."
        ),
      ])
    );

    this.list = el("div", { class: "reqlist" });
    this.mount.appendChild(this.list);
    await this._load();
  }

  async _load() {
    clear(this.list);
    this.list.appendChild(el("div", { class: "grid__loading" }, "Loading requests…"));
    let reqs;
    try {
      reqs = await this.provider.listRequests();
    } catch (e) {
      clear(this.list);
      this.list.appendChild(el("div", { class: "error" }, `Could not load requests: ${e.message}`));
      return;
    }
    clear(this.list);

    if (!reqs.length) {
      this.list.appendChild(el("div", { class: "grid__empty" }, "No requests yet."));
      return;
    }
    const isTutor = this.viewer.role === "tutor";
    for (const r of reqs) this.list.appendChild(this._card(r, isTutor));
  }

  _card(r, isTutor) {
    const head = el("div", { class: "req__head" }, [
      kindPill(r.kind),
      statusPill(r.status),
    ]);

    const who = isTutor
      ? el("div", { class: "req__who" }, [
          el("strong", {}, r.studentName || r.studentId),
          el("span", { class: "muted" }, ` · from ${r.parentName || r.parentUid}`),
        ])
      : el("div", { class: "req__who" }, [el("strong", {}, r.studentName || r.studentId)]);

    const when = el("div", { class: "req__when" }, [
      el("span", { class: "muted" }, "Proposed: "),
      `${fmtDateTime(r.proposedStartISO)} – ${new Date(r.proposedEndISO).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    ]);

    const children = [head, who, when];
    if (r.note) children.push(el("div", { class: "req__note" }, `“${r.note}”`));
    children.push(el("div", { class: "req__meta muted" }, `Submitted ${fmtDateTime(r.createdISO)}`));

    if (isTutor && r.status === "pending") {
      const approve = el("button", { class: "btn btn--primary", type: "button" }, "Approve");
      const decline = el("button", { class: "btn btn--ghost", type: "button" }, "Decline");
      const resolve = async (action, btn) => {
        approve.disabled = decline.disabled = true;
        try {
          await this.provider.resolveRequest(r.id, action);
          toast(`Request ${action === "approve" ? "approved" : "declined"}.`, "success");
          await this._load();
        } catch (e) {
          approve.disabled = decline.disabled = false;
          toast(e.message, "error");
        }
      };
      approve.addEventListener("click", () => resolve("approve", approve));
      decline.addEventListener("click", () => resolve("decline", decline));
      children.push(el("div", { class: "req__actions" }, [approve, decline]));
    }

    return el("div", { class: `req req--${r.status}` }, children);
  }
}
