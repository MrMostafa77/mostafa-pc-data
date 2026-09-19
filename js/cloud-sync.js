// ============================================================
// طبقة مزامنة سحابية — لا تلمس app.js إطلاقًا
// ============================================================
// v2 (2026-09-19): كل "مفتاح" (Game Dates, Library, Favorites...) بقى ليه
// مستند صغير خاص بيه + Chunks منفصلة (بالظبط زي أغلفة الصور)، بدل ما كل
// المفاتيح تتحشر مع بعض في مستند واحد بحد أقصى 1 ميجا. ده كان السبب الحقيقي
// إن "Game Dates" بالذات بتفشل بصمت: مستند "mostafa_library" كان وصل لحد
// الـ1,048,576 بايت المسموح به في Firestore ولسه محتاج يكبر (سجلات اللعب
// بتزيد كل ما تضيف تاريخ لعبة جديدة)، فأي كتابة كانت بترفض بالكامل.
// دلوقتي كل مفتاح مستقل تمامًا وله سقف مستقل، فمينفعش مفتاح واحد يوقف باقي
// المفاتيح، ومفيش سقف عملي على حجم Game Dates بعد كده.
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
// ملحوظة: صور الأغلفة (gameVault_coverOverrides_v1 سابقًا) مش في القايمة دي —
// ليها نظامها الخاص تحت (uploadCoverToCloud / hydrateCovers) لأسباب مشابهة.

const FS_KEYS_COLLECTION = 'gamevault_store'; // {key} (metadata: totalChunks, v) + {key}/chunks/{n}
const FS_LEGACY_COLLECTION = 'gamevault';     // المستند القديم — للترحيل مرة واحدة بس
const FS_LEGACY_DOC = 'mostafa_library';
const COVERS_COLLECTION = 'covers'; // covers/{gameId} (metadata) + covers/{gameId}/chunks/{n} (بيانات الصورة)
const CHUNK_SIZE = 700000; // ~700 ألف حرف لكل جزء — بعيد جدًا وآمن عن حد الـ1 ميجا لكل مستند

let db = null;
let syncReady = false;
let applyingRemote = false;
let unsubscribeCore = null;
let realtimePollTimer = null;
let legacyMigrationChecked = false;
const pendingCloudWrites = Object.create(null);
const remoteVersions = Object.create(null); // last version WE fetched/applied per key

function isFirebaseConfigured() {
  return typeof firebaseConfig !== 'undefined' &&
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('ضع_هنا');
}

function loadCoreScripts() {
  // هذول هما كود التطبيق الفعلي (بما فيه الـlistener اللي بيحدّث الشاشة
  // لحظيًا). تحميلهم من غير version كان معناه إن بعض الموبايلات/التابلت ممكن
  // تفضل شغالة بنسخة قديمة متكاشة من app.js للأبد (حتى بعد reload يدوي)،
  // وده بيظهر بالظبط كأن المزامنة "مش بتوصل لحظيًا" أو إن تبويب معين "مش
  // بيسمع خالص". لازم النسخة دي تتزود مع كل تحديث كود (راجع index.html).
  const v = window.__APP_VERSION || '1';
  const s1 = document.createElement('script');
  s1.src = 'js/data-inline.js?v=' + v;
  s1.onload = () => {
    const s2 = document.createElement('script');
    s2.src = 'js/app.js?v=' + v;
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

function showSyncToast(message, isError) {
  if (window.CoverStore) window.CoverStore.showToast(message, isError);
}

let cloudWriteTimers = Object.create(null);
function queueCloudWrite(key, value) {
  clearTimeout(cloudWriteTimers[key]);
  const version = Date.now();
  pendingCloudWrites[key] = true;
  cloudWriteTimers[key] = setTimeout(() => {
    uploadKeyToCloud(key, value, version)
      .then(() => {
        // Record this write's own version so the exact-match dedup in
        // reconcileMeta() skips re-fetching our own echo back from the listener.
        remoteVersions[key] = version;
        delete pendingCloudWrites[key];
      })
      .catch(err => {
        delete pendingCloudWrites[key];
        console.error('Cloud sync failed for', key, err);
        window.SoundFX?.playError();
        showSyncToast(
          'فشلت مزامنة "' + key + '" مع السحابة، هيتم إعادة المحاولة تلقائيًا: ' + (err && err.message ? err.message : err),
          true
        );
        clearTimeout(cloudWriteTimers['retry:' + key]);
        cloudWriteTimers['retry:' + key] = setTimeout(() => queueCloudWrite(key, value), 4000);
      });
  }, 50);
}

// كل مفتاح بقى ليه مستند خاص بيه تحت gamevault_store/{key} + subcollection
// chunks — بالظبط نفس أسلوب صور الأغلفة، فمفيش سقف 1 ميجا مشترك بين كل
// المفاتيح تاني، وأي مفتاح ممكن يكبر لوحده براحته.
async function uploadKeyToCloud(key, value, version) {
  const keyRef = db.collection(FS_KEYS_COLLECTION).doc(key);
  const chunksRef = keyRef.collection('chunks');
  const str = String(value == null ? '' : value);

  const oldChunksSnap = await chunksRef.get();
  const chunks = [];
  for (let i = 0; i < str.length; i += CHUNK_SIZE) chunks.push(str.slice(i, i + CHUNK_SIZE));
  if (chunks.length === 0) chunks.push(''); // keep at least one empty chunk for an empty value

  const batch = db.batch();
  oldChunksSnap.forEach(docSnap => batch.delete(docSnap.ref));
  chunks.forEach((chunk, idx) => batch.set(chunksRef.doc(String(idx)), { d: chunk }));
  batch.set(keyRef, { totalChunks: chunks.length, v: version, updatedAt: version });
  await batch.commit();
}

async function fetchKeyFromCloud(key) {
  const chunksSnap = await db.collection(FS_KEYS_COLLECTION).doc(key).collection('chunks').get();
  const parts = [];
  chunksSnap.forEach(docSnap => parts.push({ idx: Number(docSnap.id), d: (docSnap.data() || {}).d || '' }));
  parts.sort((a, b) => a.idx - b.idx);
  return parts.map(p => p.d).join('');
}

function nativeSetLocal(key, value) {
  const setter = window.__GameVaultNativeSetItem || localStorage.setItem.bind(localStorage);
  setter(key, value);
}

// بتاخد قايمة {key: {v, totalChunks}} (من onSnapshot أو من get عادي)، تقارنها
// بآخر نسخة عارفينها، وتجيب بس المفاتيح اللي فعلاً اتغيرت من جهاز/تبويب تاني.
//
// ملحوظة مهمة: مقارنة الأرقام دي بتستخدم "هل الرقم مختلف عن اللي عندنا؟"
// مش "هل الرقم أكبر من اللي عندنا؟". الفرق ده مهم جدًا: الأرقام دي أصلاً
// مبنية على ساعة كل جهاز (Date.now())، وساعات الأجهزة (خصوصًا التابلت
// والموبايل) ممكن تكون مش مظبوطة أو فيها فرق توقيت عن بعض. لو استخدمنا
// "أكبر من" وساعة جهاز معين قدّام بدقايق، أي تحديث جاي من جهاز تاني هيتجاهل
// على طول (لأن رقمه هيبان "أقدم") — وده كان السبب الحقيقي إن المزامنة
// الحية مش بتوصل خالص إلا بعد reload (اللي بيقرا القيمة الحالية مباشرة من
// غير ما يقارن أرقام خالص).
async function reconcileMeta(metaByKey) {
  const changedKeys = [];
  for (const key of SYNC_KEYS) {
    const meta = metaByKey[key];
    if (!meta) continue;
    const remoteVersion = Number(meta.v || meta.updatedAt || 0);
    const knownRemoteVersion = Number(remoteVersions[key] || 0);

    if (pendingCloudWrites[key]) continue; // نستنى الكتابة المحلية تخلص الأول
    if (remoteVersion && remoteVersion === knownRemoteVersion) continue; // معالجينها قبل كده بالظبط، مفيش داعي نجيبها تاني

    try {
      const value = await fetchKeyFromCloud(key);
      if (remoteVersion) remoteVersions[key] = remoteVersion;
      const current = localStorage.getItem(key);
      if (current !== value) {
        applyingRemote = true;
        try { nativeSetLocal(key, value); } finally { applyingRemote = false; }
        changedKeys.push(key);
      }
    } catch (e) {
      console.error('Fetch key failed for', key, e);
    }
  }
  if (changedKeys.length) {
    window.dispatchEvent(new CustomEvent('gamevault:cloud-update', { detail: { keys: changedKeys } }));
  }
}

function subscribeToCloud() {
  if (!db || unsubscribeCore) return;
  unsubscribeCore = db.collection(FS_KEYS_COLLECTION).onSnapshot(
    snap => {
      const metaByKey = {};
      snap.forEach(docSnap => { metaByKey[docSnap.id] = docSnap.data() || {}; });
      reconcileMeta(metaByKey);
    },
    err => {
      console.error('Cloud realtime listener failed', err);
      window.SoundFX?.playError();
    }
  );
}

// بعض متصفحات التابلت/الموبايل قد تفقد قناة Firestore realtime مؤقتًا
// (خصوصًا مع WebView أو تغيير الشبكة). الفحص ده بيجيب بس المستندات الصغيرة
// (metadata) من السيرفر مباشرة كل شوية، وما بيجيبش بيانات المفاتيح الكبيرة
// (زي Game Dates) إلا لو فعلاً اتغيرت — رخيص وسريع.
async function pollFromServer() {
  if (!syncReady || !db) return;
  try {
    const snap = await db.collection(FS_KEYS_COLLECTION).get({ source: 'server' });
    const metaByKey = {};
    snap.forEach(docSnap => { metaByKey[docSnap.id] = docSnap.data() || {}; });
    await reconcileMeta(metaByKey);
  } catch (e) {
    console.warn('Realtime fallback poll failed', e);
  }
}
function startRealtimeFallbackPoll() {
  if (realtimePollTimer || !db) return;
  realtimePollTimer = setInterval(pollFromServer, 2000);
}

// شبكة أمان إضافية فوق onSnapshot + الفحص الدوري: لما المتصفح يحط التاب في
// وضع نوم (الشاشة اتقفلت، التطبيق راح للخلفية، الشبكة اتغيرت) ممكن الاتنين
// يقفوا عن العمل مؤقتًا من غير ما "يرجعوا لوحدهم" بشكل مضمون على كل جهاز.
// فبمجرد ما التاب يرجع يبقى مرئي/فوكس، أو النت يرجع، بنعمل فحص فوري من
// السيرفر مباشرة — كده التحديثات بتوصل خلال ثانية من غير ما تحتاج reload.
let reconnectBound = false;
function bindReconnectSafetyNet() {
  if (reconnectBound) return;
  reconnectBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollFromServer();
  });
  window.addEventListener('focus', pollFromServer);
  window.addEventListener('online', pollFromServer);
}

// ترحيل لمرة واحدة: لو مفيش أي مستندات في gamevault_store لسه (تحديث لأول
// مرة على الجهاز/المشروع)، هات القيم القديمة من المستند المُجمّع القديم
// (gamevault/mostafa_library) وابدأ منها بدل ما تبدأ فاضي.
async function migrateLegacyDocIfNeeded(existingKeys) {
  if (legacyMigrationChecked) return;
  legacyMigrationChecked = true;
  const missing = SYNC_KEYS.filter(k => !existingKeys.has(k));
  if (!missing.length) return;
  try {
    const legacySnap = await db.collection(FS_LEGACY_COLLECTION).doc(FS_LEGACY_DOC).get();
    if (!legacySnap.exists) return;
    const legacyData = legacySnap.data() || {};
    for (const key of missing) {
      if (legacyData[key] === undefined) continue;
      const value = String(legacyData[key]);
      nativeSetLocal(key, value);
      await uploadKeyToCloud(key, value, Date.now());
    }
  } catch (e) {
    console.error('Legacy migration failed', e);
  }
}

async function hydrateFromCloud() {
  if (!db) return;
  try {
    const snap = await db.collection(FS_KEYS_COLLECTION).get();
    const existingKeys = new Set();
    snap.forEach(docSnap => existingKeys.add(docSnap.id));

    await migrateLegacyDocIfNeeded(existingKeys);

    for (const key of SYNC_KEYS) {
      if (!existingKeys.has(key)) continue;
      try {
        const value = await fetchKeyFromCloud(key);
        nativeSetLocal(key, value);
        const metaDoc = snap.docs.find(d => d.id === key);
        const v = Number((metaDoc && metaDoc.data() && metaDoc.data().v) || Date.now());
        remoteVersions[key] = v;
      } catch (e) {
        console.error('Hydrate fetch failed for', key, e);
      }
    }

    // أي مفتاح عندنا محليًا بس مش موجود سحابيًا خالص (أول مرة يستخدم الموقع
    // من هنا) — ارفعه كنقطة بداية.
    for (const key of SYNC_KEYS) {
      if (existingKeys.has(key)) continue;
      const v = localStorage.getItem(key);
      if (v === null) continue;
      try {
        const version = Date.now();
        await uploadKeyToCloud(key, v, version);
        remoteVersions[key] = version;
      } catch (e) {
        console.error('Initial upload failed for', key, e);
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
    showSyncToast(
      'الصورة اتحفظت على جهازك، لكن رفعها للسحابة (للمزامنة مع باقي أجهزتك) فشل: ' + (e && e.message ? e.message : e),
      true
    );
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
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      // Firestore's realtime listener uses a long-lived streaming
      // connection (WebChannel). Many mobile networks, carrier proxies and
      // some WiFi routers/tablets don't handle that connection well — the
      // stream silently stalls and no more updates arrive until the page
      // is fully reloaded (which opens a brand-new connection). Forcing
      // long-polling avoids that failure mode entirely. MUST be called
      // before any other Firestore call.
      try {
        db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
      } catch (settingsErr) {
        console.warn('Firestore settings() failed', settingsErr);
      }
      await hydrateFromCloud();
      syncReady = true;
      subscribeToCloud();
      startRealtimeFallbackPoll();
      bindReconnectSafetyNet();
    } catch (e) {
      console.error('Firebase init failed, continuing with local storage only', e);
    }
  }
  // لو مفيش إعدادات Firebase، الموقع هيشتغل زي ما كان بالظبط (حفظ محلي فقط)

  await hydrateCovers();
  loadCoreScripts();
}

// لو auth-gate.js متحمّل، ننتظر تسجيل الدخول الأول قبل ما نبدأ فعليًا
// (تحميل البيانات، الاتصال بـ Firestore، تحميل app.js...). لو مش
// متحمّل (تم حذفه لأي سبب) نشتغل عادي زي الأول.
if (window.GameVaultAuthReady) {
  window.GameVaultAuthReady.then(init);
} else {
  init();
}
