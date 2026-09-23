import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBpIHq7yUxkD_VF7N4WXw67KiNe2GPecGc",
  authDomain: "tender-cb6c2.firebaseapp.com",
  projectId: "tender-cb6c2",
  storageBucket: "tender-cb6c2.firebasestorage.app",
  messagingSenderId: "768946666746",
  appId: "1:768946666746:web:b2d4562fa79dbac26b1d43",
  measurementId: "G-BK474JVZBP"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
