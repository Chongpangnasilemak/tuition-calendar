// Shared render helpers used by multiple views.
// (The week calendar renders its own positioned event blocks; these helpers
// cover requests, modals and toasts.)

import { el } from "../util.js";

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
