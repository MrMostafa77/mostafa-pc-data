// ============================================================
// طبقة مزامنة سحابية — لا تلمس app.js إطلاقًا
// بتشتغل بالطريقة دي:
// 1) قبل ما app.js يشتغل، بتجيب آخر نسخة من بياناتك من Firestore
//    وتحطها في localStorage (بنفس المفاتيح اللي app.js أصلاً بيقرأها)
// 2) بعدين بتحمّل data-inline.js و app.js زي ما كانوا بالظبط
// 3) من لحظة ما app.js يستخدم localStorage.setItem لأي حفظ جديد،
//    الطبقة دي بتاخد نسخة وترفعها لنفس قاعدة البيانات تلقائيًا
// ============================================================

const SYNC_KEYS = [
  'gameVault_userGames_v1',
  'gameVault_dateRecords_v4',
  'gameVault_driveCapacities_v1',
  'gameVault_fieldOverrides_v1',
  'gameVault_sizeDeleted_v1',
  'gameVault_sizeOverrides_v1',
  'mostafa_pc_date_options_v1',
  'mostafa_pc_deleted_games_v1'
];

// صور الأغلفة المخصصة لها معاملة منفصلة: كل لعبة في مستند خاص بيها
// بدل ما تتكدس كلها في نفس مستند البيانات الرئيسي. مستندات Firestore
// محدودة بـ 1 ميجا لكل مستند، وصور الأغلفة (base64) كانت بتوصّل
// لهذا الحد بسرعة فيفشل الحفظ بصمت وترجع الصورة تختفي بعد فترة.
const COVER_KEY = 'gameVault_coverOverrides_v1';
const COVER_SUBCOLLECTION = 'gamevault_covers';

const FS_COLLECTION = 'gamevault';
const FS_DOC = 'mostafa_library';

let db = null;
let syncReady = false;

function isFirebaseConfigured() {
  return typeof firebaseConfig !== 'undefined' &&
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('ضع_هنا');
}

function loadCoreScripts() {
  const s1 = document.createElement('script');
  s1.src = 'js/data-inline.js';
  s1.onload = () => {
    const s2 = document.createElement('script');
    s2.src = 'js/app.js';
    document.body.appendChild(s2);
  };
  document.body.appendChild(s1);
}

function patchLocalStorage() {
  const nativeSetItem = localStorage.setItem.bind(localStorage);
  const nativeGetItem = localStorage.getItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    const oldValue = key === COVER_KEY ? nativeGetItem(key) : null;
    nativeSetItem(key, value);
    if (!syncReady || !db) return;

    if (SYNC_KEYS.includes(key)) {
      const payload = {};
      payload[key] = value;
      db.collection(FS_COLLECTION).doc(FS_DOC).set(payload, { merge: true })
        .catch(err => console.error('Cloud sync failed for', key, err));
    } else if (key === COVER_KEY) {
      syncCoverOverrides(oldValue, value);
    }
  };
}

function syncCoverOverrides(oldJson, newJson) {
  try {
    const oldObj = oldJson ? JSON.parse(oldJson) : {};
    const newObj = newJson ? JSON.parse(newJson) : {};
    const ids = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    ids.forEach(id => {
      const oldVal = oldObj[id];
      const newVal = newObj[id];
      if (oldVal === newVal) return;
      const docRef = db.collection(COVER_SUBCOLLECTION).doc(String(id));
      if (newVal === undefined) {
        docRef.delete().catch(err => console.error('Cloud cover delete failed for', id, err));
      } else {
        docRef.set({ cover: newVal }).catch(err => console.error('Cloud cover sync failed for', id, err));
      }
    });
  } catch (e) {
    console.error('Cover sync diff failed', e);
  }
}

async function hydrateFromCloud() {
  if (!db) return;
  try {
    const snap = await db.collection(FS_COLLECTION).doc(FS_DOC).get();
    if (snap.exists) {
      const data = snap.data();
      SYNC_KEYS.forEach(key => {
        if (data[key] !== undefined) {
          localStorage.setItem.call(localStorage, key, data[key]);
        }
      });
    } else {
      // أول مرة: ارفع أي بيانات محلية موجودة كنقطة بداية
      const initial = {};
      SYNC_KEYS.forEach(key => {
        const v = localStorage.getItem(key);
        if (v !== null) initial[key] = v;
      });
      if (Object.keys(initial).length) {
        await db.collection(FS_COLLECTION).doc(FS_DOC).set(initial, { merge: true });
      }
    }
  } catch (e) {
    console.error('Cloud hydrate failed, continuing with local data only', e);
  }
}

async function hydrateCoverOverrides() {
  if (!db) return;
  try {
    const snap = await db.collection(COVER_SUBCOLLECTION).get();
    if (!snap.empty) {
      const obj = {};
      snap.forEach(doc => {
        const data = doc.data();
        if (data && data.cover) obj[doc.id] = data.cover;
      });
      localStorage.setItem.call(localStorage, COVER_KEY, JSON.stringify(obj));
    } else {
      // أول مرة: ارفع أي صور أغلفة محلية موجودة كنقطة بداية
      const local = localStorage.getItem(COVER_KEY);
      if (local) {
        const obj = JSON.parse(local);
        const writes = Object.keys(obj).map(id =>
          db.collection(COVER_SUBCOLLECTION).doc(String(id)).set({ cover: obj[id] })
        );
        await Promise.all(writes).catch(err => console.error('Initial cover upload failed', err));
      }
    }
  } catch (e) {
    console.error('Cover hydrate failed, continuing with local covers only', e);
  }
}

async function init() {
  patchLocalStorage();

  if (isFirebaseConfigured()) {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      await hydrateFromCloud();
      await hydrateCoverOverrides();
      syncReady = true;
    } catch (e) {
      console.error('Firebase init failed, continuing with local storage only', e);
    }
  }
  // لو مفيش إعدادات Firebase، الموقع هيشتغل زي ما كان بالظبط (حفظ محلي فقط)

  loadCoreScripts();
}

init();
