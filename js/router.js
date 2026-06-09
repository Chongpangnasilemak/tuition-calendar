// Minimal hash router. Routes:
//   #/week      weekly calendar (default)
//   #/requests  requests list / approvals
// Login is handled by the shell (shown whenever there is no viewer), so the
// router only runs for signed-in users.

import { clear } from "./util.js";
import { WeekView } from "./views/week-view.js";
import { RequestsView } from "./views/requests-view.js";
import { ManageView } from "./views/manage-view.js";
import { DashboardView } from "./views/dashboard-view.js";

export class Router {
  constructor(mount, provider) {
    this.mount = mount;
    this.provider = provider;
    this.viewer = null;
    window.addEventListener("hashchange", () => this._renderRoute());
  }

  setViewer(viewer) {
    this.viewer = viewer;
  }

  route() {
    return (location.hash || "#/week").replace(/^#/, "");
  }

  go(path) {
    if (this.route() === path) this._renderRoute();
    else location.hash = path;
  }

  render() {
    this._renderRoute();
  }

  async _renderRoute() {
    if (!this.viewer) return; // shell shows login
    clear(this.mount);
    const path = this.route();
    let view;
    if (path.startsWith("/requests")) {
      view = new RequestsView(this.mount, this.provider, this.viewer);
    } else if (path.startsWith("/manage") && this.viewer.role === "tutor") {
      view = new ManageView(this.mount, this.provider, this.viewer);
    } else if (path.startsWith("/dashboard") && this.viewer.role === "tutor") {
      view = new DashboardView(this.mount, this.provider, this.viewer);
    } else {
      view = new WeekView(this.mount, this.provider, this.viewer);
    }
    await view.render();
  }
}
