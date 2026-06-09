// -----------------------------------------------------------------------------
// DataProvider — the single contract the UI talks to.
//
// The UI imports getProvider() (from ./index.js) and calls these methods. It
// NEVER knows whether it's talking to Firebase or the in-memory mock. Crucially,
// ALL anonymization happens below this line: getWeekSchedule() always returns
// lessons that are already safe to render for the current viewer. The view only
// branches on `anonymous` / `mine` — it can't leak a name it never receives.
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} Viewer
 * @property {string}            uid
 * @property {'parent'|'tutor'}  role
 * @property {string[]}          studentIds   parent's children ([] for tutor; tutor sees all)
 * @property {string}            displayName
 */

/**
 * @typedef {Object} Lesson
 * @property {string}   id            == bookingId
 * @property {string}   startISO
 * @property {string}   endISO
 * @property {boolean}  anonymous     true => busy block; sensitive keys are ABSENT
 * @property {boolean}  mine          true if it belongs to the viewer's child
 * @property {string=}  studentId     present ONLY if !anonymous
 * @property {string=}  studentName   present ONLY if !anonymous
 * @property {string=}  subject       present ONLY if !anonymous
 * @property {string=}  notes         present ONLY if !anonymous
 */

/**
 * @typedef {Object} StudentRef
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} Request
 * @property {string}                          id
 * @property {'reschedule'|'additional'}       kind
 * @property {string}                          studentId
 * @property {string=}                         studentName   resolved for display
 * @property {string=}                         bookingId     reschedule only
 * @property {string}                          proposedStartISO
 * @property {string}                          proposedEndISO
 * @property {string}                          parentUid
 * @property {string=}                         parentName    resolved for tutor display
 * @property {'pending'|'approved'|'declined'} status
 * @property {string}                          createdISO
 * @property {string=}                         note
 */

export class DataProvider {
  /** One-time setup (Firebase init / mock seed). Resolves when ready. */
  async init() { throw new Error("not implemented"); }

  // ---- auth ----
  /** @returns {Promise<Viewer|null>} */
  async getCurrentUser() { throw new Error("not implemented"); }

  /** @param {(v: Viewer|null) => void} cb @returns {() => void} unsubscribe */
  onAuthChanged(cb) { throw new Error("not implemented"); }

  /** @param {string} email @param {string} password @returns {Promise<Viewer>} */
  async signIn(email, password) { throw new Error("not implemented"); }

  async signOut() { throw new Error("not implemented"); }

  // ---- students the viewer may act for ----
  /** @returns {Promise<StudentRef[]>} parent: own children; tutor: all students */
  async listMyStudents() { throw new Error("not implemented"); }

  // ---- schedule (ALREADY anonymized for the current viewer) ----
  /**
   * @param {string} weekStartISO  Monday 00:00 local, ISO
   * @returns {Promise<{ weekStartISO: string, lessons: Lesson[] }>}
   *   PARENT: own child's lessons full; all others {anonymous:true}. TUTOR: all full.
   */
  async getWeekSchedule(weekStartISO) { throw new Error("not implemented"); }

  // ---- requests ----
  /** Parent: own requests. Tutor: all. @returns {Promise<Request[]>} */
  async listRequests() { throw new Error("not implemented"); }

  /**
   * Parent only.
   * @param {{kind:'reschedule'|'additional', studentId:string, bookingId?:string,
   *          proposedStartISO:string, proposedEndISO:string, note?:string}} payload
   * @returns {Promise<Request>}
   */
  async createRequest(payload) { throw new Error("not implemented"); }

  /**
   * Tutor only. For 'approve' on a reschedule, re-verifies
   * lessons/{request.bookingId}.studentId === request.studentId before moving the
   * booking; throws on mismatch.
   * @param {string} id @param {'approve'|'decline'} action @returns {Promise<Request>}
   */
  async resolveRequest(id, action) { throw new Error("not implemented"); }
}
