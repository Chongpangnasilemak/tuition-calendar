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
- The tutor can **add students** and **invite parents** (Manage tab): inviting
  generates a code the parent enters to connect to their child. The parent never
  links themselves — only a tutor-created invite can — which is what keeps the
  anonymization guarantee intact.

The calendar is a proper time-grid: each lesson sits at its real time and is
sized by its duration, so empty space is the tutor's free time. Parents see their
own child's lessons in blue and everyone else as grey "Busy" blocks.

It's a **static site** (plain HTML/CSS/JS, no build step) that runs two ways:

| Mode | Backend | When |
|---|---|---|
| **Demo** (default) | in-memory mock data | Local preview & the public GitHub Pages build. Nothing is saved; a reload resets it. |
| **Live** | Firebase (Firestore + Auth) | Your real schedule, shared across devices, requests saved. |

---

## Run it locally (demo mode)

No installs needed beyond Python (already on macOS):

```bash
cd tuition-calendar
python3 -m http.server 8765
# then open http://localhost:8765
```

Pick any demo account on the login screen:

- **Ms. Tutor (you)** — the admin view; approve/decline requests.
- **Parent A / B / C** — parent view; sees only that child plus anonymous
  "Busy" blocks. (Parent A and C are two parents of the *same* child, so you can
  see that co-parents don't see each other's private request notes.)

### Run the self-tests

`tests/selftest.html` drives the data layer and asserts the privacy invariants
(a parent never receives another student's name/notes). Open it in a browser
with the server running:

```
http://localhost:8765/tests/selftest.html
```

The page title becomes `SELFTEST_OK` and lists 22 passing checks.

---

## Publish to GitHub Pages (demo build)

The repo includes `.github/workflows/deploy.yml`, which publishes the site on
every push to `main`.

1. Create a GitHub repo and push this folder to it.
2. In the repo: **Settings → Pages → Build and deployment → Source = GitHub
   Actions**.
3. Push to `main`. The workflow deploys the site to
   `https://<you>.github.io/<repo>/`.

The committed `firebase-config.js` is a **placeholder**, so the public build
stays in safe **demo mode** — it never contacts a database.

---

## Go live with Firebase (real, shared data)

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

Replace the placeholder values in [`firebase-config.js`](firebase-config.js)
with your real config. (Firebase web config values are not secrets — they ship
to every browser; the security rules do the protecting. For a public repo,
prefer a **private fork** or injecting the values at deploy time.)

### 3. Deploy rules, indexes, and the Cloud Function

Install the Firebase CLI and deploy. The repo already contains `firestore.rules`,
`firestore.indexes.json`, `firebase.json`, and the `functions/` folder.

```bash
npm install -g firebase-tools      # one-time
firebase login
firebase use --add                 # select your project
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions
```

The **Cloud Function** (`functions/index.js`) does exactly one privileged thing:
`redeemInvite` links a parent to a student when they enter a valid invite code.
This is the *only* code that may write `users/{uid}.studentIds` — clients can't,
which is what stops a parent linking themselves to another child. (Deploying
functions needs the Blaze plan, but usage at this scale stays within the free
allowance. If you'd rather not deploy functions, you can do parent linking by
hand in the console instead — see step 4's note.)

### 4. Make yourself the tutor (one console step)

Just one thing must be set by hand, once:

- **`admins/{yourUid}`** — after you sign up / sign in once (Authentication →
  Users shows your UID), create an empty doc at `admins/<your-uid>` in Firestore.
  Its existence makes you the tutor.

That's it. **Everything else is done from the app:**

- Add students → **Manage → + Add student**
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
  selftest2.html           tutor + onboarding self-tests (19)
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
