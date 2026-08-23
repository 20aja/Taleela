import {initializeApp} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence, signInAnonymously} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-trapOJ-EbVhWuoz0p7_oBpLSkkYCxng",
  authDomain: "taleela-3a077.firebaseapp.com",
  projectId: "taleela-3a077",
  storageBucket: "taleela-3a077.firebasestorage.app",
  messagingSenderId: "186697289462",
  appId: "1:186697289462:web:49d39c5c7500aafbfee6d7",
};

export const app = initializeApp(firebaseConfig);

// Persistent IndexedDB cache makes room restoration and repeat visits faster.
// Multiple-tab mode avoids the old single-tab lock when the same player opens
// Taleela in more than one tab. Persistent web cache is supported by current
// Chrome, Safari, and Firefox; test private/incognito modes separately.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}),
});

export const auth = getAuth(app);
let authPromise = null;

/** Ensures the browser keeps a stable anonymous Firebase identity. */
export function ensureAuth() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (authPromise) return authPromise;

  authPromise = (async () => {
    await setPersistence(auth, browserLocalPersistence);

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

    if (existingUser) return existingUser;
    const credential = await signInAnonymously(auth);
    return credential.user;
  })().finally(() => {
    authPromise = null;
  });

  return authPromise;
}
