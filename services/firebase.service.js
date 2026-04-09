const admin = require("firebase-admin");
const serviceAccount = require("../config/firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

exports.verifyFirebaseToken = async (token) => {
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded;
};