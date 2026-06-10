// App bootstrap: select the provider, wire auth -> shell -> router.

import { getProvider, getMode } from "./data/index.js";
import { state, setViewer } from "./state.js";
import { Router } from "./router.js";
import { LoginView } from "./views/login-view.js";
import { modal, toast } from "./views/components.js";
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
    // ?reset=1 wipes persisted demo data back to the sample set. Runs before
    // onAuthChanged is wired below; the later registration renders the result
    // (resetDemo sets current=null, so the initial fire lands on login).
    const params = new URLSearchParams(location.search);
    if (params.get("reset") === "1" && typeof provider.resetDemo === "function") {
      await provider.resetDemo();
      params.delete("reset");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }

    bannerEl.textContent = "DEMO MODE — your changes are saved in this browser. ";
    if (typeof provider.resetDemo === "function") {
      const resetBtn = el(
        "button",
        {
          class: "banner__reset",
          type: "button",
          onClick: async () => {
            if (confirm("Reset the demo to its original sample data? This clears everything you've added in this browser.")) {
              await provider.resetDemo();
              location.hash = "";
              location.reload();
            }
          },
        },
        "Reset demo"
      );
      bannerEl.appendChild(resetBtn);
    }
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

  const navItems = [
    navLink("#/week", "Calendar"),
    navLink("#/requests", viewer.role === "tutor" ? "Requests" : "My requests"),
    navLink("#/invoices", "Invoices"),
  ];
  if (viewer.role === "tutor") {
    navItems.push(navLink("#/dashboard", "Dashboard"));
    navItems.push(navLink("#/manage", "Manage"));
  }
  const nav = el("nav", { class: "topbar__nav" }, navItems);

  const rightItems = [
    el("span", { class: "topbar__user" }, [
      el("span", { class: `role-pill role-pill--${viewer.role}` }, viewer.role),
      el("span", {}, viewer.displayName),
    ]),
  ];
  // Parents can connect to a child via an invite code from the tutor.
  if (viewer.role === "parent") {
    rightItems.unshift(
      el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => openRedeem(provider) }, "+ Connect child")
    );
  }
  rightItems.push(
    el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => provider.signOut() }, "Sign out")
  );
  const right = el("div", { class: "topbar__right" }, rightItems);

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

/** Parent redeems an invite code to connect to their child. */
function openRedeem(provider) {
  const code = el("input", { class: "field__input", type: "text", placeholder: "e.g. ABC123", autocapitalize: "characters" });
  const submit = el("button", { class: "btn btn--primary", type: "button" }, "Connect");
  const { close } = modal(
    "Connect to your child",
    [
      el("p", { class: "muted" }, "Enter the invite code your tutor gave you. It links your account to your child's schedule."),
      el("div", { class: "form" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Invite code"), code]),
      ]),
    ],
    [submit]
  );
  submit.addEventListener("click", async () => {
    if (!code.value.trim()) {
      toast("Please enter your invite code.", "error");
      return;
    }
    submit.disabled = true;
    try {
      const res = await provider.redeemInvite(code.value.trim());
      close();
      toast(`Connected to ${res.studentName}.`, "success");
      // The provider emits an auth change (studentIds updated) -> the shell
      // re-renders automatically.
    } catch (e) {
      submit.disabled = false;
      toast(e.message, "error");
    }
  });
}

boot();
