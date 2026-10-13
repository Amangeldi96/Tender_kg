import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBpIHq7yUxkD_VF7N4WXw67KiNe2GPecGc",
  authDomain: "tender-cb6c2.firebaseapp.com",
  projectId: "tender-cb6c2",
  storageBucket: "tender-cb6c2.firebasestorage.app",
  messagingSenderId: "768946666746",
  appId: "1:768946666746:web:b2d4562fa79dbac26b1d43",
  measurementId: "G-BK474JVZBP"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

export const analyticsPromise =
  typeof window !== "undefined"
    ? isSupported().then((supported) =>
        supported ? getAnalytics(app) : null
      )
    : Promise.resolve(null);

export { app };
export default app;
