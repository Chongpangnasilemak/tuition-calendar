// -----------------------------------------------------------------------------
// Cloud Functions for the Tuition Calendar (LIVE mode only).
//
// The ONLY privileged operation: redeemInvite. Writing users/{uid}.studentIds
// is intentionally forbidden to clients (it's the trust anchor that stops a
// parent linking themselves to another child). This callable function runs with
// Admin privileges, validates a tutor-created invite, and performs the link.
//
// Deploy:  firebase deploy --only functions
// Requires the Blaze (pay-as-you-go) plan to deploy callable functions, but
// usage at this scale is well within the free allowance.
// -----------------------------------------------------------------------------

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.redeemInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const code = String((request.data && request.data.code) || "").trim().toUpperCase();
  if (!code) throw new HttpsError("invalid-argument", "Invite code is required.");

  // The redeeming account must be a parent.
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const role = userSnap.exists ? userSnap.get("role") : "parent";
  if (role === "tutor") {
    throw new HttpsError("failed-precondition", "Tutors don't redeem invites.");
  }

  const inviteRef = db.doc(`invites/${code}`);

  // Transaction: validate + single-use + link, atomically.
  const result = await db.runTransaction(async (tx) => {
    const inv = await tx.get(inviteRef);
    if (!inv.exists) throw new HttpsError("not-found", "Invite code not found.");
    const data = inv.data();
    if (data.status === "redeemed") {
      throw new HttpsError("already-exists", "This invite has already been used.");
    }
    const studentId = data.studentId;
    const studentSnap = await tx.get(db.doc(`students/${studentId}`));
    if (!studentSnap.exists) {
      throw new HttpsError("failed-precondition", "Student no longer exists.");
    }

    // Ensure the parent's user doc exists, then link the student.
    if (!userSnap.exists) {
      tx.set(userRef, {
        role: "parent",
        email: request.auth.token.email || "",
        displayName: data.parentName || request.auth.token.email || "Parent",
        studentIds: [studentId],
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(userRef, { studentIds: FieldValue.arrayUnion(studentId) });
    }

    // Cosmetic mirror on the student doc (non-authoritative).
    tx.update(db.doc(`students/${studentId}`), {
      parentUids: FieldValue.arrayUnion(uid),
    });

    tx.update(inviteRef, {
      status: "redeemed",
      redeemedByUid: uid,
      redeemedAt: FieldValue.serverTimestamp(),
    });

    return { studentId, studentName: studentSnap.get("name") || studentId };
  });

  return result;
});
