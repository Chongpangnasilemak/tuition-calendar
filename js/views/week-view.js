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
import { describeRecurrence } from "../data/recurrence.js";
import { downloadICS, googleCalendarUrl } from "../ics.js";

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
          el("span", { class: "legend__item" }, [el("span", { class: "swatch swatch--open" }), "Available — tap to book"]),
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

    const weekEndISO = addDays(this.weekStart, 7).toISOString();
    let data, slots = [];
    try {
      data = await this.provider.getWeekSchedule(this.weekStart.toISOString());
      // Open bookable slots (best-effort; not fatal if it fails).
      try {
        slots = await this.provider.listOpenSlots(this.weekStart.toISOString(), weekEndISO);
      } catch (_) { slots = []; }
    } catch (e) {
      clear(this.calWrap);
      this.calWrap.appendChild(el("div", { class: "error" }, `Could not load schedule: ${e.message}`));
      return;
    }

    clear(this.calWrap);
    this._renderGrid(data.lessons, slots);
  }

  _renderGrid(lessons, openSlots = []) {
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

    // Group open slots by weekday.
    const slotsByDay = Array.from({ length: 7 }, () => []);
    for (const s of openSlots) slotsByDay[dowIndex(new Date(s.startISO))].push(s);

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

      // Tutor: click an empty part of the column -> choose add lesson / open slot.
      if (isTutor) {
        col.addEventListener("click", (e) => {
          if (e.target !== col) return; // ignore clicks that land on a block
          const rect = col.getBoundingClientRect();
          const y = e.clientY - rect.top + col.scrollTop;
          const mins = Math.round((y / PX_PER_HOUR) * 60 / 30) * 30; // snap to 30 min
          const startMin = Math.max(0, Math.min(mins, TOTAL_HOURS * 60 - 60));
          this._onTutorEmptyClick(colDate, startMin);
        });
      }

      // Open bookable slots (rendered behind lessons).
      for (const s of slotsByDay[i]) {
        const block = this._openSlotBlock(s);
        if (block) col.appendChild(block);
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
      // A parent clicks their OWN child's lesson -> detail (add-to-calendar +
      // shared notes + request reschedule).
      node.classList.add("ev--clickable");
      node.title = "Click for options";
      node.addEventListener("click", () => this._openParentLesson(lesson));
    }
    return node;
  }

  // --------------------------------------------------------------------- //
  // Open bookable slots
  // --------------------------------------------------------------------- //
  _openSlotBlock(slot) {
    const startMin = minutesFromStart(slot.startISO);
    const endMin = minutesFromStart(slot.endISO);
    if (startMin == null || endMin == null || endMin <= startMin) return null;
    const top = (startMin / 60) * PX_PER_HOUR;
    const height = Math.max(((endMin - startMin) / 60) * PX_PER_HOUR, 22);
    const style = `top:${top}px;height:${height}px;left:2px;width:calc(100% - 4px);`;
    const isTutor = this.viewer.role === "tutor";
    const node = el("div", {
      class: "ev ev--open ev--clickable" + (height < 40 ? " ev--short" : ""),
      style,
      title: isTutor ? "Open slot — click to remove" : "Available — tap to book",
    }, [
      el("div", { class: "ev__title" }, isTutor ? "Open" : "Available"),
      height < 40 ? null : el("div", { class: "ev__time" }, fmtTimeRange(slot.startISO, slot.endISO)),
    ]);
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isTutor) this._removeSlot(slot);
      else this._bookSlot(slot);
    });
    return node;
  }

  _onTutorEmptyClick(colDate, startMin) {
    // Offer: add a lesson now, or open the slot for parent self-booking.
    const addBtn = el("button", { class: "btn btn--block scope__btn", type: "button" }, "➕ Add a lesson");
    const openBtn = el("button", { class: "btn btn--block scope__btn", type: "button" }, "🟢 Open this slot for booking");
    const { close } = modal("This time slot", [
      el("p", { class: "muted" }, "What would you like to do with this time?"),
      el("div", { class: "scope" }, [addBtn, openBtn]),
    ], []);
    addBtn.addEventListener("click", () => { close(); this._openAddLesson({ date: colDate, startMin }); });
    openBtn.addEventListener("click", () => { close(); this._openSlotAt(colDate, startMin); });
  }

  async _openSlotAt(colDate, startMin) {
    const absMin = DAY_START_H * 60 + startMin;
    const startISO = atDayMin(colDate, absMin);
    const form = this._timeForm({ defaultDateISO: startISO, defaultStart: startISO, defaultEnd: new Date(new Date(startISO).getTime() + 60 * 60000).toISOString() });
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Open slot");
    const { close } = modal("Open a bookable slot", [
      el("p", { class: "muted" }, "Parents will see this as “Available” and can book it instantly for their child."),
      form.node,
    ], [submit]);
    submit.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      submit.disabled = true;
      try {
        await this.provider.openSlot({ startISO: vals.startISO, endISO: vals.endISO });
        close();
        toast("Slot opened for booking.", "success");
        this._loadWeek();
      } catch (e) { submit.disabled = false; toast(e.message, "error"); }
    });
  }

  async _removeSlot(slot) {
    if (!confirm(`Remove this open slot (${fmtTimeRange(slot.startISO, slot.endISO)})?`)) return;
    try {
      await this.provider.removeOpenSlot(slot.id);
      toast("Slot removed.", "success");
      this._loadWeek();
    } catch (e) { toast(e.message, "error"); }
  }

  async _bookSlot(slot) {
    let students = [];
    try { students = await this.provider.listMyStudents(); } catch (e) { toast(e.message, "error"); return; }
    if (!students.length) { toast("No child is linked to your account yet.", "error"); return; }
    const select = el("select", { class: "field__input" }, students.map((s) => el("option", { value: s.id }, s.name)));
    const subject = el("input", { class: "field__input", type: "text", placeholder: "Subject (optional)" });
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Book this slot");
    const childField = students.length > 1
      ? el("label", { class: "field" }, [el("span", { class: "field__label" }, "Child"), select]) : null;
    const { close } = modal("Book this lesson", [
      el("div", { class: "ldetail__time" }, fmtTimeRange(slot.startISO, slot.endISO)),
      el("p", { class: "muted" }, "This time is available. Booking confirms it instantly."),
      childField,
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
    ].filter(Boolean), [submit]);
    submit.addEventListener("click", async () => {
      const studentId = students.length > 1 ? select.value : students[0].id;
      submit.disabled = true;
      try {
        await this.provider.bookOpenSlot(slot.id, studentId, subject.value.trim());
        close();
        toast("Lesson booked! 🎉", "success");
        this._loadWeek();
      } catch (e) { submit.disabled = false; toast(e.message, "error"); }
    });
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
  // Add-to-calendar (shared by tutor edit + parent detail)
  // --------------------------------------------------------------------- //
  /** Build an .ics event object from a lesson the viewer can see in detail. */
  _calendarEvent(lesson) {
    const title = `${lesson.subject || "Lesson"}${lesson.mine === false && this.viewer.role === "tutor" ? " · " + lesson.studentName : ""}`;
    const descParts = [];
    if (lesson.studentName) descParts.push("Student: " + lesson.studentName);
    if (lesson.notes) descParts.push(lesson.notes);
    return {
      id: lesson.id,
      startISO: lesson.startISO,
      endISO: lesson.endISO,
      title: this.viewer.role === "tutor" ? `${lesson.studentName} · ${lesson.subject || "Lesson"}` : `${lesson.subject || "Tuition"}`,
      description: descParts.join("\n"),
    };
  }

  /** Two buttons: download .ics + open Google Calendar. */
  _calendarRow(lesson) {
    const ev = this._calendarEvent(lesson);
    const dl = el("button", { class: "btn btn--ghost btn--sm", type: "button" }, "⬇ .ics file");
    dl.addEventListener("click", () => {
      downloadICS(ev, `${(lesson.subject || "lesson").replace(/\W+/g, "-").toLowerCase()}.ics`);
      toast("Calendar file downloaded.", "success");
    });
    const gc = el("a", {
      class: "btn btn--ghost btn--sm",
      href: googleCalendarUrl(ev),
      target: "_blank",
      rel: "noopener",
    }, "📅 Google Calendar");
    return el("div", { class: "calrow" }, [
      el("span", { class: "field__label" }, "Add to calendar"),
      el("div", { class: "calrow__btns" }, [dl, gc]),
    ]);
  }

  // --------------------------------------------------------------------- //
  // Parent: lesson detail (add-to-calendar, shared notes, reschedule)
  // --------------------------------------------------------------------- //
  _openParentLesson(lesson) {
    const body = [
      el("div", { class: "ldetail" }, [
        el("div", { class: "ldetail__time" }, fmtTimeRange(lesson.startISO, lesson.endISO)),
        el("div", { class: "ldetail__sub" }, [el("strong", {}, lesson.studentName), lesson.subject ? ` · ${lesson.subject}` : ""]),
      ]),
    ];
    // Shared notes (only present if the tutor shared them — see provider).
    if (lesson.notes) {
      body.push(el("div", { class: "ldetail__notes" }, [
        el("span", { class: "field__label" }, "Note from tutor"),
        el("p", {}, lesson.notes),
      ]));
    }
    body.push(this._calendarRow(lesson));

    const reschedule = el("button", { class: "btn btn--primary", type: "button" }, "Request reschedule");
    const { close } = modal(`${lesson.subject || "Lesson"}`, body, [reschedule]);
    reschedule.addEventListener("click", () => { close(); this._openReschedule(lesson); });
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
    const shareCb = this._shareNotesCheckbox(false);
    const repeat = this._recurrenceControls(form);
    const submit = el("button", { class: "btn btn--primary", type: "button" }, "Add lesson");

    const { close } = modal(
      "Add a lesson",
      [
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Student"), select]),
        el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
        form.node,
        shareCb.node,
        repeat.node,
      ],
      [submit]
    );

    submit.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      const rec = repeat.value(vals); // null if "does not repeat", else recurrence obj
      if (rec === false) return; // invalid recurrence (toast already shown)
      submit.disabled = true;
      try {
        await this.provider.addLesson({
          studentId: select.value,
          startISO: vals.startISO,
          endISO: vals.endISO,
          subject: subject.value.trim(),
          notes: vals.note,
          shareNotes: shareCb.checked(),
          recurrence: rec,
        });
        close();
        toast(rec ? "Recurring lessons added." : "Lesson added.", "success");
        this._loadWeek();
      } catch (e) {
        submit.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  /** A "Share note with parent" checkbox. Returns { node, checked() }. */
  _shareNotesCheckbox(initial) {
    const cb = el("input", { type: "checkbox", ...(initial ? { checked: true } : {}) });
    const node = el("label", { class: "checkrow" }, [
      cb,
      el("span", {}, "Share the note with the parent"),
    ]);
    return { node, checked: () => cb.checked };
  }

  /**
   * Build the Repeat + Ends controls with a live preview hint. Returns
   * { node, value(vals) } where value() returns a recurrence object, null (no
   * repeat), or false (invalid — a toast was shown).
   */
  _recurrenceControls(form) {
    const freq = el("select", { class: "field__input" }, [
      el("option", { value: "" }, "Does not repeat"),
      el("option", { value: "daily" }, "Daily"),
      el("option", { value: "weekly" }, "Weekly"),
      el("option", { value: "biweekly" }, "Every 2 weeks"),
    ]);
    const endKind = el("select", { class: "field__input" }, [
      el("option", { value: "count" }, "After N lessons"),
      el("option", { value: "until" }, "On date"),
    ]);
    const count = el("input", { class: "field__input", type: "number", min: "1", max: "200", value: "8" });
    const untilDate = el("input", { class: "field__input", type: "date" });
    const hint = el("div", { class: "muted recur__hint" }, "");

    const countField = el("label", { class: "field" }, [el("span", { class: "field__label" }, "Ends after"), count]);
    const untilField = el("label", { class: "field" }, [el("span", { class: "field__label" }, "Ends on"), untilDate]);
    const endRow = el("div", { class: "form__row" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Ends"), endKind]),
      countField,
      untilField,
    ]);

    const build = (vals) => {
      if (!freq.value) return null;
      const end =
        endKind.value === "until"
          ? { kind: "until", dateISO: untilDate.value }
          : { kind: "count", count: parseInt(count.value, 10) || 0 };
      return { freq: freq.value, end };
    };

    const refresh = () => {
      const repeats = !!freq.value;
      endRow.style.display = repeats ? "" : "none";
      countField.style.display = endKind.value === "count" ? "" : "none";
      untilField.style.display = endKind.value === "until" ? "" : "none";
      if (!repeats) { hint.textContent = ""; return; }
      const vals = form.values(/*silent*/ true);
      if (!vals) { hint.textContent = ""; return; }
      hint.textContent = describeRecurrence(vals.startISO, vals.endISO, build(vals));
    };
    [freq, endKind, count, untilDate].forEach((c) => c.addEventListener("change", refresh));
    untilDate.addEventListener("input", refresh);
    count.addEventListener("input", refresh);
    refresh();

    const node = el("div", { class: "form recur" }, [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Repeat"), freq]),
      endRow,
      hint,
    ]);

    return {
      node,
      value(vals) {
        const rec = build(vals);
        if (!rec) return null;
        if (rec.end.kind === "count" && !(rec.end.count >= 1)) {
          toast("Enter how many lessons to repeat.", "error");
          return false;
        }
        if (rec.end.kind === "until" && !untilDate.value) {
          toast("Pick an end date.", "error");
          return false;
        }
        return rec;
      },
    };
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
      defaultNote: lesson.notes || "",
      noteLabel: "Lesson note (private unless shared below)",
    });
    const shareCb = this._shareNotesCheckbox(lesson.shareNotes === true);

    const isSeries = !!lesson.seriesId;
    const save = el("button", { class: "btn btn--primary", type: "button" }, "Save changes");
    const cancelLesson = el("button", { class: "btn btn--danger", type: "button" }, "Cancel lesson");

    const bodyNodes = [
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Student"), select]),
      el("label", { class: "field" }, [el("span", { class: "field__label" }, "Subject"), subject]),
      form.node,
      shareCb.node,
    ];
    if (isSeries) {
      bodyNodes.push(el("p", { class: "muted recur__note" }, "🔁 Part of a repeating series — you'll choose which lessons to change."));
    }
    bodyNodes.push(this._calendarRow(lesson));

    const { close } = modal(`Edit lesson — ${lesson.studentName}`, bodyNodes, [cancelLesson, save]);

    // Build a SPARSE patch: only fields the tutor actually changed. Avoids
    // silently rewriting every occurrence's time when only the subject changed.
    const sparsePatch = (vals) => {
      const p = {};
      if (select.value !== lesson.studentId) p.studentId = select.value;
      if (vals.startISO !== lesson.startISO) p.startISO = vals.startISO;
      if (vals.endISO !== lesson.endISO) p.endISO = vals.endISO;
      if (subject.value.trim() !== (lesson.subject || "")) p.subject = subject.value.trim();
      if ((vals.note || "") !== (lesson.notes || "")) p.notes = vals.note;
      if (shareCb.checked() !== (lesson.shareNotes === true)) p.shareNotes = shareCb.checked();
      return p;
    };

    save.addEventListener("click", async () => {
      const vals = form.values();
      if (!vals) return;
      const patch = sparsePatch(vals);
      if (Object.keys(patch).length === 0) { close(); return; } // nothing changed
      const scope = isSeries ? await this._chooseScope("change") : "one";
      if (!scope) return; // cancelled the chooser
      save.disabled = cancelLesson.disabled = true;
      try {
        if (scope === "one") await this.provider.updateLesson(lesson.id, patch);
        else await this.provider.updateLessonSeries(lesson.id, patch, scope);
        close();
        toast("Lesson updated.", "success");
        this._loadWeek();
      } catch (e) {
        save.disabled = cancelLesson.disabled = false;
        toast(e.message, "error");
      }
    });

    cancelLesson.addEventListener("click", async () => {
      const scope = isSeries ? await this._chooseScope("cancel") : "one";
      if (isSeries) {
        if (!scope) return;
      } else if (!confirm(`Cancel ${lesson.studentName}'s lesson? This removes it from the calendar.`)) {
        return;
      }
      save.disabled = cancelLesson.disabled = true;
      try {
        if (scope === "one") await this.provider.cancelLesson(lesson.id);
        else await this.provider.cancelLessonSeries(lesson.id, scope);
        close();
        toast("Lesson cancelled.", "success");
        this._loadWeek();
      } catch (e) {
        save.disabled = cancelLesson.disabled = false;
        toast(e.message, "error");
      }
    });
  }

  /**
   * Ask which occurrences a series edit/cancel applies to.
   * @param {'change'|'cancel'} verb
   * @returns {Promise<'one'|'future'|'all'|null>} null if dismissed
   */
  _chooseScope(verb) {
    return new Promise((resolve) => {
      let done = false;
      const pick = (s, close) => { done = true; close(); resolve(s); };
      const mk = (label, scope) => {
        const b = el("button", { class: "btn btn--block scope__btn", type: "button" }, label);
        b.addEventListener("click", () => pick(scope, close));
        return b;
      };
      const titleVerb = verb === "cancel" ? "Cancel" : "Change";
      const { close } = modal(
        `${titleVerb} repeating lesson`,
        [
          el("p", { class: "muted" }, `Which lessons should this ${verb === "cancel" ? "cancellation" : "change"} apply to?`),
          el("div", { class: "scope" }, [
            mk("This lesson only", "one"),
            mk("This and following lessons", "future"),
            mk("All lessons in the series", "all"),
          ]),
        ],
        []
      );
      // If the user closes the dialog (× / backdrop) without choosing, resolve null.
      const root = document.querySelector(".modal-backdrop:last-of-type");
      if (root) {
        const obs = new MutationObserver(() => {
          if (!document.body.contains(root) && !done) { obs.disconnect(); resolve(null); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  /** Builds the shared date/start/end/note sub-form. */
  _timeForm({ defaultDateISO, defaultStart, defaultEnd, defaultNote, noteLabel }) {
    const dateVal = toDateInputValue(new Date(defaultDateISO));
    const startVal = defaultStart ? hhmm(defaultStart) : "16:00";
    const endVal = defaultEnd ? hhmm(defaultEnd) : "17:00";

    const date = el("input", { class: "field__input", type: "date", value: dateVal });
    const start = el("input", { class: "field__input", type: "time", value: startVal });
    const end = el("input", { class: "field__input", type: "time", value: endVal });
    const note = el("textarea", { class: "field__input", rows: "2", placeholder: noteLabel || "Optional note to the tutor…" }, defaultNote || "");

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
      values(silent = false) {
        if (!date.value || !start.value || !end.value) {
          if (!silent) toast("Please fill in date, start and end times.", "error");
          return null;
        }
        if (end.value <= start.value) {
          if (!silent) toast("End time must be after start time.", "error");
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
