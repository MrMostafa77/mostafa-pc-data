// ============================================================
// GameVault — النسخ الاحتياطي + عدّاد الاستهلاك + حجم البيانات
// ملف مستقل: لا يعدّل app.js. يظهر كزر عائم بعد تسجيل الدخول.
// ============================================================
(function () {
  'use strict';

  const FREE = { reads: 50000, writes: 20000, deletes: 20000, storageBytes: 1024 * 1024 * 1024 };

  const fmtInt = n => Number(n || 0).toLocaleString('en-US');
  const fmtSize = b => {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(b / 1024).toLocaleString('en-US') + ' KB';
  };
  const colorFor = pct => (pct >= 90 ? '#e25555' : (pct >= 60 ? '#d9822b' : '#2e9e5b'));

  let panel = null;
  let usageTimer = null;

  function projectId() {
    try { return (typeof firebaseConfig !== 'undefined' && firebaseConfig.projectId) || 'project'; }
    catch (e) { return 'project'; }
  }
  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }

  function setMsg(text, kind) {
    const el = document.getElementById('gvbk-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'err' ? '#e25555' : (kind === 'ok' ? '#2e9e5b' : 'inherit');
  }

  // ---------- قراءة البيانات المحلية (المتزامنة مع السحابة) ----------
  function syncKeys() {
    return (window.GameVaultCloudSync && window.GameVaultCloudSync.keys) || [];
  }

  async function readCovers() {
    if (!window.CoverStore) return { data: {}, meta: {} };
    const [data, meta] = await Promise.all([window.CoverStore.getAll(), window.CoverStore.getAllMeta()]);
    return { data: data || {}, meta: meta || {} };
  }

  async function buildBackup(includeCovers) {
    const keys = {};
    syncKeys().forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) keys[k] = v;
    });
    const out = {
      format: 'gamevault-backup', version: 1,
      createdAt: new Date().toISOString(),
      projectId: projectId(),
      keys: keys,
      covers: {}
    };
    if (includeCovers) {
      const c = await readCovers();
      Object.keys(c.data).forEach(id => {
        out.covers[id] = { data: c.data[id], updatedAt: c.meta[id] || 0 };
      });
    }
    return out;
  }

  function downloadJson(obj, name) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const fileName = tag => 'gamevault-backup' + (tag ? '-' + tag : '') + '-' + projectId() + '-' + stamp() + '.json';

  async function onDownload() {
    const btn = document.getElementById('gvbk-dl');
    btn.disabled = true; setMsg('جاري تجهيز النسخة الاحتياطية...');
    try {
      const inc = document.getElementById('gvbk-covers').checked;
      const b = await buildBackup(inc);
      downloadJson(b, fileName(''));
      setMsg('تم تنزيل النسخة: ' + Object.keys(b.keys).length + ' مجموعة بيانات، ' + Object.keys(b.covers).length + ' غلاف. احفظها في مكان آمن.', 'ok');
    } catch (e) {
      console.error(e);
      setMsg('تعذر إنشاء النسخة: ' + (e && e.message ? e.message : e), 'err');
    } finally { btn.disabled = false; }
  }

  async function waitForSync(maxMs) {
    const cs = window.GameVaultCloudSync;
    if (!cs || !cs.isReady()) return false;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (!cs.hasPending()) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return !cs.hasPending();
  }

  async function onRestoreFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      let b;
      try { b = JSON.parse(await file.text()); } catch (e) { setMsg('الملف غير صالح (ليس JSON سليماً).', 'err'); return; }
      if (!b || b.format !== 'gamevault-backup' || !b.keys || typeof b.keys !== 'object') {
        setMsg('هذا الملف ليس نسخة احتياطية من GameVault.', 'err'); return;
      }
      const allowed = new Set(syncKeys());
      const keyNames = Object.keys(b.keys).filter(k => allowed.has(k));
      const coverIds = Object.keys(b.covers || {});
      if (!keyNames.length && !coverIds.length) { setMsg('النسخة فارغة.', 'err'); return; }

      const summary = 'سيتم استبدال بياناتك الحالية بمحتوى النسخة:\n' +
        '- تاريخ النسخة: ' + (b.createdAt || '؟') + '\n' +
        '- المشروع: ' + (b.projectId || '؟') + '\n' +
        '- مجموعات البيانات: ' + keyNames.length + '\n' +
        '- الأغلفة: ' + coverIds.length + '\n\n' +
        'سيتم تنزيل نسخة من وضعك الحالي تلقائياً قبل الاستبدال.\n\n' +
        'اكتب كلمة: استرجاع   للتأكيد';
      const answer = prompt(summary);
      if (!answer || answer.trim() !== 'استرجاع') { setMsg('تم إلغاء الاسترجاع.'); return; }

      setMsg('جاري أخذ نسخة أمان من الوضع الحالي...');
      downloadJson(await buildBackup(true), fileName('BEFORE-RESTORE'));

      setMsg('جاري الاسترجاع...');
      keyNames.forEach(k => { localStorage.setItem(k, String(b.keys[k])); }); // setItem معدّلة: بترفع للسحابة تلقائياً

      let coverFail = 0;
      if (coverIds.length && window.CoverStore) {
        const local = await readCovers();
        for (let i = 0; i < coverIds.length; i++) {
          const id = coverIds[i];
          const item = b.covers[id];
          if (!item || !item.data) continue;
          if (local.data[id] === item.data) continue; // نفس الغلاف، لا داعي لكتابة
          setMsg('جاري استرجاع الأغلفة ' + (i + 1) + ' / ' + coverIds.length + '...');
          const ts = Date.now();
          await window.CoverStore.set(id, item.data, ts);
          if (window.GameVaultCloudSync && window.GameVaultCloudSync.isReady()) {
            const ok = await window.GameVaultCloudSync.uploadCover(id, item.data, ts);
            if (ok === false) coverFail++;
          }
        }
      }

      setMsg('جاري رفع البيانات للسحابة... لا تغلق الصفحة.');
      const synced = await waitForSync(90000);
      if (synced && !coverFail) {
        setMsg('تم الاسترجاع ورفعه للسحابة بنجاح. جاري إعادة تحميل الصفحة...', 'ok');
        setTimeout(() => location.reload(), 1500);
      } else {
        setMsg('تم الاسترجاع على هذا الجهاز لكن رفعه للسحابة لم يكتمل (' + (coverFail ? coverFail + ' غلاف فشل. ' : '') +
          'ربما وصلت لحد الاستهلاك اليومي). لا تعمل تحديث للصفحة الآن، وإلا ترجع بيانات السحابة القديمة. انتظر لتجديد الحد اليومي وأعد الاسترجاع.', 'err');
      }
    } catch (e) {
      console.error(e);
      setMsg('فشل الاسترجاع: ' + (e && e.message ? e.message : e) + '. نسخة الأمان التي نُزّلت تحفظ وضعك السابق.', 'err');
    }
  }

  // ---------- العرض ----------
  function usageRow(label, used, limit) {
    const pct = limit ? used / limit * 100 : 0;
    const c = colorFor(pct);
    return '<div style="margin:6px 0"><div>' + label + ': <b style="color:' + c + '">' + fmtInt(used) +
      '</b> من ' + fmtInt(limit) + ' (' + pct.toFixed(pct < 10 ? 1 : 0) + '%)</div>' +
      '<div style="height:6px;border-radius:4px;background:rgba(128,128,128,.25);overflow:hidden;margin-top:3px">' +
      '<div style="height:100%;width:' + Math.min(100, pct).toFixed(1) + '%;background:' + c + '"></div></div></div>';
  }

  function renderUsage() {
    const el = document.getElementById('gvbk-usage');
    if (!el || !window.GVUsage) return;
    const u = window.GVUsage.get();
    const poll = window.GameVaultCloudSync && window.GameVaultCloudSync.pollIntervalMs;
    el.innerHTML =
      usageRow('القراءات', u.reads, FREE.reads) +
      usageRow('الكتابات', u.writes, FREE.writes) +
      usageRow('المسح', u.deletes, FREE.deletes) +
      '<div style="opacity:.75;font-size:12px;margin-top:6px">يوم العدّاد (بتوقيت المحيط الهادي): ' + u.day +
      (poll ? ' — الفحص الاحتياطي كل ' + Math.round(poll / 1000) + ' ثانية' : '') + '</div>';
  }

  async function renderSize() {
    const el = document.getElementById('gvbk-size');
    if (!el) return;
    try {
      let keysBytes = 0;
      syncKeys().forEach(k => { const v = localStorage.getItem(k); if (v) keysBytes += v.length; });
      const c = await readCovers();
      let covBytes = 0; let covCount = 0;
      Object.keys(c.data).forEach(id => { covBytes += (c.data[id] || '').length; covCount++; });
      const total = keysBytes + covBytes;
      const pct = total / FREE.storageBytes * 100;
      el.innerHTML = '<div>بيانات الألعاب والتواريخ: <b>' + fmtSize(keysBytes) + '</b></div>' +
        '<div>الأغلفة: <b>' + covCount + '</b> غلاف (' + fmtSize(covBytes) + ')</div>' +
        '<div>المجموع التقريبي في السحابة: <b style="color:' + colorFor(pct) + '">' + fmtSize(total) +
        '</b> من 1,024 MB (' + pct.toFixed(1) + '%)</div>';
    } catch (e) {
      el.textContent = 'تعذر قياس الحجم.';
    }
  }

  function build() {
    const wrap = document.createElement('div');
    wrap.id = 'gvbk-overlay';
    wrap.setAttribute('dir', 'rtl');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:12px';
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" style="width:min(560px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;' +
      'background:var(--panel,#20241A);color:var(--parchment,#E8E0C7);border:1px solid var(--line-strong,rgba(232,224,199,.28));' +
      'border-radius:14px;padding:18px;font-family:var(--font-body,Tahoma,Arial,sans-serif);line-height:1.7;font-size:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<h3 style="margin:0;font-size:17px">النسخ الاحتياطي والاستهلاك</h3>' +
      '<button type="button" id="gvbk-close" aria-label="إغلاق" style="cursor:pointer;background:none;border:0;color:inherit;font-size:22px;line-height:1">×</button></div>' +

      '<h4 style="margin:14px 0 4px">استهلاك Firebase اليوم (هذا الجهاز فقط، تقريبي)</h4>' +
      '<div id="gvbk-usage"></div>' +
      '<div style="opacity:.75;font-size:12px">العدّاد يحسب هذا الجهاز فقط. الرقم الكلي لكل أجهزتك في Firebase Console ← Firestore ← Usage. الحدود المجانية المذكورة هي المعتادة على خطة Spark؛ راجع صفحة الأسعار للحدود الحالية.</div>' +

      '<h4 style="margin:16px 0 4px">حجم البيانات</h4>' +
      '<div id="gvbk-size">جاري القياس...</div>' +

      '<h4 style="margin:16px 0 4px">النسخ الاحتياطي</h4>' +
      '<div style="opacity:.85;font-size:13px">ينزّل ملف JSON فيه بيانات الألعاب والتواريخ والتصنيفات والأغلفة. احفظه بعيداً عن GitHub. يُنصح بنسخة أسبوعياً وقبل أي تعديل كبير.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0">' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="gvbk-covers" checked> تضمين الأغلفة (يكبّر الملف)</label>' +
      '<button type="button" id="gvbk-dl" style="cursor:pointer;padding:8px 14px;border-radius:10px;border:0;background:var(--brass,#C9963F);color:#14170F;font-weight:700">تنزيل نسخة احتياطية</button>' +
      '<button type="button" id="gvbk-restore" style="cursor:pointer;padding:8px 14px;border-radius:10px;border:1px solid var(--line-strong,rgba(232,224,199,.28));background:transparent;color:inherit">استرجاع من ملف</button>' +
      '<input type="file" id="gvbk-file" accept=".json,application/json" style="display:none"></div>' +
      '<div id="gvbk-msg" role="status" style="min-height:20px;font-size:13px"></div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#gvbk-close').onclick = close;
    wrap.querySelector('#gvbk-dl').onclick = onDownload;
    wrap.querySelector('#gvbk-restore').onclick = () => wrap.querySelector('#gvbk-file').click();
    wrap.querySelector('#gvbk-file').addEventListener('change', onRestoreFile);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel && panel.style.display !== 'none') close(); });
    return wrap;
  }

  function open() {
    if (!panel) panel = build();
    panel.style.display = 'flex';
    setMsg('');
    renderUsage(); renderSize();
    clearInterval(usageTimer);
    usageTimer = setInterval(renderUsage, 2000);
  }
  function close() {
    if (panel) panel.style.display = 'none';
    clearInterval(usageTimer); usageTimer = null;
  }

  function addButton() {
    if (document.getElementById('gvbk-fab')) return;
    const b = document.createElement('button');
    b.id = 'gvbk-fab';
    b.type = 'button';
    b.title = 'النسخ الاحتياطي والاستهلاك';
    b.setAttribute('aria-label', 'النسخ الاحتياطي والاستهلاك');
    b.textContent = '📊';
    b.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99990;width:44px;height:44px;border-radius:50%;cursor:pointer;' +
      'font-size:20px;line-height:1;border:1px solid var(--line-strong,rgba(232,224,199,.28));' +
      'background:var(--panel,#20241A);color:var(--parchment,#E8E0C7);box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:.85';
    b.onclick = open;
    document.body.appendChild(b);
  }

  function start() {
    if (window.GameVaultAuthReady && typeof window.GameVaultAuthReady.then === 'function') {
      window.GameVaultAuthReady.then(addButton).catch(() => {});
    } else {
      addButton();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
