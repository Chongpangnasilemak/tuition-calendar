// -----------------------------------------------------------------------------
// Seed data for DEMO MODE.
//
// Builds a realistic week of lessons around "today" so the demo always opens on
// a populated current week. Includes:
//   - 1 tutor
//   - 3 parents (parent C is a CO-PARENT of the same child as parent A, to
//     exercise the shared-child / author-only-request-read case)
//   - 4 students
//   - lessons across the week (some belong to each parent's child, the rest are
//     "other students" that parents must see only as anonymous busy-blocks)
//   - a couple of sample requests
//
// Times are local. Helpers below construct ISO timestamps relative to the Monday
// of the current week.
// -----------------------------------------------------------------------------

/** Monday 00:00 (local) of the week containing `d`. */
export function mondayOf(d) {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7; // 0 = Monday
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - day);
  return out;
}

/** Build a local ISO-ish timestamp at weekday `dow` (0=Mon..6=Sun), HH:MM, in the
 *  week starting at `weekMonday`. Returns a real ISO string (UTC). */
function at(weekMonday, dow, hh, mm) {
  const d = new Date(weekMonday);
  d.setDate(d.getDate() + dow);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function plusMinutes(iso, mins) {
  return new Date(new Date(iso).getTime() + mins * 60000).toISOString();
}

// Stable accounts. (Demo "passwords" are not checked.)
export const USERS = {
  tutor: {
    uid: "tutor-1",
    role: "tutor",
    email: "tutor@demo.app",
    displayName: "Ms. Tutor (you)",
    studentIds: [],
  },
  parentA: {
    uid: "parent-a",
    role: "parent",
    email: "parent.a@demo.app",
    displayName: "Parent A (Aiden's mum)",
    studentIds: ["stu-aiden"],
  },
  parentB: {
    uid: "parent-b",
    role: "parent",
    email: "parent.b@demo.app",
    displayName: "Parent B (Bella's dad)",
    studentIds: ["stu-bella"],
  },
  parentC: {
    uid: "parent-c",
    role: "parent",
    email: "parent.c@demo.app",
    displayName: "Parent C (Aiden's dad)",
    studentIds: ["stu-aiden"], // co-parent of Aiden, alongside parent A
  },
};

export const STUDENTS = {
  "stu-aiden": { id: "stu-aiden", name: "Aiden", parentUids: ["parent-a", "parent-c"] },
  "stu-bella": { id: "stu-bella", name: "Bella", parentUids: ["parent-b"] },
  "stu-chloe": { id: "stu-chloe", name: "Chloe", parentUids: ["parent-x"] },
  "stu-derek": { id: "stu-derek", name: "Derek", parentUids: ["parent-y"] },
};

/**
 * Build the lesson list for the week of `referenceDate`.
 * Each lesson has both public (time) and private (name/subject/notes) fields;
 * the providers decide who sees what via projectLessonForViewer / security rules.
 */
export function buildLessons(referenceDate) {
  const wk = mondayOf(referenceDate);
  const L = (id, dow, hh, mm, durMin, studentId, subject, notes) => {
    const startISO = at(wk, dow, hh, mm);
    return {
      id,
      studentId,
      studentName: STUDENTS[studentId].name,
      subject,
      notes,
      startISO,
      endISO: plusMinutes(startISO, durMin),
      status: "booked",
    };
  };

  // dow: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
  return [
    L("bk-1", 0, 15, 30, 60, "stu-aiden", "Maths", "Algebra — quadratics revision"),
    L("bk-2", 0, 17, 0, 60, "stu-chloe", "English", "Essay structure"),
    L("bk-3", 1, 16, 0, 60, "stu-bella", "Science", "Chemistry: the mole"),
    L("bk-4", 1, 17, 30, 90, "stu-derek", "Maths", "Trigonometry"),
    L("bk-5", 2, 15, 0, 60, "stu-aiden", "Maths", "Past paper walkthrough"),
    L("bk-6", 2, 18, 0, 60, "stu-chloe", "English", "Comprehension practice"),
    L("bk-7", 3, 16, 30, 60, "stu-bella", "Science", "Physics: forces"),
    L("bk-8", 4, 15, 30, 60, "stu-derek", "Maths", "Calculus intro"),
    L("bk-9", 5, 10, 0, 90, "stu-aiden", "Maths", "Weekend intensive — mock exam"),
    L("bk-10", 5, 13, 0, 60, "stu-bella", "Science", "Biology: cells"),
  ];
}

/** Sample requests, anchored to the current week's bookings. */
export function buildRequests(referenceDate) {
  const wk = mondayOf(referenceDate);
  return [
    {
      id: "req-1",
      kind: "reschedule",
      studentId: "stu-aiden",
      bookingId: "bk-1",
      proposedStartISO: at(wk, 1, 15, 30), // move Aiden's Mon lesson to Tue 15:30
      proposedEndISO: at(wk, 1, 16, 30),
      parentUid: "parent-a",
      status: "pending",
      createdISO: at(wk, 0, 9, 0),
      note: "Aiden has a dentist appointment Monday afternoon — could we move to Tuesday?",
    },
    {
      id: "req-2",
      kind: "additional",
      studentId: "stu-bella",
      proposedStartISO: at(wk, 3, 17, 0), // extra Thu session for Bella
      proposedEndISO: at(wk, 3, 18, 0),
      parentUid: "parent-b",
      status: "pending",
      createdISO: at(wk, 1, 20, 0),
      note: "Could Bella get an extra session before her test on Friday?",
    },
  ];
}
