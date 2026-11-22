import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Колдонулуп жаткан Firebase долбоору: tender-cb6c2.
// Бул веб-конфигурациянын apiKey мааниси Firebase'тин жашыруун сервер ачкычы эмес.
const firebaseConfig = {
  apiKey: 'AIzaSyBpIHq7yUxkD_VF7N4WXw67KiNe2GPecGc',
  authDomain: 'tender-cb6c2.firebaseapp.com',
  projectId: 'tender-cb6c2',
  storageBucket: 'tender-cb6c2.firebasestorage.app',
  messagingSenderId: '768946666746',
  appId: '1:768946666746:web:b2d4562fa79dbac26b1d43',
  measurementId: 'G-BK474JVZBP',
};

// Башка Firebase колдонмосу мурда түзүлгөн болсо, анын базасын жаңылыш
// тандабашыбыз керек. Дайыма tender-cb6c2 долбооруна туташабыз.
const apps = getApps();
const matchingApp = apps.find(app => app.options.projectId === firebaseConfig.projectId);
export const firebaseApp = matchingApp || initializeApp(
  firebaseConfig,
  apps.some(app => app.name === '[DEFAULT]') ? 'tender-baza-cb6c2' : undefined
);
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
