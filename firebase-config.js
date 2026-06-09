// -----------------------------------------------------------------------------
// Firebase configuration.
//
// THIS COMMITTED FILE IS A PLACEHOLDER. While apiKey starts with "DEMO_" (or
// contains "YOUR_"), the app runs in DEMO MODE with in-memory mock data and
// never contacts Firebase. This is what makes the public GitHub Pages build a
// safe, self-contained demo.
//
// To run against a real Firebase project (see README "Go live"):
//   1. Create a Firebase project + a Web App, enable Email/Password auth and
//      Firestore.
//   2. Replace the values below with your real config.
//   3. Deploy firestore.rules and firestore.indexes.json with the Firebase CLI.
//   4. Provision /admins, /users, /students in the console (see README).
//
// Firebase web config values are NOT secrets (they ship to every browser);
// access is controlled by the security rules in firestore.rules. Even so, for a
// public repo prefer committing only the placeholder and injecting real values
// at deploy time, or keep a private fork.
// -----------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "DEMO_PLACEHOLDER_no_real_project_attached",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
