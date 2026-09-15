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
  'gameVault_coverOverrides_v1',
  'gameVault_dateRecords_v4',
  'gameVault_driveCapacities_v1',
  'gameVault_fieldOverrides_v1',
  'gameVault_sizeDeleted_v1',
  'gameVault_sizeOverrides_v1',
  'mostafa_pc_date_options_v1',
  'mostafa_pc_deleted_games_v1'
];

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
  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (syncReady && db && SYNC_KEYS.includes(key)) {
      const payload = {};
      payload[key] = value;
      db.collection(FS_COLLECTION).doc(FS_DOC).set(payload, { merge: true })
        .catch(err => console.error('Cloud sync failed for', key, err));
    }
  };
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

async function init() {
  patchLocalStorage();

  if (isFirebaseConfigured()) {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      await hydrateFromCloud();
      syncReady = true;
    } catch (e) {
      console.error('Firebase init failed, continuing with local storage only', e);
    }
  }
  // لو مفيش إعدادات Firebase، الموقع هيشتغل زي ما كان بالظبط (حفظ محلي فقط)

  loadCoreScripts();
}

init();
