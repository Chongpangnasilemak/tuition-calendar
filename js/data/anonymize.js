// -----------------------------------------------------------------------------
// projectLessonForViewer — the SHARED, pure anonymization function.
//
// Both the MockProvider (in JS) and the FirebaseProvider (structurally, via the
// bookings/lessons split + security rules) produce the same result: a parent
// receives FULL detail only for their own child's lessons; every other lesson
// comes back as { anonymous: true } with the sensitive keys ABSENT (not blanked).
//
// Keeping this pure and shared means demo mode behaves identically to production.
// -----------------------------------------------------------------------------

/**
 * @param {{ id:string, startISO:string, endISO:string, studentId:string,
 *           studentName:string, subject:string, notes:string }} lesson
 * @param {{ role:'parent'|'tutor', studentIds:string[] }} viewer
 * @returns {import('./provider.js').Lesson}
 */
export function projectLessonForViewer(lesson, viewer) {
  const isTutor = viewer.role === "tutor";
  const mine = isTutor || viewer.studentIds.includes(lesson.studentId);

  if (mine) {
    return {
      id: lesson.id,
      startISO: lesson.startISO,
      endISO: lesson.endISO,
      anonymous: false,
      mine: !isTutor, // tutor "owns" nothing; just sees everything in detail
      studentId: lesson.studentId,
      studentName: lesson.studentName,
      subject: lesson.subject,
      notes: lesson.notes,
    };
  }

  // Anonymous busy-block: sensitive keys are simply not present.
  return {
    id: lesson.id,
    startISO: lesson.startISO,
    endISO: lesson.endISO,
    anonymous: true,
    mine: false,
  };
}
