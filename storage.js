import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Garante que o aparelho esteja "logado" de forma anônima no Firebase antes de
// qualquer leitura/gravação. As regras do banco passam a exigir isso.
let authPromise = null;
function ensureAuth() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!authPromise) {
    authPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          resolve(user);
        } else {
          signInAnonymously(auth).catch((err) => {
            unsub();
            authPromise = null; // permite tentar de novo na próxima chamada
            reject(err);
          });
        }
      });
    });
  }
  return authPromise;
}

// Mesma "forma" de resposta que o app já espera: { key, value } ou null
export const storage = {
  async get(key) {
    await ensureAuth();
    const ref = doc(db, 'appdata', key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { key, value: snap.data().value };
  },
  async set(key, value) {
    await ensureAuth();
    const ref = doc(db, 'appdata', key);
    await setDoc(ref, { value });
    return { key, value };
  },
  // Varre todos os documentos da coleção cujo nome comece com `prefix` (ex: "product:").
  // Usado para recuperar registros "órfãos" caso um índice seja perdido.
  async listByPrefix(prefix) {
    await ensureAuth();
    const snap = await getDocs(collection(db, 'appdata'));
    const out = [];
    snap.forEach((d) => {
      if (d.id.startsWith(prefix)) out.push({ key: d.id, value: d.data().value });
    });
    return out;
  },
};
