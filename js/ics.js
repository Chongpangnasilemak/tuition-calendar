// -----------------------------------------------------------------------------
// "Add to calendar" helpers — pure client-side, no backend.
//
// Two ways to get a lesson into someone's own calendar:
//   - downloadICS(): an RFC 5545 .ics file (works with Apple Calendar, Outlook,
//     Google import, etc.)
//   - googleCalendarUrl(): a deep link that opens Google Calendar's "new event"
//     screen pre-filled.
//
// Times are emitted in UTC (the app already stores ISO/UTC), so the event lands
// at the correct local time in whatever calendar imports it.
// -----------------------------------------------------------------------------

/** Format a Date as an RFC 5545 UTC timestamp: 20260610T140000Z */
function toICSUtc(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function icsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets per RFC 5545 (continuation lines start with a space). */
function foldLine(line) {
  if (line.length <= 75) return line;
  const out = [];
  let i = 0;
  out.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    out.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return out.join("\r\n");
}

/** A stable-ish UID; we don't have crypto here, so derive from fields + a salt. */
function makeUid(lesson) {
  const base = `${lesson.id || "lesson"}-${lesson.startISO}`.replace(/[^a-zA-Z0-9-]/g, "");
  return `${base}@tuition-calendar`;
}

/**
 * Build an iCalendar (.ics) string for one lesson.
 * @param {{id?:string, startISO:string, endISO:string, title:string,
 *          description?:string, location?:string, stampISO?:string}} ev
 */
export function buildICS(ev) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tuition Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${makeUid(ev)}`,
    // DTSTAMP must be a valid time; the app can't call Date.now() in some
    // contexts, so fall back to the event start if no stamp is provided.
    `DTSTAMP:${toICSUtc(ev.stampISO || ev.startISO)}`,
    `DTSTART:${toICSUtc(ev.startISO)}`,
    `DTEND:${toICSUtc(ev.endISO)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  // A sensible default 30-min reminder.
  lines.push("BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM");
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Trigger a download of the .ics for a lesson. */
export function downloadICS(ev, filename = "lesson.ics") {
  const blob = new Blob([buildICS(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A Google Calendar "create event" deep link (opens pre-filled). */
export function googleCalendarUrl(ev) {
  const fmt = (iso) => toICSUtc(iso); // Google accepts the same UTC basic format
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title || "Lesson",
    dates: `${fmt(ev.startISO)}/${fmt(ev.endISO)}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return "https://calendar.google.com/calendar/render?" + params.toString();
}
