/* ============================================================
   GameVault — Insights tab (standalone, read-only)
   تقرير: ابحث عن لعبة → شوف السلسلة وعدد مرات اللعب وآخر مرة لعبتها.
   ملف مستقل: لا يعدّل app.js ولا يكتب في أي بيانات المشروع.
   ============================================================ */
(function () {
  'use strict';
  if (window.__gvInsightsLoaded) return;
  window.__gvInsightsLoaded = true;

  var LS = window.localStorage;
  var K = {
    user: 'gameVault_userGames_v1', ov: 'gameVault_fieldOverrides_v1', del: 'mostafa_pc_deleted_games_v1',
    dates: 'gameVault_dateRecords_v4', lang: 'gameVault_lang_v1'
  };
  function lj(k, f) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? f : v; } catch (e) { return f; } }
  function L() { return LS.getItem(K.lang) === 'ar' ? 'ar' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  /* ---------- i18n ---------- */
  var T = {
    tab: ['Insights', 'التحليلات'],
    title: ['Game Play Report', 'تقرير اللعبة'],
    sub: ['Search the library, pick a game, and see its series, how many times you played it and when you last finished it.', 'ابحث في المكتبة واختار لعبة لتشوف سلسلتها وعدد مرات لعبها وآخر مرة أنهيتها.'],
    ph: ['Search by game name...', 'ابحث باسم اللعبة...'],
    game: ['Game', 'اللعبة'], series: ['Series', 'السلسلة'], plays: ['Times played', 'عدد مرات اللعب'],
    last: ['Last played (end date)', 'آخر مرة لُعبت (تاريخ النهاية)'],
    solo: ['Standalone (no series)', 'بدون سلسلة (مستقلة)'],
    never: ['Never played', 'لم تُلعب بعد'],
    now: ['Playing now', 'قيد اللعب حاليًا'], since: ['started', 'بدأت في'],
    noend: ['No end date recorded', 'لا يوجد تاريخ نهاية مسجّل'],
    today: ['today', 'اليوم'], ago: ['ago', 'مضت'], day: ['day', 'يوم'], days: ['days', 'يوم'],
    top_t: ['Most Played Games', 'أكثر الألعاب لعبًا'],
    order: ['Order', 'الترتيب'], desc: ['Most played first', 'الأكثر لعبًا أولًا (تنازلي)'], asc: ['Least played first', 'الأقل لعبًا أولًا (تصاعدي)'],
    played_n: ['Games played', 'ألعاب تم لعبها'], total_plays: ['Total plays', 'إجمالي مرات اللعب'],
    col_game: ['Game', 'اللعبة'], col_plays: ['Times played', 'عدد مرات اللعب'], col_last: ['Last played', 'آخر لعب'],
    more: ['Show more', 'عرض المزيد'], shown: ['Showing', 'المعروض'], of: ['of', 'من'],
    top_note: ['Only games with at least one play record are listed. Ties are ordered by most recent play.', 'بتظهر الألعاب اللي ليها سجل لعب واحد على الأقل. لو العدد متساوي بيترتبوا بالأحدث لعبًا.'],
    hint: ['Start typing a game name to see matches.', 'اكتب اسم لعبة لتظهر لك الألعاب المشابهة.']
  };
  function t(k) { var v = T[k]; return v ? v[L() === 'ar' ? 1 : 0] : k; }
  function dig(s) { return L() === 'ar' ? String(s).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }) : String(s); }

  /* ---------- البيانات (قراءة فقط) ---------- */
  var norm = function (s) { return String(s || '').replace(/[\u00A0\u2000-\u200B]/g, ' ').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar'); };
  var ISO = /^\d{4}-\d{2}-\d{2}/;
  function validDate(v) { return typeof v === 'string' && ISO.test(v) ? v.slice(0, 10) : null; }

  function build() {
    var GD = window.GameVaultData || {};
    var del = {}; lj(K.del, []).forEach(function (i) { del[Number(i)] = 1; });
    var ov = lj(K.ov, {});
    var games = (GD.games || []).concat(lj(K.user, [])).filter(function (g) { return !del[Number(g.id)]; }).map(function (g) {
      return Object.assign({}, g, ov[g.id] || {});
    });
    var recs = lj(K.dates, null);
    if (!Array.isArray(recs)) recs = GD.playLogs || [];
    return { games: games, recs: recs };
  }

  function stats(g, D) {
    var key = norm(g.name), rows = D.recs.filter(function (r) {
      return r && ((r.gameId != null && Number(r.gameId) === Number(g.id)) || (key && norm(r.name) === key));
    });
    var last = null, open = null;
    rows.forEach(function (r) {
      var e = validDate(r.end);
      if (e && (!last || e > last)) last = e;
      if (!e && r.start && String(r.end || '') !== 'Postponed') { var s = validDate(r.start); if (s && (!open || s > open)) open = s; }
    });
    var ge = validDate(g.endDate); if (ge && (!last || ge > last)) last = ge;
    return { count: rows.length, last: last, open: open };
  }

  function daysAgo(iso) {
    var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null;
    var n = new Date(); return Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - d) / 864e5);
  }

  /* ---------- البحث (نفس أسلوب بحث المكتبة) ---------- */
  // يبدأ بـ (startsWith) أولًا، ولو مفيش نتيجة يرجع لـ (يحتوي). ولو كتبت أكتر من اسم بفاصلة، بيبحث في آخر اسم.
  function matches(q) {
    var m = D.games.filter(function (g) { return (g.name || '').toLowerCase().indexOf(q) === 0; });
    if (!m.length) m = D.games.filter(function (g) { return (g.name || '').toLowerCase().indexOf(q) >= 0; });
    var seen = {}, out = [];
    m.forEach(function (g) { if (!seen[g.name]) { seen[g.name] = 1; out.push(g); } });
    return out;
  }
  function splitQuery(raw) {
    var i = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('،'));
    return { prefix: i >= 0 ? raw.slice(0, i + 1) + ' ' : '', q: (i >= 0 ? raw.slice(i + 1) : raw).replace(/^\s+/, '').toLowerCase() };
  }

  /* ---------- الواجهة ---------- */
  var D = { games: [], recs: [] }, root = null, navBtn = null, input = null, sugg = null, out = null, active = -1, current = [];

  function labelNav() { if (!navBtn) return; var l = navBtn.querySelector('.tab-label'); if (l) l.textContent = t('tab'); }
  function isActive() { return root && root.classList.contains('active'); }

  function drawFrame() {
    root.setAttribute('dir', L() === 'ar' ? 'rtl' : 'ltr');
    root.innerHTML = '<div class="gvi-head"><h2>' + esc(t('title')) + '</h2><p>' + esc(t('sub')) + '</p></div>' +
      '<div class="gvi-search"><input autocomplete="off" class="search-input" id="gvi-q" type="text" placeholder="' + esc(t('ph')) + '"/><div class="search-sugg" id="gvi-sugg"></div></div>' +
      '<div id="gvi-out"><div class="gvi-empty">' + esc(t('hint')) + '</div></div><div id="gvi-top"></div>';
    topLimit = 25; renderTop();
    input = root.querySelector('#gvi-q'); sugg = root.querySelector('#gvi-sugg'); out = root.querySelector('#gvi-out');
    input.addEventListener('input', function () { showSugg(); });
    input.addEventListener('focus', function () { showSugg(); });
    input.addEventListener('keydown', function (e) {
      var items = sugg.querySelectorAll('.sugg-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return; e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (it, i) { it.classList.toggle('active', i === active); });
        if (items[active].scrollIntoView) items[active].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault(); if (current.length) pick(current[active >= 0 ? active : 0]);
      } else if (e.key === 'Escape') { sugg.classList.remove('open'); }
    });
    sugg.addEventListener('mousedown', function (e) {
      var it = e.target.closest && e.target.closest('.sugg-item'); if (!it) return;
      e.preventDefault(); pick(current[+it.getAttribute('data-i')]);
    });
  }

  function showSugg() {
    D = build();
    var sq = splitQuery(input.value); active = -1;
    if (!sq.q) { current = []; sugg.classList.remove('open'); return; }
    current = matches(sq.q);
    if (!current.length) { sugg.classList.remove('open'); return; }
    sugg.innerHTML = current.map(function (g, i) {
      var label = String(g.name), idx = label.toLowerCase().indexOf(sq.q);
      var hl = idx >= 0 ? esc(label.slice(0, idx)) + '<b>' + esc(label.slice(idx, idx + sq.q.length)) + '</b>' + esc(label.slice(idx + sq.q.length)) : esc(label);
      return '<div class="sugg-item" data-i="' + i + '"><img class="sugg-thumb" src="assets/covers/' + esc(g.id) + '.jpg" onerror="this.style.visibility=\'hidden\'" alt=""><span style="flex:1">' + hl + '</span><span class="s-meta">' + esc(g.year || '') + ' · ' + esc(g.hdd || '') + '</span></div>';
    }).join('');
    sugg.classList.add('open');
  }

  function lastText(s) {
    if (s.last) {
      var a = daysAgo(s.last), rel = a == null ? '' : (a <= 0 ? t('today') : (L() === 'ar' ? t('ago') + ' ' + dig(a) + ' ' + (a === 1 ? t('day') : t('days')) : dig(a) + ' ' + (a === 1 ? t('day') : t('days')) + ' ' + t('ago')));
      return esc(dig(s.last)) + (rel ? '<small class="gvi-rel">' + esc(rel) + '</small>' : '');
    }
    if (s.open) return esc(t('now')) + '<small class="gvi-rel">' + esc(t('since')) + ' ' + esc(dig(s.open)) + '</small>';
    return esc(s.count ? t('noend') : t('never'));
  }

  /* ---------- تقرير: أكثر الألعاب لعبًا ---------- */
  var topDir = 'desc', topLimit = 25;
  function renderTop() {
    var el = root && root.querySelector('#gvi-top'); if (!el) return;
    D = build();
    var seen = {}, rows = [];
    D.games.forEach(function (g) {
      var k = norm(g.name); if (seen[k]) return; seen[k] = 1;
      var st = stats(g, D); if (st.count > 0) rows.push({ g: g, s: st });
    });
    rows.sort(function (a, b) {
      var d = topDir === 'asc' ? a.s.count - b.s.count : b.s.count - a.s.count; if (d) return d;
      var la = a.s.last || '', lb = b.s.last || ''; if (la !== lb) return la < lb ? 1 : -1;
      return String(a.g.name).localeCompare(String(b.g.name));
    });
    var maxC = rows.reduce(function (m, r) { return Math.max(m, r.s.count); }, 1);
    var total = rows.reduce(function (m, r) { return m + r.s.count; }, 0);
    var shown = rows.slice(0, topLimit);
    var body = shown.map(function (r, i) {
      var series = (!r.g.series || r.g.series === 'SOLO') ? '' : '<small class="gvi-rel">' + esc(r.g.series) + '</small>';
      return '<tr><td>' + dig(i + 1) + '</td><td class="gvi-tg"><span class="gvi-name">' + esc(r.g.name) + '</span>' + series + '</td>' +
        '<td><div class="gvi-cnt"><b>' + esc(dig(r.s.count)) + '</b><span class="gvi-bt"><i style="width:' + Math.max(3, r.s.count / maxC * 100).toFixed(1) + '%"></i></span></div></td>' +
        '<td>' + lastText(r.s) + '</td></tr>';
    }).join('');
    el.innerHTML = '<h3 class="gvi-sec">' + esc(t('top_t')) + '</h3>' +
      '<div class="gvi-kpis gvi-kpis-s"><div class="gvi-kpi"><span>' + esc(t('played_n')) + '</span><b>' + esc(dig(rows.length)) + '</b></div><div class="gvi-kpi"><span>' + esc(t('total_plays')) + '</span><b>' + esc(dig(total)) + '</b></div></div>' +
      '<div class="gvi-tool">' + esc(t('order')) + ' <select class="gvi-sel" data-act="dir"><option value="desc"' + (topDir === 'desc' ? ' selected' : '') + '>' + esc(t('desc')) + '</option><option value="asc"' + (topDir === 'asc' ? ' selected' : '') + '>' + esc(t('asc')) + '</option></select></div>' +
      (rows.length ? '<div class="gvi-scroll"><table class="gvi-table"><thead><tr><th>#</th><th>' + esc(t('col_game')) + '</th><th>' + esc(t('col_plays')) + '</th><th>' + esc(t('col_last')) + '</th></tr></thead><tbody>' + body + '</tbody></table></div>' : '<div class="gvi-empty">' + esc(t('never')) + '</div>') +
      '<p class="gvi-note">' + esc(t('shown')) + ' ' + esc(dig(shown.length)) + ' ' + esc(t('of')) + ' ' + esc(dig(rows.length)) + ' — ' + esc(t('top_note')) + '</p>' +
      (rows.length > shown.length ? '<button type="button" class="gvi-more" data-act="more">' + esc(t('more')) + '</button>' : '');
  }

  function row(k, v) { return '<div class="gvi-kpi"><span>' + esc(t(k)) + '</span><b>' + v + '</b></div>'; }

  function pick(g) {
    if (!g) return;
    var sq = splitQuery(input.value); input.value = sq.prefix + g.name; sugg.classList.remove('open');
    D = build();
    var fresh = D.games.filter(function (x) { return Number(x.id) === Number(g.id); })[0] || g;
    var s = stats(fresh, D);
    var series = (!fresh.series || fresh.series === 'SOLO') ? t('solo') : fresh.series;
    var lastHtml = lastText(s);
    out.innerHTML = '<div class="gvi-card"><img class="gvi-cover" src="assets/covers/' + esc(fresh.id) + '.jpg" onerror="this.style.display=\'none\'" alt="">' +
      '<div class="gvi-card-body"><h3 class="gvi-gname">' + esc(fresh.name) + '</h3><div class="gvi-kpis">' +
      row('series', esc(series)) + row('plays', esc(dig(s.count))) + row('last', lastHtml) + '</div></div></div>';
  }

  /* ---------- حقن التبويب ---------- */
  var CSS = '#insights-section .gvi-head h2{margin:0 0 4px}#insights-section .gvi-head p{margin:0 0 14px;opacity:.7;font-size:13px}' +
    '.gvi-search{position:relative;max-width:560px;margin:8px 0 16px}.gvi-empty{opacity:.6;padding:8px 0;font-size:13px}' +
    '.gvi-card{display:flex;gap:16px;align-items:flex-start;background:var(--panel,rgba(255,255,255,.04));border:1px solid var(--line,rgba(255,255,255,.12));border-radius:6px;padding:14px}' +
    '.gvi-cover{width:90px;height:120px;object-fit:cover;border-radius:4px;border:1px solid var(--line-strong,rgba(255,255,255,.2));flex:0 0 90px}' +
    '.gvi-card-body{flex:1;min-width:0}.gvi-gname{margin:0 0 10px;font-size:20px}' +
    '.gvi-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.gvi-kpi{background:var(--panel-2,rgba(255,255,255,.05));border:1px solid var(--line,rgba(255,255,255,.12));padding:10px 12px;border-radius:6px}' +
    '.gvi-kpi b{display:block;font-size:17px;color:var(--brass-bright,#e3b15c);margin-top:4px}.gvi-kpi span{font-size:12px;opacity:.75}.gvi-rel{display:block;font-size:12px;font-weight:400;opacity:.7;color:inherit;margin-top:2px}' +
    '.gvi-sec{margin:26px 0 8px;font-size:17px}.gvi-kpis-s{margin-bottom:10px}.gvi-tool{margin:8px 0;font-size:13px}.gvi-sel{background:var(--panel-2,#262b1d);color:inherit;border:1px solid var(--line,rgba(255,255,255,.2));border-radius:4px;padding:4px 8px;margin-inline-start:6px}' +
    '.gvi-scroll{overflow-x:auto}.gvi-table{width:100%;border-collapse:collapse;font-size:13px}.gvi-table th,.gvi-table td{padding:7px 8px;text-align:start;border-bottom:1px solid var(--line,rgba(255,255,255,.1));vertical-align:middle}.gvi-table th{opacity:.7;font-weight:600;white-space:nowrap}.gvi-tg{min-width:180px}.gvi-name{font-weight:600}' +
    '.gvi-cnt{display:flex;align-items:center;gap:10px;min-width:130px}.gvi-cnt b{min-width:26px;color:var(--brass-bright,#e3b15c)}.gvi-bt{flex:1;height:8px;background:rgba(127,127,127,.18);border-radius:4px;overflow:hidden;display:block}.gvi-bt i{display:block;height:100%;background:var(--brass,#c9963f);border-radius:4px}' +
    '.gvi-note{font-size:12px;opacity:.65;margin:10px 0 0}.gvi-more{margin-top:8px;padding:7px 18px;background:var(--panel-2,rgba(255,255,255,.06));color:inherit;border:1px solid var(--line-strong,rgba(255,255,255,.25));border-radius:4px;cursor:pointer}.gvi-more:hover{border-color:var(--brass,#c9963f)}' +
    '@media(min-width:1001px){.tabnav{grid-template-columns:repeat(7,minmax(0,1fr)) !important}}@media(max-width:640px){.gvi-card{flex-direction:column}}';

  function inject() {
    var nav = document.getElementById('tabnav'); var after = document.getElementById('reports-section') || document.querySelector('.tab-page:last-of-type');
    if (!nav || !after || document.getElementById('insights-section')) return false;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    navBtn = document.createElement('button'); navBtn.type = 'button'; navBtn.className = 'tabnav-btn'; navBtn.setAttribute('data-tab', 'insights-section');
    navBtn.innerHTML = '<span aria-hidden="true" class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><circle cx="6" cy="16" r="1"/><circle cx="10" cy="11" r="1"/><circle cx="13" cy="14" r="1"/><circle cx="18" cy="7" r="1"/></svg></span><span class="tab-label">' + esc(t('tab')) + '</span>';
    nav.appendChild(navBtn);
    root = document.createElement('section'); root.className = 'section tab-page'; root.id = 'insights-section';
    after.parentNode.insertBefore(root, after.nextSibling);

    navBtn.addEventListener('click', function (ev) {
      if (ev && ev.isTrusted && window.SoundFX && window.SoundFX.playNavigate) { try { window.SoundFX.playNavigate(); } catch (e) { } }
      document.querySelectorAll('.tabnav-btn').forEach(function (b) { b.classList.toggle('active', b === navBtn); });
      document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.toggle('active', p === root); });
      [document.body, document.documentElement].forEach(function (el) { el.classList.remove('tab-home-mode'); el.classList.add('tab-fullscreen-mode'); });
      drawFrame(); window.scrollTo({ top: 0, behavior: 'auto' });
    });
    // أي تبويب تاني: اقفل تبويبي (الكود الأصلي ميعرفوش)
    document.querySelectorAll('.tabnav-btn').forEach(function (b) {
      if (b === navBtn) return;
      b.addEventListener('click', function () { navBtn.classList.remove('active'); root.classList.remove('active'); });
    });
    root.addEventListener('change', function (e) { if (e.target && e.target.getAttribute('data-act') === 'dir') { topDir = e.target.value === 'asc' ? 'asc' : 'desc'; topLimit = 25; renderTop(); } });
    root.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-act="more"]'); if (b) { topLimit += 25; renderTop(); } });
    document.addEventListener('click', function (e) { if (sugg && !(e.target.closest && e.target.closest('.gvi-search'))) sugg.classList.remove('open'); });
    var lt = document.getElementById('lang-toggle');
    if (lt) lt.addEventListener('click', function () { labelNav(); if (isActive()) drawFrame(); });
    return true;
  }

  // app.js بيتحمّل بعد تسجيل الدخول — نستنى لحد ما يجهز
  var tries = 0, timer = setInterval(function () {
    tries++;
    if (window.GameVaultData && document.getElementById('lang-toggle')) { clearInterval(timer); try { inject(); } catch (e) { console.error('Insights:', e); } }
    else if (tries > 7200) clearInterval(timer);
  }, 500);
})();
