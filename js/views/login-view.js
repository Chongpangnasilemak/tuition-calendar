// Login view.
//   - In DEMO mode: shows clickable demo accounts (tutor + parents) so anyone
//     can explore both sides instantly. Password is ignored.
//   - In LIVE mode: a plain email + password form (Firebase Auth).

import { el, clear } from "../util.js";
import { toast } from "./components.js";

export class LoginView {
  /**
   * @param {HTMLElement} mount
   * @param {import('../data/provider.js').DataProvider} provider
   * @param {'demo'|'live'} mode
   */
  constructor(mount, provider, mode) {
    this.mount = mount;
    this.provider = provider;
    this.mode = mode;
  }

  async render() {
    clear(this.mount);
    const card = el("div", { class: "login" }, [
      el("h1", { class: "login__title" }, "Tuition Calendar"),
      el(
        "p",
        { class: "muted login__sub" },
        this.mode === "demo"
          ? "Demo mode — pick an account to explore. No data is saved."
          : "Sign in to view your child's schedule."
      ),
    ]);

    if (this.mode === "demo") {
      card.appendChild(await this._demoAccounts());
    } else {
      card.appendChild(this._loginForm());
    }
    this.mount.appendChild(card);
  }

  async _demoAccounts() {
    const accounts =
      typeof this.provider.demoAccounts === "function"
        ? this.provider.demoAccounts()
        : [];
    const wrap = el("div", { class: "accounts" });
    for (const a of accounts) {
      const btn = el(
        "button",
        { class: `account account--${a.role}`, type: "button" },
        [
          el("span", { class: "account__role" }, a.role === "tutor" ? "TUTOR" : "PARENT"),
          el("span", { class: "account__name" }, a.displayName),
          el("span", { class: "account__email muted" }, a.email),
        ]
      );
      btn.addEventListener("click", async () => {
        try {
          await this.provider.signIn(a.email, "demo");
        } catch (e) {
          toast(e.message, "error");
        }
      });
      wrap.appendChild(btn);
    }
    wrap.appendChild(
      el("p", { class: "muted accounts__hint" }, [
        "Sign in as the ",
        el("strong", {}, "tutor"),
        " to approve requests, or as a ",
        el("strong", {}, "parent"),
        " to see only your child plus anonymous busy-blocks.",
      ])
    );
    return wrap;
  }

  _loginForm() {
    const email = el("input", { class: "field__input", type: "email", placeholder: "you@example.com", autocomplete: "username" });
    const pass = el("input", { class: "field__input", type: "password", placeholder: "Password", autocomplete: "current-password" });
    const submit = el("button", { class: "btn btn--primary btn--block", type: "submit" }, "Sign in");

    const form = el("form", { class: "form" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Email"), email]),
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Password"), pass]),
      submit,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await this.provider.signIn(email.value, pass.value);
      } catch (err) {
        toast(err.message || "Sign-in failed.", "error");
        submit.disabled = false;
      }
    });
    return form;
  }
}
