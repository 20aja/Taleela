import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-trapOJ-EbVhWuoz0p7_oBpLSkkYCxng",
  authDomain: "taleela-3a077.firebaseapp.com",
  projectId: "taleela-3a077",
  storageBucket: "taleela-3a077.firebasestorage.app",
  messagingSenderId: "186697289462",
  appId: "1:186697289462:web:49d39c5c7500aafbfee6d7",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

let authPromise = null;

/**
 * Ensures every browser tab has a stable anonymous Firebase identity.
 * Session persistence keeps the same UID across refreshes while allowing
 * separate tabs to act as separate players during local multiplayer tests.
 */
export function ensureAuth() {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  if (authPromise) {
    return authPromise;
  }

  authPromise = (async () => {
    await setPersistence(auth, browserSessionPersistence);

    const existingUser = await new Promise((resolve) => {
      let resolved = false;
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (resolved) return;
        resolved = true;
        unsubscribe();
        resolve(user || null);
      });

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        unsubscribe();
        resolve(auth.currentUser || null);
      }, 1500);
    });

    if (existingUser) {
      return existingUser;
    }

    const credential = await signInAnonymously(auth);
    return credential.user;
  })().finally(() => {
    authPromise = null;
  });

  return authPromise;
}
