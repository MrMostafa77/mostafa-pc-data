// ============================================================
// طبقة مزامنة سحابية — لا تلمس app.js إطلاقًا
// بتشتغل بالطريقة دي:
// 1) قبل ما app.js يشتغل، بتجيب آخر نسخة من بياناتك من Firestore
//    وتحطها في localStorage (بنفس المفاتيح اللي app.js أصلاً بيقرأها)
// 2) بعدين بتحمّل data-inline.js و app.js زي ما كانوا بالظبط
// 3) من لحظة ما app.js يستخدم localStorage.setItem لأي حفظ جديد،
//    الطبقة دي بتاخد نسخة وترفعها لنفس قاعدة البيانات تلقائيًا
// 4) بتشترك في onSnapshot عشان أي تغيير من جهاز/تبويب آخر يظهر لحظيًا
// ============================================================

const SYNC_KEYS = [
  'gameVault_userGames_v1',
  'gameVault_dateRecords_v4',
  'gameVault_driveCapacities_v1',
  'gameVault_fieldOverrides_v1',
  'gameVault_sizeDeleted_v1',
  'gameVault_sizeOverrides_v1',
  'mostafa_pc_date_options_v1',
  'mostafa_pc_deleted_games_v1',
  'gameVault_favorites_v1',
  'gameVault_gameTags_v1',
  'gameVault_upcomingGames_v1'
];
// ملحوظة: صور الأغلفة (gameVault_coverOverrides_v1 سابقًا) اتشالت من هنا عمدًا.
// كانت بتترفع كنص base64 ضخم داخل نفس مستند Firestore، اللي حده 1 ميجا فقط،
// فسريعًا كانت بتوصل للحد وتفشل بصمت. دلوقتي الصور بتتخزن محليًا في IndexedDB
// (مساحة أكبر بمراحل) وبتتزامن سحابيًا عبر Firestore بس (بدون Firebase Storage
// اللي بقى محتاج خطة Blaze المدفوعة) — كل صورة بتتقسم لأجزاء صغيرة (chunks) في
// مستندات منفصلة عشان محدش يوصل لحد الـ1 ميجا. راجع uploadCoverToCloud /
// removeCoverFromCloud / hydrateCovers تحت.

const FS_COLLECTION = 'gamevault';
const FS_DOC = 'mostafa_library';
const COVERS_COLLECTION = 'covers'; // covers/{gameId} (metadata) + covers/{gameId}/chunks/{n} (بيانات الصورة)
const CHUNK_SIZE = 700000; // ~700 ألف حرف لكل جزء — بعيد جدًا وآمن عن حد الـ1 ميجا لكل مستند

let db = null;
let syncReady = false;
let applyingRemote = false;
let unsubscribeCore = null;
let realtimePollTimer = null;
let lastRemoteFingerprint = '';
let lastSnapshotAt = 0;

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
  if (window.__GameVaultLocalStoragePatched) return;
  window.__GameVaultLocalStoragePatched = true;

  // Patch the Storage prototype, not just the instance. Some mobile/tablet
  // browsers expose localStorage.setItem as a native non-overridable method.
  const proto = Storage.prototype;
  const nativeSetItem = proto.setItem.bind(localStorage);
  const nativeRemoveItem = proto.removeItem.bind(localStorage);
  window.__GameVaultNativeSetItem = nativeSetItem;
  window.__GameVaultNativeRemoveItem = nativeRemoveItem;

  proto.setItem = function(key, value) {
    nativeSetItem(key, value);
    if (syncReady && db && !applyingRemote && SYNC_KEYS.includes(key)) {
      queueCloudWrite(key, value);
    }
  };

  proto.removeItem = function(key) {
    nativeRemoveItem(key);
    // Keep existing behavior for local-only settings.
    // Synced stores currently use setItem for persistence.
  };
}

let cloudWriteTimers = Object.create(null);
function queueCloudWrite(key, value) {
  clearTimeout(cloudWriteTimers[key]);
  cloudWriteTimers[key] = setTimeout(() => {
    const payload = {};
    payload[key] = value;
    db.collection(FS_COLLECTION).doc(FS_DOC).set(payload, { merge: true })
      .catch(err => {
        console.error('Cloud sync failed for', key, err);
        window.SoundFX?.playError();
      });
  }, 50);
}

function applyRemoteCoreData(data) {
  const changedKeys = [];
  // Ignore duplicate snapshots/polls with identical payloads.
  try {
    const fp = JSON.stringify(SYNC_KEYS.map(key => data[key] === undefined ? null : String(data[key])));
    if (fp === lastRemoteFingerprint) return;
    lastRemoteFingerprint = fp;
  } catch (e) {}
  applyingRemote = true;
  try {
    SYNC_KEYS.forEach(key => {
      if (data[key] === undefined) return;
      const next = String(data[key]);
      const current = localStorage.getItem(key);
      if (current !== next) {
        nativeSetLocal(key, next);
        changedKeys.push(key);
      }
    });
  } finally {
    applyingRemote = false;
  }
  if (changedKeys.length) {
    window.dispatchEvent(new CustomEvent('gamevault:cloud-update', { detail: { keys: changedKeys } }));
  }
}

function nativeSetLocal(key, value) {
  const setter = window.__GameVaultNativeSetItem || localStorage.setItem.bind(localStorage);
  setter(key, value);
}

function subscribeToCloud() {
  if (!db || unsubscribeCore) return;
  unsubscribeCore = db.collection(FS_COLLECTION).doc(FS_DOC).onSnapshot(
    snap => {
      lastSnapshotAt = Date.now();
      if (!snap.exists) return;
      applyRemoteCoreData(snap.data() || {});
    },
    err => {
      console.error('Cloud realtime listener failed', err);
      window.SoundFX?.playError();
    }
  );
}


// بعض متصفحات التابلت/الموبايل قد تفقد قناة Firestore realtime مؤقتًا
// (خصوصًا مع WebView أو تغيير الشبكة). نستخدم فحصًا خفيفًا جدًا كشبكة أمان.
// الـ onSnapshot يظل المسار الأساسي، والفحص لا يعيد معالجة نفس البيانات.
function startRealtimeFallbackPoll() {
  if (realtimePollTimer || !db) return;
  realtimePollTimer = setInterval(async () => {
    if (!syncReady || !db) return;
    // لا نحتاج polling متكرر طالما الـ listener شغال بشكل طبيعي.
    if (Date.now() - lastSnapshotAt < 2500) return;
    try {
      const snap = await db.collection(FS_COLLECTION).doc(FS_DOC).get({ source: 'server' });
      if (snap.exists) applyRemoteCoreData(snap.data() || {});
    } catch (e) {
      console.warn('Realtime fallback poll failed', e);
    }
  }, 2500);
}

async function hydrateFromCloud() {
  if (!db) return;
  try {
    const snap = await db.collection(FS_COLLECTION).doc(FS_DOC).get();
    if (snap.exists) {
      const data = snap.data();
      SYNC_KEYS.forEach(key => {
        if (data[key] !== undefined) {
          nativeSetLocal(key, data[key]);
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
    window.SoundFX?.playError();
  }
}

// ============== مزامنة صور الأغلفة عبر Firestore فقط (بدون Storage) ==============
// كل صورة بتتقسم لأجزاء نصية صغيرة (chunks) وتتخزن في مستندات منفصلة تحت
// covers/{gameId}/chunks/{index}، ومستند covers/{gameId} نفسه بيحتفظ بس بعدد
// الأجزاء ووقت آخر تحديث (updatedAt) عشان أي جهاز يقدر يعرف هل محتاج يجيب
// نسخة أحدث ولا لأ من غير ما يقرأ كل الصور في كل مرة.

async function uploadCoverToCloud(id, dataUrl, updatedAt) {
  if (!syncReady || !db) return;
  try {
    const gameRef = db.collection(COVERS_COLLECTION).doc(String(id));
    const chunksRef = gameRef.collection('chunks');

    // امسح أي أجزاء قديمة أولاً (لو الصورة الجديدة عدد أجزائها مختلف عن القديمة)
    const oldChunksSnap = await chunksRef.get();
    const chunks = [];
    for (let i = 0; i < dataUrl.length; i += CHUNK_SIZE) chunks.push(dataUrl.slice(i, i + CHUNK_SIZE));

    const batch = db.batch();
    oldChunksSnap.forEach(docSnap => batch.delete(docSnap.ref));
    chunks.forEach((chunk, idx) => batch.set(chunksRef.doc(String(idx)), { d: chunk }));
    batch.set(gameRef, { totalChunks: chunks.length, updatedAt: updatedAt || Date.now() });
    await batch.commit();
  } catch (e) {
    console.error('Cloud cover upload failed for', id, e);
    if (window.CoverStore) {
      window.CoverStore.showToast(
        'الصورة اتحفظت على جهازك، لكن رفعها للسحابة (للمزامنة مع باقي أجهزتك) فشل: ' + (e && e.message ? e.message : e),
        true
      );
    }
    window.SoundFX?.playError();
  }
}

async function removeCoverFromCloud(id) {
  if (!syncReady || !db) return;
  try {
    const gameRef = db.collection(COVERS_COLLECTION).doc(String(id));
    const chunksSnap = await gameRef.collection('chunks').get();
    const batch = db.batch();
    chunksSnap.forEach(docSnap => batch.delete(docSnap.ref));
    batch.delete(gameRef);
    await batch.commit();
  } catch (e) {
    console.error('Cloud cover remove failed for', id, e);
  }
}

// بيرجع خريطة {gameId: updatedAt} من غير ما يجيب الصور نفسها — قراءة خفيفة
// جدًا (مستند واحد صغير لكل لعبة) بنستخدمها بس عشان نعرف مين محتاج تحديث.
async function getCoverManifestFromCloud() {
  if (!db) return {};
  try {
    const snap = await db.collection(COVERS_COLLECTION).get();
    const out = {};
    snap.forEach(docSnap => { out[docSnap.id] = (docSnap.data() || {}).updatedAt || 0; });
    return out;
  } catch (e) {
    console.error('Fetch cover manifest failed', e);
    return {};
  }
}

// بيجيب الصورة كاملة (كل الأجزاء مجمّعة بالترتيب الصحيح) للعبة معيّنة
async function fetchCoverFromCloud(id) {
  if (!db) return null;
  try {
    const chunksSnap = await db.collection(COVERS_COLLECTION).doc(String(id)).collection('chunks').get();
    const parts = [];
    chunksSnap.forEach(docSnap => parts.push({ idx: Number(docSnap.id), d: (docSnap.data() || {}).d || '' }));
    parts.sort((a, b) => a.idx - b.idx);
    const data = parts.map(p => p.d).join('');
    return data || null;
  } catch (e) {
    console.error('Fetch cover failed for', id, e);
    return null;
  }
}

// بيجهّز window.GameVaultCoverOverrides قبل ما app.js يشتغل:
// 1) بيرحّل أي صور قديمة كانت في localStorage لـ IndexedDB
// 2) بياخد نسخة الصور المحفوظة محليًا على هذا الجهاز (سريعة، من غير إنترنت)
// 3) لو فيه مزامنة سحابية شغالة، بيقارن تاريخ كل صورة محليًا مقابل السحابة،
//    ويجيب بس الصور اللي اتحدثت من جهاز تاني (مش بيعيد تحميل كل حاجة كل مرة)
// 4) لو صورة اتمسحت من جهاز تاني، بيشيلها من هنا كمان
async function hydrateCovers() {
  let local = {};
  let localMeta = {};
  if (window.CoverStore) {
    await window.CoverStore.migrateFromLocalStorageOnce();
    local = await window.CoverStore.getAll();
    localMeta = await window.CoverStore.getAllMeta();
  }

  const merged = Object.assign({}, local);

  if (syncReady) {
    try {
      const manifest = await getCoverManifestFromCloud();

      for (const id of Object.keys(manifest)) {
        const remoteUpdatedAt = manifest[id] || 0;
        const localUpdatedAt = localMeta[id] || 0;
        if (remoteUpdatedAt > localUpdatedAt) {
          const data = await fetchCoverFromCloud(id);
          if (data) {
            merged[id] = data;
            if (window.CoverStore) window.CoverStore.set(id, data, remoteUpdatedAt).catch(() => {});
          }
        }
      }

      // لو صورة موجودة محليًا بس مش موجودة في السحابة، معناها اتمسحت من جهاز تاني
      Object.keys(local).forEach(id => {
        if (!(id in manifest)) delete merged[id];
      });
    } catch (e) {
      console.error('Cover hydrate from cloud failed, using local covers only', e);
    }
  }

  window.GameVaultCoverOverrides = merged;
}

window.GameVaultCloudSync = {
  uploadCover: uploadCoverToCloud,
  removeCover: removeCoverFromCloud,
  isReady: () => syncReady
};

async function init() {
  patchLocalStorage();

  if (isFirebaseConfigured()) {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      await hydrateFromCloud();
      syncReady = true;
      subscribeToCloud();
      startRealtimeFallbackPoll();
    } catch (e) {
      console.error('Firebase init failed, continuing with local storage only', e);
    }
  }
  // لو مفيش إعدادات Firebase، الموقع هيشتغل زي ما كان بالظبط (حفظ محلي فقط)

  await hydrateCovers();
  loadCoreScripts();
}

init();
