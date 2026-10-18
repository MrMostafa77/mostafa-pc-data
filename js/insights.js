/* ============================================================
   GameVault — Insights tab (standalone, read-only)
   ملف مستقل: لا يعدّل app.js ولا يكتب في أي بيانات.
   بيضيف تبويب "Insights" جديد ويقرأ بيانات المشروع (قراءة فقط).
   ============================================================ */
(function () {
  'use strict';
  if (window.__gvInsightsLoaded) return;
  window.__gvInsightsLoaded = true;

  var LS = window.localStorage;
  var K = {
    user: 'gameVault_userGames_v1', ov: 'gameVault_fieldOverrides_v1', del: 'mostafa_pc_deleted_games_v1',
    size: 'gameVault_sizeOverrides_v1', dates: 'gameVault_dateRecords_v4', lang: 'gameVault_lang_v1',
    ui: 'gameVault_insightsUI_v1'
  };
  function lj(k, f) { try { var v = JSON.parse(LS.getItem(k)); return v == null ? f : v; } catch (e) { return f; } }
  function L() { return LS.getItem(K.lang) === 'ar' ? 'ar' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  /* ---------- i18n (قاموس خاص بالتبويب ده فقط) ---------- */
  var T = {
    tab: ['Insights', 'التحليلات'],
    title: ['Library Insights', 'تحليلات المكتبة'],
    sub: ['Read-only analysis of your library, play history and storage. Nothing here changes your data.', 'تحليل للقراءة فقط لمكتبتك وسجل اللعب والمساحات. لا شيء هنا يغيّر بياناتك.'],
    k_games: ['Games', 'الألعاب'], k_disk: ['On drives', 'على الهاردات'], k_backlog: ['Backlog on drives', 'ألعاب لم تُلعب على الهاردات'],
    k_outdated: ['Need update', 'تحتاج تحديث'], k_locked: ['Space in unplayed', 'مساحة ألعاب لم تُلعب'],
    p1: ['Backlog Radar', 'رادار الألعاب المتأخرة'], p2: ['Library Health', 'صحة المكتبة'], p3: ['Added vs Finished', 'المضاف مقابل المنتهي'],
    p4: ['Space per Play', 'المساحة مقابل اللعب'], p5: ['Play Patterns', 'أنماط اللعب'], p6: ['Devices & Screens', 'الأجهزة والشاشات'],
    p7: ['Rating Analysis', 'تحليل التقييمات'], p8: ['Data Quality', 'جودة البيانات'], p9: ['Series Gaps', 'السلاسل الناقصة'], p10: ['Update Reminders', 'تذكير التحديثات'],
    game: ['Game', 'اللعبة'], drive: ['Drive', 'الهارد'], size: ['Size', 'الحجم'], added: ['Added', 'الإضافة'], updated: ['Game update', 'تحديث اللعبة'],
    sort: ['Sort by', 'ترتيب حسب'], by_size: ['Size', 'الحجم'], by_added: ['Oldest added', 'الأقدم إضافة'], by_name: ['Name', 'الاسم'],
    n_backlog: ['Unplayed games (Brand-New / Installed)', 'ألعاب لم تُلعب (جديدة / منصّبة)'], pct_lib: ['of library', 'من المكتبة'],
    on_disk_bl: ['Unplayed and on a drive', 'لم تُلعب وموجودة على هارد'], locked: ['Space they use', 'المساحة التي تشغلها'],
    h_known: ['Games on drives with a known update date', 'ألعاب على الهاردات لها تاريخ تحديث'], h_unknown: ['No update date', 'بدون تاريخ تحديث'],
    h_nover: ['No version text', 'بدون نص إصدار'], b_6m: ['Under 6 months', 'أقل من 6 شهور'], b_12m: ['6–12 months', '6 – 12 شهر'],
    b_24m: ['1–2 years', 'من سنة إلى سنتين'], b_old: ['Over 2 years', 'أكتر من سنتين'], b_unk: ['Unknown', 'غير معروف'],
    age_buckets: ['Update age of games on drives', 'عمر آخر تحديث للألعاب على الهاردات'],
    m_added: ['Added', 'مضافة'], m_fin: ['Finished', 'منتهية'], no_added: ['games have no “added to library” date, so they are not counted in Added.', 'لعبة ليس لها تاريخ إضافة للمكتبة فلا تدخل في المضاف.'],
    net: ['Last 12 months', 'آخر 12 شهر'], tot_added: ['added', 'مضافة'], tot_fin: ['finished', 'منتهية'],
    heavy: ['Biggest space with least play', 'أكبر مساحة وأقل لعب'], play_days: ['Play days', 'أيام اللعب'], gb_day: ['GB per play day', 'جيجا لكل يوم لعب'],
    dormant: ['On drives, not played for over a year (or never)', 'على الهاردات ولم تُلعب منذ أكثر من سنة (أو أبدًا)'],
    per_year: ['Sessions per year', 'جلسات اللعب كل سنة'], per_month: ['Sessions by month of year', 'الجلسات حسب شهور السنة'],
    avg_fin: ['Average days per session', 'متوسط الأيام للجلسة'], med_fin: ['Median', 'الوسيط'], longest: ['Longest sessions', 'أطول الجلسات'],
    sessions: ['sessions', 'جلسة'], days: ['days', 'يوم'], day1: ['d', 'ي'], start: ['Start', 'البداية'], gap_note: ['Based on play-date records with a start and end.', 'بناءً على سجلات تواريخ اللعب التي لها بداية ونهاية.'],
    dev: ['Device', 'الجهاز'], scr: ['Screen', 'الشاشة'], res: ['Resolution', 'الدقة'], plays: ['Sessions', 'الجلسات'], share: ['Share', 'النسبة'],
    r_note: ['Score: Epic 5 · Great 4 · Very-Good 3 · Good 2 · Not-Bad 1 · Bad 0. Groups with 3+ rated games.', 'الدرجة: Epic 5 · Great 4 · Very-Good 3 · Good 2 · Not-Bad 1 · Bad 0. المجموعات التي فيها 3 ألعاب مقيّمة أو أكثر.'],
    genre: ['Genre', 'النوع'], series: ['Series', 'السلسلة'], developer: ['Developer', 'المطوّر'], avg: ['Avg', 'المتوسط'], n: ['Games', 'الألعاب'], verdicts: ['Final rating spread', 'توزيع التقييم النهائي'],
    q_check: ['Show games with', 'اعرض الألعاب التي'], q_ok: ['complete', 'مكتمل'],
    q_release: ['no release date', 'بدون تاريخ إصدار'], q_size: ['size is 0', 'حجمها صفر'], q_cover: ['no cover', 'بدون غلاف'], q_added: ['no added-to-library date', 'بدون تاريخ إضافة'],
    q_ver: ['no version text', 'بدون نص إصدار'], q_verdict: ['finished but no final rating', 'منتهية بدون تقييم نهائي'], q_genre: ['no genre', 'بدون نوع'], q_dev: ['no developer', 'بدون مطوّر'],
    q_upd: ['on a drive with no update date', 'على هارد بدون تاريخ تحديث'], q_more: ['more', 'أخرى'],
    s_owned: ['Owned', 'المملوكة'], s_played: ['Played', 'الملعوبة'], s_done: ['Done %', 'نسبة الإنجاز'], s_left: ['Not played yet', 'لم تُلعب بعد'],
    s_note: ['Series where you played some games but not all.', 'سلاسل لعبت بعض أجزائها وليس كلها.'], s_never: ['Series never started', 'سلاسل لم تبدأها'],
    thr: ['Remind me when older than', 'نبّهني عندما يزيد العمر عن'], months: ['months', 'شهر'], age: ['Age', 'العمر'],
    due: ['games on drives are past this age', 'لعبة على الهاردات تجاوزت هذا العمر'], nodate_n: ['more on drives have no update date', 'لعبة أخرى على الهاردات بلا تاريخ تحديث'],
    none: ['Nothing to show.', 'لا يوجد ما يُعرض.'], unit_gb: ['GB', 'جيجا'], total: ['Total', 'الإجمالي'], version: ['Version', 'الإصدار']
  };
  function t(k) { var v = T[k]; return v ? v[L() === 'ar' ? 1 : 0] : k; }
  var MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'] };

  /* ---------- أرقام وتواريخ حسب اللغة ---------- */
  function dig(s) { return L() === 'ar' ? String(s).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }).replace(/,/g, '٬').replace(/\./g, '٫') : String(s); }
  function nf(n, d) { if (n == null || !isFinite(n)) return '—'; return dig(Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 })); }
  function gb(n) { return nf(n, 2) + ' ' + t('unit_gb'); }
  function fd(iso) { return iso ? dig(iso) : '—'; }

  /* ---------- قراءة البيانات (قراءة فقط) ---------- */
  var VERDICT = { 'Epic': 5, 'Great': 4, 'Very-Good': 3, 'Good': 2, 'Not-Bad': 1, 'Bad': 0 };
  var NOT_DISK = { 'Deleted': 1, 'Downloading': 1, 'Re-Newed': 1 };
  function nk(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ''); }
  function parseVerDate(v) {
    if (v == null) return null;
    var re = /(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/g, m, last = null;
    while ((m = re.exec(String(v)))) last = m;
    if (!last) return null;
    var dd = +last[1], mm = +last[2], yy = +last[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 1990 || yy > 2100) return null;
    return yy + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
  }
  function toDay(iso) { if (!iso) return null; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? null : d; }
  function ageDays(iso) { var d = toDay(iso); if (!d) return null; var n = new Date(); return Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - d) / 864e5); }
  function spanDays(a, b) { var x = toDay(a), y = toDay(b); if (!x || !y) return null; return Math.round((y - x) / 864e5) + 1; }

  function build() {
    var GD = window.GameVaultData || {};
    var base = GD.games || [];
    var del = {}; lj(K.del, []).forEach(function (i) { del[Number(i)] = 1; });
    var ov = lj(K.ov, {}), so = lj(K.size, {});
    var games = base.concat(lj(K.user, [])).filter(function (g) { return !del[Number(g.id)]; }).map(function (g) {
      var c = Object.assign({}, g, ov[g.id] || {});
      var s = so[g.id];
      c.size = (s != null && isFinite(s)) ? Number(s) : (Number(c.sizeGB) || 0);
      c.onDisk = !!c.hdd && !NOT_DISK[c.hdd];
      c.addedISO = (c.createdAt || c.addedAt || c.dateAdded) ? String(c.createdAt || c.addedAt || c.dateAdded).slice(0, 10) : null;
      c.updISO = c.gameUpdatedDate ? String(c.gameUpdatedDate).slice(0, 10) : parseVerDate(c.gameVersion);
      c.plays = []; c.key = nk(c.name);
      return c;
    });
    var byId = {}, byName = {};
    games.forEach(function (g) { byId[Number(g.id)] = g; if (g.key && !byName[g.key]) byName[g.key] = g; });
    var recs = lj(K.dates, null);
    if (!Array.isArray(recs)) recs = (GD.playLogs || []).map(function (r) { return { name: r.name, start: r.start, end: r.end, days: r.days, gpu: r.gpu, screenType: r.screenType, resolution: r.resolution }; });
    var plays = [];
    recs.forEach(function (r) {
      if (!r || !(r.start || r.end)) return;
      var g = (r.gameId != null && byId[Number(r.gameId)]) || byName[nk(r.name)] || null;
      var p = { g: g, name: r.name, start: r.start || null, end: r.end || null };
      p.days = (r.days !== '' && r.days != null && isFinite(r.days)) ? Number(r.days) : (spanDays(r.start || r.end, r.end || r.start) || 1);
      p.device = r.gpu || r.device || (g && g.gpu) || '';
      p.screen = r.screenType || (g && g.screenType) || '';
      p.res = r.resolution || (g && g.resolution) || '';
      plays.push(p); if (g) g.plays.push(p);
    });
    games.forEach(function (g) {
      g.nplays = g.plays.length;
      g.playDays = g.plays.reduce(function (a, p) { return a + (p.days || 0); }, 0);
      var last = null; g.plays.forEach(function (p) { var e = p.end || p.start; if (e && (!last || e > last)) last = e; });
      g.lastPlay = last;
      g.unplayed = (g.playingState === 'Brand-New' || g.playingState === 'Installed') && g.nplays === 0;
    });
    return { games: games, plays: plays };
  }

  /* ---------- UI state ---------- */
  var ui = Object.assign({ upd: 12, sort: 'size', q: 'releaseDate' }, lj(K.ui, {}));
  function saveUI() { try { LS.setItem(K.ui, JSON.stringify(ui)); } catch (e) { } }
  var D = null;

  /* ---------- helpers للعرض ---------- */
  function bars(items, fmt, cls) {
    if (!items.length) return '<div class="gvi-empty">' + esc(t('none')) + '</div>';
    var max = Math.max.apply(null, items.map(function (x) { return x.v; }).concat([1e-9]));
    return '<div class="gvi-bars">' + items.map(function (x) {
      return '<div class="gvi-bar"><span class="gvi-bl" title="' + esc(x.l) + '">' + esc(x.l) + '</span><span class="gvi-bt"><i class="' + (cls || '') + '" style="width:' + Math.max(1.5, x.v / max * 100).toFixed(1) + '%"></i></span><span class="gvi-bv">' + (fmt ? fmt(x.v, x) : nf(x.v)) + '</span></div>';
    }).join('') + '</div>';
  }
  function table(head, rows) {
    if (!rows.length) return '<div class="gvi-empty">' + esc(t('none')) + '</div>';
    return '<div class="gvi-scroll"><table class="gvi-table"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function kpis(list) { return '<div class="gvi-kpis">' + list.map(function (k) { return '<div class="gvi-kpi"><b>' + k[1] + '</b><span>' + esc(k[0]) + '</span></div>'; }).join('') + '</div>'; }
  function note(s) { return '<p class="gvi-note">' + esc(s) + '</p>'; }
  function sel(act, val, opts) { return '<select class="gvi-sel" data-act="' + act + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; }
  function nm(g) { return '<span class="gvi-name">' + esc(g.name) + '</span>'; }
  function sum(a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); }
  function mean(a) { return a.length ? sum(a, function (x) { return x; }) / a.length : null; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function monthKey(iso) { return iso ? String(iso).slice(0, 7) : null; }
  function monthLabel(k) { var p = k.split('-'); return MON[L()][+p[1] - 1] + ' ' + dig(p[0].slice(2)); }

  /* ---------- الأقسام العشرة ---------- */
  function p1() {
    var bl = D.games.filter(function (g) { return g.unplayed; });
    var od = bl.filter(function (g) { return g.onDisk; });
    var arr = od.slice();
    if (ui.sort === 'size') arr.sort(function (a, b) { return b.size - a.size; });
    else if (ui.sort === 'name') arr.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else arr.sort(function (a, b) { return (a.addedISO || '9999') < (b.addedISO || '9999') ? -1 : 1; });
    return kpis([[t('n_backlog'), nf(bl.length)], [t('pct_lib'), nf(D.games.length ? bl.length / D.games.length * 100 : 0, 1) + '%'], [t('on_disk_bl'), nf(od.length)], [t('locked'), gb(sum(od, function (g) { return g.size; }))]]) +
      '<div class="gvi-tool">' + esc(t('sort')) + ' ' + sel('sort', ui.sort, [['size', t('by_size')], ['added', t('by_added')], ['name', t('by_name')]]) + '</div>' +
      table([t('game'), t('drive'), t('size'), t('added'), t('updated')], arr.slice(0, 25).map(function (g) { return [nm(g), esc(g.hdd), gb(g.size), fd(g.addedISO), fd(g.updISO)]; }));
  }
  function bucket(g) {
    var a = ageDays(g.updISO); if (a == null) return 'u';
    return a < 183 ? 'a' : a < 365 ? 'b' : a < 730 ? 'c' : 'd';
  }
  function p2() {
    var od = D.games.filter(function (g) { return g.onDisk; });
    var cnt = { a: 0, b: 0, c: 0, d: 0, u: 0 }; od.forEach(function (g) { cnt[bucket(g)]++; });
    var nov = od.filter(function (g) { return g.gameVersion == null || String(g.gameVersion).trim() === ''; }).length;
    return kpis([[t('k_disk'), nf(od.length)], [t('h_known'), nf(od.length - cnt.u)], [t('h_unknown'), nf(cnt.u)], [t('h_nover'), nf(nov)]]) +
      '<h4>' + esc(t('age_buckets')) + '</h4>' + bars([{ l: t('b_6m'), v: cnt.a }, { l: t('b_12m'), v: cnt.b }, { l: t('b_24m'), v: cnt.c }, { l: t('b_old'), v: cnt.d }, { l: t('b_unk'), v: cnt.u }]);
  }
  function lastMonths(n) {
    var out = [], d = new Date(); d.setDate(1);
    for (var i = n - 1; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2)); }
    return out;
  }
  function p3() {
    var ms = lastMonths(12), a = {}, f = {};
    ms.forEach(function (m) { a[m] = 0; f[m] = 0; });
    var noAdd = 0;
    D.games.forEach(function (g) { if (!g.addedISO) noAdd++; else { var k = monthKey(g.addedISO); if (k in a) a[k]++; } });
    D.plays.forEach(function (p) { if (p.end) { var k = monthKey(p.end); if (k in f) f[k]++; } });
    var mx = Math.max.apply(null, ms.map(function (m) { return Math.max(a[m], f[m]); }).concat([1]));
    var rows = ms.map(function (m) {
      return '<div class="gvi-bar gvi-bar2"><span class="gvi-bl">' + esc(monthLabel(m)) + '</span><span class="gvi-bt gvi-dual"><i class="gvi-c1" style="width:' + (a[m] / mx * 100).toFixed(1) + '%"></i><i class="gvi-c2" style="width:' + (f[m] / mx * 100).toFixed(1) + '%"></i></span><span class="gvi-bv">' + nf(a[m]) + ' / ' + nf(f[m]) + '</span></div>';
    }).join('');
    var ta = sum(ms, function (m) { return a[m]; }), tf = sum(ms, function (m) { return f[m]; });
    return kpis([[t('net') + ' · ' + t('tot_added'), nf(ta)], [t('net') + ' · ' + t('tot_fin'), nf(tf)]]) +
      '<div class="gvi-legend"><i class="gvi-c1"></i>' + esc(t('m_added')) + ' <i class="gvi-c2"></i>' + esc(t('m_fin')) + '</div><div class="gvi-bars">' + rows + '</div>' +
      note(nf(noAdd) + ' ' + t('no_added'));
  }
  function p4() {
    var od = D.games.filter(function (g) { return g.onDisk && g.size >= 1; });
    var heavy = od.map(function (g) { return { g: g, r: g.size / (1 + g.playDays) }; }).sort(function (a, b) { return b.r - a.r; }).slice(0, 15);
    var dorm = od.filter(function (g) { var a = ageDays(g.lastPlay); return a == null || a > 365; });
    return kpis([[t('dormant'), nf(dorm.length)], [t('locked'), gb(sum(dorm, function (g) { return g.size; }))]]) +
      '<h4>' + esc(t('heavy')) + '</h4>' + table([t('game'), t('drive'), t('size'), t('play_days'), t('gb_day')], heavy.map(function (x) { return [nm(x.g), esc(x.g.hdd), gb(x.g.size), nf(x.g.playDays), nf(x.r, 2)]; }));
  }
  function p5() {
    var ps = D.plays, yr = {}, mo = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    ps.forEach(function (p) { var d = p.start || p.end; if (!d) return; var y = String(d).slice(0, 4); yr[y] = (yr[y] || 0) + 1; var m = +String(d).slice(5, 7); if (m >= 1 && m <= 12) mo[m - 1]++; });
    var ys = Object.keys(yr).sort().slice(-12).map(function (y) { return { l: dig(y), v: yr[y] }; });
    var ds = ps.filter(function (p) { return p.start && p.end && p.days > 0; }).map(function (p) { return p.days; });
    var longest = ps.filter(function (p) { return p.start && p.end && p.days > 0; }).sort(function (a, b) { return b.days - a.days; }).slice(0, 8);
    return kpis([[t('sessions'), nf(ps.length)], [t('avg_fin'), nf(mean(ds), 1)], [t('med_fin'), nf(median(ds), 1)]]) +
      '<h4>' + esc(t('per_year')) + '</h4>' + bars(ys) +
      '<h4>' + esc(t('per_month')) + '</h4>' + bars(mo.map(function (v, i) { return { l: MON[L()][i], v: v }; })) +
      '<h4>' + esc(t('longest')) + '</h4>' + table([t('game'), t('start'), t('days')], longest.map(function (p) { return ['<span class="gvi-name">' + esc(p.g ? p.g.name : p.name) + '</span>', fd(p.start), nf(p.days)]; })) + note(t('gap_note'));
  }
  function group(ps, f) {
    var m = {}, tot = ps.length;
    ps.forEach(function (p) { var k = f(p) || '—'; (m[k] = m[k] || { k: k, n: 0, d: 0 }); m[k].n++; m[k].d += p.days || 0; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8).map(function (x) { return [esc(x.k), nf(x.n), nf(x.d), nf(tot ? x.n / tot * 100 : 0, 1) + '%']; });
  }
  function p6() {
    var ps = D.plays;
    function tb(label, f) { return '<h4>' + esc(label) + '</h4>' + table([label, t('plays'), t('days'), t('share')], group(ps, f)); }
    return tb(t('dev'), function (p) { return p.device; }) + tb(t('scr'), function (p) { return p.screen; }) + tb(t('res'), function (p) { return p.res; });
  }
  function grp(f) {
    var m = {};
    D.games.forEach(function (g) { var s = VERDICT[g.verdict]; var k = f(g); if (s == null || !k) return; (m[k] = m[k] || { k: k, s: 0, n: 0 }); m[k].s += s; m[k].n++; });
    return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.n >= 3; }).map(function (x) { return { l: x.k, v: x.s / x.n, n: x.n }; }).sort(function (a, b) { return b.v - a.v || b.n - a.n; }).slice(0, 8);
  }
  function p7() {
    var vc = {}; D.games.forEach(function (g) { if (g.verdict) vc[g.verdict] = (vc[g.verdict] || 0) + 1; });
    var order = ['Epic', 'Great', 'Very-Good', 'Good', 'Not-Bad', 'Bad', 'NOSTALGIC'];
    function fmt(v, x) { return nf(v, 2) + ' · ' + nf(x.n); }
    return '<h4>' + esc(t('verdicts')) + '</h4>' + bars(order.filter(function (k) { return vc[k]; }).map(function (k) { return { l: k, v: vc[k] }; })) +
      '<h4>' + esc(t('genre')) + ' (' + esc(t('avg')) + ' · ' + esc(t('n')) + ')</h4>' + bars(grp(function (g) { return g.genre; }), fmt) +
      '<h4>' + esc(t('series')) + '</h4>' + bars(grp(function (g) { return g.series && g.series !== 'SOLO' ? g.series : null; }), fmt) +
      '<h4>' + esc(t('developer')) + '</h4>' + bars(grp(function (g) { return g.developer; }), fmt) + note(t('r_note'));
  }
  var QC = [
    ['releaseDate', 'q_release', function (g) { return !g.releaseDate; }], ['size', 'q_size', function (g) { return !(g.size > 0); }],
    ['cover', 'q_cover', function (g) { return !g.cover; }], ['added', 'q_added', function (g) { return !g.addedISO; }],
    ['ver', 'q_ver', function (g) { return g.gameVersion == null || String(g.gameVersion).trim() === ''; }],
    ['verdict', 'q_verdict', function (g) { return g.playingState === 'Done' && !g.verdict; }],
    ['genre', 'q_genre', function (g) { return !g.genre; }], ['dev', 'q_dev', function (g) { return !g.developer; }],
    ['upd', 'q_upd', function (g) { return g.onDisk && !g.updISO; }]
  ];
  function p8() {
    var N = D.games.length, rows = QC.map(function (c) { var n = D.games.filter(c[2]).length; return { l: t(c[1]), v: n }; });
    var cur = QC.filter(function (c) { return c[0] === ui.q; })[0] || QC[0];
    var list = D.games.filter(cur[2]);
    return bars(rows, function (v) { return nf(v) + ' · ' + nf(N ? v / N * 100 : 0, 1) + '%'; }, 'gvi-warn') +
      '<div class="gvi-tool">' + esc(t('q_check')) + ' ' + sel('q', cur[0], QC.map(function (c) { return [c[0], t(c[1])]; })) + '</div>' +
      table([t('game'), t('drive')], list.slice(0, 25).map(function (g) { return [nm(g), esc(g.hdd || '—')]; })) +
      (list.length > 25 ? note('+' + nf(list.length - 25) + ' ' + t('q_more')) : '');
  }
  function p9() {
    var m = {};
    D.games.forEach(function (g) { var s = g.series; if (!s || s === 'SOLO') return; (m[s] = m[s] || { s: s, all: [], pl: 0 }); m[s].all.push(g); if (g.nplays > 0 || g.playingState === 'Done') m[s].pl++; });
    var arr = Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.all.length >= 2; });
    var part = arr.filter(function (x) { return x.pl > 0 && x.pl < x.all.length; }).sort(function (a, b) { return (b.all.length - b.pl) - (a.all.length - a.pl); });
    var never = arr.filter(function (x) { return x.pl === 0; }).length;
    return kpis([[t('s_note'), nf(part.length)], [t('s_never'), nf(never)]]) +
      table([t('series'), t('s_owned'), t('s_played'), t('s_done'), t('s_left')], part.slice(0, 20).map(function (x) {
        var left = x.all.filter(function (g) { return !(g.nplays > 0 || g.playingState === 'Done'); });
        return [esc(x.s), nf(x.all.length), nf(x.pl), nf(x.pl / x.all.length * 100) + '%', esc(left.slice(0, 4).map(function (g) { return g.name; }).join(', ')) + (left.length > 4 ? ' +' + nf(left.length - 4) : '')];
      }));
  }
  function outdated(months) {
    var lim = months * 30.4375;
    return D.games.filter(function (g) { var a = ageDays(g.updISO); return g.onDisk && a != null && a > lim; }).sort(function (a, b) { return ageDays(b.updISO) - ageDays(a.updISO); });
  }
  function p10() {
    var list = outdated(ui.upd), nodate = D.games.filter(function (g) { return g.onDisk && !g.updISO; }).length;
    return '<div class="gvi-tool">' + esc(t('thr')) + ' ' + sel('upd', ui.upd, [[3, '3'], [6, '6'], [12, '12'], [24, '24']].map(function (o) { return [o[0], dig(o[1]) + ' ' + t('months')]; })) + '</div>' +
      kpis([[t('due'), nf(list.length)], [t('nodate_n'), nf(nodate)]]) +
      table([t('game'), t('drive'), t('version'), t('updated'), t('age')], list.slice(0, 30).map(function (g) {
        var a = ageDays(g.updISO); return [nm(g), esc(g.hdd), esc(g.gameVersion || '—'), fd(g.updISO), nf(Math.round(a / 30.4375)) + ' ' + t('months')];
      }));
  }
  var PANELS = [['p1', p1], ['p2', p2], ['p3', p3], ['p4', p4], ['p5', p5], ['p6', p6], ['p7', p7], ['p8', p8], ['p9', p9], ['p10', p10]];
  var openSet = { p1: 1, p10: 1 };

  /* ---------- الرسم ---------- */
  var root = null, navBtn = null;
  function panelHtml(p) { return '<summary>' + esc(t(p[0])) + '</summary><div class="gvi-body">' + p[1]() + '</div>'; }
  function render() {
    if (!root) return;
    try { D = build(); } catch (e) { root.innerHTML = '<div class="gvi-empty">' + esc(String(e && e.message || e)) + '</div>'; return; }
    var od = D.games.filter(function (g) { return g.onDisk; }), bl = D.games.filter(function (g) { return g.unplayed && g.onDisk; });
    root.setAttribute('dir', L() === 'ar' ? 'rtl' : 'ltr');
    root.innerHTML = '<div class="gvi-head"><h2>' + esc(t('title')) + '</h2><p>' + esc(t('sub')) + '</p></div>' +
      kpis([[t('k_games'), nf(D.games.length)], [t('k_disk'), nf(od.length)], [t('k_backlog'), nf(bl.length)], [t('k_outdated'), nf(outdated(ui.upd).length)], [t('k_locked'), gb(sum(bl, function (g) { return g.size; }))]]) +
      PANELS.map(function (p) { return '<details class="gvi-panel" data-p="' + p[0] + '"' + (openSet[p[0]] ? ' open' : '') + '>' + panelHtml(p) + '</details>'; }).join('');
    labelNav(); badge();
  }
  function rerender(id) {
    var el = root.querySelector('details[data-p="' + id + '"]'); var p = PANELS.filter(function (x) { return x[0] === id; })[0];
    if (el && p) { el.innerHTML = panelHtml(p); }
    badge();
  }
  function labelNav() { if (!navBtn) return; var l = navBtn.querySelector('.tab-label'); if (l) l.textContent = t('tab'); }
  function badge() {
    if (!navBtn || !D) return; var n = outdated(ui.upd).length, b = navBtn.querySelector('.gvi-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'gvi-badge'; navBtn.appendChild(b); }
    b.textContent = nf(n); b.title = t('due');
  }
  function isActive() { return root && root.classList.contains('active'); }

  /* ---------- حقن التبويب ---------- */
  var CSS = '#insights-section .gvi-head h2{margin:0 0 4px}#insights-section .gvi-head p{margin:0 0 14px;opacity:.7;font-size:13px}' +
    '.gvi-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0 14px}.gvi-kpi{background:var(--panel-2,rgba(255,255,255,.05));border:1px solid var(--line,rgba(255,255,255,.12));padding:10px 12px;border-radius:6px}' +
    '.gvi-kpi b{display:block;font-size:20px;color:var(--brass-bright,#e3b15c)}.gvi-kpi span{font-size:12px;opacity:.75}' +
    '.gvi-panel{background:var(--panel,rgba(255,255,255,.04));border:1px solid var(--line,rgba(255,255,255,.12));border-radius:6px;margin:12px 0}.gvi-panel>summary{cursor:pointer;padding:12px 16px;font-weight:700;font-size:15px;list-style:none}' +
    '.gvi-panel>summary::-webkit-details-marker{display:none}.gvi-panel>summary:before{content:"▸";margin-inline-end:8px;display:inline-block;transition:transform .15s}.gvi-panel[open]>summary:before{transform:rotate(90deg)}' +
    '.gvi-body{padding:2px 16px 16px}.gvi-body h4{margin:16px 0 8px;font-size:13px;opacity:.8}.gvi-tool{margin:8px 0;font-size:13px}.gvi-sel{background:var(--panel-2,#262b1d);color:inherit;border:1px solid var(--line,rgba(255,255,255,.2));border-radius:4px;padding:4px 8px;margin-inline-start:6px}' +
    '.gvi-scroll{overflow-x:auto}.gvi-table{width:100%;border-collapse:collapse;font-size:13px}.gvi-table th,.gvi-table td{padding:6px 8px;text-align:start;border-bottom:1px solid var(--line,rgba(255,255,255,.1));white-space:nowrap}.gvi-table td:first-child{white-space:normal;min-width:160px}.gvi-table th{opacity:.7;font-weight:600}' +
    '.gvi-bars{display:grid;gap:6px}.gvi-bar{display:grid;grid-template-columns:minmax(90px,170px) 1fr minmax(70px,auto);gap:10px;align-items:center;font-size:13px}.gvi-bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gvi-bt{height:10px;background:rgba(127,127,127,.18);border-radius:5px;overflow:hidden;display:block}' +
    '.gvi-bt i{display:block;height:100%;background:var(--brass,#c9963f);border-radius:5px}.gvi-bt i.gvi-warn{background:var(--rust,#b5502f)}.gvi-dual{height:16px;display:flex;flex-direction:column;gap:2px;background:none}.gvi-dual i{height:7px}.gvi-dual i.gvi-c1,.gvi-legend i.gvi-c1{background:var(--brass,#c9963f)}.gvi-dual i.gvi-c2,.gvi-legend i.gvi-c2{background:var(--verdigris-bright,#7baf97)}' +
    '.gvi-legend{font-size:12px;margin:4px 0 8px}.gvi-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px}.gvi-bv{text-align:end;opacity:.85;white-space:nowrap}.gvi-note{font-size:12px;opacity:.65;margin:10px 0 0}.gvi-empty{opacity:.6;padding:8px 0;font-size:13px}.gvi-name{font-weight:600}' +
    '@media(min-width:1001px){.tabnav{grid-template-columns:repeat(7,minmax(0,1fr)) !important}}.gvi-badge{position:absolute;top:5px;inset-inline-end:7px;display:inline-block;min-width:16px;padding:0 5px;border-radius:9px;background:var(--rust,#b5502f);color:#fff;font-size:11px;line-height:16px;text-align:center}@media(max-width:640px){.gvi-bar{grid-template-columns:90px 1fr auto}}';

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
      render(); window.scrollTo({ top: 0, behavior: 'auto' });
    });
    // أي تبويب تاني: اقفل تبويبي (الكود الأصلي ميعرفوش)
    document.querySelectorAll('.tabnav-btn').forEach(function (b) {
      if (b === navBtn) return;
      b.addEventListener('click', function () { navBtn.classList.remove('active'); root.classList.remove('active'); });
    });
    root.addEventListener('change', function (e) {
      var a = e.target && e.target.getAttribute('data-act'); if (!a) return; var v = e.target.value;
      if (a === 'sort') { ui.sort = v; saveUI(); rerender('p1'); }
      else if (a === 'q') { ui.q = v; saveUI(); rerender('p8'); }
      else if (a === 'upd') { ui.upd = +v; saveUI(); rerender('p10'); }
    });
    root.addEventListener('toggle', function (e) { var p = e.target && e.target.getAttribute && e.target.getAttribute('data-p'); if (p) { if (e.target.open) openSet[p] = 1; else delete openSet[p]; } }, true);
    var lt = document.getElementById('lang-toggle');
    if (lt) lt.addEventListener('click', function () { labelNav(); if (isActive()) render(); });
    // شارة عدد الألعاب المطلوب تحديثها بتظهر حتى من غير فتح التبويب
    try { D = build(); badge(); } catch (e) { }
    window.GameVaultInsights = { refresh: render };
    return true;
  }

  // app.js بيتحمّل بعد تسجيل الدخول — نستنى لحد ما يجهز
  var tries = 0, timer = setInterval(function () {
    tries++;
    if (window.GameVaultData && window.GameVaultSizes && document.getElementById('lang-toggle')) { clearInterval(timer); try { inject(); } catch (e) { console.error('Insights:', e); } }
    else if (tries > 7200) clearInterval(timer);
  }, 500);
})();
