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
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

import { DataProvider } from "./provider.js";

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
      this._viewer = fbUser ? await this._loadViewer(fbUser) : null;
      for (const cb of this._authCbs) cb(this._viewer);
    });
  }

  async _loadViewer(fbUser) {
    const db = this._db;
    // Role/link come from /users/{uid}; tutor confirmed by /admins/{uid}.
    const [userSnap, adminSnap] = await Promise.all([
      getDoc(doc(db, "users", fbUser.uid)),
      getDoc(doc(db, "admins", fbUser.uid)),
    ]);
    const u = userSnap.exists() ? userSnap.data() : {};
    const isTutor = adminSnap.exists() || u.role === "tutor";
    return {
      uid: fbUser.uid,
      role: isTutor ? "tutor" : "parent",
      studentIds: Array.isArray(u.studentIds) ? u.studentIds : [],
      displayName: u.displayName || fbUser.email || "User",
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
   * Sign in with Google. Tries a popup; if the browser blocks it (common on
   * mobile) falls back to a full-page redirect. After sign-in a brand-new Google
   * user is just a parent with no children until they redeem an invite code —
   * same post-login path as email sign-up (onAuthStateChanged -> _loadViewer).
   */
  async signInWithGoogle() {
    const gp = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(this._auth, gp);
      this._viewer = await this._loadViewer(cred.user);
      return this._viewer;
    } catch (e) {
      const code = (e && e.code) || "";
      // Popup blocked / closed / unsupported -> use redirect. The result is
      // picked up by getRedirectResult() on the next page load (see init()).
      if (
        code.includes("popup-blocked") ||
        code.includes("popup-closed-by-user") ||
        code.includes("cancelled-popup-request") ||
        code.includes("operation-not-supported")
      ) {
        await signInWithRedirect(this._auth, gp);
        return null; // page will redirect; resolved after the round-trip
      }
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
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name }));
    }
    // Parent: read each linked student doc (rules allow own children).
    const out = [];
    for (const id of v.studentIds) {
      const s = await getDoc(doc(db, "students", id));
      if (s.exists()) out.push({ id, name: s.data().name });
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
    return {
      id,
      startISO: tsToISO(data.start),
      endISO: tsToISO(data.end),
      anonymous: false,
      mine,
      studentId: data.studentId,
      studentName: data.studentName,
      subject: data.subject,
      notes: data.notes,
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
  async addLesson({ studentId, startISO, endISO, subject, notes }) {
    const v = this._requireTutor();
    const db = this._db;
    const s = await getDoc(doc(db, "students", studentId));
    if (!s.exists()) throw new Error("Unknown student.");
    if (!startISO || !endISO || endISO <= startISO)
      throw new Error("Invalid lesson time range.");

    const id = doc(collection(db, "bookings")).id; // opaque shared id
    const start = Timestamp.fromDate(new Date(startISO));
    const end = Timestamp.fromDate(new Date(endISO));
    const batch = writeBatch(db);
    batch.set(doc(db, "bookings", id), {
      start, end,
      durationMins: Math.round((end.toMillis() - start.toMillis()) / 60000),
      status: "booked",
      kind: "lesson",
    });
    batch.set(doc(db, "lessons", id), {
      bookingId: id,
      studentId,
      studentName: s.data().name,
      subject: (subject || "Lesson").trim(),
      notes: (notes || "").trim(),
      start, end,
      status: "booked",
    });
    await batch.commit();
    return {
      id, startISO, endISO, anonymous: false, mine: false,
      studentId, studentName: s.data().name, subject: (subject || "Lesson").trim(),
      notes: (notes || "").trim(),
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

  // ---- tutor: students & onboarding ----
  async listAllStudents() {
    this._requireTutor();
    const snap = await getDocs(collection(this._db, "students"));
    return snap.docs.map((d) => ({ id: d.id, name: d.data().name }));
  }

  async addStudent({ name, subject }) {
    this._requireTutor();
    const clean = (name || "").trim();
    if (!clean) throw new Error("Student name is required.");
    const ref = doc(collection(this._db, "students"));
    await setDoc(ref, {
      name: clean,
      subject: (subject || "").trim(),
      parentUids: [],
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, name: clean };
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
