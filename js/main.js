// App bootstrap: select the provider, wire auth -> shell -> router.

import { getProvider, getMode } from "./data/index.js";
import { state, setViewer } from "./state.js";
import { Router } from "./router.js";
import { LoginView } from "./views/login-view.js";
import { el, clear } from "./util.js";

const appEl = document.getElementById("app");
const headerEl = document.getElementById("app-header");
const bannerEl = document.getElementById("mode-banner");

async function boot() {
  let provider;
  try {
    provider = await getProvider();
  } catch (e) {
    appEl.appendChild(el("div", { class: "error" }, `Failed to start: ${e.message}`));
    return;
  }
  state.mode = getMode();

  // Demo banner.
  if (state.mode === "demo") {
    bannerEl.textContent = "DEMO MODE — data is not saved. Reload resets everything.";
    bannerEl.classList.add("banner--show");
  }

  const router = new Router(appEl, provider);

  // React to auth changes from the provider.
  provider.onAuthChanged((viewer) => {
    setViewer(viewer);
    router.setViewer(viewer);
    renderShell(provider, router, viewer);
    if (viewer) {
      // Default to the week view on (re)login.
      if (!location.hash) location.hash = "#/week";
      router.render();
    } else {
      showLogin(provider);
    }
  });
}

function renderShell(provider, router, viewer) {
  clear(headerEl);
  if (!viewer) {
    headerEl.classList.remove("topbar--show");
    return;
  }
  headerEl.classList.add("topbar--show");

  const nav = el("nav", { class: "topbar__nav" }, [
    navLink("#/week", "Calendar"),
    navLink("#/requests", viewer.role === "tutor" ? "Requests" : "My requests"),
  ]);

  const right = el("div", { class: "topbar__right" }, [
    el("span", { class: "topbar__user" }, [
      el("span", { class: `role-pill role-pill--${viewer.role}` }, viewer.role),
      el("span", {}, viewer.displayName),
    ]),
    el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => provider.signOut() }, "Sign out"),
  ]);

  headerEl.appendChild(
    el("div", { class: "topbar" }, [
      el("div", { class: "topbar__brand" }, "📅 Tuition Calendar"),
      nav,
      right,
    ])
  );
}

function navLink(hash, label) {
  const a = el("a", { class: "topbar__link", href: hash }, label);
  const mark = () => a.classList.toggle("is-active", (location.hash || "#/week").startsWith(hash));
  mark();
  window.addEventListener("hashchange", mark);
  return a;
}

function showLogin(provider) {
  clear(appEl);
  const view = new LoginView(appEl, provider, state.mode);
  view.render();
}

boot();
