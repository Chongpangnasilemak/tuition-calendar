// -----------------------------------------------------------------------------
// Recurrence — the SINGLE source of truth for expanding a recurring lesson into
// concrete occurrences. Used by BOTH providers (to create the docs) and the
// add-lesson modal (to preview "8 lessons, ends 4 Aug"), so what you preview is
// exactly what gets created.
//
// "Expand on create": a recurring lesson becomes N independent lessons up front,
// each its own opaque id, all sharing a seriesId. No rule is re-interpreted at
// read time — every occurrence is a normal lesson, so the week view, the
// anonymized parent view, and the security rules are all unchanged.
//
// DST-safe: occurrences are rebuilt from local wall-clock components (year,
// month, day, hour, minute), never by adding a fixed number of milliseconds —
// so a weekly 4:00pm slot stays 4:00pm local even across a daylight-saving
// change.
// -----------------------------------------------------------------------------

export const MAX_OCCURRENCES = 200; // fat-finger guard (also keeps batches < 450 ops)

/**
 * @typedef {Object} Recurrence
 * @property {'daily'|'weekly'|'biweekly'} freq
 * @property {{ kind:'count', count:number } | { kind:'until', dateISO:string }} end
 */

/** Add `n` whole days to a Date, preserving local wall-clock time (DST-safe). */
function addLocalDays(d, n) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);
  return out;
}

/** End of the local day for an ISO date string ("YYYY-MM-DD" or full ISO). */
export function endOfLocalDay(dateISO) {
  const d = new Date(dateISO);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function stepDays(freq) {
  if (freq === "daily") return 1;
  if (freq === "weekly") return 7;
  if (freq === "biweekly") return 14;
  throw new Error("Unknown recurrence freq: " + freq);
}

/**
 * Expand a (start,end) lesson + recurrence into an array of {startISO,endISO}
 * occurrences, INCLUDING the first one. Returns [{startISO,endISO}, ...].
 *
 * @param {string} startISO  first occurrence start (ISO)
 * @param {string} endISO    first occurrence end (ISO)
 * @param {Recurrence|null} recurrence  null/undefined => single occurrence
 * @param {number} [max=MAX_OCCURRENCES]
 */
export function expandRecurrence(startISO, endISO, recurrence, max = MAX_OCCURRENCES) {
  const start0 = new Date(startISO);
  const end0 = new Date(endISO);
  if (!(end0 > start0)) throw new Error("End must be after start.");

  // No recurrence -> just the one lesson.
  if (!recurrence || !recurrence.freq) {
    return [{ startISO: start0.toISOString(), endISO: end0.toISOString() }];
  }

  const step = stepDays(recurrence.freq);
  const durationMs = end0.getTime() - start0.getTime();

  // Resolve how many occurrences.
  let count;
  if (recurrence.end && recurrence.end.kind === "count") {
    count = Math.floor(recurrence.end.count);
    if (!(count >= 1)) throw new Error("Count must be at least 1.");
  } else if (recurrence.end && recurrence.end.kind === "until") {
    count = Infinity; // bounded by the until-date below
  } else {
    throw new Error("Recurrence needs an end (count or until).");
  }

  const untilMs =
    recurrence.end && recurrence.end.kind === "until"
      ? endOfLocalDay(recurrence.end.dateISO).getTime()
      : null;

  if (untilMs != null && untilMs < start0.getTime()) {
    throw new Error("End date is before the first lesson.");
  }

  const out = [];
  for (let i = 0; i < count && out.length < max; i++) {
    const s = addLocalDays(start0, step * i);
    if (untilMs != null && s.getTime() > untilMs) break;
    // Rebuild the end from the (DST-safe) start + the original duration. Using
    // the duration here is fine because start/end are on the same day; the
    // wall-clock anchor is the START, which we rebuilt from local components.
    const e = new Date(s.getTime() + durationMs);
    out.push({ startISO: s.toISOString(), endISO: e.toISOString() });
  }

  if (out.length === 0) throw new Error("Recurrence produced no occurrences.");
  return out;
}

/**
 * Compute a WALL-CLOCK shift from one ISO time to another, as local
 * component deltas (days/hours/minutes) rather than a raw millisecond diff.
 * Applying this with applyWallClockShift() keeps a recurring slot at the same
 * local time across DST changes.
 */
export function wallClockShift(fromISO, toISO) {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  return {
    days: Math.round((dayStart(b) - dayStart(a)) / 86400000),
    minutes: (b.getHours() * 60 + b.getMinutes()) - (a.getHours() * 60 + a.getMinutes()),
  };
}

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Apply a wall-clock shift (from wallClockShift) to an ISO time, DST-safe. */
export function applyWallClockShift(iso, shift) {
  const d = new Date(iso);
  const out = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + shift.days,
    d.getHours(),
    d.getMinutes() + shift.minutes,
    0,
    0
  );
  return out.toISOString();
}

/** A short human summary for the modal preview, e.g. "Weekly · 8 lessons (ends Tue, 4 Aug)". */
export function describeRecurrence(startISO, endISO, recurrence) {
  if (!recurrence || !recurrence.freq) return "Does not repeat";
  let occ;
  try {
    occ = expandRecurrence(startISO, endISO, recurrence);
  } catch (e) {
    return e.message;
  }
  const freqLabel =
    recurrence.freq === "daily" ? "Daily" : recurrence.freq === "weekly" ? "Weekly" : "Every 2 weeks";
  const last = new Date(occ[occ.length - 1].startISO);
  const lastStr = last.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const n = occ.length;
  const plural = n === 1 ? "lesson" : "lessons";
  return `${freqLabel} · ${n} ${plural} (ends ${lastStr})`;
}
