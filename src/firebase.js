import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: "AIzaSyBMhmqgki-Jv6tStI85xzZuh2H4inGEFHg",
    authDomain: "thi-online-nhc.firebaseapp.com",
    projectId: "thi-online-nhc",
    storageBucket: "thi-online-nhc.firebasestorage.app",
    messagingSenderId: "696590815921",
    appId: "1:696590815921:web:be8b98a15fbfb3457d8890",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
