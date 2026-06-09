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
- The **tutor** has an admin view: sees every lesson in full detail and
  **approves or declines** incoming requests.

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

### 3. Deploy rules + indexes

Install the Firebase CLI and deploy the rules and indexes in this repo:

```bash
npm install -g firebase-tools      # one-time
firebase login
firebase init firestore            # select your project; keep firestore.rules + firestore.indexes.json
firebase deploy --only firestore:rules,firestore:indexes
```

(`firestore.rules` and `firestore.indexes.json` are already written — point the
CLI at them.)

### 4. Provision your data (in the Firebase console)

These collections are **never** writable from the app — you set them up once:

- **`admins/{yourUid}`** — create an empty doc whose id is *your* Auth UID. Its
  existence makes you the tutor.
- **`users/{uid}`** for every person — fields:
  `role` (`"tutor"` or `"parent"`), `displayName`, `email`, and for parents
  `studentIds` (array of the student doc-ids they may see).
- **`students/{studentId}`** — `name`, and `parentUids` (array, used only as a
  query convenience).

Lessons are created by the app (the tutor adds them / approvals create them).
Each lesson is a `bookings/{id}` doc (`start`, `end`, `durationMins`, `status`,
`kind`) plus a `lessons/{id}` doc with the same id (`studentId`, `studentName`,
`subject`, `notes`, `start`, `end`, `status`).

### 5. Use it

Open the GitHub Pages URL with `?live=1` (or just open it — once the config is
real, live mode is the default). Parents sign in with the email/password you
created for them in Firebase Auth.

---

## Project layout

```
index.html                 single page, loads js/main.js (ES module)
firebase-config.js         PLACEHOLDER -> forces demo by default
firestore.rules            security rules (the anonymization guarantee)
firestore.indexes.json     composite indexes for the week queries
.github/workflows/deploy.yml  GitHub Pages deploy
css/app.css
js/
  main.js                  bootstrap: pick provider, wire auth -> shell -> router
  router.js                hash routes (#/week, #/requests)
  state.js                 shared viewer state
  util.js                  DOM + date/time helpers
  data/
    provider.js            DataProvider interface + typedefs
    index.js               provider selection (demo vs live)
    anonymize.js           shared pure projectLessonForViewer()
    mock-provider.js       in-memory demo backend
    mock-data.js           seed accounts/students/lessons/requests
    firebase-provider.js   live Firestore + Auth backend
  views/
    week-view.js           weekly calendar + request flows
    requests-view.js       request list / tutor approvals
    login-view.js          demo accounts / email+password
    components.js          shared render helpers (lesson block, modal, toast)
tests/
  selftest.html            in-browser privacy/behaviour self-tests
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
