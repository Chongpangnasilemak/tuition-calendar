// Weekly calendar view — TIME GRID layout.
//
// A left-hand time axis (08:00–21:00) and seven day columns with hour
// gridlines. Each lesson is absolutely positioned by its start time and sized
// by its duration, so empty space is literally the tutor's free time.
//
// Receives { weekStartISO, lessons:[...] } from the provider — already
// anonymized for the current viewer — and branches ONLY on lesson.anonymous /
// lesson.mine. It never sees a foreign name.
//
// Parents get two request entry points:
//   - "Request reschedule" on each of their own child's lessons
//   - "Request additional lesson" button (top of the view)

import {
  el,
  clear,
  addDays,
  dowIndex,
  dayLabel,
  fmtDate,
  fmtTimeRange,
  mondayOf,
  weekRangeLabel,
  toDateInputValue,
  localToISO,
} from "../util.js";
import { modal, toast } from "./components.js";

// Grid bounds (local hours) and pixel scale.
const DAY_START_H = 8; // 08:00
const DAY_END_H = 21; // 21:00
const PX_PER_HOUR = 56;
const TOTAL_HOURS = DAY_END_H - DAY_START_H;
const GRID_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;

export class WeekView {
  /**
   * @param {HTMLElement} mount
   * @param {import('../data/provider.js').DataProvider} provider
   * @param {import('../data/provider.js').Viewer} viewer
   */
  constructor(mount, provider, viewer) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = viewer;
    this.weekStart = mondayOf(new Date());
  }

  async render() {
    clear(this.mount);
    const isParent = this.viewer.role === "parent";

    // A parent with no child linked yet: prompt them to connect rather than show
    // a confusing grid of anonymous busy-blocks.
    if (isParent && (!this.viewer.studentIds || this.viewer.studentIds.length === 0)) {
      this.mount.appendChild(
        el("div", { class: "empty-state" }, [
          el("div", { class: "empty-state__icon" }, "🔗"),
          el("h1", {}, "Connect to your child"),
          el("p", { class: "muted" }, "You're signed in, but not linked to a student yet. Use the invite code your tutor gave you."),
          el("button", { class: "btn btn--primary", type: "button", onClick: () => {
            const btn = document.querySelector('.topbar__right button');
            // Open the redeem dialog via the header button if present.
            const connect = [...document.querySelectorAll(".topbar__right button")]
              .find((b) => b.textContent.includes("Connect"));
            if (connect) connect.click();
          } }, "+ Connect child"),
        ])
      );
      return;
    }

    const header = el("div", { class: "week__bar" }, [
      el("div", { class: "week__nav" }, [
        el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => this._shift(-7) }, "←"),
        el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => this._today() }, "Today"),
        el("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => this._shift(7) }, "→"),
      ]),
      el("div", { class: "week__range" }, weekRangeLabel(this.weekStart.toISOString())),
      isParent
        ? el("button", { class: "btn btn--primary", type: "button", onClick: () => this._openAdditional() }, "+ Request lesson")
        : el("button", { class: "btn btn--primary", type: "button", onClick: () => this._openAddLesson() }, "+ Add lesson"),
    ]);
    this.mount.appendChild(header);

    if (isParent) {
      this.mount.appendChild(
        el("div", { class: "legend" }, [
          el("span", { class: "legend__item" }, [el("span", { class: "swatch swatch--mine" }), "Your child"]),
          el("span", { class: "legend__item" }, [el("span", { class: "swatch swatch--busy" }), "Busy — name hidden"]),
        ])
      );
    }

    this.calWrap = el("div", { class: "cal" });
    this.mount.appendChild(this.calWrap);

    await this._loadWeek();
  }

  async _loadWeek() {
    clear(this.calWrap);
    this.calWrap.appendChild(el("div", { class: "cal__loading" }, "Loading schedule…"));

    let data;
    try {
      data = await this.provider.getWeekSchedule(this.weekStart.toISOString());
    } catch (e) {
      clear(this.calWrap);
      this.calWrap.appendChild(el("div", { class: "error" }, `Could not load schedule: ${e.message}`));
      return;
    }

    clear(this.calWrap);
    this._renderGrid(data.lessons);
  }

  _renderGrid(lessons) {
    // --- column headers (sticky), aligned with the time-gutter on the left ---
    const headRow = el("div", { class: "cal__head" }, [
      el("div", { class: "cal__corner" }),
    ]);
    const todayKey = dayKey(new Date());
    for (let i = 0; i < 7; i++) {
      const colDate = addDays(this.weekStart, i);
      const isToday = dayKey(colDate) === todayKey;
      headRow.appendChild(
        el("div", { class: "cal__dayhead" + (isToday ? " is-today" : "") }, [
          el("span", { class: "cal__dayname" }, dayLabel(i)),
          el("span", { class: "cal__daydate" }, fmtDate(colDate.toISOString()).replace(/^[A-Za-z]+,?\s*/, "")),
        ])
      );
    }
    this.calWrap.appendChild(headRow);

    // --- scrollable body: time gutter + 7 day columns ---
    const body = el("div", { class: "cal__body" });

    // Time gutter (hour labels).
    const gutter = el("div", { class: "cal__gutter", style: `height:${GRID_HEIGHT}px` });
    for (let h = DAY_START_H; h <= DAY_END_H; h++) {
      gutter.appendChild(
        el("div", {
          class: "cal__hourlabel",
          style: `top:${(h - DAY_START_H) * PX_PER_HOUR}px`,
        }, fmtHour(h))
      );
    }
    body.appendChild(gutter);

    // Group lessons by weekday so overlaps can be laid out side by side.
    const byDay = Array.from({ length: 7 }, () => []);
    for (const l of lessons) {
      const d = new Date(l.startISO);
      const i = dowIndex(d);
      byDay[i].push(l);
    }

    const isTutor = this.viewer.role === "tutor";

    for (let i = 0; i < 7; i++) {
      const colDate = addDays(this.weekStart, i);
      const isToday = dayKey(colDate) === todayKey;
      const col = el("div", {
        class: "cal__col" + (isToday ? " is-today" : "") + (isTutor ? " cal__col--addable" : ""),
        style: `height:${GRID_HEIGHT}px`,
      });

      // Hour gridlines.
      for (let h = 0; h <= TOTAL_HOURS; h++) {
        col.appendChild(el("div", { class: "cal__hourline", style: `top:${h * PX_PER_HOUR}px` }));
      }

      // Tutor: click an empty part of the column to add a lesson at that time.
      if (isTutor) {
        col.addEventListener("click", (e) => {
          if (e.target !== col) return; // ignore clicks that land on a lesson block
          const rect = col.getBoundingClientRect();
          const y = e.clientY - rect.top + col.scrollTop;
          const mins = Math.round((y / PX_PER_HOUR) * 60 / 30) * 30; // snap to 30 min
          const startMin = Math.max(0, Math.min(mins, TOTAL_HOURS * 60 - 60));
          this._openAddLesson({ date: colDate, startMin });
        });
      }

      // Positioned lesson blocks (with overlap columns).
      for (const block of this._layoutDay(byDay[i])) {
        col.appendChild(block);
      }
      body.appendChild(col);
    }

    this.calWrap.appendChild(body);

    if (lessons.length === 0) {
      this.calWrap.appendChild(el("div", { class: "cal__empty" }, "No lessons scheduled this week."));
    }

    // Scroll so the first lesson (or 9am) is comfortably in view.
    requestAnimationFrame(() => {
      const earliest = lessons.reduce((min, l) => {
        const m = minutesFromStart(l.startISO);
        return m != null && m < min ? m : min;
      }, (9 - DAY_START_H) * 60);
      body.scrollTop = Math.max(0, (earliest / 60) * PX_PER_HOUR - 12);
    });
  }

  /**
   * Lay out one day's lessons, splitting overlapping lessons into side-by-side
   * columns so nothing is hidden behind another block.
   * @returns {HTMLElement[]}
   */
  _layoutDay(dayLessons) {
    const items = dayLessons
      .map((l) => ({
        l,
        start: minutesFromStart(l.startISO),
        end: minutesFromStart(l.endISO),
      }))
      .filter((it) => it.start != null && it.end != null && it.end > it.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // Greedy column assignment within each overlap cluster.
    const colEnd = []; // running end-minute per column
    let cluster = [];
    let clusterMaxCol = 0;
    const out = [];

    const flush = () => {
      const cols = clusterMaxCol + 1;
      for (const it of cluster) {
        out.push(this._block(it.l, it.start, it.end, it._col, cols));
      }
      cluster = [];
      clusterMaxCol = 0;
      colEnd.length = 0;
    };

    let clusterEnd = -1;
    for (const it of items) {
      if (cluster.length && it.start >= clusterEnd) {
        flush(); // no overlap with current cluster -> new cluster
      }
      // find a free column
      let c = 0;
      while (c < colEnd.length && colEnd[c] > it.start) c++;
      colEnd[c] = it.end;
      it._col = c;
      clusterMaxCol = Math.max(clusterMaxCol, c);
      clusterEnd = Math.max(clusterEnd, it.end);
      cluster.push(it);
    }
    if (cluster.length) flush();
    return out;
  }

  _block(lesson, startMin, endMin, colIndex, colCount) {
    const top = (startMin / 60) * PX_PER_HOUR;
    const height = Math.max(((endMin - startMin) / 60) * PX_PER_HOUR, 22);
    const widthPct = 100 / colCount;
    const leftPct = colIndex * widthPct;
    const style =
      `top:${top}px;height:${height}px;` +
      `left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);`;

    const short = height < 40;

    if (lesson.anonymous) {
      return el("div", { class: "ev ev--busy" + (short ? " ev--short" : ""), style, title: "Booked (another student)" }, [
        el("div", { class: "ev__title" }, "Busy"),
        short ? null : el("div", { class: "ev__time" }, fmtTimeRange(lesson.startISO, lesson.endISO)),
      ]);
    }

    const cls = "ev " + (lesson.mine ? "ev--mine" : "ev--detail") + (short ? " ev--short" : "");
    const children = [
      el("div", { class: "ev__title" }, lesson.studentName + (lesson.subject ? ` · ${lesson.subject}` : "")),
    ];
    if (!short) children.push(el("div", { class: "ev__time" }, fmtTimeRange(lesson.startISO, lesson.endISO)));
    if (!short && lesson.notes) children.push(el("div", { class: "ev__notes" }, lesson.notes));

    const node = el("div", { class: cls, style }, children);

    if (this.viewer.role === "tutor") {
      // Tutor can edit/cancel any lesson.
      node.classList.add("ev--clickable");
      node.title = "Click to edit or cancel";
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        this._openEditLesson(lesson);
      });
    } else if (lesson.mine) {
      // A parent can propose a reschedule of their OWN child's lesson.
      node.classList.add("ev--clickable");
      node.title = "Click to request a reschedule";
      node.addEventListener("click", () => this._openReschedule(lesson));
    }
    return node;
  }

  _shift(days) {
    this.weekStart = addDays(this.weekStart, days);
    this._refreshRange();
    this._loadWeek();
  }
  _today() {
    this.weekStart = mondayOf(new Date());
    this._refreshRange();
    this._loadWeek();
  }
  _refreshRange() {
    const rangeEl = this.mount.querySelector(".week__range");
    if (rangeEl) rangeEl.textContent = weekRangeLabel(this.weekStart.toISOString());
  }

  // --------------------------------------------------------------------- //
  // Request flows
  // --------------------------------------------------------------------- //
  _openReschedule(lesson) {
    const form = this._timeForm({
      defaultDateISO: lesson.startISO,
      defaultStart: lesson.startISO,
      defaultEnd: lesson.endISO,
    });
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Submit request");
    const { close } = modal(
      `Reschedule: ${lesson.studentName} — ${lesson.subject || "lesson"}`,
      [
        el("p", { class: "muted" }, "Propose a new time for this lesson. The tutor will confirm."),
        form.node,
      ],
      [submit]
    );
    submit.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      submit.disabled = true;
      try {
        await this.provider.createRequest({
          kind: "reschedule",
          studentId: lesson.studentId,
          bookingId: lesson.id,
          proposedStartISO: vals.startISO,
          proposedEndISO: vals.endISO,
          note: vals.note,
        });
        close();
        toast("Reschedule request sent.", "success");
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  async _openAdditional() {
    let students = [];
    try {
      students = await this.provider.listMyStudents();
    } catch (e) {
      toast(e.message, "error");
      return;
    }
    const select = el(
      "select",
      { class: "field__input" },
      students.map((s) => el("option", { value: s.id }, s.name))
    );

    const form = this._timeForm({
      defaultDateISO: addDays(this.weekStart, 0).toISOString(),
      defaultStart: null,
      defaultEnd: null,
    });

    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Submit request");
    const childField = students.length > 1
      ? el("label", { class: "field" }, [el("span", { class: "field__label" }, "Child"), select])
      : null;

    const { close } = modal(
      "Request an additional lesson",
      [
        el("p", { class: "muted" }, "Pick a free slot you'd like. The tutor will confirm availability."),
        childField,
        form.node,
      ].filter(Boolean),
      [submit]
    );

    submit.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      const studentId = students.length > 1 ? select.value : students[0]?.id;
      if (!studentId) {
        toast("No child on file for your account.", "error");
        return;
      }
      submit.disabled = true;
      try {
        await this.provider.createRequest({
          kind: "additional",
          studentId,
          proposedStartISO: vals.startISO,
          proposedEndISO: vals.endISO,
          note: vals.note,
        });
        close();
        toast("Additional-lesson request sent.", "success");
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  // --------------------------------------------------------------------- //
  // Tutor: add / edit / cancel a lesson
  // --------------------------------------------------------------------- //
  async _openAddLesson(opts = {}) {
    let students = [];
    try {
      students = await this.provider.listAllStudents();
    } catch (e) {
      toast(e.message, "error");
      return;
    }
    if (!students.length) {
      toast("Add a student first (Manage → Add student).", "error");
      return;
    }

    const select = el(
      "select",
      { class: "field__input" },
      students.map((s) => el("option", { value: s.id }, s.name))
    );
    const subject = el("input", { class: "field__input", type: "text", placeholder: "e.g. Maths" });

    // Default date/time: from a clicked slot, or the first weekday at 4pm.
    // startMin is minutes from the grid top (DAY_START_H), so absolute minutes
    // past midnight = DAY_START_H*60 + startMin.
    const date = opts.date || addDays(this.weekStart, 0);
    const gridMin = opts.startMin != null ? opts.startMin : (16 - DAY_START_H) * 60; // default 4pm
    const absMin = DAY_START_H * 60 + gridMin;
    const startISO = atDayMin(date, absMin);
    const endISO = new Date(new Date(startISO).getTime() + 60 * 60000).toISOString();

    const form = this._timeForm({ defaultDateISO: startISO, defaultStart: startISO, defaultEnd: endISO });
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Add lesson");

    const { close } = modal(
      "Add a lesson",
      [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Student"), select]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
        form.node,
      ],
      [submit]
    );

    submit.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      submit.disabled = true;
      try {
        await this.provider.addLesson({
          studentId: select.value,
          startISO: vals.startISO,
          endISO: vals.endISO,
          subject: subject.value.trim(),
          notes: vals.note,
        });
        close();
        toast("Lesson added.", "success");
        this._loadWeek();
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  async _openEditLesson(lesson) {
    let students = [];
    try {
      students = await this.provider.listAllStudents();
    } catch (_) {}

    const select = el(
      "select",
      { class: "field__input" },
      students.map((s) => el("option", { value: s.id, ...(s.id === lesson.studentId ? { selected: true } : {}) }, s.name))
    );
    const subject = el("input", { class: "field__input", type: "text", value: lesson.subject || "" });

    const form = this._timeForm({
      defaultDateISO: lesson.startISO,
      defaultStart: lesson.startISO,
      defaultEnd: lesson.endISO,
    });

    const save = el("button", { class: "btn btn--primary", type: "button" }, "Save changes");
    const cancelLesson = el("button", { class: "btn btn--danger", type: "button" }, "Cancel lesson");

    const { close } = modal(
      `Edit lesson — ${lesson.studentName}`,
      [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Student"), select]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
        form.node,
      ],
      [cancelLesson, save]
    );

    save.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      save.disabled = cancelLesson.disabled = true;
      try {
        await this.provider.updateLesson(lesson.id, {
          studentId: select.value,
          startISO: vals.startISO,
          endISO: vals.endISO,
          subject: subject.value.trim(),
          notes: vals.note,
        });
        close();
        toast("Lesson updated.", "success");
        this._loadWeek();
      } catch (e) {
        save.disabled = cancelLesson.disabled = false;
        toast(e.message, "error");
      }
    });

    cancelLesson.addEventListener("click", async () => {
      if (!confirm(`Cancel ${lesson.studentName}'s lesson? This removes it from the calendar.`)) return;
      save.disabled = cancelLesson.disabled = true;
      try {
        await this.provider.cancelLesson(lesson.id);
        close();
        toast("Lesson cancelled.", "success");
        this._loadWeek();
      } catch (e) {
        save.disabled = cancelLesson.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  /** Builds the shared date/start/end/note sub-form. */
  _timeForm({ defaultDateISO, defaultStart, defaultEnd }) {
    const dateVal = toDateInputValue(new Date(defaultDateISO));
    const startVal = defaultStart ? hhmm(defaultStart) : "16:00";
    const endVal = defaultEnd ? hhmm(defaultEnd) : "17:00";

    const date = el("input", { class: "field__input", type: "date", value: dateVal });
    const start = el("input", { class: "field__input", type: "time", value: startVal });
    const end = el("input", { class: "field__input", type: "time", value: endVal });
    const note = el("textarea", { class: "field__input", rows: "2", placeholder: "Optional note to the tutor…" });

    const node = el("div", { class: "form" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Date"), date]),
      el("div", { class: "form__row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Start"), start]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "End"), end]),
      ]),
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Note"), note]),
    ]);

    return {
      node,
      values() {
        if (!date.value || !start.value || !end.value) {
          toast("Please fill in date, start and end times.", "error");
          return null;
        }
        if (end.value <= start.value) {
          toast("End time must be after start time.", "error");
          return null;
        }
        return {
          startISO: localToISO(date.value, start.value),
          endISO: localToISO(date.value, end.value),
          note: note.value.trim(),
        };
      },
    };
  }
}

// --- module-local helpers ---------------------------------------------------

/** Minutes from DAY_START_H for an ISO time (local). null if it can't be placed. */
function minutesFromStart(iso) {
  const d = new Date(iso);
  const mins = (d.getHours() - DAY_START_H) * 60 + d.getMinutes();
  // Clamp into the visible window so out-of-range lessons still show at an edge.
  const max = TOTAL_HOURS * 60;
  if (mins < 0) return 0;
  if (mins > max) return max;
  return mins;
}

function fmtHour(h) {
  const ampm = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** ISO for a given Date's day at `absMin` minutes past local midnight. */
function atDayMin(date, absMin) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(absMin);
  return d.toISOString();
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
