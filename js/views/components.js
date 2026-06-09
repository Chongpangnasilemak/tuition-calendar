// Shared render helpers used by multiple views.

import { el, fmtTimeRange } from "../util.js";

/**
 * Render a single lesson onto the calendar grid.
 *  - Own child / tutor view: full detail card (name, subject, notes).
 *  - Anonymous: a neutral "Busy" block with only the time. No identity exists
 *    on the object to leak.
 *
 * @param {import('../data/provider.js').Lesson} lesson
 * @param {{ onReschedule?: (lesson) => void }} [opts]
 */
export function lessonBlock(lesson, opts = {}) {
  if (lesson.anonymous) {
    return el("div", { class: "lesson lesson--busy", title: "Booked (another student)" }, [
      el("div", { class: "lesson__time" }, fmtTimeRange(lesson.startISO, lesson.endISO)),
      el("div", { class: "lesson__busy-label" }, "Busy"),
    ]);
  }

  const cls = lesson.mine ? "lesson lesson--mine" : "lesson lesson--detail";
  const children = [
    el("div", { class: "lesson__time" }, fmtTimeRange(lesson.startISO, lesson.endISO)),
    el("div", { class: "lesson__name" }, lesson.studentName),
  ];
  if (lesson.subject)
    children.push(el("div", { class: "lesson__subject" }, lesson.subject));
  if (lesson.notes) children.push(el("div", { class: "lesson__notes" }, lesson.notes));

  // A parent can propose a reschedule of their OWN child's lesson.
  if (lesson.mine && opts.onReschedule) {
    children.push(
      el(
        "button",
        {
          class: "lesson__action",
          type: "button",
          onClick: () => opts.onReschedule(lesson),
        },
        "Request reschedule"
      )
    );
  }

  return el("div", { class: cls }, children);
}

export function statusPill(status) {
  return el("span", { class: `pill pill--${status}` }, status);
}

export function kindPill(kind) {
  const label = kind === "reschedule" ? "Reschedule" : "Additional lesson";
  return el("span", { class: `pill pill--kind` }, label);
}

/** A lightweight modal. Returns { root, close }. */
export function modal(title, bodyNode, footerNodes = []) {
  const close = () => root.remove();
  const root = el("div", { class: "modal-backdrop", onClick: (e) => {
    if (e.target === root) close();
  } }, [
    el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modal__head" }, [
        el("h2", { class: "modal__title" }, title),
        el("button", { class: "modal__x", type: "button", onClick: close, "aria-label": "Close" }, "×"),
      ]),
      el("div", { class: "modal__body" }, bodyNode),
      el("div", { class: "modal__foot" }, footerNodes),
    ]),
  ]);
  document.body.appendChild(root);
  return { root, close };
}

export function toast(message, kind = "info") {
  const t = el("div", { class: `toast toast--${kind}` }, message);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("toast--show"), 10);
  setTimeout(() => {
    t.classList.remove("toast--show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}
