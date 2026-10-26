/* ============================================================
   GameVault — Insights
   Reports:
   1) Game Play Report
   2) Most Played Games
   3) Best Year Gaming
   ============================================================ */
(function () {
  'use strict';
  if (window.__gvInsightsLoaded) return;
  window.__gvInsightsLoaded = true;

  var LS = window.localStorage;
  var K = {
    user: 'gameVault_userGames_v1',
    ov: 'gameVault_fieldOverrides_v1',
    del: 'mostafa_pc_deleted_games_v1',
    dates: 'gameVault_dateRecords_v4',
    lang: 'gameVault_lang_v1',
    bestYear: 'gameVault_bestYearGaming_v1'
  };
  function lj(k, f) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? f : v; } catch (e) { return f; } }
  function L() { return LS.getItem(K.lang) === 'ar' ? 'ar' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function dig(s) { return L() === 'ar' ? String(s).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }) : String(s); }
  function norm(s) { return String(s || '').replace(/[\u00A0\u2000-\u200B]/g, ' ').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar'); }
  var ISO = /^\d{4}-\d{2}-\d{2}/;
  function validDate(v) { return typeof v === 'string' && ISO.test(v) ? v.slice(0, 10) : null; }

  var T = {
    tab: ['Insights', 'التحليلات'],
    playReport: ['Game Play Report', 'تقرير اللعب'],
    playSub: ['Search the library, pick a game, and see its series, play count and last play.', 'ابحث في المكتبة، اختر لعبة وشاهد السلسلة وعدد مرات اللعب وآخر لعب.'],
    mostPlayed: ['Most Played Games', 'أكثر الألعاب لعبًا'],
    bestYear: ['Best Year Gaming', 'أفضل سنة لعب'],
    bestYearSub: ['Select the games you actually played. The year with the highest number of selected games wins.', 'حدد الألعاب التي لعبتها فعليًا. السنة التي تحتوي على أكبر عدد من الألعاب المحددة تفوز.'],
    ph: ['Search by game name...', 'ابحث باسم اللعبة...'],
    game: ['Game', 'اللعبة'], series: ['Series', 'السلسلة'], plays: ['Times played', 'عدد مرات اللعب'],
    last: ['Last played (end date)', 'آخر مرة لُعبت (تاريخ النهاية)'],
    solo: ['Standalone (no series)', 'بدون سلسلة (مستقلة)'],
    never: ['Never played', 'لم تُلعب بعد'],
    now: ['Playing now', 'قيد اللعب حاليًا'], since: ['started', 'بدأت في'],
    noend: ['No end date recorded', 'لا يوجد تاريخ نهاية مسجّل'],
    today: ['today', 'اليوم'], ago: ['ago', 'مضت'], day: ['day', 'يوم'], days: ['days', 'يوم'],
    order: ['Order', 'الترتيب'], desc: ['Most played first', 'الأكثر لعبًا أولًا (تنازلي)'], asc: ['Least played first', 'الأقل لعبًا أولًا (تصاعدي)'],
    played_n: ['Games played', 'ألعاب تم لعبها'], total_plays: ['Total plays', 'إجمالي مرات اللعب'],
    col_game: ['Game', 'اللعبة'], col_plays: ['Times played', 'عدد مرات اللعب'], col_last: ['Last played', 'آخر لعب'],
    more: ['Show more', 'عرض المزيد'], shown: ['Showing', 'المعروض'], of: ['of', 'من'],
    top_note: ['Only games with at least one play record are listed. Ties are ordered by most recent play.', 'تظهر الألعاب التي لها سجل لعب واحد على الأقل. عند التعادل يتم الترتيب حسب أحدث لعب.'],
    hint: ['Start typing a game name to see matches.', 'اكتب اسم لعبة لتظهر لك الألعاب المشابهة.'],
    selected: ['Selected', 'المحدد'],
    games: ['games', 'ألعاب'],
    best: ['Best Year', 'أفضل سنة'],
    tied: ['Tie', 'تعادل'],
    noSelection: ['Select games from the years below to calculate your Best Year.', 'حدد الألعاب من السنوات بالأسفل لحساب أفضل سنة.'],
    reset: ['Reset selections', 'إلغاء كل التحديدات'],
    allGames: ['games in this year', 'ألعاب في هذه السنة'],
    checkHint: ['Check each game you played. You can collapse or expand any year.', 'ضع علامة أمام كل لعبة لعبتها. يمكنك طي أو فتح أي سنة.']
  };
  function t(k) { var v = T[k]; return v ? v[L() === 'ar' ? 1 : 0] : k; }

  function build() {
    var GD = window.GameVaultData || {};
    var del = {}; lj(K.del, []).forEach(function (i) { del[Number(i)] = 1; });
    var ov = lj(K.ov, {});
    var games = (GD.games || []).concat(lj(K.user, [])).filter(function (g) {
      return !del[Number(g.id)];
    }).map(function (g) { return Object.assign({}, g, ov[g.id] || {}); });
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
      if (!e && r.start && String(r.end || '') !== 'Postponed') {
        var s = validDate(r.start);
        if (s && (!open || s > open)) open = s;
      }
    });
    var ge = validDate(g.endDate);
    if (ge && (!last || ge > last)) last = ge;
    return { count: rows.length, last: last, open: open };
  }

  function daysAgo(iso) {
    var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null;
    var n = new Date();
    return Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - d) / 864e5);
  }

  var D = { games: [], recs: [] }, root = null, navBtn = null;
  var input = null, sugg = null, out = null, current = [], active = -1;
  var topDir = 'desc', topLimit = 25, reportTab = 'top';

  function labelNav() {
    if (!navBtn) return;
    var l = navBtn.querySelector('.tab-label'); if (l) l.textContent = t('tab');
  }
  function isActive() { return root && root.classList.contains('active'); }

  function splitQuery(raw) {
    var i = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('،'));
    return { prefix: i >= 0 ? raw.slice(0, i + 1) + ' ' : '', q: (i >= 0 ? raw.slice(i + 1) : raw).replace(/^\s+/, '').toLowerCase() };
  }
  function matches(q) {
    var m = D.games.filter(function (g) { return (g.name || '').toLowerCase().indexOf(q) === 0; });
    if (!m.length) m = D.games.filter(function (g) { return (g.name || '').toLowerCase().indexOf(q) >= 0; });
    var seen = {}, out = [];
    m.forEach(function (g) { if (!seen[g.name]) { seen[g.name] = 1; out.push(g); } });
    return out;
  }

  function showSugg() {
    D = build(); active = -1;
    var sq = splitQuery(input.value);
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

  function row(k, v) {
    return '<div class="gvi-kpi"><span>' + esc(t(k)) + '</span><b>' + v + '</b></div>';
  }

  function pick(g) {
    if (!g) return;
    var sq = splitQuery(input.value); input.value = sq.prefix + g.name; sugg.classList.remove('open');
    D = build();
    var fresh = D.games.filter(function (x) { return Number(x.id) === Number(g.id); })[0] || g;
    var s = stats(fresh, D);
    var series = (!fresh.series || fresh.series === 'SOLO') ? t('solo') : fresh.series;
    out.innerHTML = '<div class="gvi-card"><img class="gvi-cover" src="assets/covers/' + esc(fresh.id) + '.jpg" onerror="this.style.display=\'none\'" alt="">' +
      '<div class="gvi-card-body"><h3 class="gvi-gname">' + esc(fresh.name) + '</h3><div class="gvi-kpis">' +
      row('series', esc(series)) + row('plays', esc(dig(s.count))) + row('last', lastText(s)) + '</div></div></div>';
  }

  function renderTop() {
    var el = root && root.querySelector('#gvi-top'); if (!el) return;
    D = build();
    var seen = {}, rows = [];
    D.games.forEach(function (g) {
      var k = norm(g.name); if (seen[k]) return; seen[k] = 1;
      var st = stats(g, D); if (st.count > 0) rows.push({ g: g, s: st });
    });
    rows.sort(function (a, b) {
      var d = topDir === 'asc' ? a.s.count - b.s.count : b.s.count - a.s.count;
      if (d) return d;
      var la = a.s.last || '', lb = b.s.last || '';
      if (la !== lb) return la < lb ? 1 : -1;
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
    el.innerHTML = '<div class="gvi-section-title"><h3>' + esc(t('mostPlayed')) + '</h3></div>' +
      '<div class="gvi-kpis gvi-kpis-s"><div class="gvi-kpi"><span>' + esc(t('played_n')) + '</span><b>' + esc(dig(rows.length)) + '</b></div><div class="gvi-kpi"><span>' + esc(t('total_plays')) + '</span><b>' + esc(dig(total)) + '</b></div></div>' +
      '<div class="gvi-tool">' + esc(t('order')) + ' <select class="gvi-sel" data-act="dir"><option value="desc"' + (topDir === 'desc' ? ' selected' : '') + '>' + esc(t('desc')) + '</option><option value="asc"' + (topDir === 'asc' ? ' selected' : '') + '>' + esc(t('asc')) + '</option></select></div>' +
      (rows.length ? '<div class="gvi-scroll"><table class="gvi-table"><thead><tr><th>#</th><th>' + esc(t('col_game')) + '</th><th>' + esc(t('col_plays')) + '</th><th>' + esc(t('col_last')) + '</th></tr></thead><tbody>' + body + '</tbody></table></div>' : '<div class="gvi-empty">' + esc(t('never')) + '</div>') +
      '<p class="gvi-note">' + esc(t('shown')) + ' ' + esc(dig(shown.length)) + ' ' + esc(t('of')) + ' ' + esc(dig(rows.length)) + ' — ' + esc(t('top_note')) + '</p>' +
      (rows.length > shown.length ? '<button type="button" class="gvi-more" data-act="more">' + esc(t('more')) + '</button>' : '');
  }

  function getBestState() {
    var saved = lj(K.bestYear, {});
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    return saved;
  }
  function saveBestState(s) {
    try { LS.setItem(K.bestYear, JSON.stringify(s)); } catch (e) {}
  }
  function yearGroups() {
    D = build();
    var map = {};
    D.games.forEach(function (g) {
      var y = Number(g.year);
      if (!y && g.releaseDate) y = Number(String(g.releaseDate).slice(0, 4));
      if (!y || y < 1900 || y > 2100) return;
      if (!map[y]) map[y] = [];
      map[y].push(g);
    });
    Object.keys(map).forEach(function (y) {
      var seen = {};
      map[y] = map[y].filter(function (g) {
        var key = String(g.id) + '|' + norm(g.name);
        if (seen[key]) return false; seen[key] = 1; return true;
      }).sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
    });
    return map;
  }
  function renderBestYear() {
    var el = root && root.querySelector('#gvi-best-year'); if (!el) return;
    var map = yearGroups(), state = getBestState(), years = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    var counts = {}, totalSelected = 0;
    years.forEach(function (y) {
      counts[y] = map[y].reduce(function (n, g) {
        var key = String(g.id);
        if (state[key]) { totalSelected++; return n + 1; }
        return n;
      }, 0);
    });
    var max = years.reduce(function (m, y) { return Math.max(m, counts[y] || 0); }, 0);
    var winners = max ? years.filter(function (y) { return counts[y] === max; }) : [];
    var summary = winners.length
      ? winners.map(function (y) { return dig(y) + ' (' + dig(counts[y]) + ')'; }).join(' · ')
      : t('noSelection');

    var details = years.map(function (y) {
      var open = winners.indexOf(y) >= 0;
      var rows = map[y].map(function (g) {
        var key = String(g.id), checked = !!state[key];
        return '<label class="gvi-year-game' + (checked ? ' checked' : '') + '">' +
          '<input type="checkbox" data-act="best-check" data-game-id="' + esc(key) + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="gvi-check-box" aria-hidden="true"></span>' +
          '<span class="gvi-year-game-name">' + esc(g.name) + '</span>' +
          '<span class="gvi-year-game-series">' + esc((g.series && g.series !== 'SOLO') ? g.series : '') + '</span>' +
          '</label>';
      }).join('');
      return '<details class="gvi-year" data-year="' + y + '"' + (open ? ' open' : '') + '>' +
        '<summary><span class="gvi-year-main"><b>' + dig(y) + '</b><small>' + dig(map[y].length) + ' ' + esc(t('allGames')) + '</small></span>' +
        '<span class="gvi-year-count">' + dig(counts[y]) + '</span></summary>' +
        '<div class="gvi-year-body">' + rows + '</div></details>';
    }).join('');

    el.innerHTML =
      '<div class="gvi-best-head"><div><h3>' + esc(t('bestYear')) + '</h3><p>' + esc(t('bestYearSub')) + '</p></div>' +
      '<button type="button" class="gvi-reset" data-act="best-reset">' + esc(t('reset')) + '</button></div>' +
      '<div class="gvi-best-winner"><span>' + esc(t('best')) + '</span><strong>' + summary + '</strong><small>' + esc(t('selected')) + ': ' + dig(totalSelected) + '</small></div>' +
      '<div class="gvi-check-hint">' + esc(t('checkHint')) + '</div>' +
      '<div class="gvi-years">' + details + '</div>';
  }

  function drawFrame() {
    root.setAttribute('dir', L() === 'ar' ? 'rtl' : 'ltr');
    root.innerHTML =
      '<div class="gvi-head"><h2>' + esc(t('tab')) + '</h2><p>' + esc(t('playSub')) + '</p></div>' +
      '<div class="gvi-report-tabs" role="tablist">' +
        '<button type="button" class="gvi-report-tab" data-report="top">' + esc(t('mostPlayed')) + '</button>' +
        '<button type="button" class="gvi-report-tab" data-report="play">' + esc(t('playReport')) + '</button>' +
        '<button type="button" class="gvi-report-tab" data-report="best">' + esc(t('bestYear')) + '</button>' +
      '</div>' +
      '<div class="gvi-report-panel" data-panel="play"><div class="gvi-panel-inner">' +
        '<div class="gvi-panel-title"><h3>' + esc(t('playReport')) + '</h3><p>' + esc(t('playSub')) + '</p></div>' +
        '<div class="gvi-search"><input autocomplete="off" class="search-input" id="gvi-q" type="text" placeholder="' + esc(t('ph')) + '"/><div class="search-sugg" id="gvi-sugg"></div></div>' +
        '<div id="gvi-out"><div class="gvi-empty">' + esc(t('hint')) + '</div></div>' +
      '</div></div>' +
      '<div class="gvi-report-panel" data-panel="top"><div class="gvi-panel-inner"><div id="gvi-top"></div></div></div>' +
      '<div class="gvi-report-panel" data-panel="best"><div class="gvi-panel-inner"><div id="gvi-best-year"></div></div></div>';

    root.querySelectorAll('.gvi-report-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-report') === reportTab);
      b.addEventListener('click', function () { reportTab = b.getAttribute('data-report'); renderReportTabs(); });
    });
    input = root.querySelector('#gvi-q'); sugg = root.querySelector('#gvi-sugg'); out = root.querySelector('#gvi-out');
    input.addEventListener('input', showSugg);
    input.addEventListener('focus', showSugg);
    input.addEventListener('keydown', function (e) {
      var items = sugg.querySelectorAll('.sugg-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return; e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (it, i) { it.classList.toggle('active', i === active); });
      } else if (e.key === 'Enter') {
        e.preventDefault(); if (current.length) pick(current[active >= 0 ? active : 0]);
      } else if (e.key === 'Escape') sugg.classList.remove('open');
    });
    sugg.addEventListener('mousedown', function (e) {
      var it = e.target.closest && e.target.closest('.sugg-item'); if (!it) return;
      e.preventDefault(); pick(current[+it.getAttribute('data-i')]);
    });
    root.querySelectorAll('.gvi-report-panel').forEach(function (p) { p.style.display = 'none'; });
    renderReportTabs();
    renderTop();
    renderBestYear();
  }

  function renderReportTabs() {
    if (!root) return;
    root.querySelectorAll('.gvi-report-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-report') === reportTab);
    });
    root.querySelectorAll('.gvi-report-panel').forEach(function (p) {
      p.style.display = p.getAttribute('data-panel') === reportTab ? 'block' : 'none';
    });
  }

  var CSS =
    '#insights-section .gvi-head h2{margin:0 0 4px}' +
    '#insights-section .gvi-head p{margin:0 0 14px;opacity:.7;font-size:13px}' +
    '#insights-section .gvi-report-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.12));padding-bottom:10px}' +
    '#insights-section .gvi-report-tab{appearance:none;border:1px solid var(--line-strong,rgba(255,255,255,.2));background:var(--panel-2,rgba(255,255,255,.05));color:inherit;padding:9px 15px;border-radius:6px;cursor:pointer;font-weight:600;transition:.15s}' +
    '#insights-section .gvi-report-tab:hover,#insights-section .gvi-report-tab.active{border-color:var(--brass,#c9963f);background:rgba(201,150,63,.12);color:var(--brass-bright,#e3b15c)}' +
    '#insights-section .gvi-report-panel{background:var(--panel,rgba(255,255,255,.035));border:1px solid var(--line,rgba(255,255,255,.12));border-radius:8px;overflow:hidden}' +
    '#insights-section .gvi-panel-inner{padding:16px 18px;min-height:220px}' +
    '#insights-section .gvi-panel-title h3{margin:0 0 4px;font-size:18px}' +
    '#insights-section .gvi-panel-title p{margin:0 0 14px;opacity:.65;font-size:12px}' +
    '#insights-section .gvi-search{position:relative;max-width:560px;margin:8px 0 16px}' +
    '#insights-section .gvi-empty{opacity:.6;padding:8px 0;font-size:13px}' +
    '#insights-section .gvi-card{display:flex;gap:16px;align-items:flex-start;background:var(--panel-2,rgba(255,255,255,.04));border:1px solid var(--line,rgba(255,255,255,.12));border-radius:6px;padding:14px}' +
    '#insights-section .gvi-cover{width:90px;height:120px;object-fit:cover;border-radius:4px;border:1px solid var(--line-strong,rgba(255,255,255,.2));flex:0 0 90px}' +
    '#insights-section .gvi-card-body{flex:1;min-width:0}.gvi-gname{margin:0 0 10px;font-size:20px}' +
    '#insights-section .gvi-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}' +
    '#insights-section .gvi-kpi{background:var(--panel-2,rgba(255,255,255,.05));border:1px solid var(--line,rgba(255,255,255,.12));padding:10px 12px;border-radius:6px}' +
    '#insights-section .gvi-kpi b{display:block;font-size:17px;color:var(--brass-bright,#e3b15c);margin-top:4px}.gvi-kpi span{font-size:12px;opacity:.75}' +
    '#insights-section .gvi-rel{display:block;font-size:12px;font-weight:400;opacity:.7;color:inherit;margin-top:2px}' +
    '#insights-section .gvi-section-title h3{margin:0 0 10px;font-size:18px}' +
    '#insights-section .gvi-kpis-s{margin-bottom:10px}.gvi-tool{margin:8px 0;font-size:13px}' +
    '#insights-section .gvi-sel{background:var(--panel-2,#262b1d);color:inherit;border:1px solid var(--line,rgba(255,255,255,.2));border-radius:4px;padding:4px 8px;margin-inline-start:6px}' +
    '#insights-section .gvi-scroll{overflow-x:auto}.gvi-table{width:100%;border-collapse:collapse;font-size:13px}.gvi-table th,.gvi-table td{padding:7px 8px;text-align:start;border-bottom:1px solid var(--line,rgba(255,255,255,.1));vertical-align:middle}.gvi-table th{opacity:.7;font-weight:600;white-space:nowrap}.gvi-tg{min-width:180px}.gvi-name{font-weight:600}' +
    '#insights-section .gvi-cnt{display:flex;align-items:center;gap:10px;min-width:130px}.gvi-cnt b{min-width:26px;color:var(--brass-bright,#e3b15c)}.gvi-bt{flex:1;height:8px;background:rgba(127,127,127,.18);border-radius:4px;overflow:hidden;display:block}.gvi-bt i{display:block;height:100%;background:var(--brass,#c9963f);border-radius:4px}' +
    '#insights-section .gvi-note{font-size:12px;opacity:.65;margin:10px 0 0}.gvi-more{margin-top:8px;padding:7px 18px;background:var(--panel-2,rgba(255,255,255,.06));color:inherit;border:1px solid var(--line-strong,rgba(255,255,255,.25));border-radius:4px;cursor:pointer}.gvi-more:hover{border-color:var(--brass,#c9963f)}' +
    '#insights-section .gvi-best-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.gvi-best-head h3{margin:0 0 4px;font-size:18px}.gvi-best-head p{margin:0;opacity:.65;font-size:12px}' +
    '#insights-section .gvi-reset{border:1px solid var(--line-strong,rgba(255,255,255,.2));background:var(--panel-2,rgba(255,255,255,.05));color:inherit;border-radius:5px;padding:7px 11px;cursor:pointer;white-space:nowrap}.gvi-reset:hover{border-color:var(--brass,#c9963f)}' +
    '#insights-section .gvi-best-winner{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(201,150,63,.16),rgba(255,255,255,.025));border:1px solid var(--brass,#c9963f);border-radius:7px;padding:13px 15px;margin-bottom:12px}' +
    '#insights-section .gvi-best-winner span{font-size:12px;opacity:.7}.gvi-best-winner strong{font-size:20px;color:var(--brass-bright,#e3b15c)}.gvi-best-winner small{opacity:.65}' +
    '#insights-section .gvi-check-hint{font-size:12px;opacity:.6;margin:0 0 10px}' +
    '#insights-section .gvi-years{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}' +
    '#insights-section .gvi-year{border:1px solid var(--line,rgba(255,255,255,.12));background:var(--panel-2,rgba(255,255,255,.025));border-radius:6px;overflow:hidden}' +
    '#insights-section .gvi-year summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:11px 13px}.gvi-year summary::-webkit-details-marker{display:none}' +
    '#insights-section .gvi-year summary:hover{background:rgba(255,255,255,.035)}.gvi-year-main{display:flex;align-items:center;gap:9px}.gvi-year-main b{font-size:16px;color:var(--parchment,#e8ddc8)}.gvi-year-main small{font-size:11px;opacity:.55}.gvi-year-count{min-width:30px;text-align:center;font-family:var(--font-mono,monospace);font-weight:700;color:var(--brass-bright,#e3b15c);background:rgba(201,150,63,.12);border-radius:12px;padding:3px 7px}' +
    '#insights-section .gvi-year-body{border-top:1px solid var(--line,rgba(255,255,255,.1));padding:6px 10px 9px;max-height:390px;overflow:auto}' +
    '#insights-section .gvi-year-game{display:grid;grid-template-columns:20px 1fr auto;align-items:center;gap:8px;padding:7px 5px;border-bottom:1px solid rgba(255,255,255,.055);cursor:pointer}.gvi-year-game:last-child{border-bottom:0}.gvi-year-game:hover{background:rgba(255,255,255,.03)}' +
    '#insights-section .gvi-year-game input{position:absolute;opacity:0;pointer-events:none}.gvi-check-box{width:15px;height:15px;border:1px solid var(--line-strong,rgba(255,255,255,.3));border-radius:3px;display:block;position:relative}.gvi-year-game.checked .gvi-check-box{background:var(--brass,#c9963f);border-color:var(--brass-bright,#e3b15c)}.gvi-year-game.checked .gvi-check-box:after{content:"✓";position:absolute;inset:0;display:grid;place-items:center;font-size:11px;color:#111;font-weight:900}' +
    '#insights-section .gvi-year-game-name{font-size:12.5px;line-height:1.3}.gvi-year-game-series{font-size:10.5px;opacity:.45;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '@media(min-width:1001px){.tabnav{grid-template-columns:repeat(7,minmax(0,1fr)) !important}}@media(max-width:640px){.gvi-card{flex-direction:column}.gvi-best-winner{grid-template-columns:1fr}.gvi-years{grid-template-columns:1fr}}';

  function inject() {
    var nav = document.getElementById('tabnav');
    var after = document.getElementById('reports-section') || document.querySelector('.tab-page:last-of-type');
    if (!nav || !after || document.getElementById('insights-section')) return false;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    navBtn = document.createElement('button');
    navBtn.type = 'button'; navBtn.className = 'tabnav-btn';
    navBtn.setAttribute('data-tab', 'insights-section');
    navBtn.innerHTML = '<span aria-hidden="true" class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><circle cx="6" cy="16" r="1"/><circle cx="10" cy="11" r="1"/><circle cx="13" cy="14" r="1"/><circle cx="18" cy="7" r="1"/></svg></span><span class="tab-label">' + esc(t('tab')) + '</span>';
    nav.appendChild(navBtn);

    root = document.createElement('section');
    root.className = 'section tab-page'; root.id = 'insights-section';
    after.parentNode.insertBefore(root, after.nextSibling);

    navBtn.addEventListener('click', function (ev) {
      if (ev && ev.isTrusted && window.SoundFX && window.SoundFX.playNavigate) { try { window.SoundFX.playNavigate(); } catch (e) {} }
      document.querySelectorAll('.tabnav-btn').forEach(function (b) { b.classList.toggle('active', b === navBtn); });
      document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.toggle('active', p === root); });
      [document.body, document.documentElement].forEach(function (el) { el.classList.remove('tab-home-mode'); el.classList.add('tab-fullscreen-mode'); });
      drawFrame(); window.scrollTo({ top: 0, behavior: 'auto' });
    });

    document.querySelectorAll('.tabnav-btn').forEach(function (b) {
      if (b === navBtn) return;
      b.addEventListener('click', function () { navBtn.classList.remove('active'); root.classList.remove('active'); });
    });

    root.addEventListener('change', function (e) {
      if (e.target && e.target.getAttribute('data-act') === 'dir') {
        topDir = e.target.value === 'asc' ? 'asc' : 'desc'; topLimit = 25; renderTop();
      }
      if (e.target && e.target.getAttribute('data-act') === 'best-check') {
        var state = getBestState(), id = String(e.target.getAttribute('data-game-id'));
        if (e.target.checked) state[id] = 1; else delete state[id];
        saveBestState(state); renderBestYear();
      }
    });

    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act="more"]');
      if (b) { topLimit += 25; renderTop(); }
      var reset = e.target.closest && e.target.closest('[data-act="best-reset"]');
      if (reset) { saveBestState({}); renderBestYear(); }
    });

    document.addEventListener('click', function (e) {
      if (sugg && !(e.target.closest && e.target.closest('.gvi-search'))) sugg.classList.remove('open');
    });

    var lt = document.getElementById('lang-toggle');
    if (lt) lt.addEventListener('click', function () { labelNav(); if (isActive()) drawFrame(); });
    return true;
  }

  var tries = 0, timer = setInterval(function () {
    tries++;
    if (window.GameVaultData && document.getElementById('lang-toggle')) {
      clearInterval(timer);
      try { inject(); } catch (e) { console.error('Insights:', e); }
    } else if (tries > 7200) clearInterval(timer);
  }, 500);
})();
