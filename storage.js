import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Mesma "forma" de resposta que o app já espera: { key, value } ou null
export const storage = {
  async get(key) {
    const ref = doc(db, 'appdata', key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { key, value: snap.data().value };
  },
  async set(key, value) {
    const ref = doc(db, 'appdata', key);
    await setDoc(ref, { value });
    return { key, value };
  },
};
