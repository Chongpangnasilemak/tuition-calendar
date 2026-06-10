// -----------------------------------------------------------------------------
// FirebaseProvider — LIVE backend (Firestore + Firebase Auth).
//
// The Firebase SDK is imported here ONLY (from the gstatic CDN as ES modules),
// so demo mode never downloads it. The anonymization guarantee is enforced
// STRUCTURALLY + by security rules, not by client filtering:
//
//   - getWeekSchedule for a PARENT runs TWO queries:
//       (a) ALL bookings in the week (public, time-only)  -> anonymous busy-blocks
//       (b) their own children's lessons in the week      -> full detail
//     then overlays (b) onto (a) by shared doc id. The parent literally cannot
//     read another student's /lessons doc (rules deny it), so no name can leak.
//   - getWeekSchedule for the TUTOR reads all /lessons directly (full detail).
//   - resolveRequest writes bookings+lessons+requests in ONE batch and, for a
//     reschedule, re-verifies lessons/{bookingId}.studentId === request.studentId
//     before moving the slot.
// -----------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

import { DataProvider } from "./provider.js";
import { expandRecurrence, wallClockShift, applyWallClockShift } from "./recurrence.js";

export class FirebaseProvider extends DataProvider {
  constructor(config) {
    super();
    this._config = config;
    this._app = null;
    this._auth = null;
    this._db = null;
    this._viewer = null; // cached Viewer for the signed-in user
    this._authCbs = new Set();
  }

  async init() {
    this._app = initializeApp(this._config);
    this._auth = getAuth(this._app);
    this._db = getFirestore(this._app);
    this._functions = getFunctions(this._app);

    // Complete any pending Google redirect sign-in from a previous page load.
    // (onAuthStateChanged below also picks up the restored session; this just
    // lets us swallow/observe redirect errors without crashing boot.)
    try { await getRedirectResult(this._auth); } catch (_) {}

    // Keep a Viewer in sync with auth + the user's /users doc + /admins marker.
    onAuthStateChanged(this._auth, async (fbUser) => {
      try {
        this._viewer = fbUser ? await this._loadViewer(fbUser) : null;
      } catch (e) {
        // NEVER bounce a signed-in user back to login just because a profile
        // read hiccupped. Fall back to a minimal parent viewer so they stay
        // logged in (a brand-new Google user with no users/ doc lands here).
        this._viewer = fbUser
          ? { uid: fbUser.uid, role: "parent", studentIds: [], displayName: fbUser.displayName || fbUser.email || "User" }
          : null;
      }
      for (const cb of this._authCbs) cb(this._viewer);
    });
  }

  async _loadViewer(fbUser) {
    const db = this._db;
    // Role/link come from /users/{uid}; tutor confirmed by /admins/{uid} OR the
    // tutor email allowlist (settings/tutors.emails). Read each independently so
    // one failing (e.g. a transient error) doesn't wipe out the whole viewer.
    let u = {};
    let isAdmin = false;
    let allowEmails = [];
    try {
      const userSnap = await getDoc(doc(db, "users", fbUser.uid));
      if (userSnap.exists()) u = userSnap.data();
    } catch (_) {}
    try {
      const adminSnap = await getDoc(doc(db, "admins", fbUser.uid));
      isAdmin = adminSnap.exists();
    } catch (_) {}
    try {
      const tSnap = await getDoc(doc(db, "settings", "tutors"));
      if (tSnap.exists() && Array.isArray(tSnap.data().emails)) allowEmails = tSnap.data().emails;
    } catch (_) {}
    const email = (fbUser.email || "").toLowerCase();
    const onAllowlist = !!email && allowEmails.includes(email);
    const isTutor = isAdmin || u.role === "tutor" || onAllowlist;
    return {
      uid: fbUser.uid,
      role: isTutor ? "tutor" : "parent",
      studentIds: Array.isArray(u.studentIds) ? u.studentIds : [],
      displayName: u.displayName || fbUser.displayName || fbUser.email || "User",
    };
  }

  // ---- auth ----
  async getCurrentUser() {
    return this._viewer;
  }

  onAuthChanged(cb) {
    this._authCbs.add(cb);
    cb(this._viewer);
    return () => this._authCbs.delete(cb);
  }

  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(this._auth, email, password);
    this._viewer = await this._loadViewer(cred.user);
    return this._viewer;
  }

  /**
   * Create a new parent account. The /users doc is created lazily on first
   * invite redemption (by the Cloud Function), so a fresh account simply has no
   * linked children until they redeem a code.
   */
  async signUp(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(this._auth, email, password);
    if (displayName && displayName.trim()) {
      try { await updateProfile(cred.user, { displayName: displayName.trim() }); } catch (_) {}
    }
    this._viewer = await this._loadViewer(cred.user);
    return this._viewer;
  }

  supportsGoogle() { return true; }

  /**
   * Sign in with Google using a POPUP.
   *
   * We deliberately use the popup, NOT signInWithRedirect: this app is hosted on
   * github.io while the Firebase auth handler lives on firebaseapp.com, so the
   * redirect flow's session can't persist back to our origin (modern browsers
   * block the cross-domain handler's third-party storage) — the user ends up
   * back on the login screen even though auth succeeded. The popup keeps the
   * session on our origin and works. If the popup is blocked, we fall back to a
   * redirect as a last resort. A brand-new Google user is just a parent with no
   * children until they redeem an invite code.
   */
  async signInWithGoogle() {
    const gp = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(this._auth, gp);
      this._viewer = await this._loadViewer(cred.user);
      return this._viewer;
    } catch (e) {
      const code = (e && e.code) || "";
      if (code.includes("popup-blocked") || code.includes("operation-not-supported")) {
        // Popup unavailable (e.g. some in-app browsers) -> redirect fallback.
        await signInWithRedirect(this._auth, gp);
        return null;
      }
      // popup-closed-by-user / cancelled -> surface a clean message to the caller.
      throw e;
    }
  }

  async signOut() {
    await signOut(this._auth);
    this._viewer = null;
  }

  // ---- students ----
  async listMyStudents() {
    const v = this._requireViewer();
    const db = this._db;
    if (v.role === "tutor") {
      const snap = await getDocs(collection(db, "students"));
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name, rate: d.data().rate || 0 }));
    }
    // Parent: read each linked student doc (rules allow own children).
    const out = [];
    for (const id of v.studentIds) {
      const s = await getDoc(doc(db, "students", id));
      if (s.exists()) out.push({ id, name: s.data().name, rate: s.data().rate || 0 });
    }
    return out;
  }

  // ---- schedule ----
  async getWeekSchedule(weekStartISO) {
    const v = this._requireViewer();
    const db = this._db;
    const start = new Date(weekStartISO);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60000);
    const tStart = Timestamp.fromDate(start);
    const tEnd = Timestamp.fromDate(end);

    if (v.role === "tutor") {
      // Tutor: full detail straight from /lessons.
      const q = query(
        collection(db, "lessons"),
        where("start", ">=", tStart),
        where("start", "<", tEnd)
      );
      const snap = await getDocs(q);
      const lessons = snap.docs
        .map((d) => this._lessonFull(d.id, d.data(), /*mine*/ false))
        .filter((l) => l._status === "booked")
        .map(strip)
        .sort((a, b) => a.startISO.localeCompare(b.startISO));
      return { weekStartISO: start.toISOString(), lessons };
    }

    // Parent: (a) all bookings (time only), (b) own children's lessons (detail).
    const bookingsSnap = await getDocs(
      query(
        collection(db, "bookings"),
        where("start", ">=", tStart),
        where("start", "<", tEnd)
      )
    );

    // Own children's lessons — Firestore 'in' supports up to 30 values.
    const ownLessons = new Map(); // bookingId -> data
    if (v.studentIds.length) {
      for (const chunk of chunk30(v.studentIds)) {
        const snap = await getDocs(
          query(
            collection(db, "lessons"),
            where("studentId", "in", chunk),
            where("start", ">=", tStart),
            where("start", "<", tEnd)
          )
        );
        snap.docs.forEach((d) => ownLessons.set(d.id, d.data()));
      }
    }

    const lessons = bookingsSnap.docs
      .filter((d) => (d.data().status || "booked") === "booked")
      .map((d) => {
        const id = d.id;
        const b = d.data();
        if (ownLessons.has(id)) {
          return strip(this._lessonFull(id, ownLessons.get(id), /*mine*/ true));
        }
        return {
          id,
          startISO: tsToISO(b.start),
          endISO: tsToISO(b.end),
          anonymous: true,
          mine: false,
        };
      })
      .sort((a, b) => a.startISO.localeCompare(b.startISO));

    return { weekStartISO: start.toISOString(), lessons };
  }

  _lessonFull(id, data, mine) {
    // `mine` is true only for a PARENT's own child (tutor all-view passes false).
    // The tutor always sees notes; a parent sees notes only if shared.
    const isParentView = mine;
    const notesVisible = !isParentView || data.shareNotes === true;
    return {
      id,
      startISO: tsToISO(data.start),
      endISO: tsToISO(data.end),
      anonymous: false,
      mine,
      studentId: data.studentId,
      studentName: data.studentName,
      subject: data.subject,
      notes: notesVisible ? (data.notes || "") : "",
      // tutor view: surface the share state so the toggle renders checked
      ...(!isParentView ? { shareNotes: data.shareNotes === true, paid: data.paid === true } : {}),
      ...(data.seriesId ? { seriesId: data.seriesId } : {}),
      _status: data.status || "booked",
    };
  }

  // ---- requests ----
  async listRequests() {
    const v = this._requireViewer();
    const db = this._db;
    let snap;
    if (v.role === "tutor") {
      snap = await getDocs(collection(db, "requests"));
    } else {
      snap = await getDocs(
        query(collection(db, "requests"), where("parentUid", "==", v.uid))
      );
    }
    const reqs = snap.docs.map((d) => this._reqOut(d.id, d.data()));

    // Resolve student/parent display names for the tutor view (best effort).
    if (v.role === "tutor") {
      for (const r of reqs) {
        r.studentName = await this._studentName(r.studentId);
        r.parentName = await this._userName(r.parentUid);
      }
    } else {
      for (const r of reqs) r.studentName = await this._studentName(r.studentId);
    }
    return reqs.sort((a, b) => b.createdISO.localeCompare(a.createdISO));
  }

  async createRequest(payload) {
    const v = this._requireViewer();
    if (v.role !== "parent") throw new Error("Only parents can submit requests.");
    const { kind, studentId, bookingId, proposedStartISO, proposedEndISO, note } =
      payload || {};
    if (!v.studentIds.includes(studentId))
      throw new Error("You can only request for your own child.");

    const base = {
      type: kind,
      status: "pending",
      parentUid: v.uid,
      studentId,
      proposedStart: Timestamp.fromDate(new Date(proposedStartISO)),
      proposedEnd: Timestamp.fromDate(new Date(proposedEndISO)),
      note: (note || "").trim(),
      createdAt: serverTimestamp(),
      resolvedAt: null,
    };
    if (kind === "reschedule") base.bookingId = bookingId;

    const ref = await addDoc(collection(this._db, "requests"), base);
    const snap = await getDoc(ref);
    const out = this._reqOut(ref.id, snap.data());
    out.studentName = await this._studentName(studentId);
    return out;
  }

  async resolveRequest(id, action) {
    const v = this._requireViewer();
    if (v.role !== "tutor") throw new Error("Only the tutor can resolve requests.");
    const db = this._db;
    const reqRef = doc(db, "requests", id);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error("Request not found.");
    const req = reqSnap.data();
    if (req.status !== "pending") throw new Error("Request already resolved.");

    if (action === "decline") {
      await updateDoc(reqRef, { status: "declined", resolvedAt: serverTimestamp() });
      const out = this._reqOut(id, { ...req, status: "declined" });
      out.studentName = await this._studentName(req.studentId);
      out.parentName = await this._userName(req.parentUid);
      return out;
    }

    // approve -> batch write so public + private layers never diverge.
    const batch = writeBatch(db);

    if (req.type === "reschedule") {
      const lessonRef = doc(db, "lessons", req.bookingId);
      const lessonSnap = await getDoc(lessonRef);
      // Re-verify the target booking still belongs to the request's student.
      if (!lessonSnap.exists() || lessonSnap.data().studentId !== req.studentId)
        throw new Error("Target booking no longer matches the request's student.");

      batch.update(doc(db, "bookings", req.bookingId), {
        start: req.proposedStart,
        end: req.proposedEnd,
      });
      batch.update(lessonRef, { start: req.proposedStart, end: req.proposedEnd });
    } else {
      // additional -> mint a new opaque booking id, write both layers.
      const newId = doc(collection(db, "bookings")).id;
      batch.set(doc(db, "bookings", newId), {
        start: req.proposedStart,
        end: req.proposedEnd,
        durationMins: Math.round(
          (req.proposedEnd.toMillis() - req.proposedStart.toMillis()) / 60000
        ),
        status: "booked",
        kind: "lesson",
      });
      batch.set(doc(db, "lessons", newId), {
        bookingId: newId,
        studentId: req.studentId,
        studentName: await this._studentName(req.studentId),
        subject: "Lesson",
        notes: "Added from parent request",
        start: req.proposedStart,
        end: req.proposedEnd,
        status: "booked",
      });
    }

    batch.update(reqRef, { status: "approved", resolvedAt: serverTimestamp() });
    await batch.commit();

    const out = this._reqOut(id, { ...req, status: "approved" });
    out.studentName = await this._studentName(req.studentId);
    out.parentName = await this._userName(req.parentUid);
    return out;
  }

  // ---- tutor: lesson management ----
  async addLesson({ studentId, startISO, endISO, subject, notes, recurrence, shareNotes }) {
    const v = this._requireTutor();
    const db = this._db;
    const s = await getDoc(doc(db, "students", studentId));
    if (!s.exists()) throw new Error("Unknown student.");
    if (!startISO || !endISO || endISO <= startISO)
      throw new Error("Invalid lesson time range.");

    const studentName = s.data().name;
    const subj = (subject || "Lesson").trim();
    const note = (notes || "").trim();
    const share = shareNotes === true;
    const occ = expandRecurrence(startISO, endISO, recurrence || null);
    const seriesId = occ.length > 1 ? "ser-" + doc(collection(db, "lessons")).id : null;

    // One booking (public, time only — NEVER seriesId) + one lesson (private,
    // carries seriesId) per occurrence, sharing an opaque id. Batched (<450 ops).
    const batch = writeBatch(db);
    let firstId = null;
    for (const o of occ) {
      const id = doc(collection(db, "bookings")).id;
      if (!firstId) firstId = id;
      const start = Timestamp.fromDate(new Date(o.startISO));
      const end = Timestamp.fromDate(new Date(o.endISO));
      batch.set(doc(db, "bookings", id), {
        start, end,
        durationMins: Math.round((end.toMillis() - start.toMillis()) / 60000),
        status: "booked",
        kind: "lesson",
      });
      batch.set(doc(db, "lessons", id), {
        bookingId: id,
        studentId,
        studentName,
        subject: subj,
        notes: note,
        shareNotes: share,
        paid: false,
        start, end,
        status: "booked",
        ...(seriesId ? { seriesId } : {}),
      });
    }
    await batch.commit();
    return {
      id: firstId, startISO: occ[0].startISO, endISO: occ[0].endISO,
      anonymous: false, mine: false, studentId, studentName, subject: subj, notes: note,
      ...(seriesId ? { seriesId } : {}),
    };
  }

  async updateLesson(id, patch = {}) {
    this._requireTutor();
    const db = this._db;
    const lessonRef = doc(db, "lessons", id);
    const snap = await getDoc(lessonRef);
    if (!snap.exists()) throw new Error("Lesson not found.");
    const cur = snap.data();

    const lessonPatch = {};
    const bookingPatch = {};
    if (patch.studentId && patch.studentId !== cur.studentId) {
      const s = await getDoc(doc(db, "students", patch.studentId));
      if (!s.exists()) throw new Error("Unknown student.");
      lessonPatch.studentId = patch.studentId;
      lessonPatch.studentName = s.data().name;
    }
    if (patch.startISO) {
      const t = Timestamp.fromDate(new Date(patch.startISO));
      lessonPatch.start = t; bookingPatch.start = t;
    }
    if (patch.endISO) {
      const t = Timestamp.fromDate(new Date(patch.endISO));
      lessonPatch.end = t; bookingPatch.end = t;
    }
    if (patch.subject != null) lessonPatch.subject = patch.subject.trim();
    if (patch.notes != null) lessonPatch.notes = patch.notes.trim();
    if (patch.shareNotes != null) lessonPatch.shareNotes = patch.shareNotes === true;
    if (patch.paid != null) lessonPatch.paid = patch.paid === true; // lessons-only flag

    const batch = writeBatch(db);
    if (Object.keys(lessonPatch).length) batch.update(lessonRef, lessonPatch);
    if (Object.keys(bookingPatch).length) batch.update(doc(db, "bookings", id), bookingPatch);
    await batch.commit();

    const after = { ...cur, ...lessonPatch };
    return this._lessonFull(id, after, false);
  }

  async cancelLesson(id) {
    this._requireTutor();
    const db = this._db;
    const batch = writeBatch(db);
    batch.delete(doc(db, "lessons", id));
    batch.delete(doc(db, "bookings", id));
    await batch.commit();
  }

  /** Resolve the lesson docs in a series (optionally from the clicked one onward). */
  async _seriesLessonDocs(clickedLesson, scope) {
    const db = this._db;
    if (!clickedLesson.seriesId || scope === "one") return null; // caller handles single
    // Composite index (seriesId, start) required — see firestore.indexes.json.
    let q;
    if (scope === "future") {
      q = query(
        collection(db, "lessons"),
        where("seriesId", "==", clickedLesson.seriesId),
        where("start", ">=", clickedLesson.start)
      );
    } else {
      q = query(collection(db, "lessons"), where("seriesId", "==", clickedLesson.seriesId));
    }
    const snap = await getDocs(q);
    return snap.docs;
  }

  async updateLessonSeries(id, patch = {}, scope = "one") {
    this._requireTutor();
    const db = this._db;
    const clickedSnap = await getDoc(doc(db, "lessons", id));
    if (!clickedSnap.exists()) throw new Error("Lesson not found.");
    const clicked = clickedSnap.data();
    if (scope === "one" || !clicked.seriesId) return this.updateLesson(id, patch);

    // Resolve student change + wall-clock time shifts from the clicked occurrence.
    let studentField = null;
    if (patch.studentId && patch.studentId !== clicked.studentId) {
      const s = await getDoc(doc(db, "students", patch.studentId));
      if (!s.exists()) throw new Error("Unknown student.");
      studentField = { studentId: patch.studentId, studentName: s.data().name };
    }
    const startShift = patch.startISO ? wallClockShift(tsToISO(clicked.start), patch.startISO) : null;
    const endShift = patch.endISO ? wallClockShift(tsToISO(clicked.end), patch.endISO) : null;

    const docs = await this._seriesLessonDocs(clicked, scope);
    const batch = writeBatch(db);
    for (const d of docs) {
      const data = d.data();
      const lessonPatch = {};
      const bookingPatch = {};
      if (studentField) Object.assign(lessonPatch, studentField);
      if (startShift) {
        const t = Timestamp.fromDate(new Date(applyWallClockShift(tsToISO(data.start), startShift)));
        lessonPatch.start = t; bookingPatch.start = t;
      }
      if (endShift) {
        const t = Timestamp.fromDate(new Date(applyWallClockShift(tsToISO(data.end), endShift)));
        lessonPatch.end = t; bookingPatch.end = t;
      }
      if (patch.subject != null) lessonPatch.subject = patch.subject.trim();
      if (patch.notes != null) lessonPatch.notes = patch.notes.trim();
      if (patch.shareNotes != null) lessonPatch.shareNotes = patch.shareNotes === true;
      if (Object.keys(lessonPatch).length) batch.update(doc(db, "lessons", d.id), lessonPatch);
      if (Object.keys(bookingPatch).length) batch.update(doc(db, "bookings", d.id), bookingPatch);
    }
    await batch.commit();
    const after = await getDoc(doc(db, "lessons", id));
    return this._lessonFull(id, after.exists() ? after.data() : clicked, false);
  }

  async cancelLessonSeries(id, scope = "one") {
    this._requireTutor();
    const db = this._db;
    const clickedSnap = await getDoc(doc(db, "lessons", id));
    if (!clickedSnap.exists()) throw new Error("Lesson not found.");
    const clicked = clickedSnap.data();
    if (scope === "one" || !clicked.seriesId) { await this.cancelLesson(id); return { removed: 1 }; }

    const docs = await this._seriesLessonDocs(clicked, scope);
    let removed = 0;
    // Each occurrence = 2 deletes; chunk to stay under the 500-op batch cap.
    for (let i = 0; i < docs.length; i += 200) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 200)) {
        batch.delete(doc(db, "lessons", d.id));
        batch.delete(doc(db, "bookings", d.id));
        removed++;
      }
      await batch.commit();
    }
    return { removed };
  }

  // ---- tutor: students & onboarding ----
  async listAllStudents() {
    this._requireTutor();
    const snap = await getDocs(collection(this._db, "students"));
    return snap.docs.map((d) => ({ id: d.id, name: d.data().name, rate: d.data().rate || 0 }));
  }

  async setStudentRate(id, rate) {
    this._requireTutor();
    await updateDoc(doc(this._db, "students", id), { rate: Number(rate) || 0 });
  }

  async getPaymentSettings() {
    this._requireViewer();
    try {
      const s = await getDoc(doc(this._db, "settings", "payment"));
      const d = s.exists() ? s.data() : {};
      return { payNowId: d.payNowId || "", payeeName: d.payeeName || "" };
    } catch (_) {
      return { payNowId: "", payeeName: "" };
    }
  }

  async savePaymentSettings({ payNowId, payeeName }) {
    this._requireTutor();
    const out = { payNowId: (payNowId || "").trim(), payeeName: (payeeName || "").trim() };
    await setDoc(doc(this._db, "settings", "payment"), out);
    return out;
  }

  async listLessonsInRange(startISO, endISO) {
    this._requireTutor();
    const db = this._db;
    // Student rates for the join.
    const studentsSnap = await getDocs(collection(db, "students"));
    const rates = {};
    studentsSnap.docs.forEach((d) => { rates[d.id] = d.data().rate || 0; });

    const snap = await getDocs(query(
      collection(db, "lessons"),
      where("start", ">=", Timestamp.fromDate(new Date(startISO))),
      where("start", "<", Timestamp.fromDate(new Date(endISO)))
    ));
    return snap.docs
      .map((d) => { const x = d.data(); return {
        id: d.id, startISO: tsToISO(x.start), endISO: tsToISO(x.end), studentId: x.studentId,
        studentName: x.studentName, subject: x.subject, paid: x.paid === true,
        rate: rates[x.studentId] || 0,
        _status: x.status || "booked",
      }; })
      .filter((l) => l._status === "booked")
      .sort((a, b) => a.startISO.localeCompare(b.startISO));
  }

  async setLessonPaid(id, paid) {
    this._requireTutor();
    await updateDoc(doc(this._db, "lessons", id), { paid: paid === true });
  }

  // ---- self-booking ----
  async listOpenSlots(startISO, endISO) {
    this._requireViewer();
    const db = this._db;
    const snap = await getDocs(query(
      collection(db, "openslots"),
      where("start", ">=", Timestamp.fromDate(new Date(startISO))),
      where("start", "<", Timestamp.fromDate(new Date(endISO)))
    ));
    return snap.docs
      .filter((d) => (d.data().status || "open") === "open")
      .map((d) => ({ id: d.id, startISO: tsToISO(d.data().start), endISO: tsToISO(d.data().end) }))
      .sort((a, b) => a.startISO.localeCompare(b.startISO));
  }

  async openSlot({ startISO, endISO }) {
    this._requireTutor();
    if (!startISO || !endISO || endISO <= startISO) throw new Error("Invalid slot time range.");
    const ref = doc(collection(this._db, "openslots"));
    await setDoc(ref, {
      start: Timestamp.fromDate(new Date(startISO)),
      end: Timestamp.fromDate(new Date(endISO)),
      status: "open",
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, startISO, endISO };
  }

  async removeOpenSlot(slotId) {
    this._requireTutor();
    await deleteDoc(doc(this._db, "openslots", slotId));
  }

  async bookOpenSlot(slotId, studentId, subject) {
    const v = this._requireViewer();
    if (v.role !== "parent") throw new Error("Only parents can book a slot.");
    if (!v.studentIds.includes(studentId)) throw new Error("You can only book for your own child.");
    const db = this._db;

    // Need the student's name (read outside the txn; immutable enough for demo scale).
    const sDoc = await getDoc(doc(db, "students", studentId));
    const studentName = sDoc.exists() ? sDoc.data().name : studentId;
    const newId = doc(collection(db, "bookings")).id; // shared id for booking+lesson

    // Transaction: claim the slot iff still open, then create booking+lesson.
    // A racing second booker sees status!='open' and throws -> no double-book.
    let slotStartISO, slotEndISO;
    await runTransaction(db, async (tx) => {
      const slotRef = doc(db, "openslots", slotId);
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists() || (slotSnap.data().status || "open") !== "open") {
        throw new Error("Sorry, that slot is no longer available.");
      }
      const slot = slotSnap.data();
      slotStartISO = tsToISO(slot.start);
      slotEndISO = tsToISO(slot.end);
      tx.update(slotRef, { status: "taken", takenBy: v.uid, takenStudentId: studentId });
      tx.set(doc(db, "bookings", newId), {
        start: slot.start, end: slot.end,
        durationMins: Math.round((slot.end.toMillis() - slot.start.toMillis()) / 60000),
        status: "booked", kind: "lesson",
      });
      tx.set(doc(db, "lessons", newId), {
        bookingId: newId, studentId, studentName,
        subject: (subject || "Lesson").trim(), notes: "", shareNotes: false, paid: false,
        start: slot.start, end: slot.end, status: "booked",
      });
    });

    return {
      id: newId, anonymous: false, mine: true, studentId, studentName,
      subject: (subject || "Lesson").trim(), notes: "",
      startISO: slotStartISO, endISO: slotEndISO,
    };
  }

  async addStudent({ name, subject, rate }) {
    this._requireTutor();
    const clean = (name || "").trim();
    if (!clean) throw new Error("Student name is required.");
    const ref = doc(collection(this._db, "students"));
    await setDoc(ref, {
      name: clean,
      subject: (subject || "").trim(),
      rate: Number(rate) || 0,
      parentUids: [],
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, name: clean, rate: Number(rate) || 0 };
  }

  async removeStudent(studentId) {
    this._requireTutor();
    const db = this._db;
    // Find this student's lessons (to delete them + their public bookings).
    const lessonSnap = await getDocs(
      query(collection(db, "lessons"), where("studentId", "==", studentId))
    );
    // Find pending invites for this student.
    const inviteSnap = await getDocs(
      query(collection(db, "invites"), where("studentId", "==", studentId))
    );

    // Firestore batches cap at 500 ops; chunk to be safe.
    const ops = [];
    lessonSnap.docs.forEach((d) => {
      ops.push(["lessons", d.id]);
      ops.push(["bookings", d.id]); // same id, 1:1
    });
    inviteSnap.docs.forEach((d) => ops.push(["invites", d.id]));
    ops.push(["students", studentId]);

    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(db);
      for (const [coll, id] of ops.slice(i, i + 450)) {
        batch.delete(doc(db, coll, id));
      }
      await batch.commit();
    }
    // Note: parents' users/{uid}.studentIds is NOT client-writable (trust
    // anchor), so a linked parent keeps a dangling id — harmless, since the
    // student doc and lessons are gone. A console/admin step can prune it.
    return { removedLessons: lessonSnap.size };
  }

  async createInvite({ studentId, parentEmail, parentName }) {
    const v = this._requireTutor();
    const db = this._db;
    const s = await getDoc(doc(db, "students", studentId));
    if (!s.exists()) throw new Error("Unknown student.");
    const email = (parentEmail || "").trim().toLowerCase();
    if (!email) throw new Error("Parent email is required.");

    const code = rcode();
    // Invite doc id == code (codes are unique enough for a solo tutor; the
    // Cloud Function enforces single-use on redeem).
    await setDoc(doc(db, "invites", code), {
      code,
      studentId,
      studentName: s.data().name,
      parentEmail: email,
      parentName: (parentName || "").trim(),
      status: "pending",
      tutorUid: v.uid,
      createdAt: serverTimestamp(),
    });
    return {
      code, studentId, studentName: s.data().name, parentEmail: email,
      parentName: (parentName || "").trim(), status: "pending",
      createdISO: new Date().toISOString(),
    };
  }

  async listInvites() {
    this._requireTutor();
    const snap = await getDocs(collection(this._db, "invites"));
    return snap.docs
      .map((d) => {
        const r = d.data();
        return {
          code: r.code || d.id,
          studentId: r.studentId,
          studentName: r.studentName,
          parentEmail: r.parentEmail,
          parentName: r.parentName || "",
          status: r.status || "pending",
          createdISO: tsToISO(r.createdAt) || new Date(0).toISOString(),
        };
      })
      .sort((a, b) => b.createdISO.localeCompare(a.createdISO));
  }

  async redeemInvite(code) {
    const v = this._requireViewer();
    if (v.role !== "parent")
      throw new Error("Only a parent account can redeem an invite.");
    // Linking writes users.studentIds, which is NOT client-writable by design.
    // A trusted Cloud Function performs the link after validating the invite.
    // On the free (Spark) plan the function isn't deployed, so this fails with a
    // clear message and the tutor links the parent from the Firebase console.
    const fn = httpsCallable(this._functions, "redeemInvite");
    let res;
    try {
      res = await fn({ code: (code || "").trim() });
    } catch (e) {
      const c = e && e.code ? String(e.code) : "";
      if (c.includes("not-found") || c.includes("internal") || c.includes("unavailable")) {
        throw new Error(
          "Self-serve invite codes aren't enabled on this project yet. Your tutor will connect your account to your child."
        );
      }
      throw new Error((e && e.message) || "Could not redeem invite.");
    }
    const data = res?.data || {};
    if (!data.studentId) throw new Error(data.error || "Invite could not be redeemed.");
    // Refresh the viewer so the new studentId is reflected immediately.
    if (this._auth.currentUser) {
      this._viewer = await this._loadViewer(this._auth.currentUser);
      for (const cb of this._authCbs) cb(this._viewer);
    }
    return { studentId: data.studentId, studentName: data.studentName || data.studentId };
  }

  _requireTutor() {
    const v = this._requireViewer();
    if (v.role !== "tutor") throw new Error("Tutor only.");
    return v;
  }

  // ---- helpers ----
  _reqOut(id, r) {
    return {
      id,
      kind: r.type,
      studentId: r.studentId,
      ...(r.bookingId ? { bookingId: r.bookingId } : {}),
      proposedStartISO: tsToISO(r.proposedStart),
      proposedEndISO: tsToISO(r.proposedEnd),
      parentUid: r.parentUid,
      status: r.status,
      createdISO: tsToISO(r.createdAt) || new Date(0).toISOString(),
      note: r.note || "",
    };
  }

  async _studentName(studentId) {
    try {
      const s = await getDoc(doc(this._db, "students", studentId));
      return s.exists() ? s.data().name : studentId;
    } catch (_) {
      return studentId;
    }
  }
  async _userName(uid) {
    try {
      const u = await getDoc(doc(this._db, "users", uid));
      return u.exists() ? u.data().displayName || uid : uid;
    } catch (_) {
      return uid;
    }
  }

  _requireViewer() {
    if (!this._viewer) throw new Error("Not signed in.");
    return this._viewer;
  }
}

// ---- module-local utilities ----
function tsToISO(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return null;
}
function strip(l) {
  // remove the internal _status marker before returning to the UI
  const { _status, ...rest } = l;
  return rest;
}
function* chunk30(arr) {
  for (let i = 0; i < arr.length; i += 30) yield arr.slice(i, i + 30);
}
function rcode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
