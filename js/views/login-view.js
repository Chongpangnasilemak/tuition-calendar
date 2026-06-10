// Login view.
//   - DEMO mode: quick-access demo account buttons (instant explore) PLUS an
//     email box so an invited/new parent can sign in or sign up by email.
//   - LIVE mode: an email + password form with a Sign in / Create account
//     toggle, so a brand-new parent can create their account, then connect to
//     their child with the invite code their tutor gave them.

import { el, clear } from "../util.js";
import { toast } from "./components.js";

/**
 * Lightweight password strength heuristic (no library). Returns a 0..4 score,
 * a label, and a fill percentage for the meter. Not security-grade, just
 * helpful guidance to nudge parents away from weak passwords.
 */
function scorePassword(pw) {
  const p = pw || "";
  let s = 0;
  if (p.length >= 6) s++;
  if (p.length >= 10) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  // common-weak penalty
  if (/^(password|123456|qwerty|111111|abc123)/i.test(p)) s = 0;
  s = Math.max(0, Math.min(4, s));
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score: s, label: labels[s], pct: (s / 4) * 100 };
}

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
    this.signupMode = false; // live: toggle between sign in / create account
  }

  async render() {
    clear(this.mount);
    const card = el("div", { class: "login" }, [
      el("h1", { class: "login__title" }, "Tuition Calendar"),
      el(
        "p",
        { class: "muted login__sub" },
        this.mode === "demo"
          ? "Demo mode — explore as anyone. No data is saved."
          : "Sign in, or create an account and connect to your child with your invite code."
      ),
    ]);

    if (this.mode === "demo") {
      card.appendChild(await this._demoAccounts());
      card.appendChild(el("div", { class: "login__divider" }, "or sign in with email"));
      card.appendChild(this._emailForm());
    } else {
      card.appendChild(this._liveForm());
    }
    this.mount.appendChild(card);
  }

  async _demoAccounts() {
    const accounts =
      typeof this.provider.demoAccounts === "function"
        ? this.provider.demoAccounts()
        : [];
    const wrap = el("div", { class: "accounts" });
    wrap.appendChild(el("p", { class: "accounts__label muted" }, "Quick demo accounts"));
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
    return wrap;
  }

  /** DEMO: email box that signs in if the account exists, else creates a parent. */
  _emailForm() {
    const email = el("input", { class: "field__input", type: "email", placeholder: "you@example.com", autocomplete: "username" });
    const submit = el("button", { class: "btn btn--primary btn--block", type: "submit" }, "Sign in / Sign up");

    const form = el("form", { class: "form" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Email"), email]),
      submit,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = email.value.trim();
      if (!v) {
        toast("Enter your email.", "error");
        return;
      }
      submit.disabled = true;
      try {
        // In demo, signUp signs in if the account already exists, else creates a
        // new parent. (Tutor uses the quick button above.)
        await this.provider.signUp(v, "demo");
      } catch (err) {
        toast(err.message || "Could not sign in.", "error");
        submit.disabled = false;
      }
    });
    form.appendChild(
      el("p", { class: "muted accounts__hint" },
        "New parent? Enter the email your tutor invited, then use “+ Connect child” with your code.")
    );
    return form;
  }

  /** LIVE: email + password with a Sign in / Create account toggle. */
  _liveForm() {
    const wrap = el("div", {});

    const renderForm = () => {
      clear(wrap);
      const isSignup = this.signupMode;
      const name = el("input", { class: "field__input", type: "text", placeholder: "Your name", autocomplete: "name" });
      const email = el("input", { class: "field__input", type: "email", placeholder: "you@example.com", autocomplete: "username" });
      const pass = el("input", { class: "field__input", type: "password", placeholder: "Password", autocomplete: isSignup ? "new-password" : "current-password" });
      const submit = el("button", { class: "btn btn--primary btn--block", type: "submit" }, isSignup ? "Create account" : "Sign in");

      // "Continue with Google" (live mode only) — fastest path, no password.
      if (this.provider.supportsGoogle && this.provider.supportsGoogle()) {
        const gbtn = el("button", { class: "btn btn--google btn--block", type: "button" }, [
          el("span", { class: "btn__gicon", "aria-hidden": "true" }, "G"),
          "Continue with Google",
        ]);
        gbtn.addEventListener("click", async () => {
          gbtn.disabled = true;
          try {
            await this.provider.signInWithGoogle();
            // On success, onAuthChanged re-renders. On redirect, the page reloads.
          } catch (err) {
            gbtn.disabled = false;
            toast(this._friendly(err), "error");
          }
        });
        wrap.appendChild(gbtn);
        wrap.appendChild(el("div", { class: "login__divider" }, "or with email"));
      }

      // Sign-up extras: a strength meter + a confirm-password field so a typo
      // can't silently lock a new parent out of their account.
      const confirm = el("input", { class: "field__input", type: "password", placeholder: "Re-enter password", autocomplete: "new-password" });
      const meterBar = el("div", { class: "pwmeter__bar" });
      const meterLabel = el("span", { class: "pwmeter__label muted" }, "");
      const meter = el("div", { class: "pwmeter" }, [el("div", { class: "pwmeter__track" }, meterBar), meterLabel]);
      const matchMsg = el("div", { class: "pwmatch muted" }, "");

      const refreshStrength = () => {
        const { score, label, pct } = scorePassword(pass.value);
        meterBar.style.width = pct + "%";
        meterBar.className = "pwmeter__bar pwmeter__bar--" + score;
        meterLabel.textContent = pass.value ? label : "";
      };
      const refreshMatch = () => {
        if (!confirm.value) { matchMsg.textContent = ""; matchMsg.className = "pwmatch muted"; return; }
        const ok = confirm.value === pass.value;
        matchMsg.textContent = ok ? "✓ Passwords match" : "✗ Passwords don't match";
        matchMsg.className = "pwmatch " + (ok ? "pwmatch--ok" : "pwmatch--bad");
      };
      pass.addEventListener("input", () => { refreshStrength(); refreshMatch(); });
      confirm.addEventListener("input", refreshMatch);

      const fields = [];
      if (isSignup) fields.push(el("label", { class: "field" }, [el("span", { class: "field__label" }, "Name"), name]));
      fields.push(el("label", { class: "field" }, [el("span", { class: "field__label" }, "Email"), email]));
      fields.push(el("label", { class: "field" }, [el("span", { class: "field__label" }, "Password"), pass]));
      if (isSignup) {
        fields.push(meter);
        fields.push(el("label", { class: "field" }, [el("span", { class: "field__label" }, "Confirm password"), confirm]));
        fields.push(matchMsg);
      }
      fields.push(submit);

      const form = el("form", { class: "form" }, fields);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!email.value.trim() || !pass.value) {
          toast("Enter your email and password.", "error");
          return;
        }
        if (isSignup) {
          if (pass.value.length < 6) { toast("Password should be at least 6 characters.", "error"); return; }
          if (pass.value !== confirm.value) { toast("Passwords don't match — please re-enter.", "error"); confirm.focus(); return; }
          if (scorePassword(pass.value).score < 1) { toast("Please choose a slightly stronger password.", "error"); return; }
        }
        submit.disabled = true;
        try {
          if (isSignup) await this.provider.signUp(email.value.trim(), pass.value, name.value.trim());
          else await this.provider.signIn(email.value.trim(), pass.value);
        } catch (err) {
          toast(this._friendly(err), "error");
          submit.disabled = false;
        }
      });
      wrap.appendChild(form);

      const toggle = el("button", { class: "linkbtn", type: "button" },
        isSignup ? "Already have an account? Sign in" : "New parent? Create an account");
      toggle.addEventListener("click", () => {
        this.signupMode = !this.signupMode;
        renderForm();
      });
      wrap.appendChild(el("p", { class: "login__toggle" }, toggle));
    };

    renderForm();
    return wrap;
  }

  _friendly(err) {
    const code = (err && err.code) || "";
    if (code.includes("email-already-in-use")) return "That email already has an account — try Sign in.";
    if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Wrong email or password.";
    if (code.includes("user-not-found")) return "No account with that email — try Create an account.";
    if (code.includes("weak-password")) return "Password should be at least 6 characters.";
    if (code.includes("invalid-email")) return "That doesn't look like a valid email.";
    if (code.includes("account-exists-with-different-credential"))
      return "You already have an account with that email — sign in with your password instead.";
    if (code.includes("unauthorized-domain"))
      return "This site isn't authorized for Google sign-in yet (add it in Firebase Auth settings).";
    if (code.includes("operation-not-allowed"))
      return "Google sign-in isn't enabled on this project yet.";
    return (err && err.message) || "Sign-in failed.";
  }
}
