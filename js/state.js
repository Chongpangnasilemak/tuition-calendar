// Tiny shared app state: the current viewer + a change subscription.
// The provider is the source of truth for auth; this just caches the latest
// viewer and lets the shell re-render when it changes.

export const state = {
  viewer: null, // Viewer | null
  mode: "demo", // 'demo' | 'live'
};

const subs = new Set();

export function setViewer(v) {
  state.viewer = v;
  for (const cb of subs) cb(v);
}

export function onViewerChange(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
