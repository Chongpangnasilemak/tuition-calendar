# 📅 Tuition Calendar

A scheduling calendar for a private tutor and their parents.

- **Parents** sign in and see **their own child's lessons** in full detail
  (time, subject, notes).
- They also see the tutor's **other booked slots — anonymously**: just a grey
  "Busy" block with the time. No other student's name, subject, or notes are
  ever revealed. This lets a parent see when you're free without learning who
  else you teach.
- Parents can **propose a reschedule** of their child's lesson, or **request an
  additional lesson** in a free slot.
- The **tutor** has an admin view: a full week **time-grid** (8am–9pm) where they
  can **add a lesson** (click an empty slot or the "+ Add lesson" button),
  **edit or cancel** any lesson, and **approve/decline** parent requests.
- The tutor can **add / remove students** and **invite parents** (Manage tab):
  inviting generates a code the parent enters to connect to their child. The
  parent never links themselves — only a tutor-created invite can — which is what
  keeps the anonymization guarantee intact. Removing a student deletes their
  lessons and unlinks their parents.

The calendar is a proper time-grid: each lesson sits at its real time and is
sized by its duration, so empty space is the tutor's free time. Parents see their
own child's lessons in blue and everyone else as grey "Busy" blocks.

It's a **static site** (plain HTML/CSS/JS, no build step) that runs two ways:

| Mode | Backend | When |
|---|---|---|
| **Live** (default) | Firebase (Firestore + Auth + Functions) | The real schedule, shared across devices, data saved. Selected automatically because `firebase-config.js` holds a real config. |
| **Demo** | in-memory mock data | Add `?demo=1` to the URL. Self-contained sandbox; changes persist in that browser (localStorage) until you Reset. |

> **This project is LIVE.** It's deployed to GitHub Pages and connected to the
> Firebase project **`tuition-calendar-670e3`**. Public URL:
> <https://chongpangnasilemak.github.io/tuition-calendar/>. To turn it back into
> a safe public demo, replace the `apiKey` in `firebase-config.js` with a
> `"DEMO_..."` placeholder.

---

## Run it locally

No installs needed beyond Python (already on macOS):

```bash
cd tuition-calendar
python3 -m http.server 8765
# Live mode (talks to the real Firebase project): http://localhost:8765
# Demo mode (offline sandbox):                    http://localhost:8765/?demo=1
```

`localhost` is an allowed referrer on the Firebase API key, so live mode works
locally too.

### Demo mode

Add `?demo=1`. Pick a quick demo account, or sign in/up with any email:

- **Ms. Tutor (you)** — the admin view; add/edit/cancel lessons, manage
  students, approve/decline requests.
- **Parent A / B / C** — parent view; sees only that child plus anonymous
  "Busy" blocks. (Parent A and C are two parents of the *same* child, so you can
  see that co-parents don't see each other's private request notes.)

Demo changes persist in the browser (localStorage). The banner has a **Reset
demo** button (or append `?reset=1`) to wipe back to the sample data.

### Run the self-tests

Open these in a browser with the server running; each sets its `<title>` to
`*_OK` and lists passing checks:

| File | Covers | Checks |
|---|---|---|
| `tests/selftest.html` | privacy invariants (a parent never receives another student's name/notes) | 22 |
| `tests/selftest2.html` | tutor lesson mgmt + onboarding + remove-student | 26 |
| `tests/selftest3.html` | demo localStorage persistence (invite survives reload) | 8 |
| `tests/rendertest.html` | time-grid structural render | — |

---

## Deployment

GitHub Pages auto-deploys on every push to `main` via
`.github/workflows/deploy.yml`. Firestore rules/indexes and the Cloud Function
are deployed with the Firebase CLI (see below) — those do **not** ship via Pages.

To set up Pages on a fresh repo: **Settings → Pages → Build and deployment →
Source = GitHub Actions**, then push to `main`.

---

## Firebase setup (how this project was wired — and how to redo it elsewhere)

The data model is designed so the **anonymization is enforced by the database
itself** (Firestore Security Rules), not just hidden in the UI. A parent using
the browser console cannot read another student's name.

**How it works:** every lesson is split into two records sharing one opaque id —
a **public `bookings`** doc (time/status only, *no* student id) that any signed-in
user may read, and a **private `lessons`** doc (name, subject, notes) that only
the linked parents and the tutor may read. The "who is my child" link lives only
in your own `users/{uid}.studentIds`, which is **not** client-writable — so a
parent can't add themselves to another child.

### 1. Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password →
   Enable.**
3. **Build → Firestore Database → Create database** (production mode).
4. **Project settings → Your apps → Web (`</>`)** → register an app → copy the
   `firebaseConfig` values.

### 2. Point the app at your project

Put your Web App config into [`firebase-config.js`](firebase-config.js) (this
repo already has the real `tuition-calendar-670e3` config committed). Firebase
web config values are **not secrets** — they ship to every browser; the security
rules do the protecting. GitHub may still flag the `apiKey` as a "secret" — that
is a known **false positive** for Firebase web keys; dismiss it. As defence in
depth, the key is restricted in Google Cloud to the GitHub Pages + localhost
referrers and to Firebase APIs only, so it's useless from any other site.

### 3. Deploy rules, indexes, and the Cloud Function

Install the Firebase CLI and deploy. The repo already contains `firestore.rules`,
`firestore.indexes.json`, `firebase.json`, and the `functions/` folder.

```bash
npm install -g firebase-tools      # one-time (needs Node; this Mac uses ~/.local/node)
firebase login
firebase use --add                 # select your project
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions
```

The **Cloud Function** (`functions/index.js`) does exactly one privileged thing:
`redeemInvite` links a parent to a student when they enter a valid invite code.
This is the *only* code that may write `users/{uid}.studentIds` — clients can't,
which is what stops a parent linking themselves to another child. **Deploying
functions requires the Blaze (pay-as-you-go) plan**, but usage at this scale
stays within the free allowance.

> ⚠️ **Gotcha — "Self-serve invite codes aren't enabled" after deploy.** A
> Gen-2 callable function runs on Cloud Run, which blocks the browser's call at
> its IAM gate *before* the function's own Firebase-Auth check runs. On a fresh
> project you must grant the underlying Run service the `allUsers` invoker role
> (Auth is still enforced inside the function). One-time fix:
> ```bash
> gcloud run services add-iam-policy-binding redeeminvite \
>   --region=us-central1 --member=allUsers --role=roles/run.invoker \
>   --project=tuition-calendar-670e3
> ```
> (Or do it via the Cloud Run console → the service → Permissions.)

> Prefer not to deploy the Cloud Function (e.g. staying on the free Spark plan)?
> Link parents by hand instead: in Firestore, add the student's id to that
> parent's `users/{uid}.studentIds`. The app shows a friendly "your tutor will
> connect your account" message when the function isn't deployed.

### 4. Enable Email/Password + make yourself the tutor

Two things must be set by hand, once (the CLI can't initialize Auth):

1. **Enable login** — Console → **Authentication → Get started → Sign-in method
   → Email/Password → Enable**. (Until this is done, sign-in throws
   `CONFIGURATION_NOT_FOUND`.)
2. **Become the tutor** — sign up once in the app, find your UID
   (Authentication → Users), then create an empty doc at `admins/<your-uid>` in
   Firestore *and* a `users/<your-uid>` doc with `role: "tutor"`. Its existence
   makes you the tutor.

That's it. **Everything else is done from the app:**

- Add / remove students → **Manage → + Add student** / the **×** on a chip.
- Onboard a parent → **Manage → ✉ Invite a parent** (gives you a code) → the
  parent signs up with their email and enters the code via **+ Connect child**.
- Add / edit / cancel lessons → the **Calendar** tab.

> Prefer not to deploy the Cloud Function? You can link a parent manually instead:
> in Firestore, add the student's id to that parent's `users/{uid}.studentIds`
> array. The in-app invite flow simply automates this securely.

**Data model reference** (created by the app): each lesson is a `bookings/{id}`
doc (`start`, `end`, `durationMins`, `status`, `kind` — *time only, no identity*)
plus a `lessons/{id}` doc with the same id (`studentId`, `studentName`, `subject`,
`notes`, `start`, `end`, `status`). Invites live in `invites/{code}`.

### 5. Use it

Open the GitHub Pages URL with `?live=1` (or just open it — once the config is
real, live mode is the default). You sign in, your parents sign in with their own
email/password, and onboarding happens through the invite flow above.

---

## Project layout

```
index.html                 single page, loads js/main.js (ES module)
firebase-config.js         PLACEHOLDER -> forces demo by default
firebase.json              Firebase CLI config (rules, indexes, functions)
firestore.rules            security rules (the anonymization guarantee)
firestore.indexes.json     composite indexes for the week queries
.github/workflows/deploy.yml  GitHub Pages deploy
css/app.css
functions/
  index.js                 Cloud Function: redeemInvite (secure parent linking)
  package.json
js/
  main.js                  bootstrap: provider, auth -> shell -> router, redeem
  router.js                hash routes (#/week, #/requests, #/manage)
  state.js                 shared viewer state
  util.js                  DOM + date/time helpers
  data/
    provider.js            DataProvider interface + typedefs
    index.js               provider selection (demo vs live)
    anonymize.js           shared pure projectLessonForViewer()
    mock-provider.js       in-memory demo backend (full tutor + onboarding)
    mock-data.js           seed accounts/students/lessons/requests
    firebase-provider.js   live Firestore + Auth + Functions backend
  views/
    week-view.js           time-grid calendar + request/add/edit/cancel flows
    requests-view.js       request list / tutor approvals
    manage-view.js         tutor: add student, invite parent, list (tutor only)
    login-view.js          demo accounts / email+password
    components.js          shared render helpers (modal, toast, pills)
tests/
  selftest.html            privacy/behaviour self-tests (22)
  selftest2.html           tutor + onboarding + remove-student self-tests (26)
  selftest3.html           demo localStorage persistence self-tests (8)
  rendertest.html          time-grid structural render check
```

## Security notes

- Anonymization is structural: the public `bookings` layer carries **no student
  identifier at all**, so anonymous slots can't be correlated or de-anonymized.
- The parent↔child link has a **single source of truth** (`users.studentIds`),
  is **not** client-writable, and is the only thing the rules trust.
- A parent can only create requests for their own child, can't resolve requests,
  and can't self-promote to tutor. On a reschedule **approval**, the tutor side
  re-verifies the target booking still belongs to the request's student.

See the header comment in `firestore.rules` for the full rationale.

> **Rules-are-not-filters note.** A list query is allowed only if its query
> constraints alone prove every returned doc satisfies the read rule. So the
> `requests` read rule is just `parentUid == uid()` (matching the client's
> `where("parentUid","==",uid)` query) — adding an `isParentOf(studentId)` check
> there would reject the whole query ("Missing or insufficient permissions").
> Likewise, parents must query `lessons` with `where("studentId","in",
> myStudentIds)`. Keep client queries and read rules aligned.
