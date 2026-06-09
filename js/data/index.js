// -----------------------------------------------------------------------------
// getProvider() — picks the backend ONCE and caches it.
//
// Decision order (first match wins). The SAFE DEFAULT is demo: a committed
// placeholder firebase-config.js forces demo on GitHub Pages, so the public
// build never talks to a real database by accident.
//
//   1. URL ?demo=1                                       -> MockProvider (override)
//   2. URL ?live=1 AND real config present               -> FirebaseProvider
//   3. firebase-config.js apiKey is real (non-placeholder) -> FirebaseProvider
//   4. otherwise (absent / placeholder / import fails)   -> MockProvider (default)
//
// The Firebase SDK is only fetched when we actually go live (dynamic import in
// firebase-provider.js), so demo mode downloads nothing from Firebase.
// -----------------------------------------------------------------------------

import { firebaseConfig } from "../../firebase-config.js";

export function isRealConfig(cfg) {
  return (
    !!cfg &&
    typeof cfg.apiKey === "string" &&
    cfg.apiKey.length > 10 &&
    !cfg.apiKey.startsWith("DEMO") &&
    !cfg.apiKey.includes("YOUR_")
  );
}

let _provider = null;

export async function getProvider() {
  if (_provider) return _provider;

  const params = new URLSearchParams(location.search);
  const forceDemo = params.get("demo") === "1";
  const forceLive = params.get("live") === "1";

  let useFirebase = false;
  if (forceDemo) useFirebase = false;
  else if (forceLive && isRealConfig(firebaseConfig)) useFirebase = true;
  else if (isRealConfig(firebaseConfig)) useFirebase = true;

  if (useFirebase) {
    const { FirebaseProvider } = await import("./firebase-provider.js");
    _provider = new FirebaseProvider(firebaseConfig);
  } else {
    const { MockProvider } = await import("./mock-provider.js");
    _provider = new MockProvider();
  }
  await _provider.init();
  return _provider;
}

export function getMode() {
  return _provider && _provider.constructor.name === "FirebaseProvider"
    ? "live"
    : "demo";
}
