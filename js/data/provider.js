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

  /**
   * Create a new PARENT account, then sign in. New parents use this, then
   * redeem an invite code to connect to their child.
   * @param {string} email @param {string} password @param {string} [displayName]
   * @returns {Promise<Viewer>}
   */
  async signUp(email, password, displayName) { throw new Error("not implemented"); }

  /**
   * Sign in (or sign up) with Google. New users become parents with no children
   * until they redeem an invite code. Live mode only — demo throws a friendly
   * error. @returns {Promise<Viewer>}
   */
  async signInWithGoogle() { throw new Error("not implemented"); }

  /** Whether this provider supports Google sign-in (true only in live mode). */
  supportsGoogle() { return false; }

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

  // ---- tutor: lesson management ----
  /**
   * Tutor only. Create a lesson (writes a booking + a lesson record).
   * @param {{studentId:string, startISO:string, endISO:string,
   *          subject?:string, notes?:string}} payload
   * @returns {Promise<import('./provider.js').Lesson>}
   */
  async addLesson(payload) { throw new Error("not implemented"); }

  /**
   * Tutor only. Update a lesson's time and/or detail.
   * @param {string} id  the bookingId/lessonId
   * @param {{startISO?:string, endISO?:string, subject?:string, notes?:string,
   *          studentId?:string}} patch
   * @returns {Promise<import('./provider.js').Lesson>}
   */
  async updateLesson(id, patch) { throw new Error("not implemented"); }

  /** Tutor only. Cancel (delete) a lesson. @param {string} id */
  async cancelLesson(id) { throw new Error("not implemented"); }

  /**
   * Tutor only. Edit a recurring lesson across its series.
   * @param {string} id @param {object} patch (sparse — changed fields only)
   * @param {'one'|'future'|'all'} scope  'future' is inclusive of the clicked one
   * @returns {Promise<import('./provider.js').Lesson>}
   */
  async updateLessonSeries(id, patch, scope) { throw new Error("not implemented"); }

  /**
   * Tutor only. Cancel a recurring lesson across its series.
   * @param {string} id @param {'one'|'future'|'all'} scope
   * @returns {Promise<{removed:number}>}
   */
  async cancelLessonSeries(id, scope) { throw new Error("not implemented"); }

  // ---- tutor: students & onboarding ----
  /** Tutor only. List ALL students (roster). @returns {Promise<StudentRef[]>} */
  async listAllStudents() { throw new Error("not implemented"); }

  /**
   * Tutor only. Add a new student to the roster.
   * @param {{name:string, subject?:string}} payload
   * @returns {Promise<StudentRef>}
   */
  async addStudent(payload) { throw new Error("not implemented"); }

  /**
   * Tutor only. Remove a student and all of their lessons/bookings, and unlink
   * them from any parents. Pending invites for that student are removed too.
   * @param {string} studentId
   * @returns {Promise<{removedLessons:number}>}
   */
  async removeStudent(studentId) { throw new Error("not implemented"); }

  /**
   * Tutor only. Create an invite that links a (future) parent account to a
   * student. The parent redeems the returned code to gain access. The parent
   * NEVER writes their own link — only this tutor-authored invite can.
   * @param {{studentId:string, parentEmail:string, parentName?:string}} payload
   * @returns {Promise<{code:string, studentId:string, parentEmail:string,
   *                    parentName?:string, status:'pending'|'redeemed', createdISO:string}>}
   */
  async createInvite(payload) { throw new Error("not implemented"); }

  /** Tutor only. List invites this tutor created. @returns {Promise<Array>} */
  async listInvites() { throw new Error("not implemented"); }

  /**
   * Redeem an invite code: links the CURRENT signed-in parent to the invite's
   * student. In live mode this is performed by trusted server logic (a Cloud
   * Function), because writing users.studentIds is not allowed from the browser.
   * @param {string} code
   * @returns {Promise<{studentId:string, studentName:string}>}
   */
  async redeemInvite(code) { throw new Error("not implemented"); }
}
