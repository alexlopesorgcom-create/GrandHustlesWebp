const admin = require("firebase-admin");

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON");
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required service account fields");
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  if (expectedProjectId && serviceAccount.project_id !== expectedProjectId) {
    throw new Error("Firebase service account project does not match FIREBASE_PROJECT_ID");
  }

  return serviceAccount;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

const db = admin.firestore();

module.exports = { admin, db };
