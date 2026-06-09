// -----------------------------------------------------------------------------
// MockProvider — in-memory DEMO MODE backend.
//
// Reproduces the SAME guarantees the Firebase security rules enforce:
//   - getWeekSchedule routes every lesson through projectLessonForViewer, so a
//     parent only ever receives full detail for their own child; everyone else
//     is an anonymous busy-block.
//   - listRequests returns a parent only their OWN (author) requests; the tutor
//     sees all.
//   - createRequest is parent-only and only for the parent's own child.
//   - resolveRequest is tutor-only and, for a reschedule approval, re-verifies
//     the target booking belongs to the request's student before moving it.
//
// No persistence: a page reload resets to the seed data. A simple "switch user"
// affordance lets the demo log in as the tutor or different parents.
// -----------------------------------------------------------------------------

import { DataProvider } from "./provider.js";
import { projectLessonForViewer } from "./anonymize.js";
import {
  USERS,
  STUDENTS,
  buildLessons,
  buildRequests,
} from "./mock-data.js";

const LAST_USER_KEY = "tuition_demo_last_user";

export class MockProvider extends DataProvider {
  constructor() {
    super();
    this._users = USERS;
    this._students = STUDENTS;
    this._lessons = [];
    this._requests = [];
    this._current = null; // uid string or null
    this._authCbs = new Set();
  }

  async init() {
    const now = new Date();
    this._lessons = buildLessons(now);
    this._requests = buildRequests(now);
    // Restore last demo user (if any) for a smoother reload experience.
    try {
      const last = localStorage.getItem(LAST_USER_KEY);
      if (last && this._userByUid(last)) this._current = last;
    } catch (_) {
      /* localStorage may be unavailable; fine for demo */
    }
  }

  // ---- internal helpers ----
  _userByUid(uid) {
    return Object.values(this._users).find((u) => u.uid === uid) || null;
  }
  _userByEmail(email) {
    const e = (email || "").trim().toLowerCase();
    return Object.values(this._users).find((u) => u.email.toLowerCase() === e) || null;
  }
  _viewer() {
    if (!this._current) return null;
    const u = this._userByUid(this._current);
    if (!u) return null;
    return {
      uid: u.uid,
      role: u.role,
      studentIds: u.studentIds.slice(),
      displayName: u.displayName,
    };
  }
  _emit() {
    const v = this._viewer();
    for (const cb of this._authCbs) cb(v);
  }

  // ---- auth ----
  async getCurrentUser() {
    return this._viewer();
  }

  onAuthChanged(cb) {
    this._authCbs.add(cb);
    // Fire once with current state so callers get an initial value.
    cb(this._viewer());
    return () => this._authCbs.delete(cb);
  }

  /** Demo sign-in: match by email; password is ignored. */
  async signIn(email /*, password */) {
    const u = this._userByEmail(email);
    if (!u) throw new Error("No demo account with that email.");
    this._current = u.uid;
    try {
      localStorage.setItem(LAST_USER_KEY, u.uid);
    } catch (_) {}
    this._emit();
    return this._viewer();
  }

  async signOut() {
    this._current = null;
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch (_) {}
    this._emit();
  }

  /** Demo-only convenience: list selectable accounts for the login screen. */
  demoAccounts() {
    return Object.values(this._users).map((u) => ({
      email: u.email,
      displayName: u.displayName,
      role: u.role,
    }));
  }

  // ---- students ----
  async listMyStudents() {
    const v = this._requireViewer();
    if (v.role === "tutor") {
      return Object.values(this._students).map((s) => ({ id: s.id, name: s.name }));
    }
    return v.studentIds.map((id) => ({ id, name: this._students[id]?.name || id }));
  }

  // ---- schedule ----
  async getWeekSchedule(weekStartISO) {
    const v = this._requireViewer();
    const start = new Date(weekStartISO);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60000);

    const inWeek = this._lessons.filter((l) => {
      const t = new Date(l.startISO);
      return t >= start && t < end && l.status === "booked";
    });

    const lessons = inWeek
      .map((l) => projectLessonForViewer(l, v))
      .sort((a, b) => a.startISO.localeCompare(b.startISO));

    return { weekStartISO: start.toISOString(), lessons };
  }

  // ---- requests ----
  async listRequests() {
    const v = this._requireViewer();
    const visible =
      v.role === "tutor"
        ? this._requests
        : this._requests.filter((r) => r.parentUid === v.uid);

    return visible
      .map((r) => this._decorateRequest(r, v))
      .sort((a, b) => b.createdISO.localeCompare(a.createdISO));
  }

  _decorateRequest(r, viewer) {
    const out = { ...r };
    // Tutor sees who asked + which student; parent already knows.
    out.studentName = this._students[r.studentId]?.name || r.studentId;
    if (viewer.role === "tutor") {
      out.parentName = this._userByUid(r.parentUid)?.displayName || r.parentUid;
    }
    return out;
  }

  async createRequest(payload) {
    const v = this._requireViewer();
    if (v.role !== "parent") throw new Error("Only parents can submit requests.");

    const { kind, studentId, bookingId, proposedStartISO, proposedEndISO, note } =
      payload || {};

    if (!["reschedule", "additional"].includes(kind))
      throw new Error("Invalid request kind.");
    if (!v.studentIds.includes(studentId))
      throw new Error("You can only request for your own child.");
    if (kind === "reschedule" && !bookingId)
      throw new Error("Reschedule requires the lesson to move.");
    if (kind === "additional" && bookingId)
      throw new Error("Additional lessons must not reference an existing booking.");
    if (!proposedStartISO || !proposedEndISO || proposedEndISO <= proposedStartISO)
      throw new Error("Invalid proposed time range.");

    // For a reschedule, the target booking must be the parent's own child's.
    if (kind === "reschedule") {
      const target = this._lessons.find((l) => l.id === bookingId);
      if (!target || target.studentId !== studentId)
        throw new Error("You can only reschedule your own child's lesson.");
    }

    const req = {
      id: "req-" + Math.random().toString(36).slice(2, 9),
      kind,
      studentId,
      ...(kind === "reschedule" ? { bookingId } : {}),
      proposedStartISO,
      proposedEndISO,
      parentUid: v.uid,
      status: "pending",
      createdISO: new Date().toISOString(),
      note: (note || "").trim(),
    };
    this._requests.push(req);
    return this._decorateRequest(req, v);
  }

  async resolveRequest(id, action) {
    const v = this._requireViewer();
    if (v.role !== "tutor") throw new Error("Only the tutor can resolve requests.");
    if (!["approve", "decline"].includes(action))
      throw new Error("action must be approve or decline.");

    const req = this._requests.find((r) => r.id === id);
    if (!req) throw new Error("Request not found.");
    if (req.status !== "pending") throw new Error("Request already resolved.");

    if (action === "decline") {
      req.status = "declined";
      req.resolvedISO = new Date().toISOString();
      return this._decorateRequest(req, v);
    }

    // approve
    if (req.kind === "reschedule") {
      const target = this._lessons.find((l) => l.id === req.bookingId);
      // Re-verify the booking still belongs to the request's student (defence in depth).
      if (!target || target.studentId !== req.studentId)
        throw new Error("Target booking no longer matches the request's student.");
      target.startISO = req.proposedStartISO;
      target.endISO = req.proposedEndISO;
    } else {
      // additional: create a new booking+lesson for that student.
      const student = this._students[req.studentId];
      this._lessons.push({
        id: "bk-" + Math.random().toString(36).slice(2, 9),
        studentId: req.studentId,
        studentName: student?.name || req.studentId,
        subject: "Lesson",
        notes: "Added from parent request",
        startISO: req.proposedStartISO,
        endISO: req.proposedEndISO,
        status: "booked",
      });
    }

    req.status = "approved";
    req.resolvedISO = new Date().toISOString();
    return this._decorateRequest(req, v);
  }

  _requireViewer() {
    const v = this._viewer();
    if (!v) throw new Error("Not signed in.");
    return v;
  }
}
