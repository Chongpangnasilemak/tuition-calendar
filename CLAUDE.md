# CLAUDE.md — working notes for this repo

Operational context for AI assistants working on the Tuition Calendar. Read this
before making changes. See `README.md` for the product/setup overview.

## What this is
A static (no-build) tutor scheduling web app. Vanilla JS ES modules, served as
files. Two backends behind one `DataProvider` interface (`js/data/provider.js`):
- `MockProvider` (`js/data/mock-provider.js`) — demo mode, in-memory + localStorage.
- `FirebaseProvider` (`js/data/firebase-provider.js`) — live Firestore + Auth + Functions.
`js/data/index.js` picks one: real `firebase-config.js` ⇒ live (default);
`?demo=1` ⇒ mock. Anonymization is shared/pure in `js/data/anonymize.js`.

## Live deployment (this is a LIVE project)
- Firebase project: **`tuition-calendar-670e3`** (Blaze plan).
- Public URL: https://chongpangnasilemak.github.io/tuition-calendar/ (GitHub Pages,
  auto-deploys on push to `main` via `.github/workflows/deploy.yml`).
- GitHub repo: `Chongpangnasilemak/tuition-calendar` (public).
- Owner/tutor account: `engchongyock@gmail.com`. Test tutor:
  `tutor.test@tuition-calendar.app` / `TestTutor#2026`.
- The committed `firebase-config.js` holds the REAL web config. The apiKey is
  public-by-design (restricted in GCP to github.io + localhost referrers). Any
  GitHub "secret detected" alert on it is a false positive — do not panic-rotate.

## Environment quirks (this Mac)
- **No Homebrew, no system Node.** Node 20 was installed to `~/.local/node`
  (added to `~/.zshrc`). Firebase CLI is there too. In scripts:
  `export PATH="$HOME/.local/node/bin:$PATH"`.
- The Bash tool is **non-interactive**: `firebase login` must be run by the user
  in their own Terminal. Other firebase/gcloud calls work with the cached token.
- `firebase` access token for raw REST calls:
  `cat ~/.config/configstore/firebase-tools.json | python3 -c "import sys,json;print(json.load(sys.stdin)['tokens']['access_token'])"`.
- zsh: `$UID` is read-only; don't use it as a var. URL-encode `(default)` as
  `%28default%29` in Firestore REST URLs. Pipe-to-`while read` loses PATH — use
  `/usr/bin/curl` or avoid subshells.

## Testing (headless Chrome, no Node test runner)
Chrome is at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
Serve with `python3 -m http.server 8765`, then:
```
"$CHROME" --headless=new --disable-gpu --no-sandbox --user-data-dir=$(mktemp -d) \
  --virtual-time-budget=9000 --dump-dom "http://localhost:8765/tests/<file>" 
```
Parse the dumped DOM with python (regex + html.unescape); each test sets
`<title>` to `*_OK`/`*_FAIL`. Don't run two Chrome instances in one bash command
(they race on the dump file). Tests: `selftest.html` (22), `selftest2.html` (26),
`selftest3.html` (8), `rendertest.html`. Exit 137/143/144 from a killed Chrome
(e.g. after `pkill http.server`) is harmless.

## Deploying
```
export PATH="$HOME/.local/node/bin:$PATH"
firebase deploy --only firestore:rules,firestore:indexes --project tuition-calendar-670e3
firebase deploy --only functions --project tuition-calendar-670e3   # needs functions/node_modules
```
GitHub Pages deploys automatically on `git push origin main`.

## Hard-won gotchas (don't re-debug these)
1. **Gen-2 callable functions are blocked by Cloud Run's IAM gate** until
   `allUsers` has `roles/run.invoker` on the Run service. Symptom: client gets
   "Self-serve invite codes aren't enabled" / logs show "Empty Authorization
   header". Firebase Auth is still enforced *inside* the function. Fix:
   `gcloud run services add-iam-policy-binding redeeminvite --region=us-central1 --member=allUsers --role=roles/run.invoker --project=tuition-calendar-670e3`.
2. **Rules are not filters.** A list query is allowed only if its constraints
   alone prove every doc passes the read rule. The `requests` read rule must be
   exactly `parentUid == uid()` (no extra `isParentOf` check) to match the
   client's `where("parentUid","==",uid)` query. Parents query `lessons` with
   `where("studentId","in",myStudentIds)`. Keep queries and rules aligned.
3. **Auth must be initialized in the console once** (Email/Password enabled) or
   sign-in throws `CONFIGURATION_NOT_FOUND` — the CLI can't do it.
4. **`users` docs are never client-writable** (trust anchor). The Cloud Function
   (`redeemInvite`, Admin SDK) is the only writer of `users.studentIds`. So
   `removeStudent` from the client can't prune a parent's `studentIds` — it
   leaves a harmless dangling id (the student/lessons are gone).
5. Functions deploy on a fresh Blaze project may fail the first build with a
   build-service-account permission error; retry ~75s later (APIs just enabled).

## Firestore data model (see firestore.rules header for the why)
- `admins/{uid}` — existence ⇒ tutor (console-created, never client-writable).
- `users/{uid}` — role + `studentIds` (parent↔child trust anchor; not client-writable).
- `students/{id}` — name/subject (tutor-writable).
- `bookings/{id}` — PUBLIC, time/status only, NO student identity (anonymous busy blocks).
- `lessons/{id}` — PRIVATE detail, same id as its booking; gated by `isParentOf(studentId)`.
- `requests/{id}` — parent reschedule/additional requests; tutor resolves.
- `invites/{code}` — tutor-created; redeemed via the Cloud Function only.

## Conventions
- Match existing style: vanilla JS, the `el()` helper in `js/util.js`, no deps.
- Any new mutating MockProvider method must call `this._save()` before returning
  (persistence) and `this._emit()` if auth/viewer state changed.
- When adding a DataProvider method, implement it in BOTH providers + the base
  class, and add coverage to the relevant `tests/selftest*.html`.
- Only commit/push when the user asks. End commit messages with the Co-Authored-By line.
