// Small DOM + date/time helpers shared across views. No dependencies.

/** Create an element with attrs/props and children. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday 00:00 (local) of the week containing `d`. */
export function mondayOf(d) {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7;
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - day);
  return out;
}

export function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** 0=Mon..6=Sun for a Date. */
export function dowIndex(d) {
  return (d.getDay() + 6) % 7;
}

export function dayLabel(i) {
  return DAYS[i];
}

export function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtTimeRange(startISO, endISO) {
  return `${fmtTime(startISO)} – ${fmtTime(endISO)}`;
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function fmtDateTime(iso) {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

/** "YYYY-MM-DD" for a Date in LOCAL time (for <input type=date>). */
export function toDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Combine a "YYYY-MM-DD" + "HH:MM" (local) into an ISO string. */
export function localToISO(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

export function weekRangeLabel(weekStartISO) {
  const start = new Date(weekStartISO);
  const end = addDays(start, 6);
  const opts = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString([], opts)} – ${end.toLocaleDateString([], {
    ...opts,
    year: "numeric",
  })}`;
}
