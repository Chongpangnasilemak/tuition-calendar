// Weekly calendar view.
//
// Receives { weekStartISO, lessons:[...] } from the provider — already
// anonymized for the current viewer — and renders a Mon–Sun grid. It branches
// ONLY on lesson.anonymous / lesson.mine; it never sees a foreign name.
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
  mondayOf,
  weekRangeLabel,
  toDateInputValue,
  localToISO,
} from "../util.js";
import { lessonBlock, modal, toast } from "./components.js";

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

    const header = el("div", { class: "week__bar" }, [
      el("div", { class: "week__nav" }, [
        el("button", { class: "btn btn--ghost", type: "button", onClick: () => this._shift(-7) }, "← Prev"),
        el("button", { class: "btn btn--ghost", type: "button", onClick: () => this._today() }, "This week"),
        el("button", { class: "btn btn--ghost", type: "button", onClick: () => this._shift(7) }, "Next →"),
      ]),
      el("div", { class: "week__range" }, weekRangeLabel(this.weekStart.toISOString())),
      isParent
        ? el("button", { class: "btn btn--primary", type: "button", onClick: () => this._openAdditional() }, "+ Request additional lesson")
        : el("div", { class: "week__hint" }, "Tutor view — all lessons shown in full detail"),
    ]);
    this.mount.appendChild(header);

    const legend = isParent
      ? el("div", { class: "legend" }, [
          el("span", { class: "legend__item" }, [el("span", { class: "swatch swatch--mine" }), "Your child"]),
          el("span", { class: "legend__item" }, [el("span", { class: "swatch swatch--busy" }), "Busy (another student — name hidden)"]),
        ])
      : null;
    if (legend) this.mount.appendChild(legend);

    const grid = el("div", { class: "grid" });
    this.mount.appendChild(grid);
    this.grid = grid;

    await this._loadWeek();
  }

  async _loadWeek() {
    clear(this.grid);
    this.grid.appendChild(el("div", { class: "grid__loading" }, "Loading schedule…"));

    let data;
    try {
      data = await this.provider.getWeekSchedule(this.weekStart.toISOString());
    } catch (e) {
      clear(this.grid);
      this.grid.appendChild(el("div", { class: "error" }, `Could not load schedule: ${e.message}`));
      return;
    }

    clear(this.grid);

    // Build 7 day-columns.
    const columns = [];
    for (let i = 0; i < 7; i++) {
      const colDate = addDays(this.weekStart, i);
      const col = el("div", { class: "col" }, [
        el("div", { class: "col__head" }, [
          el("span", { class: "col__day" }, dayLabel(i)),
          el("span", { class: "col__date" }, fmtDate(colDate.toISOString())),
        ]),
      ]);
      const body = el("div", { class: "col__body" });
      col.appendChild(body);
      columns.push(body);
      this.grid.appendChild(col);
    }

    let count = 0;
    for (const lesson of data.lessons) {
      const i = dowIndex(new Date(lesson.startISO));
      columns[i].appendChild(
        lessonBlock(lesson, {
          onReschedule: (l) => this._openReschedule(l),
        })
      );
      count++;
    }

    if (count === 0) {
      this.grid.appendChild(el("div", { class: "grid__empty" }, "No lessons this week."));
    }
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

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
