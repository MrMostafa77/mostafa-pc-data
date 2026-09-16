// ============================================================
// طبقة تخزين صور الأغلفة — IndexedDB بدل localStorage
// ------------------------------------------------------------
// ليه التغيير؟
// كانت الصور بتتخزن كنص base64 داخل localStorage (حده الفعلي
// 5-10 ميجا فقط في أغلب المتصفحات)، وأي فشل في الحفظ كان بيتبلع
// بصمت (catch فاضي) من غير ما يظهر لك أي تنبيه.
//
// IndexedDB بيوفر مساحة تخزين محلية أكبر بمراحل (مئات الميجابايت
// في العادة)، وهنا كمان بنظهر تنبيه واضح لو أي حفظ فشل فعلاً.
//
// كل صورة متخزنة كـ { data: <base64>, updatedAt: <رقم الوقت> }
// عشان js/cloud-sync.js يقدر يقارن مع النسخة السحابية ويعرف مين أحدث.
// ============================================================
(function () {
  const DB_NAME = 'GameVaultCovers';
  const STORE = 'covers';
  const OLD_LOCALSTORAGE_KEY = 'gameVault_coverOverrides_v1';

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB غير مدعوم في هذا المتصفح')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllRaw() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const out = {};
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
          else resolve(out);
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch (e) {
      console.error('CoverStore.getAllRaw failed', e);
      return {};
    }
  }

  // بيرجع خريطة مسطّحة {id: dataUrl} — دي اللي app.js بيستخدمها مباشرة
  async function getAll() {
    const raw = await getAllRaw();
    const out = {};
    Object.keys(raw).forEach(id => { out[id] = (raw[id] && raw[id].data) || raw[id]; });
    return out;
  }

  // بيرجع خريطة {id: updatedAt} — دي اللي cloud-sync.js بيستخدمها للمقارنة
  async function getAllMeta() {
    const raw = await getAllRaw();
    const out = {};
    Object.keys(raw).forEach(id => { out[id] = (raw[id] && raw[id].updatedAt) || 0; });
    return out;
  }

  async function set(id, dataUrl, updatedAt) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ data: dataUrl, updatedAt: updatedAt || Date.now() }, String(id));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function remove(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(String(id));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ترحيل تلقائي لمرة واحدة: أي صور كانت محفوظة سابقًا في localStorage
  // (اللي كانت بتوصل لحد المساحة وتفشل بصمت) بننقلها لـ IndexedDB،
  // وبعد كده بنفضي المفتاح القديم من localStorage عشان نوفر مساحة.
  let migrated = false;
  async function migrateFromLocalStorageOnce() {
    if (migrated) return;
    migrated = true;
    try {
      const raw = localStorage.getItem(OLD_LOCALSTORAGE_KEY);
      if (!raw) return;
      const old = JSON.parse(raw);
      const ids = Object.keys(old || {});
      for (const id of ids) {
        await set(id, old[id], Date.now());
      }
      localStorage.removeItem(OLD_LOCALSTORAGE_KEY);
      if (ids.length) console.log('[CoverStore] تم نقل', ids.length, 'صورة من localStorage القديم إلى IndexedDB بنجاح');
    } catch (e) {
      console.error('[CoverStore] فشل ترحيل الصور القديمة', e);
    }
  }

  function showToast(message, isError) {
    try {
      const div = document.createElement('div');
      div.textContent = message;
      div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
        'background:' + (isError ? '#c0392b' : '#27ae60') + ';color:#fff;padding:10px 18px;border-radius:8px;' +
        'font-size:14px;z-index:99999;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:90vw;text-align:center;' +
        'font-family:inherit;';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), isError ? 6000 : 2500);
    } catch (e) { /* لو مفيش body لسه، تجاهل التنبيه بدل ما نكسر الصفحة */ }
  }

  window.CoverStore = { getAll, getAllMeta, set, remove, migrateFromLocalStorageOnce, showToast };
})();
