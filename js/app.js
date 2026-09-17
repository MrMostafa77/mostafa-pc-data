
(function(){
  'use strict';

  /* ================= BASE DATA + STORAGE ================= */
  const BASE_GAMES = window.GameVaultData.games;
  const USERGAMES_KEY = 'gameVault_userGames_v1';
  const OVERRIDES_KEY = 'gameVault_fieldOverrides_v1'; // per-id: {screenType, gpu, resolution}
  // ملحوظة: صور الأغلفة بقت متخزنة في IndexedDB (js/cover-store.js) بدل localStorage
  // القديم المحدود المساحة — شوف persistCoverOverride/removeCoverOverride تحت.
  const ONLINE_COVER_CACHE_KEY = 'gameVault_onlineCoverCache_v1'; // كاش لصور الأغلفة المجلوبة أونلاين للألعاب التي لا تملك صورة محلية
  const DATE_RECORDS_KEY = 'gameVault_dateRecords_v4';
  const SIZE_OVERRIDES_KEY = 'gameVault_sizeOverrides_v1';
  const SIZE_DELETED_KEY = 'gameVault_sizeDeleted_v1';
  const CAP_KEY = 'gameVault_driveCapacities_v1';

  function loadJSON(key, fallback){
    try{ const v = JSON.parse(localStorage.getItem(key) || 'null'); return v===null ? fallback : v; }
    catch(e){ return fallback; }
  }
  function saveJSON(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  // حفظ/حذف صورة غلاف: بيتخزن في IndexedDB محليًا (مساحة كبيرة)، وبيترفع
  // لـ Firebase Storage لو المزامنة السحابية شغالة. أي فشل بيظهر تنبيه واضح
  // للمستخدم بدل ما يختفي بصمت زي ما كان بيحصل مع localStorage القديم.
  function persistCoverOverride(id, dataUrl){
    coverOverrides[id] = dataUrl;
    const updatedAt = Date.now();
    if(window.CoverStore){
      window.CoverStore.set(id, dataUrl, updatedAt).then(()=>{
        window.SoundFX?.playAdd();
      }).catch(err=>{
        console.error('Cover save failed', err);
        window.CoverStore.showToast('فشل حفظ الصورة على جهازك: ' + (err && err.message ? err.message : 'خطأ غير معروف'), true);
        window.SoundFX?.playError();
      });
    }
    if(window.GameVaultCloudSync && window.GameVaultCloudSync.isReady()){
      window.GameVaultCloudSync.uploadCover(id, dataUrl, updatedAt);
    }
  }
  function removeCoverOverride(id){
    delete coverOverrides[id];
    if(window.CoverStore){
      window.CoverStore.remove(id).then(()=>{
        window.SoundFX?.playDelete();
      }).catch(err=>{
        console.error('Cover remove failed', err);
        window.SoundFX?.playError();
      });
    }
    if(window.GameVaultCloudSync && window.GameVaultCloudSync.isReady()){
      window.GameVaultCloudSync.removeCover(id);
    }
  }

  let userGames = loadJSON(USERGAMES_KEY, []);
  // إصلاح تلقائي لمرة واحدة: أي لعبة مضافة قديمًا وقع رقمها بالغلط على رقم لعبة محذوفة
  (function repairCollidedUserGameIds(){
    try{
      const deletedIds = new Set(loadJSON('mostafa_pc_deleted_games_v1', []).map(Number));
      if(!deletedIds.size) return;
      let nextId = BASE_GAMES.map(g=>g.id||0).concat(userGames.map(g=>g.id||0)).concat([...deletedIds]).reduce((m,id)=>Math.max(m,id),0);
      let changed = false;
      userGames.forEach(g=>{
        if(deletedIds.has(Number(g.id))){
          nextId += 1;
          g.id = nextId;
          changed = true;
        }
      });
      if(changed) saveJSON(USERGAMES_KEY, userGames);
    }catch(e){}
  })();
  let overrides = loadJSON(OVERRIDES_KEY, {});
  let coverOverrides = Object.assign({}, window.GameVaultCoverOverrides || {});
  let onlineCoverCache = loadJSON(ONLINE_COVER_CACHE_KEY, {}); // id(string) -> url مكتشف | false غير موجود
  let dateRecords = loadJSON(DATE_RECORDS_KEY, null);
  let sizeOverrides = loadJSON(SIZE_OVERRIDES_KEY, {});
  let sizeDeleted = new Set(loadJSON(SIZE_DELETED_KEY, []).map(Number));
  let capacities = loadJSON(CAP_KEY, {});

  let GAMES = [];
  function rebuildGamesArray(){
    const deleted=new Set(loadJSON('mostafa_pc_deleted_games_v1',[]).map(Number));
    GAMES = BASE_GAMES.filter(g=>!deleted.has(Number(g.id))).concat(userGames.filter(g=>!deleted.has(Number(g.id))));
    GAMES.forEach(g=>{
      if(coverOverrides[g.id]) g.cover = coverOverrides[g.id];
      const ov = overrides[g.id];
      if(ov){ Object.assign(g, ov); }
    });
  }
  rebuildGamesArray();

  /* ================= HELPERS ================= */
  const fmt = (n, d=0) => (n===null||n===undefined||isNaN(n)) ? '—' : Number(n).toLocaleString('en-US',{minimumFractionDigits:d, maximumFractionDigits:d});
  const norm = (s) => (s||'').toString().trim().toUpperCase();
  const esc = (s) => (s===null||s===undefined) ? '' : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function localTodayISO(){
    const now=new Date();
    const y=now.getFullYear();
    const m=String(now.getMonth()+1).padStart(2,'0');
    const d=String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function computeDays(start, end){
    if(!start || !end) return null;
    const a = new Date(`${start}T00:00:00`), b = new Date(`${end}T00:00:00`);
    if(isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    // Duration is the calendar-date difference: 15 Aug -> 19 Aug = 4 days.
    return Math.max(0, Math.round((b.getTime()-a.getTime())/86400000));
  }
  function recordDays(r){
    if(!r || !r.start) return null;
    const rawEnd=String(r.end||'').trim();
    if(rawEnd.toLowerCase()==='postponed') return null;
    const effectiveEnd=(!rawEnd || rawEnd.toLowerCase()==='now') ? localTodayISO() : rawEnd;
    return computeDays(r.start,effectiveEnd);
  }
  function computeAge(releaseDate){
    if(!releaseDate) return null;
    const rel = new Date(releaseDate+'T00:00:00');
    if(isNaN(rel)) return null;
    const now = new Date();
    let years = now.getFullYear() - rel.getFullYear();
    let months = now.getMonth() - rel.getMonth();
    let days = now.getDate() - rel.getDate();
    if(days < 0){ months -= 1; const pm = new Date(now.getFullYear(), now.getMonth(), 0); days += pm.getDate(); }
    if(months < 0){ years -= 1; months += 12; }
    return `${years}Y ${months}M ${days}D`;
  }

  const STATE_LABEL = {'Done':'مكتملة','Brand-New':'لم تُلعب بعد','Not-Completed':'غير مكتملة','Not-Rankable':'غير قابلة للتقييم','Installed':'مثبّتة','Playing Now':'قيد اللعب حاليًا'};
  const VERDICT_LABEL = {'Epic':'أسطورية','Great':'رائعة','Very-Good':'جيدة جدًا','Good':'جيدة','Not-Bad':'مقبولة','Bad':'ضعيفة','NOSTALGIC':'حنين للماضي'};
  const PERSP_LABEL = {'FIRST PERSON':'منظور أول','THIRD PERSON':'منظور ثالث','FIRST&THIRD':'أول وثالث','2D PLATFORMER':'منصات ثنائية الأبعاد','2.5D PLATEFORMER':'منصات 2.5D','3D TOP-DOWN':'علوي ثلاثي الأبعاد'};
  const ARABIC_LABEL = {'Ar':'مدعوم من الشركة','No':'مدعوم كامل معربين','S':'مدعوم جزئي معربين'};
  const SERIES_LABEL = {'SOLO':'بدون سلسلة (مستقلة)'};

  /* ================= GENRE / SERIES NORMALIZATION ================= */
  let genreDisplay = {}, seriesDisplay = {};
  function rebuildNormalizedMaps(){
    genreDisplay = {}; seriesDisplay = {};
    GAMES.forEach(g=>{
      if(g.genre){
        const key = norm(g.genre);
        if(!genreDisplay[key]) genreDisplay[key] = {label:g.genre.trim(), count:0};
        genreDisplay[key].count++;
      }
      if(g.series){
        const key = norm(g.series);
        if(!seriesDisplay[key]) seriesDisplay[key] = {label:g.series.trim(), count:0};
        seriesDisplay[key].count++;
      }
    });
    GAMES.forEach(g=>{
      g._genreKey = g.genre ? norm(g.genre) : null;
      g._seriesKey = g.series ? norm(g.series) : null;
    });
  }
  rebuildNormalizedMaps();

  /* ================= COVER ART (generated placeholder, no scraped images) ================= */
  const COVER_PALETTES = [
    ['#5C8C77','#7BAF97'], ['#C9963F','#E3B15C'], ['#B5502F','#D9764F'],
    ['#4C6B8A','#7C9CBF'], ['#7A5C8C','#A785BF'], ['#8C7A5C','#BFA785'],
    ['#5C7A8C','#85AABF'], ['#8C5C6B','#BF859A']
  ];
  function hashStr(s){
    s = s || '';
    let h = 0;
    for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; }
    return h;
  }
  function initials(name){
    const words = (name||'?').trim().split(/\s+/).filter(Boolean);
    if(!words.length) return '?';
    if(words.length===1) return words[0].slice(0,2).toUpperCase();
    return (words[0][0]+words[1][0]).toUpperCase();
  }
  const coverCache = {};
  function coverSvgDataUri(g){
    if(g.cover) return g.cover;
    if(coverCache[g.id]) return coverCache[g.id];
    const seed = g._genreKey || g._seriesKey || g.name || String(g.id);
    const pal = COVER_PALETTES[hashStr(seed) % COVER_PALETTES.length];
    const label = esc(initials(g.name));
    const yearLabel = g.year ? esc(g.year) : '';
    const seriesLabel = (g.series && g.series !== 'SOLO') ? esc(g.series.slice(0,18)) : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">
      <defs>
        <linearGradient id="g${g.id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${pal[0]}"/>
          <stop offset="1" stop-color="${pal[1]}"/>
        </linearGradient>
      </defs>
      <rect width="200" height="260" fill="${pal[0]}"/>
      <rect width="200" height="260" fill="url(#g${g.id})"/>
      <rect x="0" y="0" width="200" height="260" fill="none" stroke="#1B1F16" stroke-opacity="0.35" stroke-width="6"/>
      <line x1="0" y1="0" x2="200" y2="260" stroke="#1B1F16" stroke-opacity="0.08" stroke-width="14"/>
      <line x1="200" y1="0" x2="0" y2="260" stroke="#1B1F16" stroke-opacity="0.08" stroke-width="14"/>
      <rect x="10" y="10" width="180" height="240" fill="none" stroke="#E8E0C7" stroke-opacity="0.55" stroke-width="1.5"/>
      <text x="100" y="140" font-family="Tahoma, Arial, sans-serif" font-size="64" font-weight="700" fill="#E8E0C7" fill-opacity="0.92" text-anchor="middle" dominant-baseline="middle">${label}</text>
      ${yearLabel ? `<text x="14" y="28" font-family="Consolas, monospace" font-size="14" fill="#E8E0C7" fill-opacity="0.85">${yearLabel}</text>` : ''}
      ${seriesLabel ? `<text x="100" y="236" font-family="Tahoma, Arial, sans-serif" font-size="12" fill="#1B1F16" fill-opacity="0.75" text-anchor="middle">${seriesLabel}</text>` : ''}
    </svg>`;
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    coverCache[g.id] = uri;
    return uri;
  }

  /* ================= أغلفة أونلاين تلقائية (فقط للألعاب بلا صورة محلية) ================= */
  // مهم: هذه الدالة لا تلمس إطلاقًا أي لعبة لديها g.cover موجود أصلاً (صورة محلية/مرفوعة).
  // تُستخدم فقط لعرض غلاف من الإنترنت مؤقتًا في الواجهة للألعاب الناقصة، مع كاش في localStorage.
  function updateCoverImgEls(id, src){
    document.querySelectorAll('img[data-cover-id="'+id+'"]').forEach(img=>{ img.src = src; });
  }
  function fetchOnlineCover(g){
    if(g.cover) return; // لا تحديث أبدًا للألعاب التي لديها صورة بالفعل
    const key = String(g.id);
    const cached = onlineCoverCache[key];
    if(cached === false) return;      // بحثنا سابقًا ولم نجد صورة
    if(cached){ updateCoverImgEls(g.id, cached); return; } // موجودة بالكاش
    if(cached === null) return;       // طلب قيد التنفيذ حاليًا
    onlineCoverCache[key] = null;
    const titles = [g.name + ' (video game)', g.name];
    const attempt = (i) => {
      if(i >= titles.length){ onlineCoverCache[key] = false; saveJSON(ONLINE_COVER_CACHE_KEY, onlineCoverCache); return; }
      fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(titles[i]))
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const src = data && data.thumbnail && data.thumbnail.source;
          if(src){
            onlineCoverCache[key] = src;
            saveJSON(ONLINE_COVER_CACHE_KEY, onlineCoverCache);
            updateCoverImgEls(g.id, src);
          } else { attempt(i+1); }
        })
        .catch(() => attempt(i+1));
    };
    attempt(0);
  }
  function scheduleOnlineCovers(games){
    let delay = 0;
    (games||[]).forEach(g=>{
      if(!g || g.cover) return;
      setTimeout(()=>fetchOnlineCover(g), delay);
      delay += 200; // تفريق الطلبات لتجنّب إغراق الشبكة
    });
  }

  function compressCover(dataUrl, cb){const img=new Image();img.onload=()=>{const maxW=500,maxH=700,scale=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);cb(c.toDataURL('image/jpeg',0.78));};img.onerror=()=>cb(null);img.src=dataUrl;}

  /* ================= HERO STATS ================= */
  function renderHeroStats(){
    // The top area is reserved ONLY for games currently being played.
    // A game is considered active only when it has a Game Dates record
    // with a start date and no end date. Finished/closed date records are
    // never shown here, even if the library status still says "Playing Now".
    const activeMap = new Map();
    (Array.isArray(dateRecords) ? dateRecords : []).forEach(r=>{
      if(!r || !r.start || r.end) return;
      const g = GAMES.find(x =>
        (r.gameId != null && Number(x.id)===Number(r.gameId)) ||
        normDateSearch(x.name)===normDateSearch(r.name)
      );
      if(!g) return;
      const key=String(g.id);
      const prev=activeMap.get(key);
      if(!prev || String(r.start).localeCompare(String(prev.r.start||''))>0){
        activeMap.set(key,{g,r});
      }
    });

    const activeGames=[...activeMap.values()].sort((a,b)=>
      String(b.r.start||'').localeCompare(String(a.r.start||''))
    );

    // Show exactly the number of active games: 1 game = 1 card, 2 = 2 cards, etc.
    const playingSlots = activeGames.map(({g,r})=>`
      <div class="hstat hstat-playing">
        <img class="playing-cover" data-cover-id="${g.id}" loading="lazy" decoding="async" src="${esc(gameImage(g))}" alt="">
        <div class="playing-info">
          <div class="playing-title" title="${esc(g.name)}">${gameNameLink(g.name)}</div>
          <div class="playing-label">🎮 ${tr('قيد اللعب حاليًا')}</div>
          <div class="playing-date">${esc(r.start)}</div>
        </div>
      </div>
    `).join('');

    const heroStats=document.getElementById('hero-stats');
    if(heroStats){
      heroStats.innerHTML=playingSlots;
      heroStats.style.display=activeGames.length?'flex':'none';
      scheduleOnlineCovers(activeGames.map(x=>x.g));
    }

    const fc = document.getElementById('footer-count');
    if(fc) fc.textContent = fmt(GAMES.length);
  }

  /* ================= DASHBOARD CHARTS ================= */
  function barChart(container, rows, opts){
    if(!rows.length){ container.innerHTML = `<div style="color:var(--muted); font-size:12.5px;">لا توجد بيانات بعد</div>`; return; }
    const max = Math.max(...rows.map(r=>r.value), 1);
    container.innerHTML = rows.map(r=>`
      <div class="bar-row ${opts && opts.brass ? 'brass':''}">
        <div class="b-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="b-track"><div class="b-fill" style="width:${(r.value/max*100).toFixed(1)}%"></div></div>
        <div class="b-val">${fmt(r.value)}</div>
      </div>`).join('');
  }

  function gameImage(g){
    if(g.image || g.imageUrl || g.cover) return g.image || g.imageUrl || g.cover;
    return coverSvgDataUri(g);
  }
  function renderGameStrip(items){
    if(!items.length) return '<div class="empty-state">لا توجد ألعاب مسجلة.</div>';
    setTimeout(()=>scheduleOnlineCovers(items),0);
    return `<div class="recent-games">${items.map(g=>`<div class="recent-game">
      <img data-cover-id="${g.id}" loading="lazy" decoding="async" src="${gameImage(g)}" alt="">
      <div class="rg-name" title="${esc(g.name)}">${gameNameLink(g.name)}</div>
      <div class="rg-date">${esc(g.endDate||g.startDate||'—')}</div>
    </div>`).join('')}</div>`;
  }
  function renderDashboard(){
    const topGenres = Object.entries(genreDisplay).sort((a,b)=>b[1].count-a[1].count).slice(0,8).map(([k,v])=>({label:v.label,value:v.count}));
    barChart(document.getElementById('chart-genre'),topGenres);
    const stateCounts={}; GAMES.forEach(g=>{if(g.playingState) stateCounts[g.playingState]=(stateCounts[g.playingState]||0)+1;});
    barChart(document.getElementById('chart-state'),Object.entries(stateCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:STATE_LABEL[k]||k,value:v})));
    const verdictCounts={}; GAMES.forEach(g=>{if(g.verdict) verdictCounts[g.verdict]=(verdictCounts[g.verdict]||0)+1;});
    const verdictOrder=['Epic','Great','Very-Good','Good','NOSTALGIC','Not-Bad','Bad'];
    barChart(document.getElementById('chart-verdict'),verdictOrder.filter(v=>verdictCounts[v]).map(v=>({label:VERDICT_LABEL[v]||v,value:verdictCounts[v]})),{brass:true});
    const played=GAMES.filter(g=>g.startDate).sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate)));
    const last5=played.slice(0,5), first5=played.slice(-5).reverse();
    const dash=document.getElementById('dashboard-section');
    let extra=document.getElementById('dashboard-extra');
    if(!extra){ extra=document.createElement('div'); extra.id='dashboard-extra'; dash.appendChild(extra); }
    const seriesRows=Object.entries(seriesDisplay).filter(([k,v])=>k!=='SOLO').map(([k,v])=>{
      const games=GAMES.filter(g=>g.series===k); const done=games.filter(g=>g.playingState==='Done').length;
      return {label:v.label,total:games.length,done,pct:games.length?done/games.length*100:0};
    }).sort((a,b)=>b.total-a.total).slice(0,12);
    const topPlayed=[...seriesRows].sort((a,b)=>b.total-a.total).slice(0,8);
    const epicNostalgic=GAMES.filter(g=>['Epic','NOSTALGIC'].includes(String(g.verdict||'')));
    const today=new Date(); today.setHours(0,0,0,0);
    const renderEpicCard=g=>{
      const rs=getGamePlayRecords(g.id,g.name).filter(r=>r && (r.start||r.end));
      // The elapsed-days counter and displayed last-play date are based on the latest End Date only.
      const completedPlays=rs.filter(r=>r.end && r.end !== 'Postponed' && !isNaN(new Date(r.end+'T00:00:00'))).sort((a,b)=>String(b.end).localeCompare(String(a.end)));
      const lastDate=completedPlays.length ? completedPlays[0].end : '—';
      let days='—';
      if(lastDate){const d=new Date(lastDate+'T00:00:00'); if(!isNaN(d))days=Math.max(0,Math.floor((today-d)/86400000));}
      const ageClass=(typeof days==='number'?(days>=730?' days-circle-red':(days>=365?' days-circle-yellow':'')):''); return `<div class="epic-game-card"><img loading="lazy" decoding="async" src="${gameImage(g)}" alt=""><div class="epic-game-name" title="${esc(g.name)}">${gameNameLink(g.name)}</div><div class="epic-game-stats"><span class="days-circle${ageClass}">${days}</span><span class="last-date-box">${esc(lastDate)}<small>${rs.length} مرات لعب</small></span></div></div>`;
    };
    extra.innerHTML=`
      <div class="dash-grid" style="margin-top:18px;grid-template-columns:1fr 1fr;">
        <div class="panel"><h3>Last 5 Games Played</h3>${renderGameStrip(last5)}</div>
        <div class="panel"><h3>Farest 5 Games</h3>${renderGameStrip(first5)}</div>
      </div>
      <div class="panel epic-nostalgic-panel"><h3>Epic & Nostalgic Games</h3>${epicNostalgic.length?`<div class="epic-game-grid">${epicNostalgic.map(renderEpicCard).join('')}</div>`:'<div class="empty-state">لا توجد ألعاب بهذا التقييم.</div>'}</div>`;

    const perspCounts={}; GAMES.forEach(g=>{if(g.perspective) perspCounts[g.perspective]=(perspCounts[g.perspective]||0)+1;});
    barChart(document.getElementById('chart-persp'),Object.entries(perspCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:PERSP_LABEL[k]||k,value:v})));
    const decades={}; GAMES.forEach(g=>{if(g.year){const d=Math.floor(g.year/10)*10;decades[d]=(decades[d]||0)+1;}});
    const decadeKeys=Object.keys(decades).map(Number).sort((a,b)=>a-b), maxDecade=Math.max(...decadeKeys.map(d=>decades[d]),1);
    document.getElementById('chart-decade').innerHTML=decadeKeys.map(d=>`<div class="decade-bar"><div class="dval">${decades[d]}</div><div class="col" style="height:${(decades[d]/maxDecade*90).toFixed(0)}px"></div><div class="dlabel">${d}s</div></div>`).join('');
    const topSeries=Object.entries(seriesDisplay).filter(([k,v])=>k!=='SOLO').sort((a,b)=>b[1].count-a[1].count).slice(0,8).map(([k,v])=>({label:v.label,value:v.count}));
    barChart(document.getElementById('chart-series'),topSeries,{brass:true});
    const seriesNote=document.getElementById('series-note'); if(seriesNote) seriesNote.textContent=`${fmt(Object.keys(seriesDisplay).filter(k=>k!=='SOLO').length)} سلسلة موثّقة`;
  }

  /* ================= DRIVES ================= */
  function recomputeDriveStats(){
    const driveStats = {};
    GAMES.forEach(g=>{
      const h = g.hdd || 'غير محدد';
      if(!driveStats[h]) driveStats[h] = {count:0, size:0};
      driveStats[h].count++;
      driveStats[h].size += (g.sizeGB||0);
    });
    return driveStats;
  }
  function renderDrives(){
    const driveStats=recomputeDriveStats();
    const entries=Object.entries(driveStats).sort((a,b)=>b[1].size-a[1].size);
    const known=Object.keys(capacities).filter(k=>!driveStats[k]);
    const all=[...entries,...known.map(k=>[k,{count:0,size:0}])];
    document.getElementById('drives-grid').innerHTML=`
      <div class="drives-toolbar" style="grid-column:1/-1">
        <div><label>اسم الهارد</label><input id="new-drive-name" class="mini-input" placeholder="مثال: SSD-01"></div>
        <div><label>السعة GB</label><input id="new-drive-cap" type="number" min="1" step="1" class="mini-input" placeholder="1000"></div>
        <button type="button" class="plus-btn" id="add-drive-btn">＋ إضافة هارد</button>
        <span class="note">يمكنك إدخال أي سعة تريدها، وتُحفظ محليًا.</span>
      </div>`+
      all.map(([name,st])=>{
        const cap=capacities[name]; const isDeleted=name==='Deleted'; let barHtml='',remainHtml='';
        if(cap&&cap>0){const pct=Math.min(100,st.size/cap*100),warn=pct>88;barHtml=`<div class="drive-bar-track"><div class="drive-bar-fill ${warn?'warn':''}" style="width:${pct.toFixed(1)}%"></div></div>`;remainHtml=`<div class="drive-remain">${pct.toFixed(1)}% مستخدمة · المتبقي ${fmt(Math.max(0,cap-st.size),1)} GB</div>`;}
        return `<div class="drive-card ${isDeleted?'is-deleted':''}"><div class="drive-name">${esc(name)} <span class="cnt">${st.count} لعبة</span></div><div class="drive-used">${fmt(st.size,1)} GB مستخدمة</div>${!isDeleted?`<div class="drive-cap-row"><label>السعة:</label><input type="number" min="1" step="1" data-drive="${esc(name)}" class="cap-input" value="${cap||''}" readonly><button type="button" class="icon-action drive-edit" title="تعديل السعة">✏️</button><button type="button" class="icon-action drive-save" title="حفظ السعة" disabled>💾</button></div>`:''}${barHtml}${remainHtml}</div>`;
      }).join('');
    document.getElementById('add-drive-btn').addEventListener('click',()=>{const n=document.getElementById('new-drive-name').value.trim();const c=parseFloat(document.getElementById('new-drive-cap').value);if(!n||!(c>0)){alert('اكتب اسم الهارد والسعة أولاً.');return;}capacities[n]=c;saveJSON(CAP_KEY,capacities);renderDrives();});
    document.querySelectorAll('.drive-edit').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('.drive-cap-row');const inp=row?.querySelector('.cap-input');const save=row?.querySelector('.drive-save');if(!inp)return;inp.readOnly=false;inp.classList.add('is-editing');inp.focus();if(save)save.disabled=false;}));
    document.querySelectorAll('.drive-save').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('.drive-cap-row');const inp=row?.querySelector('.cap-input');if(!inp||btn.disabled)return;const d=inp.dataset.drive,v=parseFloat(inp.value);if(v>0)capacities[d]=v;else delete capacities[d];saveJSON(CAP_KEY,capacities);renderDrives();}));
  }

  /* ================= FILTER STATE ================= */
  const state = {
    search:'',
    genres:new Set(), hdds:new Set(), states:new Set(), verdicts:new Set(), persp:new Set(), arabic:new Set(), series:new Set(),
    gotyOnly:false,
    yearMin:null, yearMax:null,
    sizeMin:null, sizeMax:null,
    sort:'name-asc',
    page:1, pageSize:20,
    expandedId:null
  };

  function valueCounts(key){
    const m = {};
    GAMES.forEach(g=>{ const v=g[key]; if(v) m[v]=(m[v]||0)+1; });
    return m;
  }
  function genreValueCounts(){ const m={}; Object.entries(genreDisplay).forEach(([k,v])=>{ m[k]=v.count; }); return m; }
  function seriesValueCounts(){ const m={}; Object.entries(seriesDisplay).forEach(([k,v])=>{ m[k]=v.count; }); return m; }

  function filterGroupIcon(title){
    const icons={
      'النوع':'🎮','السلسلة':'◈','الهارد':'▣','Playing State':'▶','التقييم':'★','المنظور':'◉','الدعم العربي':'文','سنة الإصدار':'⌁','الحجم (GB)':'▰'
    };
    return `<span class="filter-group-icon" aria-hidden="true">${icons[title]||'◆'}</span>`;
  }

  function buildChipGroup(title, valueCounts, activeSet, labelMap){
    const ratingOrder = ['Bad','Not-Bad','Good','Very-Good','Great','NOSTALGIC','Epic'];
    const isRating = title === 'التقييم';
    const rows = isRating
      ? ratingOrder.filter(v => Object.prototype.hasOwnProperty.call(valueCounts, v)).map(v => [v, valueCounts[v]])
      : Object.entries(valueCounts).sort((a,b)=>b[1]-a[1]);
    const groupClass = 'filter-group-' + String(title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    return `<details class="f-group ${groupClass} ${isRating?'rating-filter-group':''}"><summary><span class="filter-group-title">${filterGroupIcon(title)}<span>${title}</span></span><span class="filter-group-count">(${rows.length})</span></summary>
      <div class="chip-list ${isRating?'rating-chip-list':''}">
        ${rows.map(([val,count],idx)=>{
          const label = labelMap && labelMap[val] ? labelMap[val] : val;
          const stars = isRating ? '★'.repeat(idx+1) : '';
          return `<button type="button" class="chip ${activeSet.has(val)?'active':''} ${isRating?'rating-chip rating-'+String(val).toLowerCase().replace(/\s+/g,'-'):''}" data-group="${title}" data-val="${esc(val)}"><span class="chip-main">${isRating?`<span class="rating-stars" aria-hidden="true">${stars}</span>`:`<span class="chip-mark" aria-hidden="true">◆</span>`}<span class="chip-label">${esc(label)}</span></span><span class="n">${count}</span></button>`;
        }).join('')}
      </div>
    </details>`;
  }


  let YEAR_MIN=0, YEAR_MAX=0;
  function recomputeYearRange(){
    const allYears = GAMES.filter(g=>g.year).map(g=>g.year);
    YEAR_MIN = allYears.length ? Math.min(...allYears) : 0;
    YEAR_MAX = allYears.length ? Math.max(...allYears) : 0;
  }

  const genreLabelMap = () => { const m={}; Object.entries(genreDisplay).forEach(([k,v])=>{ m[k]=v.label; }); return m; };
  const seriesLabelMapFn = () => { const m={}; Object.entries(seriesDisplay).forEach(([k,v])=>{ m[k]= SERIES_LABEL[v.label] || v.label; }); return m; };

  function renderFilters(){
    recomputeYearRange();
    const html = `
      <div class="filter-panel-tools" role="toolbar" aria-label="التحكم في الفلاتر">
        <button type="button" class="filter-panel-action" id="collapse-all-filters" title="طي الكل">⌃ <span>طي الكل</span></button>
        <button type="button" class="filter-panel-action" id="expand-all-filters" title="فرد الكل">⌄ <span>فرد الكل</span></button>
      </div>
      ${buildChipGroup('السلسلة', seriesValueCounts(), state.series, seriesLabelMapFn())}
      ${buildChipGroup('Playing State', valueCounts('playingState'), state.states, STATE_LABEL)}
      <details class="f-group"><summary><span class="filter-group-title"><span class="filter-group-icon" aria-hidden="true">⌁</span><span>سنة الإصدار</span></span><span class="filter-group-count"></span></summary>
        <div class="range-row">
          <input type="number" id="year-min" placeholder="${YEAR_MIN}" value="${state.yearMin??''}">
          <span style="color:var(--muted)">—</span>
          <input type="number" id="year-max" placeholder="${YEAR_MAX}" value="${state.yearMax??''}">
        </div>
      </details>
      ${buildChipGroup('الهارد', valueCounts('hdd'), state.hdds)}
      ${buildChipGroup('التقييم', valueCounts('verdict'), state.verdicts, VERDICT_LABEL)}
      ${buildChipGroup('الدعم العربي', valueCounts('arabic'), state.arabic, ARABIC_LABEL)}
      ${buildChipGroup('النوع', genreValueCounts(), state.genres, genreLabelMap())}
      ${buildChipGroup('المنظور', valueCounts('perspective'), state.persp, PERSP_LABEL)}
      <details class="f-group"><summary><span class="filter-group-title"><span class="filter-group-icon" aria-hidden="true">▰</span><span>الحجم (GB)</span></span><span class="filter-group-count"></span></summary>
        <div class="range-row">
          <input type="number" id="size-min" placeholder="0" value="${state.sizeMin??''}">
          <span style="color:var(--muted)">—</span>
          <input type="number" id="size-max" placeholder="max" value="${state.sizeMax??''}">
        </div>
      </details>
      <div class="f-group filter-goty-group" style="border-bottom:none;">
        <label class="toggle-row"><input type="checkbox" id="goty-toggle" ${state.gotyOnly?'checked':''}> عرض اختياراتي المفضّلة فقط (GOTY)</label>
      </div>
      <button type="button" class="clear-btn" id="clear-filters">مسح كل الفلاتر</button>
    `;
    document.getElementById('filters').innerHTML = html;

    document.querySelectorAll('.chip').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const group = chip.getAttribute('data-group');
        const val = chip.getAttribute('data-val');
        const setMap = {'النوع':state.genres,'السلسلة':state.series,'الهارد':state.hdds,'Playing State':state.states,'التقييم':state.verdicts,'المنظور':state.persp,'الدعم العربي':state.arabic};
        const set = setMap[group];
        if(!set) return;
        if(set.has(val)) set.delete(val); else set.add(val);
        state.page = 1;
        renderFilters(); renderResults();
      });
    });
    const filterGroups = () => Array.from(document.querySelectorAll('#library-section aside#filters.filters details.f-group'));
    document.getElementById('collapse-all-filters').addEventListener('click', ()=>filterGroups().forEach(el=>el.open=false));
    document.getElementById('expand-all-filters').addEventListener('click', ()=>filterGroups().forEach(el=>el.open=true));
    document.getElementById('year-min').addEventListener('input', e=>{ state.yearMin = e.target.value?parseInt(e.target.value):null; state.page=1; renderResults(); });
    document.getElementById('year-max').addEventListener('input', e=>{ state.yearMax = e.target.value?parseInt(e.target.value):null; state.page=1; renderResults(); });
    document.getElementById('size-min').addEventListener('input', e=>{ state.sizeMin = e.target.value?parseFloat(e.target.value):null; state.page=1; renderResults(); });
    document.getElementById('size-max').addEventListener('input', e=>{ state.sizeMax = e.target.value?parseFloat(e.target.value):null; state.page=1; renderResults(); });
    document.getElementById('goty-toggle').addEventListener('change', e=>{ state.gotyOnly = e.target.checked; state.page=1; renderResults(); });
    document.getElementById('clear-filters').addEventListener('click', ()=>{
      state.genres.clear(); state.hdds.clear(); state.states.clear(); state.verdicts.clear(); state.persp.clear(); state.arabic.clear(); state.series.clear();
      state.gotyOnly=false; state.yearMin=null; state.yearMax=null; state.sizeMin=null; state.sizeMax=null; state.search=''; state.searchName=''; state.searchSeries='';
      const sn=document.getElementById('search-name-input'); if(sn) sn.value=''; const ss=document.getElementById('search-series-input'); if(ss) ss.value='';
      state.page=1;
      renderFilters(); renderResults();
    });
  }

  /* ================= SEARCH CLEAR BUTTONS ================= */
  function enhanceSearchClearButtons(root=document){
    const inputs=root.querySelectorAll ? root.querySelectorAll('input.search-input[type="text"], input.search-input[type="search"], input.dt-game-search[type="text"], input.dt-game-search[type="search"]') : [];
    inputs.forEach(input=>{
      if(!input || input.dataset.clearButtonBound==='1') return;
      input.dataset.clearButtonBound='1';
      const wrap=document.createElement('div');
      wrap.className='search-clear-wrap';
      input.parentNode.insertBefore(wrap,input);
      wrap.appendChild(input);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='search-clear-btn';
      btn.setAttribute('aria-label','Clear search');
      btn.title='Clear search';
      btn.textContent='×';
      wrap.appendChild(btn);
      const sync=()=>{btn.classList.toggle('is-visible',String(input.value||'').length>0);};
      btn.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        input.value='';
        input.focus();
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('search',{bubbles:true}));
        sync();
      });
      input.addEventListener('input',sync);
      input.addEventListener('change',sync);
      input.addEventListener('search',sync);
      sync();
    });
  }

  function initSearchClearButtons(){
    enhanceSearchClearButtons(document);
    if(typeof MutationObserver!=='undefined' && !window.__searchClearObserver){
      const observer=new MutationObserver(mutations=>{
        mutations.forEach(m=>m.addedNodes.forEach(node=>{
          if(node.nodeType===1) enhanceSearchClearButtons(node);
        }));
      });
      observer.observe(document.body,{childList:true,subtree:true});
      window.__searchClearObserver=observer;
    }
  }

  /* ================= SEARCH ================= */
  function searchMatch(g, nameQ, seriesQ){
    nameQ=(nameQ||'').toLowerCase().trim();
    seriesQ=(seriesQ||'').toLowerCase().trim();
    return (!nameQ || (g.name||'').toLowerCase().includes(nameQ)) && (!seriesQ || (g.series||'').toLowerCase().includes(seriesQ));
  }

  function updateSuggestions(activeInput){
    const searchInput = document.getElementById(activeInput || 'search-name-input');
    const suggBox = document.getElementById('search-sugg');
    let suggActive = -1;
    const isSeries = searchInput.id === 'search-series-input';
    const q = ((isSeries ? state.searchSeries : state.searchName)||'').toLowerCase();
    if(!q){ suggBox.classList.remove('open'); return; }
    const matches = GAMES.filter(g=>((isSeries ? (g.series||'') : (g.name||'')).toLowerCase().includes(q))).slice(0,8);
    const seen = new Set();
    if(!matches.length){ suggBox.classList.remove('open'); return; }
    suggBox.innerHTML = matches.map(g=>{
      const label = isSeries ? (g.series||'') : g.name;
      if(seen.has(label)) return ''; seen.add(label);
      const idx = label.toLowerCase().indexOf(q);
      const highlighted = idx>=0 ? esc(label.slice(0,idx)) + '<b>' + esc(label.slice(idx,idx+q.length)) + '</b>' + esc(label.slice(idx+q.length)) : esc(label);
      return `<div class="sugg-item" data-name="${esc(label)}"><img class="sugg-thumb" data-cover-id="${g.id}" loading="lazy" decoding="async" src="${coverSvgDataUri(g)}" onerror="this.onerror=null;this.src='assets/new-badge.png'" alt=""><span>${highlighted}</span><span class="s-meta">${esc(g.year||'')} · ${esc(g.hdd||'')}</span></div>`;
    }).join('');
    suggBox.classList.add('open');
    scheduleOnlineCovers(matches);
    suggBox.querySelectorAll('.sugg-item').forEach(item=>{
      item.addEventListener('click', ()=>{
        searchInput.value = item.getAttribute('data-name');
        if(isSeries) state.searchSeries = searchInput.value; else state.searchName = searchInput.value;
        suggBox.classList.remove('open');
        state.page=1;
        renderResults();
      });
    });
  }

  /* ================= LIBRARY SEARCH ================= */
  function initLibrarySearch(){
    const nameInput=document.getElementById('search-name-input');
    const filterToggle=document.getElementById('library-filter-toggle');
    const filterPanel=document.getElementById('filters');
    const closeLibraryFilters=()=>{
      if(!filterPanel) return;
      filterPanel.classList.remove('library-filters-open');
      if(filterToggle){ filterToggle.classList.remove('active'); filterToggle.setAttribute('aria-expanded','false'); filterToggle.setAttribute('aria-label','فتح الفلاتر'); }
    };
    if(filterToggle && filterPanel && filterToggle.dataset.bound!=='1'){
      filterToggle.dataset.bound='1';
      filterToggle.addEventListener('click', (e)=>{
        e.stopPropagation();
        const open=!filterPanel.classList.contains('library-filters-open');
        filterPanel.classList.toggle('library-filters-open',open);
        filterToggle.classList.toggle('active',open);
        filterToggle.setAttribute('aria-expanded',String(open));
        filterToggle.setAttribute('aria-label',open?'إغلاق الفلاتر':'فتح الفلاتر');
      });
      document.addEventListener('click',(e)=>{
        if(!filterPanel.classList.contains('library-filters-open')) return;
        if(filterPanel.contains(e.target) || filterToggle.contains(e.target)) return;
        closeLibraryFilters();
      });
      document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeLibraryFilters(); });
    }
    const seriesInput=document.getElementById('search-series-input');
    if(!nameInput || !seriesInput || nameInput.dataset.bound==='1') return;
    nameInput.dataset.bound='1';
    let activeInput='search-name-input';
    const run=(input)=>{activeInput=input||activeInput;state.searchName=nameInput.value;state.searchSeries=seriesInput.value;state.page=1;updateSuggestions(activeInput);renderResults();};
    [nameInput,seriesInput].forEach(input=>{input.addEventListener('focus',()=>{activeInput=input.id; updateSuggestions(activeInput);});input.addEventListener('input',()=>run(input.id));input.addEventListener('search',()=>run(input.id));input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run(input.id);}});});
  }

  /* ================= FILTERING + RENDER RESULTS ================= */
  function getFiltered(){
    return GAMES.filter(g=>{
      if(!searchMatch(g, state.searchName, state.searchSeries)) return false;
      if(state.genres.size && !state.genres.has(g._genreKey)) return false;
      if(state.series.size && !state.series.has(g._seriesKey)) return false;
      if(state.hdds.size && !state.hdds.has(g.hdd)) return false;
      if(state.states.size && !state.states.has(g.playingState)) return false;
      if(state.verdicts.size && !state.verdicts.has(g.verdict)) return false;
      if(state.persp.size && !state.persp.has(g.perspective)) return false;
      if(state.arabic.size && !state.arabic.has(g.arabic)) return false;
      if(state.gotyOnly && g.goty!=='Y') return false;
      if(state.yearMin && (!g.year || g.year < state.yearMin)) return false;
      if(state.yearMax && (!g.year || g.year > state.yearMax)) return false;
      if(state.sizeMin!=null && g.sizeGB < state.sizeMin) return false;
      if(state.sizeMax!=null && g.sizeGB > state.sizeMax) return false;
      return true;
    });
  }

  function sortList(list){
    const [key, dir] = state.sort.split('-');
    const mult = dir==='asc' ? 1 : -1;
    return list.slice().sort((a,b)=>{
      if(key==='name') return a.name.localeCompare(b.name) * mult;
      if(key==='year') return ((a.year||0)-(b.year||0)) * mult;
      if(key==='size') return ((a.sizeGB||0)-(b.sizeGB||0)) * mult;
      if(key==='added') {
        const rawA=a.createdAt||a.addedAt||a.dateAdded||null;
        const rawB=b.createdAt||b.addedAt||b.dateAdded||null;
        const ta=rawA ? new Date(rawA).getTime() : 0;
        const tb=rawB ? new Date(rawB).getTime() : 0;
        return ((isNaN(ta)?0:ta)-(isNaN(tb)?0:tb)) * mult;
      }
      return 0;
    });
  }

  function stateBadgeClass(s){
    if(s==='Done') return 'state-done';
    if(s==='Brand-New') return 'state-brandnew';
    if(s==='Not-Completed') return 'state-notcompleted';
    return '';
  }
  function verdictBadgeClass(v){
    const key=String(v||'').trim().toLowerCase().replace(/\s+/g,'-');
    return {'epic':'verdict-epic','nostalgic':'verdict-nostalgic','great':'verdict-great','very-good':'verdict-very-good','good':'verdict-good','not-bad':'verdict-not-bad','bad':'verdict-bad'}[key] || '';
  }

  function latestPlayDate(gid,name){
    const rows=(Array.isArray(dateRecords)?dateRecords:[]).filter(r=>Number(r.gameId)===Number(gid) || normDateSearch(r.name)===normDateSearch(name));
    if(!rows.length)return null;
    return rows.reduce((max,r)=>{const d=r.end||r.start||'';return d>max?d:max;},'')||null;
  }
  function daysSinceLastPlayed(dateValue){
    if(!dateValue) return null;
    let d = new Date(dateValue);
    if(isNaN(d.getTime())){
      const m = String(dateValue).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
      if(m) d = new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
    }
    if(isNaN(d.getTime())) return null;
    const played = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.floor((today - played) / 86400000);
    return diff >= 0 ? diff + 1 : 0;
  }
  const SYSTEM_OPTIONS=['Low','Low-Up','Medium','Medium-Up','High','High-Up','Very-High','VeryHigh-Up','Maxed'];

  const EDIT_GAME_FIELDS=[
    ['name','اسم اللعبة','text'],['system','System','select'],['series','السلسلة','select'],['genre','النوع','select'],['hdd','الهارد','select'],
    ['developer','الشركة المطوّرة','select'],['mainChar','الشخصية Home','select'],['playingState','Playing State','select'],
    ['verdict','Final Rating','select'],['rating','Game Rating (1-10)','number'],['perspective','المنظور','select'],['versionType','نوع النسخة','select'],['rem','نوع الإصدار','select'],
    ['arabic','الدعم العربي','select'],['goty','GOTY','select'],['ledTv','LED TV','select'],['gameVersion','إصدار اللعبة','text'],
    ['installTime','وقت التثبيت','text'],['releaseDate','تاريخ الإصدار','date'],['sizeGB','الحجم (GB)','number']
  ];
  function editFieldOptions(key,g){
    const vals=key==='system' ? SYSTEM_OPTIONS : uniqueValues(key);
    const map=key==='playingState'?STATE_LABEL:key==='verdict'?VERDICT_LABEL:key==='perspective'?PERSP_LABEL:key==='arabic'?ARABIC_LABEL:key==='goty'?{Y:'نعم',N:'لا'}:{};
    return [''].concat(vals).map(v=>`<option value="${esc(v)}" ${String(v)===String(g[key]??'')?'selected':''}>${esc(map[v]||v||'—')}</option>`).join('');
  }
  function editGameHtml(g){
    const fields=EDIT_GAME_FIELDS.map(([key,label,type],idx)=>{
      if(type==='select') return `<div class="game-edit-field"><label>${esc(label)}</label><select data-edit-field="${key}" disabled>${editFieldOptions(key,g)}</select></div>`;
      return `<div class="game-edit-field"><label>${esc(label)}</label><input data-edit-field="${key}" type="${type}" value="${esc(g[key]??'')}" readonly ${key==='rating'?'step="0.1" min="1" max="10" inputmode="decimal"':type==='number'?'step="0.01" min="0"':''}></div>`;
    }).join('');
    return `<div class="game-edit-panel"><div class="game-edit-grid">${fields}</div><div class="game-edit-actions"><button type="button" class="cancel-edit">↩️</button><button type="button" class="save-edit">💾</button></div></div>`;
  }
  function setGameEditMode(row,editing){
    row.classList.toggle('editing',editing);
    row.querySelectorAll('[data-edit-field]').forEach(el=>{
      if(el.tagName==='SELECT') el.disabled=!editing;
      else el.readOnly=!editing;
    });
    const save=row.querySelector('.save-edit');
    const cancel=row.querySelector('.cancel-edit');
    if(save) save.disabled=!editing;
    if(cancel) cancel.disabled=!editing;
  }
  function snapshotGameEditRow(row){
    const snapshot={};
    row.querySelectorAll('[data-edit-field]').forEach(el=>{ snapshot[el.dataset.editField]=el.value; });
    row.dataset.editSnapshot=JSON.stringify(snapshot);
  }
  function restoreGameEditRow(row){
    try{
      const snapshot=JSON.parse(row.dataset.editSnapshot||'{}');
      row.querySelectorAll('[data-edit-field]').forEach(el=>{
        const key=el.dataset.editField;
        if(Object.prototype.hasOwnProperty.call(snapshot,key)) el.value=snapshot[key];
      });
    }catch(e){}
  }
  function showLibrarySaveSuccess(){
    const host=document.getElementById('library-section')||document.getElementById('results-list');
    if(!host)return;
    host.querySelectorAll('.library-save-success').forEach(x=>x.remove());
    const ok=document.createElement('div');
    ok.className='library-save-success';
    ok.textContent='تم حفظ التغيرات بنجاح';
    const target=document.getElementById('results-list');
    if(target) target.prepend(ok); else host.prepend(ok);
    setTimeout(()=>ok.remove(),2500);
    window.SoundFX?.playSaveSuccess();
  }
  function saveGameEdits(id,row){
    const g=GAMES.find(x=>Number(x.id)===Number(id)); if(!g)return;
    const changed={};
    row.querySelectorAll('[data-edit-field]').forEach(el=>{let v=el.value;if(el.type==='number')v=v===''?null:Number(v);else v=v||null;changed[el.dataset.editField]=v;});
    if(changed.rating!=null){ const n=Number(changed.rating); changed.rating=Number.isFinite(n)?Math.min(10,Math.max(1,Math.round(n*10)/10)):null; }
    if(changed.releaseDate) changed.year=parseInt(String(changed.releaseDate).slice(0,4))||null;
    changed.age=computeAge(changed.releaseDate);
    if(userGames.some(x=>Number(x.id)===Number(id))){
      const ug=userGames.find(x=>Number(x.id)===Number(id)); Object.assign(ug,changed); saveJSON(USERGAMES_KEY,userGames);
    }else{
      if(!overrides[id])overrides[id]={}; Object.assign(overrides[id],changed); saveJSON(OVERRIDES_KEY,overrides);
    }
    rebuildGamesArray(); rebuildNormalizedMaps(); renderHeroStats(); renderDashboard(); renderFilters(); renderResults();
    showLibrarySaveSuccess();
  }
  function deleteGameCompletely(id){
    const g=GAMES.find(x=>Number(x.id)===Number(id)); if(!g)return;
    if(!confirm(tr(`حذف اللعبة "${g.name}" بالكامل؟ سيتم حذف سجلات التواريخ المرتبطة بها أيضًا.`)))return;
    window.SoundFX?.playDelete();
    userGames=userGames.filter(x=>Number(x.id)!==Number(id));
    const del=loadJSON('mostafa_pc_deleted_games_v1',[]); if(!del.includes(Number(id)))del.push(Number(id));
    saveJSON('mostafa_pc_deleted_games_v1',del);
    delete overrides[id]; if(coverOverrides[id]) removeCoverOverride(id);
    saveJSON(USERGAMES_KEY,userGames);saveJSON(OVERRIDES_KEY,overrides);
    dateRecords=ensureDateRecords().filter(r=>Number(r.gameId)!==Number(id) && normDateSearch(r.name)!==normDateSearch(g.name)); saveDateRecords();
    rebuildGamesArray(); rebuildNormalizedMaps(); state.expandedId=null; renderHeroStats(); renderDashboard(); renderDrives(); renderFilters(); renderResults(); renderDatesTab();
  }
  function playDateKey(r){return String(r?.start||r?.end||'9999-12-31');}
  function getGamePlayRecords(gid,name){
    const id=Number(gid); const nn=normDateSearch(name);
    return (Array.isArray(dateRecords)?dateRecords:[]).filter(r=>
      (r.gameId!=null && Number(r.gameId)===id) || (nn && normDateSearch(r.name)===nn)
    );
  }
  function getGamePlayCount(gid,name){return getGamePlayRecords(gid,name).length;}
  function getPlayCountBefore(gid,name,currentRecord){
    // Number of plays before the current record (used for New/Old status).
    const key=playDateKey(currentRecord);
    return getGamePlayRecords(gid,name).filter(r=>r!==currentRecord && playDateKey(r)<key).length;
  }
  function getPlayOrdinal(gid,name,currentRecord){
    // Display the play occurrence as 1, 2, 3... instead of starting at 0.
    // Records are ordered chronologically; the current record is always included.
    const records=getGamePlayRecords(gid,name).slice().sort((a,b)=>{
      const d=playDateKey(a).localeCompare(playDateKey(b));
      if(d!==0) return d;
      return String(a.rid||'').localeCompare(String(b.rid||''),undefined,{numeric:true,sensitivity:'base'});
    });
    const idx=records.indexOf(currentRecord);
    return idx>=0 ? idx+1 : getPlayCountBefore(gid,name,currentRecord)+1;
  }

  function isNewLibraryGame(g){
    // New = added to the library within the last month and not played yet.
    // Existing imported games without a createdAt are not retroactively marked New.
    if(getGamePlayCount(g.id,g.name)>0) return false;
    const raw=g.createdAt||g.addedAt||g.dateAdded||null;
    if(!raw) return false;
    const added=new Date(raw);
    if(isNaN(added.getTime())) return false;
    const now=new Date();
    const oneMonthAgo=new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth()-1);
    return added>=oneMonthAgo && added<=now;
  }

  function numericGameRating(g){
    const n=Number(g?.rating);
    return Number.isFinite(n) && n>=1 && n<=10 ? n : null;
  }
  function ratingEmblem(g,extraClass=''){
    const n=numericGameRating(g);
    return `<div class="rating-emblem ${extraClass}" aria-label="Game rating ${n!=null?n:'not set'}">
      <img class="rating-wing rating-wing-left" src="assets/rating-wing-left.svg" alt="" aria-hidden="true">
      <span class="rating-circle">${n!=null?String(n).replace(/\.0$/,''):'—'}</span>
      <img class="rating-wing rating-wing-right" src="assets/rating-wing-right.svg" alt="" aria-hidden="true">
    </div>`;
  }

  function renderResults(){
    let list = getFiltered();
    document.getElementById('result-count').innerHTML = `<b>${fmt(list.length)}</b> لعبة من أصل ${fmt(GAMES.length)}`;
    list = sortList(list);
    const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
    if(state.page > totalPages) state.page = totalPages;
    const start = (state.page-1)*state.pageSize; const pageItems = list.slice(start, start+state.pageSize);
    const container = document.getElementById('results-list');
    if(!pageItems.length){container.innerHTML=`<div class="empty-state">لا توجد ألعاب مطابقة لهذا البحث أو الفلاتر المحددة.</div>`;}
    else {
      container.innerHTML=pageItems.map((g,i)=>{
        const tags=[]; if(g.gameplay)tags.push('طور لعب مميز');if(g.graphic)tags.push('جرافيك مميز');if(g.world)tags.push('عالم مفتوح مميز');if(g.theme)tags.push('أجواء مميزة');if(g.story)tags.push('قصة مميزة');if(g.bugs)tags.push('بها أعطال');
        const isOpen=state.expandedId===g.id; const last=latestPlayDate(g.id,g.name);
        return `<div class="g-row ${isOpen?'open':''}" data-id="${g.id}">
          ${g.verdict?`<span class="g-rating ${verdictBadgeClass(g.verdict)}" title="${esc(tr(VERDICT_LABEL[g.verdict]||g.verdict))}" aria-label="${esc(tr(VERDICT_LABEL[g.verdict]||g.verdict))}"><span class="g-rating-label">${esc(g.verdict)}</span><span class="g-rating-stars">${'★'.repeat({'Bad':1,'Not-Bad':2,'Good':3,'Very-Good':4,'Great':5,'NOSTALGIC':6,'Epic':7}[g.verdict]||0)}</span>${ratingEmblem(g,'rating-emblem-collapsed')}</span>`:''}
          <div class="g-row-top"><img class="g-thumb" data-cover-id="${g.id}" loading="lazy" decoding="async" src="${coverSvgDataUri(g)}" onerror="this.onerror=null;this.src='assets/new-badge.png'" alt=""><div class="g-idx">${fmt(start+i+1)}</div><div class="g-name">${gameNameLink(g.name, 'library-game-name')}${isNewLibraryGame(g)?` <img class="library-new-badge" src="assets/new-badge.png" alt="New">`:''}${g.series&&g.series!==g.name?`<span class="g-series">${esc(SERIES_LABEL[g.series]||g.series)}</span>`:''}</div><div class="g-badges">${g.genre?`<span class="badge">${esc(g.genre)}</span>`:''}${g.hdd?`<span class="badge hdd">${esc(g.hdd)}</span>`:''}${g.year?`<span class="badge year">${g.year}</span>`:''}${g.sizeGB?`<span class="badge size">${fmt(g.sizeGB,1)} GB</span>`:''}${getGamePlayCount(g.id,g.name)?`<span class="badge play-count-badge">🎮 ${fmt(getGamePlayCount(g.id,g.name))} مرة</span>`:''}${g.playingState?`<span class="badge ${stateBadgeClass(g.playingState)}">${STATE_LABEL[g.playingState]||g.playingState}</span>`:''}${g.verdict?`<span class="badge ${verdictBadgeClass(g.verdict)}">${VERDICT_LABEL[g.verdict]||g.verdict}</span>`:''}</div></div>
          <div class="g-detail">
            <div class="g-detail-cover"><img class="game-cover-real" data-cover-id="${g.id}" loading="lazy" decoding="async" src="${coverSvgDataUri(g)}" onerror="this.onerror=null;this.src='assets/new-badge.png'" alt=""><div class="cover-tools"><label class="icon-btn cover-upload-label" title="${g.cover?tr('تحديث الصورة'):tr('إضافة صورة')}">🖼️<input type="file" accept="image/*" class="cover-upload" data-id="${g.id}" hidden></label>${g.cover?`<button type="button" class="icon-btn cover-remove" data-id="${g.id}" title="${tr('حذف الصورة')}">🗑️</button>`:''}</div></div>
            <div class="g-detail-fields">
              <div><span class="dk">${tr('السلسلة')}</span><span class="dv">${esc(SERIES_LABEL[g.series]||g.series||'—')}</span></div>
              <div><span class="dk">${tr('تاريخ الإصدار')}</span><span class="dv">${esc(g.releaseDate||'—')}</span></div>
              <div><span class="dk">${tr('نوع النسخة')}</span><span class="dv">${esc(g.versionType||'—')}</span></div>
              <div><span class="dk">${tr('الهارد')}</span><span class="dv">${esc(g.hdd||'—')}</span></div>
              <div><span class="dk">${tr('الشركة المطوّرة')}</span><span class="dv">${esc(g.developer||'—')}</span></div>
              <div><span class="dk">${tr('System')}</span><span class="dv">${esc(g.system||'—')}</span></div>
              <div><span class="dk">${tr('الشخصية Home')}</span><span class="dv">${esc(g.mainChar||'—')}</span></div>
              <div><span class="dk">${tr('المنظور')}</span><span class="dv">${esc(PERSP_LABEL[g.perspective]||g.perspective||'—')}</span></div>
              <div><span class="dk">${tr('نوع الإصدار')}</span><span class="dv">${esc(g.rem||'—')}</span></div>
              <div class="last-played-detail"><span class="dk">${tr('آخر تاريخ لعب')}</span><span class="dv last-played-value">${esc(last||'—')}${last&&daysSinceLastPlayed(last)!=null?`<span class="last-played-days" title="${esc(tr('عدد الأيام منذ آخر لعب'))}">${fmt(daysSinceLastPlayed(last))} ${esc(tr('يوم'))}</span>`:''}</span></div>
              <div><span class="dk">${tr('مدة اللعب (أيام)')}</span><span class="dv">${(()=>{const d=computeDays(g.startDate,g.endDate);return d!=null?fmt(d):'—';})()}</span></div>
              <div><span class="dk">${tr('الدقة')}</span><span class="dv">${esc(g.resolution||'—')}</span></div>
              <div><span class="dk">${tr('الدعم العربي')}</span><span class="dv">${esc(ARABIC_LABEL[g.arabic]||g.arabic||'—')}</span></div>
              <div><span class="dk">${tr('إصدار اللعبة')}</span><span class="dv">${esc(g.gameVersion||'—')}</span></div>
              <div><span class="dk">${tr('اختيار مفضّل')}</span><span class="dv">${g.goty==='Y'?tr('نعم'):tr('لا')}</span></div>
              <div><span class="dk">${tr('وقت التثبيت')}</span><span class="dv">${esc(g.installTime||'—')}</span></div>
              ${tags.length?`<div class="tag-strip">${tags.map(t=>`<span class="tag-pill">${esc(tr(t))}</span>`).join('')}</div>`:''}
            </div>${ratingEmblem(g,'rating-emblem-expanded')}
          </div>
          <div class="library-card-actions">
            <button type="button" class="icon-btn edit-game" title="${tr('تحديث بيانات اللعبة')}" aria-label="${tr('تحديث بيانات اللعبة')}">✏️</button>
            <button type="button" class="icon-btn save-game" title="${tr('حفظ')}" aria-label="${tr('حفظ')}">💾</button>
            <button type="button" class="icon-btn delete-game" title="${tr('حذف اللعبة بالكامل')}" aria-label="${tr('حذف اللعبة بالكامل')}">🗑️</button>
          </div>
          ${editGameHtml(g)}
        </div>`;
      }).join('');
      container.querySelectorAll('.g-row').forEach(row=>row.addEventListener('click',e=>{if(e.target.closest('.cover-upload-label,.cover-remove,.library-card-actions,.game-edit-panel,.game-name-link'))return;const id=Number(row.dataset.id);state.expandedId=state.expandedId===id?null:id;row.classList.toggle('open');}));
      container.querySelectorAll('.edit-game').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const row=btn.closest('.g-row');row.classList.add('open');snapshotGameEditRow(row);setGameEditMode(row,true);row.querySelector('[data-edit-field]')?.focus();}));
      container.querySelectorAll('.save-game').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const row=btn.closest('.g-row');if(!row.classList.contains('editing')){setGameEditMode(row,true);return;}saveGameEdits(Number(row.dataset.id),row);}));
      container.querySelectorAll('.delete-game').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();deleteGameCompletely(Number(btn.closest('.g-row').dataset.id));}));
      container.querySelectorAll('.cancel-edit').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const row=btn.closest('.g-row');restoreGameEditRow(row);setGameEditMode(row,false);renderResults();}));
      container.querySelectorAll('.save-edit').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const row=btn.closest('.g-row');saveGameEdits(Number(row.dataset.id),row);}));
      container.querySelectorAll('[data-edit-field]').forEach(el=>{el.addEventListener('click',e=>{if(el.readOnly||el.disabled){e.preventDefault();e.stopPropagation();}});});
      container.querySelectorAll('.g-row.editing').forEach(row=>{ if(!row.dataset.editSnapshot) snapshotGameEditRow(row); });
      container.querySelectorAll('.cover-upload').forEach(inp=>inp.addEventListener('change',e=>{const id=Number(inp.dataset.id),file=inp.files?.[0];if(!file)return;const r=new FileReader();r.onload=()=>compressCover(r.result,data=>{if(!data)return;persistCoverOverride(id,data);const g=GAMES.find(x=>x.id===id);if(g)g.cover=data;renderResults();startDynamicBackground();});r.readAsDataURL(file);}));
      container.querySelectorAll('.cover-remove').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const id=Number(btn.dataset.id);removeCoverOverride(id);const g=GAMES.find(x=>x.id===id);if(g)delete g.cover;renderResults();startDynamicBackground();}));
      scheduleOnlineCovers(pageItems);
    }
    renderPager(totalPages);
  }

  function renderPager(totalPages){
    const pager = document.getElementById('pager');
    if(totalPages<=1){ pager.innerHTML=''; return; }
    let html = '';
    html += `<button ${state.page===1?'disabled':''} data-p="${state.page-1}">السابق</button>`;
    const windowSize = 5;
    let startP = Math.max(1, state.page - Math.floor(windowSize/2));
    let endP = Math.min(totalPages, startP + windowSize - 1);
    startP = Math.max(1, endP - windowSize + 1);
    for(let p=startP; p<=endP; p++){
      html += `<button class="${p===state.page?'active':''}" data-p="${p}">${p}</button>`;
    }
    html += `<button ${state.page===totalPages?'disabled':''} data-p="${state.page+1}">التالي</button>`;
    html += `<button ${state.page===totalPages?'disabled':''} data-p="${totalPages}" title="آخر صفحة">الأخير</button>`;
    pager.innerHTML = html;
    pager.querySelectorAll('button[data-p]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        state.page = parseInt(btn.getAttribute('data-p'));
        renderResults();
        document.getElementById('library-section').scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
  }

  function initLibraryControls(){
    const sortEl=document.getElementById('sort-select');
    const pageEl=document.getElementById('page-size-select');
    if(sortEl && sortEl.dataset.bound!=='1'){
      sortEl.dataset.bound='1';
      sortEl.value=state.sort;
      sortEl.addEventListener('change',()=>{
        state.sort=sortEl.value || 'name-asc';
        state.page=1;
        renderResults();
      });
    }
    if(document.documentElement.dataset.libraryEditEscBound!=='1'){
      document.documentElement.dataset.libraryEditEscBound='1';
      document.addEventListener('keydown',(e)=>{
        if(e.key!=='Escape') return;
        const row=document.querySelector('#results-list .g-row.editing');
        if(!row) return;
        e.preventDefault();
        e.stopPropagation();
        restoreGameEditRow(row);
        setGameEditMode(row,false);
        renderResults();
      },true);
    }
    if(pageEl && pageEl.dataset.bound!=='1'){
      pageEl.dataset.bound='1';
      pageEl.value=String(state.pageSize);
      pageEl.addEventListener('change',()=>{
        const n=parseInt(pageEl.value,10);
        state.pageSize=Number.isFinite(n)&&n>0?n:20;
        state.page=1;
        renderResults();
      });
    }
  }

  /* ================= TABS ================= */
  function initTabs(){
    const navBtns=[...document.querySelectorAll('.tabnav-btn')];
    const pages=[...document.querySelectorAll('.tab-page')];
    const rendered=new Set(['dashboard-section','drives-section']);
    function renderTab(id){
      if(rendered.has(id)) return;
      rendered.add(id);
      if(id==='library-section'){ initLibrarySearch(); initLibraryControls(); renderFilters(); renderResults(); }
      else if(id==='sizes-section') renderSizesTab();
      else if(id==='dates-section') renderDatesTab();
      else if(id==='reports-section') { if(typeof renderReport==='function') renderReport(); }
    }
    navBtns.forEach(btn=>btn.addEventListener('click',()=>{
      const target=btn.dataset.tab;
      if(!target) return;
      navBtns.forEach(b=>b.classList.toggle('active',b===btn));
      pages.forEach(p=>p.classList.toggle('active',p.id===target));
      requestAnimationFrame(()=>renderTab(target));
      window.scrollTo({top:0,behavior:'auto'});
    }));
    window.__renderActiveTab=()=>{const id=document.querySelector('.tab-page.active')?.id;if(id)renderTab(id);};
  }

  /* ================= ADD GAME TAB ================= */
  function uniqueValues(key){
    const set = new Set();
    GAMES.forEach(g=>{ if(g[key]!=null && g[key]!=='') set.add(String(g[key])); });
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }

  const SELECT_FIELDS = [
    {key:'system', label:'System', options:SYSTEM_OPTIONS},
    {key:'series', label:'السلسلة'},
    {key:'genre', label:'النوع'},
    {key:'hdd', label:'الهارد'},
    {key:'developer', label:'الشركة المطوّرة'},
    {key:'mainChar', label:'الشخصية Home'},
    {key:'playingState', label:'Playing State', map:STATE_LABEL},
    {key:'verdict', label:'Final Rating', map:VERDICT_LABEL},
    {key:'perspective', label:'المنظور', map:PERSP_LABEL},
    {key:'versionType', label:'نوع النسخة'},
    {key:'rem', label:'نوع الإصدار (Remaster/Remake)'},
    {key:'ramadan', label:'رمضان'},
    {key:'arabic', label:'الدعم العربي', map:ARABIC_LABEL},
    {key:'goty', label:'اختيار مفضّل (GOTY)', map:{Y:'نعم', N:'لا'}},
    {key:'ledTv', label:'شوهدت على LED TV'},
    {key:'gameVersion', label:'إصدار اللعبة'},
    {key:'installTime', label:'وقت التثبيت'},
  ];

  function formText(ar,en){return lang==='en'?en:ar;}
  function renderAddGameForm(){
    const wrap = document.getElementById('addgame-form-wrap') || document.getElementById('library-add-game-wrap');
    const selectsHtml = SELECT_FIELDS.map(f=>{
      const opts = Array.isArray(f.options) ? f.options : uniqueValues(f.key);
      const optionsHtml = opts.map(v=>`<option value="${esc(v)}">${esc(f.map && f.map[v] ? f.map[v] : v)}</option>`).join('');
      return `
      <div class="ag-field">
        <label>${esc(formText(f.label,I18N[f.label]||f.label))}</label>
        <div class="select-with-plus"><select id="ag-${f.key}" class="ag-select">
          <option value="">${f.key==='series'?'— Choose series —':'— None —'}</option>
          ${optionsHtml}
        </select><button type="button" class="plus-btn ag-plus" data-key="${f.key}" title="${formText('إضافة قيمة جديدة','Add New Value')}">＋</button></div>
        <div id="ag-${f.key}-custom-wrap" class="ag-custom-wrap" style="display:none;"><input type="text" id="ag-${f.key}-custom" placeholder="${formText('اكتب القيمة الجديدة','Enter new value')}"><button type="button" class="plus-btn ag-save-custom" data-key="${f.key}">${formText('حفظ','Save')}</button></div>
      </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="ag-banner" id="ag-banner"></div>
      <div class="ag-grid">
        <div class="ag-field ag-wide">
          <label>${formText('اسم اللعبة *','Game Name *')}</label>
          <input type="text" id="ag-name" placeholder="Example: RESIDENT EVIL 2">
        </div>
        ${selectsHtml}
        <div class="ag-field">
          <label>${formText('تاريخ الإصدار','Release Date')}</label>
          <input type="date" id="ag-releaseDate">
        </div>
        <div class="ag-field">
          <label>${formText('الحجم (GB)','Size (GB)')}</label>
          <input type="number" min="0" step="0.01" id="ag-sizeGB" placeholder="0.00">
        </div>
        <div class="ag-field ag-wide">
          <label>${formText('سمات مميزة','Featured Attributes')}</label>
          <div class="ag-checks">
            <label class="toggle-row"><input type="checkbox" id="ag-gameplay">${formText("طور لعب مميز","Featured Gameplay")}</label>
            <label class="toggle-row"><input type="checkbox" id="ag-graphic">${formText("جرافيك مميز","Featured Graphics")}</label>
            <label class="toggle-row"><input type="checkbox" id="ag-world">${formText("عالم مفتوح مميز","Featured Open World")}</label>
            <label class="toggle-row"><input type="checkbox" id="ag-theme">${formText("أجواء مميزة","Featured Atmosphere")}</label>
            <label class="toggle-row"><input type="checkbox" id="ag-story">${formText("قصة مميزة","Featured Story")}</label>
            <label class="toggle-row"><input type="checkbox" id="ag-bugs">${formText("بها أعطال","Has Bugs")}</label>
          </div>
        </div>
      </div>
      <button type="button" class="ag-submit" id="ag-submit">${formText("إضافة اللعبة للمكتبة","Add Game to Library")}</button>
    `;

    document.querySelectorAll('.ag-plus').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.key;const wrap=document.getElementById(`ag-${key}-custom-wrap`);wrap.style.display='flex';document.getElementById(`ag-${key}-custom`).focus();}));
    document.querySelectorAll('.ag-save-custom').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.key;const inp=document.getElementById(`ag-${key}-custom`);const v=inp.value.trim();if(!v)return;const sel=document.getElementById(`ag-${key}`);const opt=document.createElement('option');opt.value=v;opt.textContent=v;sel.appendChild(opt);sel.value=v;document.getElementById(`ag-${key}-custom-wrap`).style.display='none';}));
    document.getElementById('ag-submit').addEventListener('click', submitNewGame);
  }

  function fieldValue(key){
    const sel = document.getElementById(`ag-${key}`);
    if(!sel) return null;
    if(sel.value==='__new__'){
      const custom = document.getElementById(`ag-${key}-custom`);
      const v = custom ? custom.value.trim() : '';
      return v || null;
    }
    return sel.value || null;
  }

  function submitNewGame(){
    const name = document.getElementById('ag-name').value.trim();
    const banner = document.getElementById('ag-banner');
    if(!name){
      banner.className = 'ag-banner ag-banner-error';
      banner.textContent = 'من فضلك اكتب اسم اللعبة أولاً.';
      return;
    }
    const selectedSeries = fieldValue('series');
    const releaseDate = document.getElementById('ag-releaseDate').value || null;
    const startDate = null;
    const endDate = null;
    const sizeGBraw = document.getElementById('ag-sizeGB').value;
    const deletedIds = loadJSON('mostafa_pc_deleted_games_v1', []).map(Number);
    const allIds = BASE_GAMES.map(g=>g.id||0).concat(userGames.map(g=>g.id||0)).concat(deletedIds);
    const maxId = allIds.reduce((m,id)=>Math.max(m,id), 0);

    const newGame = {
      id: maxId+1,
      name: name,
      system: fieldValue('system'),
      createdAt: new Date().toISOString(),
      series: fieldValue('series'),
      rem: fieldValue('rem'),
      versionType: fieldValue('versionType'),
      releaseDate: releaseDate,
      hdd: fieldValue('hdd'),
      sizeGB: sizeGBraw ? parseFloat(sizeGBraw) : 0,
      playingState: fieldValue('playingState'),
      mainChar: fieldValue('mainChar'),
      startDate: startDate,
      endDate: endDate,
      days: computeDays(startDate, endDate),
      ledTv: fieldValue('ledTv'),
      ramadan: fieldValue('ramadan'),
      verdict: fieldValue('verdict'),
      genre: fieldValue('genre'),
      perspective: fieldValue('perspective'),
      developer: fieldValue('developer'),
      gameVersion: fieldValue('gameVersion'),
      goty: fieldValue('goty'),
      arabic: fieldValue('arabic'),
      year: releaseDate ? parseInt(releaseDate.slice(0,4)) : null,
      installTime: fieldValue('installTime'),
      age: computeAge(releaseDate),
      gameplay: document.getElementById('ag-gameplay').checked ? 1 : 0,
      graphic: document.getElementById('ag-graphic').checked ? 1 : 0,
      world: document.getElementById('ag-world').checked ? 1 : 0,
      theme: document.getElementById('ag-theme').checked ? 1 : 0,
      story: document.getElementById('ag-story').checked ? 1 : 0,
      bugs: document.getElementById('ag-bugs').checked ? 1 : 0
    };

    userGames.push(newGame);
    saveJSON(USERGAMES_KEY, userGames);
    rebuildGamesArray();
    rebuildNormalizedMaps();

    renderHeroStats();


  renderDashboard();
    renderDrives();
    renderFilters();
    renderResults();
    renderAddGameForm();

    const freshBanner = document.getElementById('ag-banner');
    freshBanner.className = 'ag-banner ag-banner-ok';
    freshBanner.textContent = `تمت إضافة "${name}" إلى Library بنجاح.`;
    window.SoundFX?.playAdd();
    const addModal=document.getElementById('library-add-game-modal');
    if(addModal) addModal.style.display='none';
    const addWrap=document.getElementById('library-add-game-wrap');
    if(addWrap) addWrap.innerHTML='';
  }

  // ===== Home Live Digital + Analog Clock — Option 02 =====
  function initHomeLiveClock(){
    const root=document.getElementById('home-clock-dual');
    if(!root || root.dataset.clockReady==='1') return;
    root.dataset.clockReady='1';
    const digital=document.getElementById('home-clock-time');
    const dateEl=document.getElementById('home-clock-date');
    const hourHand=root.querySelector('.clock-hour');
    const minuteHand=root.querySelector('.clock-minute');
    const secondHand=root.querySelector('.clock-second');
    const pad=n=>String(n).padStart(2,'0');
    const update=()=>{
      const d=new Date();
      const h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
      const hh=(h%12)||12;
      if(digital) digital.textContent=`${pad(hh)}:${pad(m)} ${h>=12?'PM':'AM'}`;
      if(dateEl) dateEl.textContent=d.toLocaleDateString('en-US',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
      const hourDeg=(h%12)*30 + m*.5 + s/120;
      const minuteDeg=m*6 + s*.1;
      const secondDeg=s*6;
      if(hourHand) hourHand.style.transform=`translateX(-50%) rotate(${hourDeg}deg)`;
      if(minuteHand) minuteHand.style.transform=`translateX(-50%) rotate(${minuteDeg}deg)`;
      if(secondHand) secondHand.style.transform=`translateX(-50%) rotate(${secondDeg}deg)`;
    };
    update();
    root._clockTimer=setInterval(update,1000);
  }
  initHomeLiveClock();

  /* ================= DATE OPTION LISTS ================= */
  const DATE_OPTIONS_STORE='mostafa_pc_date_options_v1';
  window.getEditableOptions=function(kind,current){
    const defaults={
      screen:['First Old Screen','IBM Screen','Toshiba Screen','NIKAI Screen 42','SAMSUNG 55','Lenovo Screen','Panasonic 4K (55)','BenQ-1080P','NIKAI 4K (70)'],
      device:['PC','Laptop','PS4','PS5','Xbox One','Xbox Series X/S','Nintendo Switch','Steam Deck'],
      gpu:['Pc Old (  The First Pc )','PC Mine','Toshiba Laptop','Laptop Lenovo (GTX 1060)','PS4','New Pc (RTX 3060)','Company PC','Laptop Lenovo (Intel HD630)'],
      resolution:['480P','720P','1080P','1440P','4k']
    };
    const saved=loadJSON(DATE_OPTIONS_STORE,{screen:[],device:[],gpu:[],resolution:[]});
    // Resolution is intentionally restricted to the five approved values only.
    if(kind==='resolution') return defaults.resolution.slice();
    const arr=[...(defaults[kind]||[]),...(saved[kind]||[])];
    if(current && !arr.includes(current))arr.push(current);
    return [...new Set(arr.filter(Boolean))];
  };
  window.addDateOption=function(kind){
    if(kind==='resolution'){
      alert(lang==='en'?'Resolution choices are limited to: 480P, 720P, 1080P, 1440P, 4k':'اختيارات الدقة محددة فقط بـ: 480P, 720P, 1080P, 1440P, 4k');
      return;
    }
    const labels={screen:'نوع الشاشة',device:'الجهاز',gpu:'كارت الشاشة',resolution:'الدقة'};
    const enLabels={screen:'Screen Type',device:'Device',gpu:'Graphics Card',resolution:'Resolution'};
    const val=prompt(lang==='en'?('Enter new '+enLabels[kind]+':'):('أدخل '+labels[kind]+' الجديدة:'));
    if(!val || !val.trim())return;
    const saved=loadJSON(DATE_OPTIONS_STORE,{screen:[],device:[],gpu:[],resolution:[]});
    saved[kind]=[...(saved[kind]||[]),val.trim()];
    saved[kind]=[...new Set(saved[kind])];
    saveJSON(DATE_OPTIONS_STORE,saved);
    renderDatesTab();
  };
  window.makeOptionControl=function(kind,value,field,id,locked){
    const opts=getEditableOptions(kind,value);
    const addTitle=lang==='en'?'Add new value':'إضافة قيمة جديدة';
    const dis=locked?' disabled':'';
    const safeValue=String(value||'');
    return '<div class="side-select"><select class="dt-choice-select" data-field="'+field+'" data-id="'+id+'" data-editable-lock="1"'+dis+'>'+
      '<option value="">— اختر من القائمة —</option>'+opts.map(o=>'<option '+(String(o)===safeValue?'selected':'')+' value="'+esc(o)+'">'+esc(o)+'</option>').join('')+
      '</select><button type="button" class="dt-option-add" '+(locked?'disabled':'')+' title="'+addTitle+'" aria-label="'+addTitle+'" onclick="addDateOption(\''+kind+'\')">＋</button></div>';
  };

  /* ================= DATES TAB ================= */
  let datesSearch='';
  let datesYearFilter='';
  let datesScreenFilter='';
  let datesResolutionFilter='';
  let datesStatusFilter='';
  const datesSelectedRids=new Set();
  const datesBulkSnapshots=new Map();
  let datesBulkEditing=false;
  const normDateSearch=s=>String(s||'').replace(/[\u00A0\u2000-\u200B]/g,' ').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('ar');
  function ensureDateRecords(){
    // v4 is intentionally independent from all previous broken date stores.
    // A null store means first initialization: load ALL original Excel play logs.
    // An empty array is a valid user state after deleting every record and must NOT
    // be repopulated on every render.
    if(dateRecords === null || dateRecords === undefined || !Array.isArray(dateRecords)){
      const source=Array.isArray(PLAY_LOGS) ? PLAY_LOGS : [];
      dateRecords=source.map((r,i)=>{
        const g=GAMES.find(x=>normDateSearch(x.name)===normDateSearch(r.name));
        return {
          rid:'excel-'+String(r.n||i+1),
          gameId:g ? Number(g.id) : null,
          name:String(r.name||''),
          start:r.start||null,
          end:r.end||null,
          days:(r.days!=='' && r.days!=null) ? Number(r.days) : computeDays(r.start,r.end),
          screenType:r.screenType||'',
          device:r.device||'',
          gpu:r.gpu||'',
          resolution:r.resolution||'',
          playingState:derivePlayingState(r.start||null,r.end||null,''),
          status:derivePlayingState(r.start||null,r.end||null,'')
        };
      });
      saveDateRecords();
    } else {
      // Keep the Excel "Playing State" synchronized for every original Excel row.
      // This also upgrades records already saved in localStorage by older versions.
      const byN=new Map((Array.isArray(PLAY_LOGS)?PLAY_LOGS:[]).map(r=>[String(r.n),r]));
      dateRecords.forEach(r=>{
        if(String(r.rid||'').startsWith('excel-')){
          const src=byN.get(String(r.rid).replace('excel-',''));
          if(src){
            const derived=derivePlayingState(r.start||null,r.end||null,'');
            r.playingState=derived;
            r.status=derived;
          }
        } else {
          // Playing State is always derived from the Game Dates row itself.
          // Start + End date = Done; Start only = Playing Now; Postponed = Not-Completed.
          const derived=derivePlayingState(r.start||null,r.end||null,r.playingState||r.status||'');
          r.playingState=derived;
          r.status=derived;
        }
      });
      saveDateRecords();
    }
    return dateRecords;
  }
  function saveDateRecords(){saveJSON(DATE_RECORDS_KEY,dateRecords);}
  function syncGameDate(r){const g=GAMES.find(x=>Number(x.id)===Number(r.gameId));if(!g)return;g.startDate=r.start||null;g.endDate=r.end||null;g.days=recordDays(r);g.screenType=r.screenType||null;g.device=r.device||null;g.gpu=r.gpu||null;g.resolution=r.resolution||null;const derived=derivePlayingState(r.start||null,r.end||null,r.playingState||r.status||g.playingState);r.playingState=derived;r.status=derived;g.playingState=derived;if(!overrides[g.id])overrides[g.id]={};Object.assign(overrides[g.id],{screenType:g.screenType,gpu:g.gpu,resolution:g.resolution});saveJSON(OVERRIDES_KEY,overrides);}
  if(typeof window.makeOptionControl!=='function'){
    window.makeOptionControl=function(kind,value,field,id){
      return `<input class="dt-inline" data-field="${field}" value="${esc(value||'')}" placeholder="${tr(kind==='screen'?'نوع الشاشة':kind==='gpu'?'كارت الشاشة':'الدقة')}">`;
    };
  }
  function derivePlayingState(start,end,current){
    if(String(end||'').trim().toLowerCase()==='postponed') return 'Not-Completed';
    if(start && end) return 'Done';
    if(start && !end) return 'Playing Now';
    return String(current||'').trim();
  }
  function endDateControl(v,rid){
    const postponed=String(v||'').trim().toLowerCase()==='postponed';
    const label=postponed?'Postponed':(v||'');
    return `<div class="dt-end-control" data-rid="${esc(rid)}"><input class="dt-date dt-end-date-input" data-field="endDate" data-editable-lock="1" type="text" value="${esc(label)}" placeholder="End Date" readonly disabled><div class="dt-end-popover" hidden><input class="dt-native-picker" type="date" value="${postponed?'':esc(v||'')}" aria-label="End Date"><button type="button" class="dt-postponed-btn" data-field="end" data-value="Postponed" data-editable-lock="1" disabled aria-label="Postponed" title="Postponed">⏸</button><button type="button" class="dt-now-btn" data-field="now" data-editable-lock="1" disabled aria-label="Now" title="Now">Now</button></div><input type="hidden" data-field="end" value="${postponed?'Postponed':''}"></div>`;
  }

  function restoreDatesEditPosition(rid, topOffset, scrollTop){
    requestAnimationFrame(()=>{
      const row=document.querySelector(`#dates-wrap tr[data-rid="${CSS.escape(String(rid))}"]`);
      if(row && Number.isFinite(topOffset)){
        const current=row.getBoundingClientRect().top;
        window.scrollBy(0, current-topOffset);
      }
      if(Number.isFinite(scrollTop)) window.scrollTo({top:scrollTop,behavior:'auto'});
    });
  }

  function renderDatesTab(){
    const wrap=document.getElementById('dates-wrap');if(!wrap)return;
    const records=ensureDateRecords();
    const old=document.getElementById('dates-search-input');datesSearch=old?old.value:datesSearch;
    const oldYear=document.getElementById('dates-year-filter');datesYearFilter=oldYear?oldYear.value:datesYearFilter;
    const oldScreen=document.getElementById('dates-screen-filter');datesScreenFilter=oldScreen?oldScreen.value:datesScreenFilter;
    const oldStatus=document.getElementById('dates-status-filter');datesStatusFilter=oldStatus?oldStatus.value:datesStatusFilter;
    if(!Array.isArray(records)){dateRecords=[];}
    const yearOptions=[...new Set((Array.isArray(dateRecords)?dateRecords:[]).map(r=>String(r.start||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort((a,b)=>Number(b)-Number(a));
    const resolutionOptions=['4k','1440P','1080P','720P','480P'];
    const screenOptions=[...new Set((Array.isArray(dateRecords)?dateRecords:[]).map(r=>String(r.screenType||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
    const statusOptions=[...new Set((Array.isArray(dateRecords)?dateRecords:[]).map(r=>String(r.playingState||r.status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
    const filtered=(Array.isArray(dateRecords)?dateRecords:[]).filter(r=>{
      const matchesName=!datesSearch||normDateSearch(r.name).includes(normDateSearch(datesSearch));
      const matchesYear=!datesYearFilter||String(r.start||'').slice(0,4)===datesYearFilter;
      const matchesScreen=!datesScreenFilter||String(r.screenType||'')===datesScreenFilter;
      const matchesResolution=!datesResolutionFilter||String(r.resolution||'').toLowerCase()===datesResolutionFilter.toLowerCase();
      const matchesStatus=!datesStatusFilter||String(r.playingState||r.status||'')===datesStatusFilter;
      return matchesName&&matchesYear&&matchesScreen&&matchesResolution&&matchesStatus;
    });
    const key=state.dateSortKey||'start',dir=state.dateSortDir||1;
    // Date columns must be sorted as real calendar dates, not as display/text values.
    // Keep missing/Postponed End Dates at the bottom in either direction.
    const dateSortValue=(value)=>{
      const raw=String(value??'').trim();
      if(!raw || raw.toLowerCase()==='now' || raw.toLowerCase()==='postponed') return null;
      const m=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if(m) return Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));
      const parsed=Date.parse(raw);
      return Number.isNaN(parsed)?null:parsed;
    };
    const sorted=filtered.slice().sort((a,b)=>{
      if(key==='days'){
        const av=recordDays(a),bv=recordDays(b);
        if(av==null && bv==null)return 0;
        if(av==null)return 1;
        if(bv==null)return -1;
        return (Number(av)-Number(bv))*dir;
      }
      if(key==='start' || key==='end'){
        const av=dateSortValue(a[key]),bv=dateSortValue(b[key]);
        if(av==null && bv==null)return 0;
        if(av==null)return 1;
        if(bv==null)return -1;
        return (av-bv)*dir;
      }
      const ak=key==='name'?'name':key;
      return String(a[ak]??'').localeCompare(String(b[ak]??''),undefined,{numeric:true,sensitivity:'base'})*dir;
    });
    const total=sorted.reduce((n,r)=>n+(Number(recordDays(r))||0),0),avg=sorted.length?total/sorted.length:0;
    const completedCount=sorted.filter(r=>{const end=String(r.end||'').trim();return end && end.toLowerCase()!=='postponed';}).length;
    const completionRate=sorted.length?(completedCount/sorted.length)*100:0;
    const playCountEl=document.getElementById('dates-play-count');
    const daysCountEl=document.getElementById('dates-days-count');
    const completionEl=document.getElementById('dates-completion-rate');
    if(playCountEl){const v=playCountEl.querySelector('strong');if(v)v.textContent=fmt(sorted.length);}
    if(daysCountEl){const v=daysCountEl.querySelector('strong');if(v)v.textContent=fmt(total);}
    if(completionEl){const v=completionEl.querySelector('strong');if(v)v.textContent=`${completionRate.toFixed(1)}%`; }
    // Resolution counters follow the currently filtered Game Dates records.
    const resolutionMetricIds={'480P':'dates-resolution-480','720P':'dates-resolution-720','1080P':'dates-resolution-1080','1440P':'dates-resolution-1440','4k':'dates-resolution-4k'};
    Object.entries(resolutionMetricIds).forEach(([resolution,id])=>{
      const el=document.getElementById(id);
      if(!el)return;
      const count=sorted.filter(r=>String(r.resolution||'').trim().toLowerCase()===resolution.toLowerCase()).length;
      const v=el.querySelector('strong');
      if(v)v.textContent=fmt(count);
    });
    const arrow=k=>`dt-sort ${key===k?(dir===1?'asc':'desc'):''}`;
    const selectedVisibleCount=sorted.filter(r=>datesSelectedRids.has(String(r.rid))).length;
    const bulkLabel=lang==='en'?'Edit Selected':'تعديل المحدد';
    const bulkSaveLabel=lang==='en'?'Save Selected':'حفظ المحدد';
    const bulkCancelLabel=lang==='en'?'Cancel Selected':'إلغاء التعديل';
    const allVisibleSelected=sorted.length>0 && sorted.every(r=>datesSelectedRids.has(String(r.rid)));
    wrap.innerHTML=`<div class="dt-toolbar dates-filters"><input type="text" class="search-input dt-filter" id="dates-search-input" placeholder="Game name..." value="${esc(datesSearch)}" autocomplete="off"><select id="dates-resolution-filter" class="search-input dt-filter dt-resolution-filter" aria-label="Resolution Filter"><option value="">All Resolution</option>${resolutionOptions.map(v=>`<option value="${esc(v)}" ${datesResolutionFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="dates-year-filter" class="search-input dt-filter dt-year-filter" aria-label="Start Year Filter"><option value="">All Years</option>${yearOptions.map(y=>`<option value="${y}" ${datesYearFilter===y?'selected':''}>${y}</option>`).join('')}</select><select id="dates-screen-filter" class="search-input dt-filter" aria-label="Screen Filter"><option value="">All Screens</option>${screenOptions.map(v=>`<option value="${esc(v)}" ${datesScreenFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="dates-status-filter" class="search-input dt-filter" aria-label="Game Status Filter"><option value="">All Statuses</option>${statusOptions.map(v=>`<option value="${esc(v)}" ${datesStatusFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select><button type="button" class="plus-btn dt-add-game-btn dt-add-icon-btn" id="date-add-btn" title="Add Game" aria-label="Add Game">➕</button></div><div class="dt-bulk-toolbar" id="dt-bulk-toolbar"><label class="dt-select-all"><input type="checkbox" id="dt-select-all" ${allVisibleSelected?'checked':''}> <span>${lang==='en'?'Select All':'تحديد الكل'}</span></label><span class="dt-selected-count">${lang==='en'?`${selectedVisibleCount} selected`:`${selectedVisibleCount} محدد`}</span><button type="button" class="dt-bulk-btn" id="dt-bulk-edit" ${selectedVisibleCount?'':'disabled'}>✏️ ${bulkLabel}</button><button type="button" class="dt-bulk-btn" id="dt-bulk-save" ${datesBulkEditing&&selectedVisibleCount?'':'disabled'}>💾 ${bulkSaveLabel}</button><button type="button" class="dt-bulk-btn dt-bulk-cancel" id="dt-bulk-cancel" ${datesBulkEditing&&selectedVisibleCount?'':'disabled'}>✖ ${bulkCancelLabel}</button></div><div class="dt-table-wrap"><table class="dt-table"><thead><tr><th class="dt-select-col"><input type="checkbox" id="dt-select-all-head" ${allVisibleSelected?'checked':''} aria-label="Select all"></th><th class="${arrow('name')}" data-dsort="name">Game</th><th class="${arrow('start')}" data-dsort="start">Start Date</th><th class="${arrow('end')}" data-dsort="end">End Date</th><th class="${arrow('days')}" data-dsort="days">Days</th><th>Previous Plays</th><th>Play History</th><th class="${arrow('playingState')}" data-dsort="playingState">Playing State</th><th class="${arrow('screen')}" data-dsort="screen">Screen</th><th class="${arrow('gpu')}" data-dsort="gpu">GPU</th><th class="${arrow('resolution')}" data-dsort="resolution">Resolution</th><th>Edit</th><th>Save</th><th>Delete</th></tr></thead><tbody>${sorted.map(r=>`<tr data-rid="${esc(r.rid)}" class="${datesSelectedRids.has(String(r.rid))?'dt-row-selected':''}"><td class="dt-select-col"><input type="checkbox" class="dt-row-select" data-rid="${esc(r.rid)}" ${datesSelectedRids.has(String(r.rid))?'checked':''} aria-label="Select ${esc(r.name)}"></td><td class="dt-name">${gameNameLink(r.name)}</td><td><input class="dt-date" data-field="start" data-editable-lock="1" type="date" value="${esc(r.start||'')}" ${datesSelectedRids.has(String(r.rid))&&datesBulkEditing?'':'disabled'}></td><td>${endDateControl(r.end,r.rid)}</td><td class="dt-days">${recordDays(r)!=null?fmt(recordDays(r)):'—'}</td><td class="dt-history-count">${fmt(getPlayOrdinal(r.gameId,r.name,r))}</td><td class="dt-history-status ${getPlayCountBefore(r.gameId,r.name,r)===0?'play-status-new':'play-status-old'}">${getPlayCountBefore(r.gameId,r.name,r)===0?'New':'Old'}</td><td class="dt-game-status">${esc(r.playingState||r.status||'—')}</td><td>${makeOptionControl('screen',r.screenType||'','screen',r.rid,true)}</td><td>${makeOptionControl('gpu',r.gpu||'','gpu',r.rid,true)}</td><td>${makeOptionControl('resolution',r.resolution||'','resolution',r.rid,true)}</td><td><button type="button" class="icon-action dt-edit-btn" title="تعديل السجل">✏️</button></td><td><button type="button" class="plus-btn dt-save" title="حفظ السجل" disabled>💾</button></td><td><button type="button" class="dt-delete" title="حذف السجل">🗑️</button></td></tr>`).join('')}</tbody></table></div>`;
    const inp=document.getElementById('dates-search-input');
    if(inp){
      // Keep the search input alive from the user's point of view while the table is re-rendered.
      // Replacing the input on every keystroke used to leave focus on the old DOM node, so only
      // the first typed character was accepted. Restore focus/caret to the newly rendered input.
      inp.addEventListener('input',e=>{
        datesSearch=e.target.value;
        const caret=Number.isFinite(e.target.selectionStart)?e.target.selectionStart:String(datesSearch).length;
        renderDatesTab();
        requestAnimationFrame(()=>{
          const next=document.getElementById('dates-search-input');
          if(next){
            next.focus();
            const pos=Math.min(caret,next.value.length);
            try{next.setSelectionRange(pos,pos);}catch(_){}
          }
        });
      });
      inp.addEventListener('keydown',e=>{if(e.key===' ')e.stopPropagation();});
    }
    const yearFilter=document.getElementById('dates-year-filter');
    if(yearFilter)yearFilter.addEventListener('change',e=>{datesYearFilter=e.target.value;renderDatesTab();});
    const resolutionFilter=document.getElementById('dates-resolution-filter');
    if(resolutionFilter)resolutionFilter.addEventListener('change',e=>{datesResolutionFilter=e.target.value;renderDatesTab();});
    const screenFilter=document.getElementById('dates-screen-filter');
    if(screenFilter)screenFilter.addEventListener('change',e=>{datesScreenFilter=e.target.value;renderDatesTab();});
    const statusFilter=document.getElementById('dates-status-filter');
    if(statusFilter)statusFilter.addEventListener('change',e=>{datesStatusFilter=e.target.value;renderDatesTab();});
    wrap.querySelectorAll('[data-dsort]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.dsort;if(state.dateSortKey===k)state.dateSortDir*=-1;else{state.dateSortKey=k;state.dateSortDir=1;}renderDatesTab();}));
    const selectedRids=()=>Array.from(datesSelectedRids).filter(rid=>dateRecords.some(r=>String(r.rid)===String(rid)));
    const setRowEditMode=(row,editing)=>{
      if(!row)return;
      row.classList.toggle('dt-row-editing',editing);
      row.querySelectorAll('[data-editable-lock]').forEach(el=>{el.disabled=!editing;el.readOnly=!editing;el.classList.toggle('is-editing',editing);});
      row.querySelectorAll('.dt-option-add,.dt-postponed-btn,.dt-now-btn').forEach(el=>el.disabled=!editing);
      const save=row.querySelector('.dt-save'); if(save)save.disabled=!editing;
    };
    const snapshotRow=(row)=>{
      const endDateEl=row.querySelector('[data-field="endDate"]'), endHidden=row.querySelector('[data-field="end"]');
      row.__dtBulkSnapshot={start:row.querySelector('[data-field="start"]')?.value||'',endDate:endDateEl?.value||'',end:endHidden?.value||'',screen:row.querySelector('[data-field="screen"]')?.value||'',gpu:row.querySelector('[data-field="gpu"]')?.value||'',resolution:row.querySelector('[data-field="resolution"]')?.value||''};
    };
    const enterBulkEdit=()=>{
      const ids=selectedRids(); if(!ids.length)return;
      datesBulkSnapshots.clear();
      ids.forEach(rid=>{
        const row=wrap.querySelector(`tr[data-rid="${CSS.escape(String(rid))}"]`);
        if(row){snapshotRow(row);datesBulkSnapshots.set(String(rid),{...row.__dtBulkSnapshot});}
      });
      datesBulkEditing=true;
      renderDatesTab();
      // Re-enter edit mode after render so every selected row is editable at the same time.
      ids.forEach(rid=>{const row=wrap.querySelector(`tr[data-rid="${CSS.escape(String(rid))}"]`);if(row)setRowEditMode(row,true);});
    };
    const cancelBulkEdit=()=>{
      // No values have been written to the data model until Save Selected is pressed.
      // Re-rendering therefore restores the exact saved values and closes all edit states together.
      datesBulkEditing=false;
      datesBulkSnapshots.clear();
      renderDatesTab();
    };
    const saveBulkEdit=()=>{
      const ids=selectedRids(); if(!ids.length)return;
      ids.forEach(rid=>{
        const row=wrap.querySelector(`tr[data-rid="${CSS.escape(String(rid))}"]`),r=dateRecords.find(x=>String(x.rid)===String(rid)); if(!row||!r)return;
        r.start=row.querySelector('[data-field="start"]')?.value||null;
        r.end=(row.querySelector('[data-field="end"]')?.value==='Postponed'?'Postponed':(row.querySelector('[data-field="endDate"]')?.value||null));
        r.screenType=row.querySelector('[data-field="screen"]')?.value||null;
        r.gpu=row.querySelector('[data-field="gpu"]')?.value||null;
        r.resolution=row.querySelector('[data-field="resolution"]')?.value||null;
        const g=GAMES.find(x=>Number(x.id)===Number(r.gameId));
        r.playingState=derivePlayingState(r.start,r.end,r.playingState||r.status||g?.playingState); r.status=r.playingState; r.days=recordDays(r); syncGameDate(r);
      });
      saveDateRecords(); rebuildNormalizedMaps(); datesBulkEditing=false; datesBulkSnapshots.clear(); renderDatesTab(); renderHeroStats(); renderDashboard(); renderResults();
    };
    const toggleAll=(checked)=>{sorted.forEach(r=>{const rid=String(r.rid);if(checked)datesSelectedRids.add(rid);else datesSelectedRids.delete(rid);});renderDatesTab();};
    // Keep the exact row in place when selecting a single Game Date record.
    // Do not re-render the whole table here: a full render can reset the table/scroll
    // position and makes the selected row appear to jump away from the user's cursor.
    wrap.querySelectorAll('.dt-row-select').forEach(cb=>cb.addEventListener('change',e=>{
      e.stopPropagation();
      const rid=String(cb.dataset.rid);
      const row=cb.closest('tr');
      if(cb.checked) datesSelectedRids.add(rid); else datesSelectedRids.delete(rid);
      row?.classList.toggle('dt-row-selected',cb.checked);

      // Update only the bulk-selection controls, preserving the current row and scroll position.
      const selectedVisibleCount=sorted.filter(r=>datesSelectedRids.has(String(r.rid))).length;
      const countEl=wrap.querySelector('.dt-selected-count');
      if(countEl) countEl.textContent=lang==='en'?`${selectedVisibleCount} selected`:`${selectedVisibleCount} محدد`;
      const editBtn=wrap.querySelector('#dt-bulk-edit');
      if(editBtn) editBtn.disabled=!selectedVisibleCount;
      const saveBtn=wrap.querySelector('#dt-bulk-save');
      if(saveBtn) saveBtn.disabled=!(datesBulkEditing&&selectedVisibleCount);
      const cancelBtn=wrap.querySelector('#dt-bulk-cancel');
      if(cancelBtn) cancelBtn.disabled=!(datesBulkEditing&&selectedVisibleCount);
      const allVisibleSelected=sorted.length>0 && sorted.every(r=>datesSelectedRids.has(String(r.rid)));
      const selectAll=wrap.querySelector('#dt-select-all');
      const selectAllHead=wrap.querySelector('#dt-select-all-head');
      if(selectAll) selectAll.checked=allVisibleSelected;
      if(selectAllHead) selectAllHead.checked=allVisibleSelected;
    }));
    wrap.querySelector('#dt-select-all')?.addEventListener('change',e=>toggleAll(e.target.checked));
    wrap.querySelector('#dt-select-all-head')?.addEventListener('change',e=>toggleAll(e.target.checked));
    wrap.querySelector('#dt-bulk-edit')?.addEventListener('click',enterBulkEdit);
    wrap.querySelector('#dt-bulk-save')?.addEventListener('click',saveBulkEdit);
    wrap.querySelector('#dt-bulk-cancel')?.addEventListener('click',cancelBulkEdit);

    wrap.querySelectorAll('.dt-edit-btn').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('tr');if(!row)return;row.__dtEditPosition={top:row.getBoundingClientRect().top,scrollTop:window.scrollY};const endDateEl=row.querySelector('[data-field="endDate"]');const endHidden=row.querySelector('[data-field="end"]');const screenEl=row.querySelector('[data-field="screen"]');const gpuEl=row.querySelector('[data-field="gpu"]');const resEl=row.querySelector('[data-field="resolution"]');const startEl=row.querySelector('[data-field="start"]');const daysEl=row.querySelector('.dt-days');row.__dtEditSnapshot={start:startEl?.value||'',endDate:endDateEl?.value||'',end:endHidden?.value||'',screen:screenEl?.value||'',gpu:gpuEl?.value||'',resolution:resEl?.value||'',days:daysEl?.textContent||'—'};row.classList.add('dt-row-editing');row.querySelectorAll('[data-editable-lock]').forEach(el=>{el.disabled=false;el.readOnly=false;el.classList.add('is-editing');});row.querySelectorAll('.dt-option-add').forEach(el=>el.disabled=false);row.querySelectorAll('.dt-postponed-btn,.dt-now-btn').forEach(el=>el.disabled=false);const save=row.querySelector('.dt-save');if(save)save.disabled=false;startEl?.focus();}));

    // Game Dates: Esc cancels the active row edit, restores the exact pre-edit values, and exits edit mode.
    const cancelDatesEdit=(event)=>{
      if(event.key!=='Escape')return;
      if(datesBulkEditing){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        cancelBulkEdit();
        return;
      }
      const active=document.activeElement;
      const row=active?.closest?.('tr.dt-row-editing')||wrap.querySelector('tr.dt-row-editing');
      if(!row||!row.__dtEditSnapshot)return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const snap=row.__dtEditSnapshot;
      const set=(sel,val)=>{const el=row.querySelector(sel);if(el)el.value=val;};
      set('[data-field="start"]',snap.start);
      set('[data-field="endDate"]',snap.endDate);
      set('[data-field="end"]',snap.end);
      set('[data-field="screen"]',snap.screen);
      set('[data-field="gpu"]',snap.gpu);
      set('[data-field="resolution"]',snap.resolution);
      const daysEl=row.querySelector('.dt-days');
      if(daysEl)daysEl.textContent=snap.days;
      // Always close the End Date popup and restore its controls to the pre-edit state.
      const pop=row.querySelector('.dt-end-popover');
      if(pop)pop.hidden=true;
      const postponed=row.querySelector('.dt-postponed-btn');
      if(postponed)postponed.classList.toggle('selected',String(snap.end).toLowerCase()==='postponed');
      row.querySelectorAll('[data-editable-lock]').forEach(el=>{el.disabled=true;el.readOnly=true;el.classList.remove('is-editing');});
      row.querySelectorAll('.dt-option-add,.dt-postponed-btn,.dt-now-btn').forEach(el=>el.disabled=true);
      const save=row.querySelector('.dt-save');
      if(save)save.disabled=true;
      row.classList.remove('dt-row-editing');
      delete row.__dtEditSnapshot;
      active?.blur?.();
      row.__dtEditPosition=null;
    };
    // Capture Escape at document level so it also works while the End Date picker/popover is focused.
    document.addEventListener('keydown',cancelDatesEdit,true);
    
    wrap.querySelectorAll('.dt-save').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('tr'),r=dateRecords.find(x=>x.rid===row.dataset.rid);if(!r||btn.disabled)return;const rid=r.rid;const pos=row.__dtEditPosition||{top:row.getBoundingClientRect().top,scrollTop:window.scrollY};r.start=row.querySelector('[data-field="start"]')?.value||null;r.end=(row.querySelector('[data-field="end"]')?.value==='Postponed'?'Postponed':(row.querySelector('[data-field="endDate"]')?.value||null));r.screenType=row.querySelector('[data-field="screen"]')?.value||null;['gpu','resolution'].forEach(f=>r[f]=row.querySelector(`[data-field="${f}"]`)?.value||null);const gameForState=GAMES.find(x=>Number(x.id)===Number(r.gameId));r.playingState=derivePlayingState(r.start,r.end,r.playingState||r.status||gameForState?.playingState);r.status=r.playingState;r.days=recordDays(r);saveDateRecords();syncGameDate(r);rebuildNormalizedMaps();renderDatesTab();restoreDatesEditPosition(rid,pos.top,pos.scrollTop);renderHeroStats();renderDashboard();renderResults();}));
    wrap.querySelectorAll('.dt-end-date-input').forEach(inp=>inp.addEventListener('click',()=>{const row=inp.closest('tr');const pop=row?.querySelector('.dt-end-popover');if(pop&&!inp.disabled)pop.hidden=!pop.hidden;}));
    wrap.querySelectorAll('.dt-native-picker').forEach(inp=>inp.addEventListener('change',()=>{const row=inp.closest('tr');const visible=row?.querySelector('.dt-end-date-input');const hidden=row?.querySelector('[data-field="end"]');if(visible){visible.value=inp.value;}if(hidden)hidden.value='';const pop=row?.querySelector('.dt-end-popover');if(pop)pop.hidden=true;}));
    wrap.querySelectorAll('.dt-now-btn').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('tr');const visible=row?.querySelector('.dt-end-date-input');const picker=row?.querySelector('.dt-native-picker');const hidden=row?.querySelector('[data-field="end"]');const start=row?.querySelector('[data-field="start"]')?.value||'';const today=localTodayISO();if(visible)visible.value='';if(picker)picker.value='';if(hidden)hidden.value='';const pop=row?.querySelector('.dt-end-popover');if(pop)pop.hidden=true;row?.querySelector('.dt-postponed-btn')?.classList.remove('selected');const state=row?.querySelector('.dt-game-status');if(state)state.textContent='Playing Now';const days=row?.querySelector('.dt-days');if(days)days.textContent=fmt(computeDays(start,today));}));
    wrap.querySelectorAll('.dt-postponed-btn').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('tr');const visible=row?.querySelector('.dt-end-date-input');const picker=row?.querySelector('.dt-native-picker');const hidden=row?.querySelector('[data-field="end"]');if(hidden)hidden.value='Postponed';if(visible)visible.value='Postponed';if(picker)picker.value='';const pop=row?.querySelector('.dt-end-popover');if(pop)pop.hidden=true;btn.classList.add('selected');const state=row?.querySelector('.dt-game-status');if(state)state.textContent='Not-Completed';const days=row?.querySelector('.dt-days');if(days)days.textContent='—';}));
    wrap.querySelectorAll('.dt-delete').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.closest('tr'),r=dateRecords.find(x=>x.rid===row.dataset.rid);if(!r)return;if(!confirm(tr(`حذف سجل "${r.name}" بالكامل؟`)))return;dateRecords=dateRecords.filter(x=>x.rid!==r.rid);saveDateRecords();const g=GAMES.find(x=>Number(x.id)===Number(r.gameId));if(g){g.startDate=null;g.endDate=null;g.days=null;}renderDatesTab();renderHeroStats();renderDashboard();renderResults();}));
    document.getElementById('date-add-btn').addEventListener('click',openDateAddForm);
  }
  function openDateAddForm(){
    const wrap=document.getElementById('dates-wrap');
    const available=GAMES.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'}));
    const box=document.createElement('div');
    box.className='dt-add-panel';
    box.innerHTML=`<h3>${formText('إضافة لعبة إلى التواريخ','Add Game to Dates')}</h3><p class="note">${formText('اكتب اسم اللعبة للبحث في جميع ألعاب Library.','Type to search all games available in the library.')}</p>
      <div class="dt-add-grid">
        <div class="dt-game-picker">
          <input id="new-date-game-search" class="dt-game-search" type="text" placeholder="Type game name..." autocomplete="off">
          <div id="new-date-game-results" class="dt-game-results"></div>
          <input id="new-date-game-id" type="hidden" value="">
        </div>
        <div class="dt-labeled-field"><label for="new-date-start">${formText('تاريخ البداية','Start Date')}</label><input id="new-date-start" class="dt-start-date-gold" type="date" aria-label="Start Date"></div>
        <div class="dt-labeled-field"><label for="new-date-end">${formText('تاريخ الانتهاء','End Date')}</label><input id="new-date-end" class="dt-start-date-gold" type="date" aria-label="End Date"></div>
        <div class="dt-labeled-field"><label>${formText('الشاشة','Screen')}</label><div id="new-date-screen-wrap"></div></div>
        <div class="dt-labeled-field"><label>${formText('كارت الشاشة','Graphics Card')}</label><div id="new-date-gpu-wrap"></div></div>
        <div class="dt-labeled-field"><label>${formText('الريزولوشن','Resolution')}</label><div id="new-date-res-wrap"></div></div>
        <div class="dt-add-actions">
          <button type="button" class="plus-btn" id="new-date-save">💾 Save Record</button>
          <button type="button" class="dt-cancel-btn" id="new-date-cancel">✕ Cancel</button>
        </div>`;
    wrap.prepend(box);

    // New-record controls are active immediately: choose Device, Screen, GPU and Resolution from lists.
    document.getElementById('new-date-screen-wrap').innerHTML=makeOptionControl('screen','','new-screen','new',false);
    document.getElementById('new-date-gpu-wrap').innerHTML=makeOptionControl('gpu','','new-gpu','new',false);
    document.getElementById('new-date-res-wrap').innerHTML=makeOptionControl('resolution','','new-res','new',false);

    const search=document.getElementById('new-date-game-search');
    const results=document.getElementById('new-date-game-results');
    const hidden=document.getElementById('new-date-game-id');

    function renderGameResults(q=''){
      const nq=normDateSearch(q);
      const list=available.filter(g=>!nq||normDateSearch(g.name).includes(nq));
      results.innerHTML=list.length
        ? list.map(g=>`<button type="button" class="dt-game-result" data-gid="${g.id}"><span class="dt-result-icon">🎮</span><span>${esc(g.name)}</span></button>`).join('')
        : '<div class="dt-no-results">No games found</div>';
      results.classList.add('is-open');
    }
    renderGameResults();

    results.addEventListener('click',e=>{
      const btn=e.target.closest('.dt-game-result'); if(!btn)return;
      const g=available.find(x=>Number(x.id)===Number(btn.dataset.gid)); if(!g)return;
      hidden.value=String(g.id);
      search.value=g.name;
      results.classList.remove('is-open');
      results.innerHTML='';
      search.classList.add('selected');
      search.blur();
    });
    document.addEventListener('click',e=>{
      if(!box.contains(e.target)){results.classList.remove('is-open');}
    },{once:false});
    search.addEventListener('input',()=>{
      hidden.value='';
      search.classList.remove('selected');
      renderGameResults(search.value);
    });
    search.addEventListener('focus',()=>renderGameResults(search.value));
    search.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        const first=results.querySelector('.dt-game-result');
        if(first){first.click();e.preventDefault();}
      } else if(e.key==='Escape'){
        search.value=''; hidden.value=''; search.classList.remove('selected'); results.classList.remove('is-open'); results.innerHTML='';
      }
    });

    document.getElementById('new-date-cancel').addEventListener('click',()=>box.remove());
    box.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.preventDefault(); box.remove(); } });
    box.tabIndex=0; box.focus();
    document.getElementById('new-date-save').addEventListener('click',()=>{
      const gid=Number(hidden.value);
      if(!gid){alert(tr('اختر لعبة من Library أولًا.'));return;}
      const g=GAMES.find(x=>Number(x.id)===gid); if(!g)return;
      const r={rid:'user-'+Date.now(),gameId:gid,name:g.name,
        start:document.getElementById('new-date-start').value||null,
        end:document.getElementById('new-date-end').value||null,days:null,
        screenType:document.querySelector('[data-field="new-screen"]')?.value.trim()||'',
        gpu:document.querySelector('[data-field="new-gpu"]')?.value.trim()||'',
        resolution:document.querySelector('[data-field="new-res"]')?.value.trim()||'',
        playingState:derivePlayingState(document.getElementById('new-date-start').value||null,document.getElementById('new-date-end').value||null,g.playingState),
        status:derivePlayingState(document.getElementById('new-date-start').value||null,document.getElementById('new-date-end').value||null,g.playingState)};
      r.days=computeDays(r.start,r.end);
      dateRecords.push(r);saveDateRecords();syncGameDate(r);box.remove();renderDatesTab();renderHeroStats();renderDashboard();renderResults();const ok=document.createElement('div');ok.className='dt-save-success';ok.textContent='تم الحفظ بنجاح';document.getElementById('dates-wrap')?.prepend(ok);setTimeout(()=>ok.remove(),2500);
    });
    search.focus();
  }

  /* ================= SIZES TAB ================= */
  function bytesFromGB(gb){return Number.isFinite(Number(gb)) ? Math.round(Number(gb)*1024*1024*1024) : 0;}
  function parseBytes(value){
    const n=Number(String(value??'').replace(/,/g,'').replace(/\s/g,''));
    return Number.isFinite(n)&&n>=0 ? Math.round(n) : 0;
  }
  function fmtBytes(value){return parseBytes(value).toLocaleString('en-US');}
  function gbFromBytes(bytes){const n=parseBytes(bytes);return Number.isFinite(n)&&n>=0 ? n/(1024*1024*1024) : 0;}
  function sizeValueGB(g){return sizeOverrides[g.id]!=null ? Number(sizeOverrides[g.id]) : (g.sizeGB!=null?Number(g.sizeGB):0);}
  function renderSizesTab(){
    const wrap=document.getElementById('sizes-wrap'); if(!wrap)return;
    const search=document.getElementById('sizes-search-input');
    const filter=document.getElementById('sizes-drive-filter');
    const q=String(search?.value||'').toLocaleLowerCase('ar');
    const drives=[...new Set(GAMES.map(g=>g.hdd).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'}));
    if(filter){
      const cur=filter.value;
      filter.innerHTML='<option value="">كل Drives</option>'+drives.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
      if(drives.includes(cur))filter.value=cur;
    }
    const rows=GAMES.filter(g=>{
      if(sizeDeleted.has(Number(g.id))) return false;
      const text=`${g.name||''} ${g.hdd||''}`.toLocaleLowerCase('ar');
      return (!q||text.includes(q))&&(!filter?.value||String(g.hdd||'')===filter.value);
    }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'}));
    const iconEdit='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L18.81 7.94l-2.75-2.75L4 17.25Zm15.71-10.46c.39-.39.39-1.03 0-1.42l-1.08-1.08a1.003 1.003 0 0 0-1.42 0l-1.07 1.07 2.75 2.75 1.07-1.07Z"/></svg>';
    const iconSave='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM6 5h8v4H6V5Z"/></svg>';
    const iconDelete='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z"/></svg>';
    wrap.innerHTML=`<div class="result-count" style="margin-bottom:10px">${fmt(rows.length)} لعبة</div><div class="dt-table-wrap"><table class="dt-table sizes-table"><thead><tr><th>اللعبة</th><th>الهارد</th><th>الحجم (Byte)</th><th>الحجم (GB)</th><th>إجراءات</th></tr></thead><tbody>${rows.map(g=>{
      const gb=sizeValueGB(g), bytes=bytesFromGB(gb);
      return `<tr data-size-id="${esc(g.id)}">
        <td class="dt-name">${gameNameLink(g.name)}</td>
        <td>${esc(g.hdd||'—')}</td>
        <td><input class="size-kb-input" type="text" inputmode="numeric" autocomplete="off" data-size-bytes data-editable-lock="1" value="${fmtBytes(bytes)}" readonly></td>
        <td class="size-gb-cell"><input class="size-gb-output" type="text" data-size-gb value="${gb.toFixed(2)} GB" readonly></td>
        <td><div class="size-actions">
          <button type="button" class="icon-action size-edit" title="تعديل بيانات الحجم" aria-label="تعديل بيانات الحجم">${iconEdit}</button>
          <button type="button" class="icon-action size-save" title="حفظ الحجم" aria-label="حفظ الحجم" disabled>${iconSave}</button>
          <button type="button" class="icon-action danger size-delete" title="حذف سجل الحجم" aria-label="حذف سجل الحجم">${iconDelete}</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
    wrap.querySelectorAll('.size-kb-input').forEach(inp=>{
      inp.addEventListener('input',()=>{
        const row=inp.closest('tr'), out=row?.querySelector('[data-size-gb]');
        if(out) out.value=gbFromBytes(inp.value).toFixed(2)+' GB';
        inp.value=inp.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
      });
    });
    wrap.querySelectorAll('.size-edit').forEach(btn=>btn.addEventListener('click',()=>{
      const row=btn.closest('tr'); if(!row)return;
      const inp=row.querySelector('[data-size-bytes]');
      const out=row.querySelector('[data-size-gb]');
      // Keep a snapshot so Esc can restore exactly what was shown before editing.
      row.dataset.sizeOriginalKb=inp?.value ?? '';
      row.dataset.sizeOriginalGb=out?.value ?? '';
      row.classList.add('size-row-editing');
      if(inp){inp.readOnly=false;inp.classList.add('is-editing');inp.focus();}
      const save=row.querySelector('.size-save'); if(save)save.disabled=false;
    }));

    // Esc while editing a Sizes row cancels the edit and restores the previous values.
    wrap.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      const active=document.activeElement;
      const row=active?.closest?.('.sizes-table tr.size-row-editing') || wrap.querySelector('.sizes-table tr.size-row-editing');
      if(!row)return;
      const inp=row.querySelector('[data-size-bytes]');
      const out=row.querySelector('[data-size-gb]');
      if(inp && Object.prototype.hasOwnProperty.call(row.dataset,'sizeOriginalKb')){
        inp.value=fmtBytes(row.dataset.sizeOriginalKb);
      }
      if(out && Object.prototype.hasOwnProperty.call(row.dataset,'sizeOriginalGb')){
        out.value=row.dataset.sizeOriginalGb;
      }
      if(inp){inp.readOnly=true;inp.classList.remove('is-editing');}
      const save=row.querySelector('.size-save'); if(save)save.disabled=true;
      row.classList.remove('size-row-editing');
      delete row.dataset.sizeOriginalKb;
      delete row.dataset.sizeOriginalGb;
      e.preventDefault();
      e.stopPropagation();
    });
    wrap.querySelectorAll('.size-save').forEach(btn=>btn.addEventListener('click',()=>{
      const row=btn.closest('tr'); const id=Number(row?.dataset.sizeId); const inp=row?.querySelector('[data-size-bytes]');
      if(!id||!inp||btn.disabled)return;
      const gb=gbFromBytes(inp.value);
      sizeOverrides[id]=gb;
      sizeDeleted.delete(id);
      saveJSON(SIZE_OVERRIDES_KEY,sizeOverrides);
      saveJSON(SIZE_DELETED_KEY,[...sizeDeleted]);
      const g=GAMES.find(x=>Number(x.id)===id); if(g) g.sizeGB=gb;
      row.classList.remove('size-row-editing');
      delete row.dataset.sizeOriginalKb;
      delete row.dataset.sizeOriginalGb;
      renderSizesTab(); renderHeroStats(); renderDashboard(); renderResults();
    }));
    wrap.querySelectorAll('.size-delete').forEach(btn=>btn.addEventListener('click',()=>{
      const row=btn.closest('tr'); const id=Number(row?.dataset.sizeId); if(!id)return;
      const g=GAMES.find(x=>Number(x.id)===id);
      if(!confirm(tr(`حذف سجل الحجم "${g?.name||''}"؟`)))return;
      sizeDeleted.add(id);
      saveJSON(SIZE_DELETED_KEY,[...sizeDeleted]);
      renderSizesTab();
    }));
    if(search && !search.dataset.bound){
      search.dataset.bound='1';
      search.addEventListener('input',renderSizesTab);
      search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();renderSizesTab();}});
    }
    if(filter && !filter.dataset.bound){filter.dataset.bound='1';filter.addEventListener('change',renderSizesTab);}
  }

  /* ================= REQUESTED UPGRADES ================= */
  const PLAY_LOGS = window.GameVaultData.playLogs || [];
  state.dateSortKey='start'; state.dateSortDir=1;
  let lang = localStorage.getItem('gameVault_lang_v1') || 'en';
  const I18N = {
    'أرشيف الألعاب':"Mostafa's Pc Data",'سجل شخصي':'Personal Record','فهرسة كاملة لمقتنياتك عبر Drives، مع بحث وفرز وتحليل للمجموعة':'Complete catalog of your games across drives, with search, sorting and analytics',
    'Home':'Home','Drives':'Drives','Library':'Library','Game Dates':'Game Dates','إضافة لعبة':'Add Game',
    'Collection Overview':'Collection Overview','Dynamic Reports':'Dynamic Reports','اختر التقرير الذي تريد عرضه وسيتم تحديثه مباشرة من بيانات Library.':'Choose a report and it will update directly from your library data.',
    'Collection Summary':'Collection Summary','Genres':'Genres','Release Years':'Release Years','Screens, Resolution & GPUs':'Screens, Resolutions & GPUs','الجهاز':'Device','كارت الشاشة':'Graphics Card','Play Activity by Year':'Play Activity by Year','Series':'Series',
    'Genres الأكثر تكرارًا':'Top Genres','Playing State':'Play Status','Final Rating':'Final Verdict','Games by Release Decade':'Games by Release Decade','Perspective':'Perspective','أكثر Series تكرارًا':'Top Series',
    'توزيع المساحة':'Storage Distribution','البحث والتصفح':'Search & Browse','Game Dates ومدة اللعب':'Game Dates & Play Duration','إضافة لعبة جديدة للمكتبة':'Add a New Game',
    'بحث باسم اللعبة، السلسلة، الشركة المطوّرة، أو الشخصية Home...':'Search by game, series, developer, or main character...',
    'ابحث باسم اللعبة...':'Search by game name...','إجمالي الألعاب':'Total Games','ألعاب مكتملة':'Completed','بانتظار اللعب':'Awaiting Play','ألعاب مسجّل لها تواريخ':'Games with Dates',
    'إجمالي أيام اللعب':'Total Play Days','متوسط الأيام لكل لعبة':'Average Days per Game','سجلات اللعب':'Play Records','متوسط الأيام':'Average Days',
    'اللعبة':'Game','تاريخ البدء':'Start Date','تاريخ الانتهاء':'End Date','المدة (أيام)':'Duration (Days)','نوع الشاشة':'Screen Type','كارت الشاشة':'Graphics Card','الدقة':'Resolution',
    'السابق':'Previous','التالي':'Next','عرض الكل':'Show All','الاسم (أ-ي)':'Name (A-Z)','سنة الإصدار (الأحدث أولاً)':'Release Year (Newest)','سنة الإصدار (الأقدم أولاً)':'Release Year (Oldest)','الحجم (الأكبر أولاً)':'Size (Largest)','الحجم (الأصغر أولاً)':'Size (Smallest)',
    'Site Options':'Site Options','التصنيف العمري':'Age Rating','الدعم العربي':'Arabic Support','الدعم العربي':'Arabic Support','شركة التطوير':'Developer','الهارد':'Drive',
    'الأحجام / Sizes':'Sizes','＋ 🎮':'＋ 🎮','آخر تاريخ لعب':'Last Played Date','تحديث بيانات اللعبة':'Edit Game Data','حذف اللعبة بالكامل':'Delete Game Completely','حذف السجل':'Delete Record','رمضان':'Ramadan','الأحجام':'Sizes','أحجام الألعاب':'Game Sizes','بيانات الأحجام محمّلة تلقائيًا من صفحة Sizes في ملف Excel، ويمكن تعديلها من هنا.':'Game sizes are loaded automatically from the Excel data and can be edited here.',
    '＋ إضافة / تعديل حجم':'＋ Add / Edit Size','Actions':'Actions','Edit':'Edit','حجم':'Size','الحجم':'Size',
    'إضافة لعبة إلى التواريخ':'Add Game to Dates','الاختيار متاح فقط من الألعاب الموجودة في Library.':'Only games already in the library can be selected.',
    '— اختر لعبة من Library —':'— Choose a game from the library —','حفظ السجل':'Save Record','حفظ':'Save',
    'قيمة جديدة':'New Value','اكتب اسم اللعبة كاملًا أو جزءًا منه...':'Type the full or partial game name...',
    'جميع التقارير في مكان واحد، ويتم تحديثها مباشرة من بيانات Library وتواريخ اللعب.':'All reports in one place, updated directly from library data and play dates.',
    'Plays by Year (New / Old / Total)':'Play by Year (New / Old / Total)','Most and Least Played Years':'Most and Least Played Years','Series Completion Rate':'Series Completion Rate','Last 30 Games Played':'Last 30 Games Played',
    'الألعاب المكتملة':'Completed Games','حجم الألعاب المكتملة':'Completed Games Size','ألعاب مكتملة تم لعبها':'Completed Games Played','سجلات اللعب للألعاب المكتملة':'Play Records for Completed Games',
    'لا توجد بيانات.':'No data.','الشاشات':'Screens','الدقة':'Resolution','كروت الشاشة':'Graphics Cards','إجمالي مرات اللعب':'Total Play Sessions','عدد الألعاب التي تم لعبها':'Games Played','مرات لعب جديدة':'New Play Sessions','مرات لعب قديمة':'Old Play Sessions',
    'عدد الألعاب التي لعبت في كل سنة':'Games Played Each Year','أكثر السنوات لعبًا':'Most Played Years','أقل السنوات لعبًا':'Least Played Years','جديدة':'New','قديمة':'Old','الإجمالي':'Total','عدد Series':'Number of Series','ألعاب مكتملة داخل Series':'Completed Games in Series','إجمالي ألعاب Series':'Total Series Games','نسبة إكمال Series':'Series Completion Rate','السلسلة':'Series','المكتمل':'Completed','نسبة الإكمال':'Completion Rate','آخر سجلات اللعب':'Latest Play Records','ألعاب جديدة':'New Games','ألعاب قديمة':'Old Games','اسم اللعبة':'Game Name','التاريخ':'Date','التصنيف':'Type'

,
    "أرشيف الألعاب":"Mostafa's PC Data",
    "سجل شخصي":"Personal Record",
    "فهرسة كاملة لمقتنياتك عبر Drives، مع بحث وفرز وتحليل للمجموعة":"Complete catalog of your collection across drives, with search, sorting, and collection analysis",
    "أدخل السعة الكلية لكل هارد لمعرفة المساحة المتبقية (تُحفظ في متصفحك)":"Enter the total capacity of each drive to calculate remaining space (saved in your browser)",
    "عرض اختياراتي المفضّلة فقط (GOTY)":"Show only my favorites (GOTY)",
    "مسح كل الفلاتر":"Clear All Filters",
    "لا توجد ألعاب مطابقة لهذا البحث أو الفلاتر المحددة.":"No games match this search or the selected filters.",
    "طور لعب مميز":"Featured Gameplay",
    "جرافيك مميز":"Featured Graphics",
    "عالم مفتوح مميز":"Featured Open World",
    "أجواء مميزة":"Featured Atmosphere",
    "قصة مميزة":"Featured Story",
    "بها أعطال":"Has Bugs",
    "السلسلة":"Series",
    "الشركة المطوّرة":"Developer",
    "الشخصية Home":"Main Character",
    "المنظور":"Perspective",
    "نوع النسخة":"Version Type",
    "نوع الإصدار":"Edition Type",
    "System":"System",
    "تاريخ الإصدار":"Release Date",
    "آخر تاريخ لعب":"Last Played Date",
    "مدة اللعب (أيام)":"Play Duration (Days)",
    "الدعم العربي":"Arabic Support",
    "إصدار اللعبة":"Game Version",
    "اختيار مفضّل":"Favorite",
    "وقت التثبيت":"Install Time",
    "إضافة صورة":"Add Image",
    "تحديث الصورة":"Update Image",
    "حذف الصورة":"Delete Image",
    "تحديث بيانات اللعبة":"Edit Game Data",
    "حذف اللعبة بالكامل":"Delete Game Completely",
    "اسم اللعبة":"Game Name",
    "نوع":"Genre",
    "Playing State":"Play Status",
    "Final Rating":"Final Verdict",
    "نوع الإصدار (Remaster/Remake)":"Edition Type (Remaster/Remake)",
    "اختيار مفضّل (GOTY)":"Favorite (GOTY)",
    "شوهدت على LED TV":"Seen on LED TV",
    "سمات مميزة":"Featured Attributes",
    "من فضلك اكتب اسم اللعبة أولاً.":"Please enter the game name first.",
    "السلسلة حقل إجباري. اختر سلسلة أو أضف سلسلة جديدة من زر ＋.":"Series is required. Choose a series or add a new one with ＋.",
    "إضافة اللعبة للمكتبة":"Add Game to Library",
    "إضافة لعبة جديدة":"Add New Game",
    "إضافة قيمة جديدة":"Add New Value",
    "اكتب القيمة الجديدة":"Enter new value",
    "حفظ":"Save",
    "إضافة لعبة إلى التواريخ":"Add Game to Dates",
    "سجلات اللعب":"Play Records",
    "متوسط الأيام":"Average Days",
    "إجمالي أيام اللعب":"Total Play Days",
    "اكتب اسم اللعبة كاملًا أو جزءًا منه...":"Type the full or partial game name...",
    "حفظ السجل":"Save Record",
    "حذف السجل":"Delete Record",
    "تاريخ البدء":"Start Date",
    "تاريخ الانتهاء":"End Date",
    "المدة (أيام)":"Duration (Days)",
    "نوع الشاشة":"Screen Type",
    "كارت الشاشة":"Graphics Card",
    "الدقة":"Resolution",
    "— اختر لعبة من Library —":"— Choose a game from the library —",
    "اختر لعبة من Library أولًا.":"Choose a game from the library first.",
    "هذه اللعبة مضافة بالفعل إلى التواريخ.":"This game is already added to dates.",
    "الاختيار متاح فقط من الألعاب الموجودة في Library.":"Only games already in the library can be selected.",
    "مكتملة":"Completed",
    "لم تُلعب بعد":"Not Played Yet",
    "غير مكتملة":"Not Completed",
    "غير قابلة للتقييم":"Not Rankable",
    "مثبّتة":"Installed",
    "قيد اللعب حاليًا":"Playing Now",
    "أسطورية":"Epic",
    "رائعة":"Great",
    "جيدة جدًا":"Very Good",
    "جيدة":"Good",
    "مقبولة":"Not Bad",
    "ضعيفة":"Bad",
    "حنين للماضي":"Nostalgic",
    "منظور أول":"First Person",
    "منظور ثالث":"Third Person",
    "أول وثالث":"First & Third",
    "منصات ثنائية الأبعاد":"2D Platformer",
    "منصات 2.5D":"2.5D Platformer",
    "علوي ثلاثي الأبعاد":"3D Top-Down",
    "مدعوم من الشركة":"Company Supported",
    "مدعوم كامل معربين":"Fully Arabized",
    "مدعوم جزئي معربين":"Partially Arabized",
    "نعم":"Yes",
    "لا":"No",
    "بدون سلسلة (مستقلة)":"Standalone (No Series)",
    "Dynamic Reports":"Dynamic Reports",
    "اختر التقرير الذي تريد عرضه وسيتم تحديثه مباشرة من بيانات Library.":"Choose a report and it will update directly from your library data.",
    "إجمالي الألعاب":"Total Games",
    "حجم Library":"Library Size",
    "ألعاب لها تواريخ لعب":"Games with Play Dates",
    "سجلات التواريخ من Excel":"Date Records from Excel",
    "لا توجد بيانات.":"No data.",
    "الشاشات":"Screens",
    "كروت الشاشة":"Graphics Cards",
    "Play Activity by Year":"Play Activity by Year",
    "آخر 5 ألعاب تم لعبها":"Last 5 Games Played",
    "أقدم 5 ألعاب تم لعبها":"5 Oldest Games Played",
    "إنجاز Series":"Series Progress",
    "مكتمل ÷ إجمالي ألعاب السلسلة":"Completed ÷ Total Series Games",
    "أكثر Series لعبًا":"Most Played Series",
    "لا توجد سلاسل.":"No series.",
    "السابق":"Previous",
    "التالي":"Next",
    "الأخير":"Last",
    "الاسم (أ-ي)":"Name (A-Z)",
    "سنة الإصدار (الأحدث أولاً)":"Release Year (Newest First)",
    "سنة الإصدار (الأقدم أولاً)":"Release Year (Oldest First)",
    "الحجم (الأكبر أولاً)":"Size (Largest First)",
    "الحجم (الأصغر أولاً)":"Size (Smallest First)",
    "المضاف حديثًا (الأحدث أولاً)":"Recently Added (Newest First)",
    "20 / صفحة":"20 / page",
    "40 / صفحة":"40 / page",
    "80 / صفحة":"80 / page",
    "عرض الكل":"Show All",
    "هاردات نشطة":"Active Drives",
    "بانتظار اللعب":"Awaiting Play",
    "من اختياراتك المفضّلة (GOTY)":"From My Favorites (GOTY)",
    "القيمة الجديدة":"New Value",
    "إلغاء":"Cancel",
    "إغلاق":"Close",
    "موافق":"OK",
    "لا توجد ألعاب مسجلة.":"No games recorded.",
    "لا توجد بيانات بعد":"No data yet",
    "Home":"Home",
    "Drives":"Drives",
    "Library":"Library",
    "Game Dates":"Game Dates",
    "إجراءات":"Actions",
    "تعديل بيانات الحجم":"Edit Size Data",
    "حفظ الحجم":"Save Size",
    "حذف سجل الحجم":"Delete Size Record",
    "إضافة صورة":"Add Image",
    "تحديث الصورة":"Update Image",
    "حذف الصورة":"Delete Image",
    "آخر صفحة":"Last Page",
    "هاردات نشطة":"Active Drives",
    "ألعاب مكتملة":"Completed Games",
    "ألعاب مسجّل لها تواريخ":"Games with Dates",
    "مكتملة":"Completed",
    "لم تُلعب بعد":"Not Played Yet",
    "غير مكتملة":"Not Completed",
    "غير قابلة للتقييم":"Not Rankable",
    "مثبّتة":"Installed",
    "قيد اللعب حاليًا":"Playing Now",
    "أسطورية":"Epic",
    "جيدة جدًا":"Very Good",
    "جيدة":"Good",
    "مقبولة":"Not Bad",
    "ضعيفة":"Bad",
    "حنين للماضي":"Nostalgic",
    "مدعوم من الشركة":"Company Supported",
    "مدعوم كامل معربين":"Fully Arabized",
    "مدعوم جزئي معربين":"Partially Arabized",
    "نعم":"Yes",
    "لا":"No",
    "بدون سلسلة (مستقلة)":"Standalone (No Series)",
    "السعة":"Capacity",
    "اسم الهارد":"Drive Name",
    "إضافة هارد":"Add Drive",
    "إجمالي المساحة":"Total Capacity",
    "المتبقي":"Remaining",
    "مستخدمة":"Used",
    "كل Drives":"All Drives",
    "ابحث باسم اللعبة أو الهارد...":"Search by game or drive...",
    "أحجام الألعاب":"Game Sizes",
    "بيانات الأحجام محمّلة تلقائيًا من صفحة Sizes في ملف Excel، ويمكن تعديلها من هنا.":"Game size data is loaded automatically from the Sizes sheet in the Excel file and can be edited here.",
    "الحجم (Byte)":"Size (Byte)",
    "الحجم (GB)":"Size (GB)",
    "أدخل السعة الكلية":"Enter total capacity",
    "القيمة الجديدة":"New Value",
    "يمكنك إدخال أي سعة تريدها، وتُحفظ محليًا.":"You can enter any capacity; it is saved locally.",
    "تُحفظ في متصفحك":"Saved in your browser.",
    "إضافة لعبة إلى التواريخ":"Add Game to Dates",
    "إضافة لعبة جديدة":"Add New Game",
    "إضافة لعبة جديدة للمكتبة":"Add a New Game",
    "Playing State":"Play Status",
    "Final Rating":"Final Verdict",
    "Perspective":"Perspective",
    "السلسلة":"Series",
    "النوع":"Genre",
    "الشركة المطوّرة":"Developer",
    "الشخصية Home":"Main Character",
    "نوع النسخة":"Version Type",
    "نوع الإصدار":"Edition Type",
    "رمضان":"Ramadan",
    "الدعم العربي":"Arabic Support",
    "اختيار مفضّل":"Favorite",
    "اختيار مفضّل (GOTY)":"Favorite (GOTY)",
    "شوهدت على LED TV":"Seen on LED TV",
    "إصدار اللعبة":"Game Version",
    "وقت التثبيت":"Install Time",
    "تاريخ الإصدار":"Release Date",
    "مدة اللعب (أيام)":"Play Duration (Days)",
    "طور لعب مميز":"Featured Gameplay",
    "جرافيك مميز":"Featured Graphics",
    "عالم مفتوح مميز":"Featured Open World",
    "أجواء مميزة":"Featured Atmosphere",
    "قصة مميزة":"Featured Story",
    "بها أعطال":"Has Bugs",
    "من فضلك اكتب اسم اللعبة أولاً.":"Please enter the game name first.",
    "السلسلة حقل إجباري. اختر سلسلة أو أضف سلسلة جديدة من زر ＋.":"Series is required. Choose a series or add a new one with ＋.",
    "تمت إضافة":"Added",
    "إلى Library بنجاح.":"to the library successfully.",
    "هذه اللعبة مضافة بالفعل إلى التواريخ.":"This game is already added to dates.",
    "اختر لعبة من Library أولًا.":"Choose a game from the library first.",
    "الاختيار متاح فقط من الألعاب الموجودة في Library.":"Only games already in the library can be selected.",
    "إضافة قيمة جديدة":"Add New Value",
    "اكتب القيمة الجديدة":"Enter new value",
    "حفظ":"Save",
    "إلغاء":"Cancel",
    "إغلاق":"Close",
    "موافق":"OK",
    "لا توجد بيانات.":"No data.",
    "لا توجد بيانات بعد":"No data yet",
    "لا توجد ألعاب مسجلة.":"No games recorded.",
    "لا توجد ألعاب مطابقة لهذا البحث أو الفلاتر المحددة.":"No games match this search or the selected filters.",
    "مسح كل الفلاتر":"Clear All Filters",
    "عرض اختياراتي المفضّلة فقط (GOTY)":"Show only my favorites (GOTY)",
    "Dynamic Reports":"Dynamic Reports",
    "Collection Summary":"Collection Summary",
    "Genres":"Genres",
    "Release Years":"Release Years",
    "Screens, Resolution & GPUs":"Screens, Resolutions & Graphics Cards",
    "Play Activity by Year":"Play Activity by Year",
    "Series":"Series",
    "Genres الأكثر تكرارًا":"Top Genres",
    "Games by Release Decade":"Games by Release Decade",
    "أكثر Series تكرارًا":"Top Series",
    "أكثر Series لعبًا":"Most Played Series",
    "آخر 5 ألعاب تم لعبها":"Last 5 Games Played",
    "أقدم 5 ألعاب تم لعبها":"5 Oldest Games Played",
    "إنجاز Series":"Series Progress",
    "مكتمل ÷ إجمالي ألعاب السلسلة":"Completed ÷ Total Series Games",
    "لا توجد سلاسل.":"No series.",
    "توزيع المساحة":"Storage Distribution",
    "البحث والتصفح":"Search & Browse",
    "Game Dates ومدة اللعب":"Game Dates & Play Duration",
    "فهرسة كاملة لمقتنياتك عبر Drives، مع بحث وفرز وتحليل للمجموعة":"Complete catalog of your collection across drives, with search, sorting, and collection analysis",
    "سجل شخصي":"Personal Record",
    "أرشيف الألعاب":"Mostafa's PC Data",
    "Site Options":"Site Options",
    "إجمالي الألعاب":"Total Games",
    "حجم Library":"Library Size",
    "ألعاب لها تواريخ لعب":"Games with Play Dates",
    "سجلات التواريخ من Excel":"Date Records from Excel",
    "الشاشات":"Screens",
    "كروت الشاشة":"Graphics Cards",
    "الدقة":"Resolution",
    "اللعبة":"Game",
    "تاريخ البدء":"Start Date",
    "تاريخ الانتهاء":"End Date",
    "المدة (أيام)":"Duration (Days)",
    "السابق":"Previous",
    "التالي":"Next",
    "عرض الكل":"Show All",
    "الاسم (أ-ي)":"Name (A-Z)",
    "سنة الإصدار (الأحدث أولاً)":"Release Year (Newest First)",
    "سنة الإصدار (الأقدم أولاً)":"Release Year (Oldest First)",
    "الحجم (الأكبر أولاً)":"Size (Largest First)",
    "الحجم (الأصغر أولاً)":"Size (Smallest First)",
    "المضاف حديثًا (الأحدث أولاً)":"Recently Added (Newest First)",
    "20 / صفحة":"20 / page",
    "40 / صفحة":"40 / page",
    "80 / صفحة":"80 / page",
    "＋ إضافة لعبة إلى التواريخ":"＋ Add Game to Dates",
    "＋ إضافة هارد":"＋ Add Drive",
    "＋ 🎮":"＋ 🎮",
    "نوع الشاشة":"Screen Type",
    "كارت الشاشة":"Graphics Card",
    "حفظ السجل":"Save Record",
    "حذف السجل":"Delete Record",
    "بحث باسم اللعبة، السلسلة، الشركة المطوّرة، أو الشخصية Home...":"Search by game, series, developer, or main character...",
    "ابحث باسم اللعبة...":"Search by game name...",
    "نوع الإصدار (Remaster/Remake)":"Edition Type (Remaster/Remake)",
    "سمات مميزة":"Featured Attributes",
    "إضافة اللعبة للمكتبة":"Add Game to Library",
    "GOTY":"GOTY",
    "غير محدد":"Not Specified",
    "مثال: SSD-01":"Example: SSD-01",
    "تعديل السعة":"Edit Capacity",
    "حفظ السعة":"Save Capacity",
    "اكتب اسم الهارد والسعة أولاً.":"Enter the drive name and capacity first.",
    "التقييم":"Rating",
    "سنة الإصدار":"Release Year",
    "التحكم في الفلاتر":"Filter Controls",
    "طي الكل":"Collapse All",
    "فرد الكل":"Expand All",
    "فتح الفلاتر":"Open Filters",
    "إغلاق الفلاتر":"Close Filters",
    "تم حفظ التغيرات بنجاح":"Changes saved successfully",
    "عدد الأيام منذ آخر لعب":"Days Since Last Played",
    "يوم":"days",
    "اسم اللعبة *":"Game Name *",
    "اختيارات الدقة محددة فقط بـ: 480P, 720P, 1080P, 1440P, 4k":"Resolution options are limited to: 480P, 720P, 1080P, 1440P, 4k",
    "تعديل السجل":"Edit Record",
    "اكتب اسم اللعبة للبحث في جميع ألعاب Library.":"Type the game name to search all Library games.",
    "تاريخ البداية":"Start Date",
    "الشاشة":"Screen",
    "الريزوليوشن":"Resolution",
    "تم الحفظ بنجاح":"Saved successfully",
    "العربية":"Arabic",
    "يرجى السماح بالنوافذ المنبثقة للتصدير والطباعة.":"Please allow pop-ups for export and printing.",
    "تصدير PDF":"Export PDF",
    "تصدير Excel 365":"Export Excel 365",
    "طباعة":"Print"  };
  const I18N_REV=Object.fromEntries(Object.entries(I18N).map(([a,e])=>[e,a]));
  function tr(text){
    const map=lang==='en'?I18N:I18N_REV;
    let out=String(text??'');
    const keys=Object.keys(map).filter(Boolean).sort((a,b)=>b.length-a.length);
    for(const k of keys) if(out.includes(k)) out=out.split(k).join(map[k]);
    return out;
  }

  // ===== Full bilingual coverage: translate every text node / attribute on the page =====
  function translateNode(raw){
    const map=lang==='en'?I18N:I18N_REV;
    const keys=Object.keys(map).filter(Boolean).sort((x,y)=>y.length-x.length);
    let out=String(raw??'');
    for(const k of keys) if(out.includes(k)) out=out.split(k).join(map[k]);
    return out;
  }
  function translateAllText(){
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
      acceptNode(node){
        const p=node.parentElement;
        if(!p) return NodeFilter.FILTER_REJECT;
        const tag=p.tagName;
        if(tag==='SCRIPT'||tag==='STYLE'||tag==='TEXTAREA') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(n=>{ if(n.nodeValue && n.nodeValue.trim()) n.nodeValue=translateNode(n.nodeValue); });
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>{
      ['placeholder','title','aria-label'].forEach(attr=>{const v=el.getAttribute(attr);if(v)el.setAttribute(attr,translateNode(v));});
    });
    // input/select values that carry translatable labels (not user-typed search text)
    document.querySelectorAll('option').forEach(o=>{ if(o.textContent && o.textContent.trim()) o.textContent=translateNode(o.textContent); });
  }

  // Watches for ANY DOM change (new renders, dynamically added modals, filter chips,
  // report tables, etc.) and keeps the whole page translated automatically, in both
  // directions, without needing every render function to remember to call translate.
  let __translating=false, __translateTimer=null;
  function scheduleTranslate(){
    if(__translating) return;
    clearTimeout(__translateTimer);
    __translateTimer=setTimeout(()=>{
      __translating=true;
      try{ translateAllText(); }catch(e){}
      setTimeout(()=>{ __translating=false; },0);
    },100);
  }
  function initTranslationObserver(){
    const target=document.body;
    if(!target || typeof MutationObserver==='undefined') return;
    const observer=new MutationObserver(muts=>{
      if(__translating) return;
      scheduleTranslate();
    });
    observer.observe(target,{childList:true, subtree:true, characterData:true});
  }

  function applyLanguage(){
    document.documentElement.lang=lang;
    document.documentElement.dir=lang==='ar'?'rtl':'ltr';
    const t=document.getElementById('lang-toggle');if(t)t.textContent=lang==='en'?'العربية':'English';
    try{if(typeof renderDashboard==='function' && document.getElementById('dashboard-section')?.classList.contains('active'))renderDashboard();}catch(e){}
    try{if(typeof renderDrives==='function' && document.getElementById('drives-section')?.classList.contains('active'))renderDrives();}catch(e){}
    try{window.__renderActiveTab?.();}catch(e){}
    try{if(typeof renderReport==='function' && document.getElementById('reports-section')?.classList.contains('active'))renderReport();}catch(e){}
    try{if(typeof renderAddGameForm==='function' && document.getElementById('library-add-game-modal')?.style.display==='block')renderAddGameForm();}catch(e){}
    __translating=true;
    translateAllText();
    setTimeout(()=>{ __translating=false; },0);
    const si=document.getElementById('search-name-input');if(si)si.value=state.searchName||''; const ss=document.getElementById('search-series-input');if(ss)ss.value=state.searchSeries||'';
    const di=document.getElementById('dates-search-input');if(di)di.value=datesSearch||'';
  }
  document.getElementById('lang-toggle').addEventListener('click',()=>{lang=lang==='ar'?'en':'ar';localStorage.setItem('gameVault_lang_v1',lang);applyLanguage();});
  // Translation observer disabled for performance; renders translate explicitly when needed.
  document.getElementById('theme-toggle').addEventListener('click',()=>{
    document.body.classList.toggle('light'); localStorage.setItem('gameVault_theme_v1',document.body.classList.contains('light')?'light':'dark');
  });
  if(localStorage.getItem('gameVault_theme_v1')==='light') document.body.classList.add('light');

  function reportBars(items){
    if(!items.length) return '<div class="empty-state">لا توجد بيانات.</div>';
    const max=Math.max(...items.map(x=>x.value),1);
    return items.slice(0,15).map(x=>`<div class="bar-row"><div class="b-label" title="${esc(x.label)}">${esc(x.label)}</div><div class="b-track"><div class="b-fill" style="width:${(x.value/max*100).toFixed(1)}%"></div></div><div class="b-val">${fmt(x.value)}</div></div>`).join('');
  }
  function gameNameLink(name, extraClass=''){
    const n=String(name||'').trim();
    if(!n) return '—';
    return `<button type="button" class="game-name-link ${extraClass}" data-game-name="${esc(n)}" title="Open in Library">${esc(n)}<span class="game-link-icon" aria-hidden="true">↗</span></button>`;
  }

  function openLibraryGameFromReport(gameName){
    const key=normDateSearch(gameName);
    const target=GAMES.find(g=>normDateSearch(g.name)===key);
    if(!target)return;

    // Clear Library filters so the linked game is guaranteed to be visible.
    state.searchName='';
    state.searchSeries='';
    state.genres.clear(); state.hdds.clear(); state.states.clear();
    state.verdicts.clear(); state.persp.clear(); state.arabic.clear(); state.series.clear();
    state.gotyOnly=false; state.yearMin=null; state.yearMax=null;
    state.sizeMin=null; state.sizeMax=null;
    state.sort='name-asc';
    state.expandedId=Number(target.id);

    const visible=[...GAMES].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const index=visible.findIndex(g=>Number(g.id)===Number(target.id));
    state.page=Math.max(1,Math.floor(Math.max(0,index)/state.pageSize)+1);

    const nav=document.querySelector('.tabnav-btn[data-tab="library-section"]');
    // Switch to Library first, then force a fresh render so the exact target
    // page/card is present even when Library was already rendered earlier.
    if(nav) nav.click();
    renderFilters();
    renderResults();

    requestAnimationFrame(()=>{
      const row=document.querySelector(`#results-list .g-row[data-id="${Number(target.id)}"]`);
      if(row){
        state.expandedId=Number(target.id);
        row.classList.add('open');
        row.scrollIntoView({behavior:'smooth',block:'center'});
        row.classList.add('game-link-target');
        setTimeout(()=>row.classList.remove('game-link-target'),1400);
      }
    });
  }

  document.addEventListener('click',e=>{
    const link=e.target.closest('.game-name-link');
    if(!link) return;
    e.preventDefault();
    e.stopPropagation();
    openLibraryGameFromReport(link.dataset.gameName||link.textContent.replace('↗','').trim());
  }, true);

  function renderReport(){
    const el=document.getElementById('dynamic-report'); if(!el)return;
    const type=document.getElementById('report-select')?.value||'overview';
    // Reports use completed games as the reporting population.
    // A game marked Done is counted; incomplete games are excluded from
    // genre/year/hardware/play-history reports, while series-completion
    // keeps them in the denominator so the completion percentage remains meaningful.
    const isCompletedGame=g=>String(g?.playingState||'').trim().toLowerCase()==='done';
    // Always derive completion from the live Game Dates records first.
    // This keeps Year Summary in sync immediately after a date is saved, even
    // when the Library game object has not yet been rebuilt.
    const liveDateRecords=ensureDateRecords();
    const doneGameIds=new Set();
    const doneGameNames=new Set();
    liveDateRecords.forEach(r=>{
      if(!r || !(r.start||r.end)) return;
      const derived=derivePlayingState(r.start||null,r.end||null,r.playingState||r.status||'');
      r.playingState=derived; r.status=derived;
      if(derived==='Done'){
        if(r.gameId!=null && Number.isFinite(Number(r.gameId))) doneGameIds.add(Number(r.gameId));
        const nk=normDateSearch(r.name); if(nk) doneGameNames.add(nk);
      }
    });
    const completedGames=GAMES.filter(g=>isCompletedGame(g) || doneGameIds.has(Number(g.id)) || doneGameNames.has(normDateSearch(g.name)));
    const completedIds=new Set(completedGames.map(g=>Number(g.id)).filter(Number.isFinite));
    const completedNames=new Set(completedGames.map(g=>normDateSearch(g.name)).filter(Boolean));
    const records=liveDateRecords.filter(r=>r && (r.start||r.end) && (
      (r.gameId!=null && completedIds.has(Number(r.gameId))) ||
      (normDateSearch(r.name) && completedNames.has(normDateSearch(r.name)))
    ));
    const yearOf=r=>String(r.start||r.end||'').slice(0,4);
    const gameKey=r=>Number(r.gameId)||normDateSearch(r.name);
    const sortedRecords=[...records].sort((x,y)=>playDateKey(y).localeCompare(playDateKey(x)));
    const isNewPlay=r=>getPlayCountBefore(r.gameId,r.name,r)===0;
    saveDateRecords();
    const years=[...new Set(records.map(yearOf).filter(y=>/^\d{4}$/.test(y)))].sort((x,y)=>Number(x)-Number(y));
    const empty='<div class="report-empty">لا توجد بيانات لعب مسجلة.</div>';

    const statCard=(value,label)=>`<div class="report-card"><div class="rv">${fmt(value)}</div><div class="rl">${esc(label)}</div></div>`;
    const yearTable=(rows)=>{
      if(!rows.length)return empty;
      return `<div class="dt-table-wrap report-table-wrap"><table class="dt-table report-table"><thead><tr>
        <th>السنة</th><th>جديدة</th><th>قديمة</th><th>الإجمالي</th>
      </tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.year)}</td><td>${fmt(x.newCount)}</td><td>${fmt(x.oldCount)}</td><td><b>${fmt(x.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th>الإجمالي</th><th>${fmt(rows.reduce((s,x)=>s+x.newCount,0))}</th><th>${fmt(rows.reduce((s,x)=>s+x.oldCount,0))}</th><th>${fmt(rows.reduce((s,x)=>s+x.total,0))}</th></tr></tfoot></table></div>`;
    };

if(type==='overview'){
      const total=completedGames.length, size=completedGames.reduce((a,g)=>a+(Number(g.sizeGB)||0),0), playedGames=new Set(records.map(gameKey)).size;
      el.innerHTML=`<div class="report-grid">${statCard(total,'الألعاب المكتملة')}${statCard(size.toFixed(2)+' GB','حجم الألعاب المكتملة')}${statCard(playedGames,'ألعاب مكتملة تم لعبها')}${statCard(records.length,'سجلات اللعب للألعاب المكتملة')}</div>`;
    } else if(type==='ramadan'){
      const ramadanWindows={
        'Ramadan-2005':['2005-10-05','2005-11-03'],'Ramadan-2006':['2006-09-24','2006-10-23'],'Ramadan-2007':['2007-09-13','2007-10-12'],'Ramadan-2008':['2008-09-01','2008-09-30'],'Ramadan-2009':['2009-08-22','2009-09-19'],'Ramadan-2010':['2010-08-11','2010-09-08'],'Ramadan-2011':['2011-08-01','2011-08-29'],'Ramadan-2012':['2012-07-20','2012-08-18'],'Ramadan-2013':['2013-07-10','2013-08-07'],'Ramadan-2014':['2014-06-29','2014-07-27'],'Ramadan-2015':['2015-06-18','2015-07-16'],'Ramadan-2016':['2016-06-06','2016-07-05'],'Ramadan-2017':['2017-05-27','2017-06-24'],'Ramadan-2018':['2018-05-16','2018-06-14'],'Ramadan-2019':['2019-05-06','2019-06-03'],'Ramadan-2020':['2020-04-24','2020-05-23'],'Ramadan-2021':['2021-04-13','2021-05-12'],'Ramadan-2022':['2022-04-02','2022-05-01'],'Ramadan-2023':['2023-03-23','2023-04-20'],'Ramadan-2024':['2024-03-11','2024-04-09'],'Ramadan-2025':['2025-03-01','2025-03-30'],'Ramadan-2026':['2026-02-18','2026-03-19']
      };
      const groups={}; Object.keys(ramadanWindows).forEach(k=>groups[k]=[]);
      records.forEach(r=>{const d=String(r.end||r.start||'').slice(0,10); if(!d)return; Object.entries(ramadanWindows).forEach(([k,w])=>{if(d>=w[0]&&d<=w[1])groups[k].push(r);});});
      const yearCounts=Object.entries(groups).map(([year,rs])=>({year,count:new Set(rs.map(gameKey)).size})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count||a.year.localeCompare(b.year));
      const cards=Object.entries(groups).filter(([,rs])=>rs.length).map(([k,rs])=>{const unique=Array.from(new Map(rs.map(r=>[gameKey(r),String(r.name||'Unnamed Game')])).entries()).sort((a,b)=>a[1].localeCompare(b[1]));const count=unique.length;return `<details class="panel ramadan-year"><summary><div class="ramadan-year-row"><span class="ramadan-year-title">${esc(k)}</span><span class="ramadan-count-circle">${fmt(count)}</span></div></summary><div class="ramadan-games-list">${unique.map(([,name])=>`<div class="ramadan-game-item">${gameNameLink(name)}</div>`).join('')}</div></details>`;}).join('');
      const top=yearCounts.length?`<div class="panel ramadan-top-years"><h3>Most Played Ramadan Years</h3><p>${yearCounts.slice(0,3).map(x=>`${esc(x.year)} (${fmt(x.count)} games)`).join(' · ')}</p></div>`:'';
      el.innerHTML=cards+top||empty;
    } else if(type==='epic-nostalgic'){
      const selected=completedGames.filter(g=>{const v=String(g.verdict||g.rating||g.category||'').trim().toLowerCase(); return v==='epic'||v==='nostalgic'||v.includes('epic')||v.includes('nostalgic')||String(g.epicNostalgic||'').toLowerCase()==='true';});
      el.innerHTML=selected.length?`<div class="report-grid">${statCard(selected.length,'Epic & Nostalgic Games')}</div>${selected.map(g=>`<div class="panel"><div>${gameNameLink(g.name||'Unnamed Game')}</div><div class="note">${esc(g.series||'')}</div></div>`).join('')}`:empty;
    } else if(type==='genres'){

      const c={};completedGames.forEach(g=>{if(g.genre)c[g.genre]=(c[g.genre]||0)+1;});el.innerHTML=reportBars(Object.entries(c).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value));
    } else if(type==='year-summary'){
      const map={}; for(let y=2003;y<=2026;y++)map[y]={year:String(y),newCount:0,oldCount:0,total:0};
      records.forEach(r=>{const y=yearOf(r); if(map[y]){if(isNewPlay(r))map[y].newCount++;else map[y].oldCount++;map[y].total++;}});
      el.innerHTML=Object.values(map).map(x=>{const ys=records.filter(r=>yearOf(r)===x.year); const names=[...new Map(ys.map(r=>[gameKey(r),String(r.name||'Unnamed Game')])).entries()].sort((a,b)=>a[1].localeCompare(b[1])); return `<details class="panel report-year-fold"><summary><span>Year-${x.year}</span><span class="ramadan-count-circle">${fmt(names.length)}</span></summary><div class="report-year-detail"><span class="report-metric report-new-metric"><b>New</b>: ${fmt(x.newCount)} <b class="report-percent">(${x.total ? ((x.newCount/x.total)*100).toFixed(1) : '0.0'}%)</b></span><span class="report-metric report-old-metric"><b>Old</b>: ${fmt(x.oldCount)} <b class="report-percent">(${x.total ? ((x.oldCount/x.total)*100).toFixed(1) : '0.0'}%)</b></span><span class="report-metric report-total-metric"><b>Total</b>: ${fmt(x.total)}</span><div class="report-data-bar" role="img" aria-label="New ${x.total ? ((x.newCount/x.total)*100).toFixed(1) : '0.0'} percent, Old ${x.total ? ((x.oldCount/x.total)*100).toFixed(1) : '0.0'} percent"><div class="report-data-bar-new" style="width:${x.total ? (x.newCount/x.total)*100 : 0}%"><span>New ${x.total ? ((x.newCount/x.total)*100).toFixed(1) : '0.0'}%</span></div><div class="report-data-bar-old" style="width:${x.total ? (x.oldCount/x.total)*100 : 0}%"><span>Old ${x.total ? ((x.oldCount/x.total)*100).toFixed(1) : '0.0'}%</span></div></div></div><div class="report-year-games">${names.length?names.map(([,n])=>`${gameNameLink(n, 'report-year-game report-game-link')}`).join(''):'<div class="report-year-game empty">No games played</div>'}</div></details>`;}).join('');
      el.querySelectorAll('.report-game-link[data-game-name]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openLibraryGameFromReport(link.dataset.gameName);}));
    } else if(type==='years'){
      const c={};completedGames.forEach(g=>{if(g.year)c[g.year]=(c[g.year]||0)+1;});el.innerHTML=reportBars(Object.entries(c).map(([label,value])=>({label,value})).sort((a,b)=>Number(a.label)-Number(b.label)));
    } else if(type==='hardware'){
      const screens={},res={},gpu={};completedGames.forEach(g=>{if(g.screenType)screens[g.screenType]=(screens[g.screenType]||0)+1;if(g.resolution)res[g.resolution]=(res[g.resolution]||0)+1;if(g.gpu)gpu[g.gpu]=(gpu[g.gpu]||0)+1;});
      el.innerHTML=`<div class="dash-grid"><div class="panel"><h3>الشاشات</h3>${reportBars(Object.entries(screens).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value))}</div><div class="panel"><h3>الدقة</h3>${reportBars(Object.entries(res).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value))}</div><div class="panel"><h3>كروت الشاشة</h3>${reportBars(Object.entries(gpu).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value))}</div></div>`;
    } else if(type==='dates' || type==='yearly-play'){
      const map={};
      records.forEach(r=>{const y=yearOf(r); if(!map[y])map[y]={year:y,newCount:0,oldCount:0,total:0}; if(isNewPlay(r))map[y].newCount++;else map[y].oldCount++;map[y].total++;});
      el.innerHTML=`<div class="report-grid">${statCard(records.length,'إجمالي مرات اللعب')}${statCard(new Set(records.map(gameKey)).size,'عدد الألعاب التي تم لعبها')}${statCard(records.filter(isNewPlay).length,'مرات لعب جديدة')}${statCard(records.filter(r=>!isNewPlay(r)).length,'مرات لعب قديمة')}</div><h3 class="report-subtitle">عدد الألعاب التي لعبت في كل سنة</h3>${yearTable(years.map(y=>map[y]))}`;
    } else if(type==='played-summary'){
      const map={};
      records.forEach(r=>{const y=yearOf(r); if(!map[y])map[y]={year:y,newCount:0,oldCount:0,total:0}; if(isNewPlay(r))map[y].newCount++;else map[y].oldCount++;map[y].total++;});
      const rows=years.map(y=>map[y]);
      const maxBy=k=>rows.length?rows.reduce((a,b)=>b[k]>a[k]?b:a):null;
      const minBy=k=>rows.length?rows.reduce((a,b)=>b[k]<a[k]?b:a):null;
      const item=(title,x,k)=>x?`<div class="report-rank"><span>${title}</span><b>${esc(x.year)}</b><em>${fmt(x[k])}</em></div>`:'';
      el.innerHTML=`<div class="dash-grid report-rank-grid">
        <div class="panel"><h3>أكثر السنوات لعبًا</h3>${item('جديدة',maxBy('newCount'),'newCount')}${item('قديمة',maxBy('oldCount'),'oldCount')}${item('الإجمالي',maxBy('total'),'total')}</div>
        <div class="panel"><h3>أقل السنوات لعبًا</h3>${item('جديدة',minBy('newCount'),'newCount')}${item('قديمة',minBy('oldCount'),'oldCount')}${item('الإجمالي',minBy('total'),'total')}</div>
      </div><h3 class="report-subtitle">مقارنة جميع السنوات</h3>${yearTable(rows)}`;
    } else if(type==='series-completion'){
      const groups={};
      GAMES.forEach(g=>{
        const s=String(g.series||'').trim();
        if(!s || s.toUpperCase()==='SOLO')return;
        if(!groups[s])groups[s]={series:s,total:0,done:0};
        groups[s].total++;
        if(String(g.playingState||'').toLowerCase()==='done')groups[s].done++;
      });
      const rows=Object.values(groups).map(x=>({...x,pct:x.total?x.done/x.total*100:0})).sort((a,b)=>b.pct-a.pct||b.total-a.total);
      const total=rows.reduce((s,x)=>s+x.total,0), done=rows.reduce((s,x)=>s+x.done,0), pct=total?done/total*100:0;
      el.innerHTML=`<div class="report-grid">${statCard(rows.length,'عدد Series')}${statCard(done,'ألعاب مكتملة داخل Series')}${statCard(total,'إجمالي ألعاب Series')}${statCard(pct.toFixed(1)+'%','نسبة إكمال Series')}</div>
      <div class="dt-table-wrap report-table-wrap"><table class="dt-table report-table"><thead><tr><th>السلسلة</th><th>المكتمل</th><th>الإجمالي</th><th>نسبة الإكمال</th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${esc(x.series)}</td><td>${fmt(x.done)}</td><td>${fmt(x.total)}</td><td><div class="report-progress"><span style="width:${Math.min(100,x.pct)}%"></span></div><b>${x.pct.toFixed(1)}%</b></td></tr>`).join('')}
      </tbody></table></div>`;
    } else if(type==='last30'){
      const last30=sortedRecords.slice(0,30);
      el.innerHTML=last30.length?`<div class="report-grid">${statCard(last30.length,'آخر سجلات اللعب')}${statCard(last30.filter(isNewPlay).length,'ألعاب جديدة')}${statCard(last30.filter(r=>!isNewPlay(r)).length,'ألعاب قديمة')}</div>
      <div class="dt-table-wrap report-table-wrap"><table class="dt-table report-table"><thead><tr><th>#</th><th>اسم اللعبة</th><th>التاريخ</th><th>التصنيف</th></tr></thead><tbody>
      ${last30.map((r,i)=>`<tr><td>${i+1}</td><td>${gameNameLink(r.name||'—')}</td><td>${esc(r.start||r.end||'—')}</td><td><span class="report-type ${isNewPlay(r)?'new':'old'}">${isNewPlay(r)?'جديدة':'قديمة'}</span></td></tr>`).join('')}
      </tbody></table></div>`:empty;
    } else if(type==='series'){
      const c={};completedGames.forEach(g=>{if(g.series)c[g.series]=(c[g.series]||0)+1;});el.innerHTML=reportBars(Object.entries(c).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value));
    }
  }
  document.getElementById('report-select')?.addEventListener('change',renderReport); document.getElementById('report-select')?.addEventListener('input',renderReport);
  function startDynamicBackground(){
    const bg=document.getElementById('dynamic-bg'); if(!bg)return;
    // Use the real game artwork already stored in the project instead of one repeated wallpaper.
    // This keeps the background fully local/offline and makes it reflect the user's library.
    const localGames=(Array.isArray(GAMES)?GAMES:[])
      .filter(g=>g && g.cover)
      .map(g=>({name:g.name||'',cover:String(g.cover).replace(/\\/g,'/')}));
    const unique=[]; const seen=new Set();
    localGames.forEach(g=>{if(!seen.has(g.cover)){seen.add(g.cover);unique.push(g);}});
    // Prefer a varied rotation rather than the first few alphabetic/ID entries.
    for(let i=unique.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}
    const wallpapers=unique.slice(0,16);
    if(!wallpapers.length) return;
    let i=0;
    const show=()=>{
      const item=wallpapers[i];
      bg.classList.remove('bg-fade');
      void bg.offsetWidth;
      bg.style.backgroundImage=`url("${item.cover}")`;
      bg.setAttribute('aria-label', item.name ? `Game background: ${item.name}` : 'Game background');
      bg.classList.add('bg-fade');
      i=(i+1)%wallpapers.length;
    };
    show();
    clearInterval(window.__gameBgRotation);
    window.__gameBgRotation=setInterval(show,120000);
  }

  const _renderDashboard=renderDashboard;
  renderDashboard=function(){_renderDashboard();renderReport();};
  startDynamicBackground();


  /* ================= EXPORT / PRINT ================= */
  function exportSectionHTML(sectionId, mode){
    const section=document.getElementById(sectionId); if(!section)return;
    const clone=section.cloneNode(true);
    clone.querySelectorAll('.section-tools,.cover-tools,.icon-action,.action-btn,.plus-btn,.dt-actions,.size-actions,.pager,.search-sugg').forEach(el=>el.remove());
    clone.querySelectorAll('input,select,button').forEach(el=>{ if(el.tagName==='INPUT'||el.tagName==='SELECT'){ const span=document.createElement('span'); span.textContent=el.value||el.getAttribute('placeholder')||''; el.replaceWith(span); } else el.remove(); });
    const title=clone.querySelector('.section-head h2')?.textContent?.trim() || clone.querySelector('.section-head .tab')?.textContent?.trim() || 'Game Archive';
    const styles=[...document.querySelectorAll('style')].map(x=>x.textContent).join('\n');
    const html=`<!doctype html><html dir="${lang==='en'?'ltr':'rtl'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${styles} body{background:#fff!important;color:#111!important;padding:24px;font-family:Arial,sans-serif}.section{display:block!important;background:#fff!important;color:#111!important}.panel,.dt-table-wrap,.results-list{background:#fff!important;color:#111!important}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:7px;text-align:start}h1,h2,h3{color:#111!important}
/* ===== Reference-matched FILTER + TAB NAV design (games untouched) ===== */
.tabnav{
  display:grid!important;
  grid-template-columns:repeat(5,minmax(118px,1fr));
  gap:0!important;
  margin:18px 0 14px!important;
  padding:0!important;
  border:1px solid rgba(0,184,255,.52)!important;
  border-radius:13px!important;
  overflow:hidden!important;
  background:linear-gradient(180deg,rgba(3,18,34,.97),rgba(2,10,21,.97))!important;
  box-shadow:0 0 18px rgba(0,153,255,.16),inset 0 1px rgba(255,255,255,.05)!important;
  position:relative;z-index:50;
}
.tabnav-btn{
  position:relative!important;
  min-height:72px!important;
  padding:10px 8px 9px!important;
  border:0!important;
  border-inline-end:1px solid rgba(83,143,184,.24)!important;
  border-bottom:0!important;
  border-radius:0!important;
  background:linear-gradient(180deg,rgba(9,29,50,.92),rgba(3,14,27,.96))!important;
  color:#dcecff!important;
  font-family:var(--font-head)!important;
  font-size:15px!important;
  font-weight:800!important;
  letter-spacing:.1px;
  text-shadow:0 2px 4px #000;
  cursor:pointer;
  transition:.18s ease!important;
}
.tabnav-btn:last-child{border-inline-end:0!important;}
.tabnav-btn::before{
  display:block;
  height:27px;
  margin-bottom:4px;
  font-family:Arial,sans-serif;
  font-size:25px;
  line-height:27px;
  color:#dcecff;
  text-shadow:0 0 8px rgba(85,190,255,.42);
}
.tabnav-btn[data-tab="dashboard-section"]::before{content:'⚙';}
.tabnav-btn[data-tab="drives-section"]::before{content:'▰';}
.tabnav-btn[data-tab="library-section"]::before{content:'🎮';font-size:23px;}
.tabnav-btn[data-tab="sizes-section"]::before{content:'▣';}
.tabnav-btn[data-tab="dates-section"]::before{content:'▦';}
.tabnav-btn:hover{color:#fff!important;background:linear-gradient(180deg,#103557,#071d34)!important;transform:none!important;}
.tabnav-btn:hover::before{color:#8bdcff;}
.tabnav-btn.active{
  color:#ffe36b!important;
  background:linear-gradient(180deg,#2a260f,#17170c 62%,#0c1118)!important;
  border-inline-end-color:rgba(230,180,40,.35)!important;
  box-shadow:inset 0 0 22px rgba(255,193,34,.12),0 0 15px rgba(255,193,34,.2)!important;
}
.tabnav-btn.active::before{color:#ffd95a;text-shadow:0 0 9px rgba(255,197,49,.65);}

aside.filters{
  position:sticky!important;top:14px;
  padding:17px 13px 14px!important;
  background:linear-gradient(180deg,rgba(2,17,32,.98),rgba(2,10,21,.98))!important;
  border:1px solid rgba(0,181,255,.72)!important;
  border-radius:13px!important;
  box-shadow:0 0 18px rgba(0,154,255,.17),inset 0 0 22px rgba(0,120,190,.06)!important;
}
aside.filters::before{
  content:'';display:block;height:3px;width:48%;margin:0 0 12px 0;border-radius:5px;
  background:linear-gradient(90deg,#00bfff,rgba(0,191,255,.08));
  box-shadow:0 0 9px rgba(0,191,255,.7);
}
.f-group{margin-bottom:15px!important;}
.f-group summary{
  position:relative!important;
  padding:0 2px 7px!important;
  margin-bottom:9px!important;
  border-bottom:0!important;
  color:#dcecff!important;
  font-size:14px!important;
  font-weight:850!important;
  text-shadow:0 2px 4px #000;
}
.f-group summary::after{color:#69d8ff!important;font-size:16px!important;}
.f-group summary::before{
  content:'';position:absolute;bottom:0;inset-inline-start:0;width:42px;height:2px;border-radius:4px;
  background:#00bfff;box-shadow:0 0 8px rgba(0,191,255,.65);
}
.chip-list{gap:6px!important;max-height:180px!important;}
.chip{
  background:rgba(4,25,43,.78)!important;
  border:1px solid rgba(0,155,224,.42)!important;
  color:#dcecff!important;
  border-radius:7px!important;
  padding:6px 9px!important;
  font-size:11.5px!important;
  box-shadow:inset 0 1px rgba(255,255,255,.03);
}
.chip:hover{background:rgba(7,45,72,.9)!important;border-color:#00bfff!important;}
.chip.active{background:linear-gradient(180deg,#12618a,#073c5e)!important;border-color:#16c8ff!important;color:#fff!important;box-shadow:0 0 9px rgba(0,190,255,.2)!important;}
.range-row input[type=number]{
  background:#061a2c!important;border-color:rgba(0,155,224,.55)!important;color:#e8f5ff!important;border-radius:7px!important;
}
.toggle-row{color:#dcecff!important;}
.toggle-row input{accent-color:#00bfff!important;}
.clear-btn{
  background:rgba(0,48,75,.25)!important;
  border:0!important;border-top:1px solid rgba(0,170,240,.18)!important;
  color:#00c8ff!important;border-radius:0!important;margin-top:5px!important;padding:12px 6px!important;
  font-size:13px!important;font-weight:800!important;
}
.clear-btn:hover{background:rgba(0,133,190,.12)!important;color:#70e1ff!important;}

@media(max-width:900px){
  .tabnav{grid-template-columns:repeat(5,minmax(105px,1fr))!important;overflow-x:auto!important;}
  .tabnav-btn{min-width:105px!important;min-height:68px!important;font-size:13px!important;}
}
@media(max-width:560px){
  .tabnav{grid-template-columns:repeat(5,94px)!important;}
  .tabnav-btn{min-width:94px!important;min-height:62px!important;padding:7px 4px!important;font-size:11.5px!important;}
  .tabnav-btn::before{font-size:21px;height:23px;line-height:23px;}
  aside.filters{position:relative!important;top:auto!important;}
}
</style>
<style id="reference-ui-final">
/* ===== FINAL REFERENCE DESIGN: NAV TABS + LIBRARY FILTER ONLY ===== */
nav#tabnav.tabnav{
  width:min(1160px,calc(100% - 36px)) !important;
  margin:18px auto 14px !important;
  padding:0 !important;
  display:grid !important;
  grid-template-columns:repeat(5,1fr) !important;
  gap:0 !important;
  background:linear-gradient(180deg,rgba(4,22,40,.98),rgba(2,11,22,.99)) !important;
  border:1px solid rgba(0,185,255,.75) !important;
  border-radius:13px !important;
  overflow:hidden !important;
  box-shadow:0 0 20px rgba(0,170,255,.18),inset 0 0 18px rgba(0,110,190,.07) !important;
  position:relative !important;
  z-index:80 !important;
}
nav#tabnav .tabnav-btn{
  height:76px !important;
  min-height:76px !important;
  padding:8px 6px 7px !important;
  margin:0 !important;
  border:0 !important;
  border-inline-end:1px solid rgba(102,153,190,.22) !important;
  border-radius:0 !important;
  background:linear-gradient(180deg,#0a2742 0%,#06192d 100%) !important;
  color:#dcecff !important;
  font-family:var(--font-head,Arial,sans-serif) !important;
  font-size:15px !important;
  font-weight:900 !important;
  text-shadow:0 2px 4px #000 !important;
  box-shadow:inset 0 1px rgba(255,255,255,.045) !important;
  transition:background .16s ease,box-shadow .16s ease,color .16s ease !important;
}
nav#tabnav .tabnav-btn:last-child{border-inline-end:0 !important;}
nav#tabnav .tabnav-btn::before{
  display:block !important;
  height:31px !important;
  margin:0 0 3px !important;
  font-family:Arial,sans-serif !important;
  font-size:28px !important;
  line-height:31px !important;
  color:#e4f4ff !important;
  text-shadow:0 0 9px rgba(72,195,255,.58) !important;
}
nav#tabnav .tabnav-btn[data-tab="dashboard-section"]::before{content:'⚙' !important;}
nav#tabnav .tabnav-btn[data-tab="drives-section"]::before{content:'▰' !important;}
nav#tabnav .tabnav-btn[data-tab="library-section"]::before{content:'🎮' !important;font-size:27px !important;}
nav#tabnav .tabnav-btn[data-tab="sizes-section"]::before{content:'▣' !important;}
nav#tabnav .tabnav-btn[data-tab="dates-section"]::before{content:'▦' !important;}
nav#tabnav .tabnav-btn:hover{
  color:#fff !important;
  background:linear-gradient(180deg,#123c62,#08233d) !important;
  box-shadow:inset 0 0 18px rgba(0,178,255,.13) !important;
  transform:none !important;
}
nav#tabnav .tabnav-btn.active{
  color:#ffe477 !important;
  background:linear-gradient(180deg,#3b330e 0%,#211d0a 55%,#0c1720 100%) !important;
  box-shadow:inset 0 0 26px rgba(255,196,45,.18),0 0 16px rgba(255,190,35,.2) !important;
  border-inline-end-color:rgba(255,205,72,.28) !important;
}
nav#tabnav .tabnav-btn.active::before{
  color:#ffd75a !important;
  text-shadow:0 0 11px rgba(255,202,47,.82) !important;
}

/* Filter: match supplied reference, while keeping all existing controls functional */
#library-section aside#filters.filters{
  width:290px !important;
  min-width:290px !important;
  box-sizing:border-box !important;
  padding:18px 13px 14px !important;
  background:linear-gradient(180deg,rgba(2,18,34,.985),rgba(1,9,19,.99)) !important;
  border:1px solid rgba(0,184,255,.82) !important;
  border-radius:13px !important;
  box-shadow:0 0 21px rgba(0,156,255,.2),inset 0 0 25px rgba(0,120,200,.08) !important;
  position:relative !important;
  overflow:hidden !important;
}
#library-section aside#filters.filters::after{
  content:'' !important;
  position:absolute !important;
  top:0 !important;
  left:0 !important;
  right:0 !important;
  height:2px !important;
  background:linear-gradient(90deg,transparent,#00c9ff 25%,#00c9ff 75%,transparent) !important;
  box-shadow:0 0 10px #00c9ff !important;
}
#library-section aside#filters.filters::before{
  content:'⚱' !important;
  display:block !important;
  position:absolute !important;
  inset-inline-end:13px !important;
  top:12px !important;
  width:auto !important;
  height:auto !important;
  margin:0 !important;
  background:none !important;
  box-shadow:none !important;
  color:#00c8ff !important;
  font-size:22px !important;
  line-height:1 !important;
  opacity:.95 !important;
}
#library-section aside#filters.filters .f-group{margin-bottom:14px !important;}
#library-section aside#filters.filters .f-group summary{
  padding:0 2px 8px !important;
  margin-bottom:9px !important;
  color:#e6f4ff !important;
  font-size:14px !important;
  font-weight:900 !important;
  text-shadow:0 2px 4px #000 !important;
  border:0 !important;
}
#library-section aside#filters.filters .f-group summary::before{
  content:'' !important;
  position:absolute !important;
  bottom:0 !important;
  inset-inline-start:0 !important;
  width:42px !important;
  height:2px !important;
  border-radius:4px !important;
  background:#00bfff !important;
  box-shadow:0 0 8px rgba(0,191,255,.7) !important;
}
#library-section aside#filters.filters .f-group summary::after{
  color:#68d9ff !important;
  font-size:16px !important;
}
#library-section aside#filters.filters .chip{
  min-height:30px !important;
  box-sizing:border-box !important;
  padding:6px 9px !important;
  border-radius:7px !important;
  background:rgba(4,25,43,.82) !important;
  border:1px solid rgba(0,158,225,.42) !important;
  color:#e1effb !important;
}
#library-section aside#filters.filters .chip:hover{
  background:rgba(7,50,79,.92) !important;
  border-color:#00c8ff !important;
}
#library-section aside#filters.filters .chip.active{
  background:linear-gradient(180deg,#126a92,#074563) !important;
  border-color:#15ccff !important;
  color:#fff !important;
  box-shadow:0 0 9px rgba(0,194,255,.2) !important;
}
#library-section aside#filters.filters .range-row input[type=number]{
  background:#061b2e !important;
  border-color:rgba(0,166,235,.55) !important;
  color:#edf9ff !important;
}
#library-section aside#filters.filters .toggle-row{color:#dcecff !important;}
#library-section aside#filters.filters .toggle-row input{accent-color:#00c8ff !important;}
#library-section aside#filters.filters .clear-btn{
  background:transparent !important;
  border:0 !important;
  border-top:1px solid rgba(0,175,245,.2) !important;
  color:#00c8ff !important;
  margin-top:7px !important;
  padding:13px 6px !important;
  font-size:13px !important;
  font-weight:900 !important;
}
#library-section aside#filters.filters .clear-btn:hover{background:rgba(0,153,218,.1) !important;color:#79e4ff !important;}

@media(max-width:900px){
  nav#tabnav.tabnav{width:calc(100% - 20px) !important;overflow-x:auto !important;grid-template-columns:repeat(5,108px) !important;}
  nav#tabnav .tabnav-btn{min-width:108px !important;height:70px !important;min-height:70px !important;font-size:13px !important;}
  #library-section aside#filters.filters{width:270px !important;min-width:270px !important;}
}
@media(max-width:560px){
  nav#tabnav.tabnav{grid-template-columns:repeat(5,92px) !important;}
  nav#tabnav .tabnav-btn{min-width:92px !important;height:62px !important;min-height:62px !important;padding:6px 3px !important;font-size:11px !important;}
  nav#tabnav .tabnav-btn::before{font-size:21px !important;height:23px !important;line-height:23px !important;}
  #library-section aside#filters.filters{width:100% !important;min-width:0 !important;}
}

/* Gold hover interaction for navigation/filter icons */
.tabnav-btn,
.section-head .export-icon-btn,
.ui-btn,
.icon-action,
.library-card-actions .icon-btn,
.cover-tools .icon-btn,
.dt-table .dt-edit-btn,
.dt-table .dt-save,
.dt-table .dt-delete,
.dt-table .dt-option-add,
.pager button,
.side-select button,
.clear-btn{
  transition:background .18s ease,color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease;
}
/* Hovering any navigation icon/button turns the complete control gold */
.tabnav-btn:hover,
.tabnav-btn:hover svg,
.section-head .export-icon-btn:hover,
.section-head .export-icon-btn:hover svg,
.ui-btn:hover,
.ui-btn:hover svg,
.icon-action:hover,
.icon-action:hover svg,
.library-card-actions .icon-btn:hover,
.library-card-actions .icon-btn:hover svg,
.cover-tools .icon-btn:hover,
.cover-tools .icon-btn:hover svg,
.dt-table .dt-edit-btn:hover,
.dt-table .dt-edit-btn:hover svg,
.dt-table .dt-save:hover,
.dt-table .dt-save:hover svg,
.dt-table .dt-delete:hover,
.dt-table .dt-delete:hover svg,
.dt-table .dt-option-add:hover,
.dt-table .dt-option-add:hover svg,
.side-select button:hover,
.side-select button:hover svg,
.clear-btn:hover,
.clear-btn:hover svg{
  color:#1b1710 !important;
  background:linear-gradient(145deg,#ffe28a,#dcae3d) !important;
  border-color:#ffd45b !important;
  box-shadow:0 0 16px rgba(255,204,72,.42), inset 0 1px rgba(255,255,255,.45) !important;
  transform:translateY(-1px);
}
/* The filter section title and its expand/collapse control also respond in gold */
aside.filters .f-group summary:hover{
  color:#ffd45b !important;
  border-bottom-color:#dcae3d !important;
}
aside.filters .f-group summary:hover::after{color:#ffd45b !important;}
aside.filters .chip:hover{
  color:#1b1710 !important;
  background:linear-gradient(145deg,#ffe28a,#dcae3d) !important;
  border-color:#ffd45b !important;
  box-shadow:0 0 12px rgba(255,204,72,.30);
}
/* Keep the selected navigation tab gold even when the pointer moves over its icon */
.tabnav-btn.active,
.tabnav-btn.active:hover{
  color:#1b1710 !important;
  background:linear-gradient(145deg,#ffe28a,#dcae3d) !important;
  border-color:#ffd45b !important;
  box-shadow:0 0 20px rgba(255,204,72,.42), inset 0 1px rgba(255,255,255,.45) !important;
}


/* v14: inline tab icons + guaranteed visible rating stars */
nav#tabnav .tabnav-btn::before{display:none !important;content:none !important;}
nav#tabnav .tabnav-btn{display:flex !important;align-items:center !important;justify-content:center !important;gap:9px !important;flex-direction:row !important;}
nav#tabnav .tabnav-btn .tab-icon{display:inline-flex !important;align-items:center;justify-content:center;width:30px;height:30px;font-size:23px;line-height:1;color:#dff6ff;text-shadow:0 0 10px rgba(0,195,255,.72);flex:0 0 30px;}
nav#tabnav .tabnav-btn.active .tab-icon{color:#ffd75a !important;text-shadow:0 0 12px rgba(255,202,47,.9) !important;}
nav#tabnav .tabnav-btn:hover .tab-icon{color:#1b1710 !important;text-shadow:none !important;}
.rating-filter-group .rating-chip-list{display:flex !important;flex-direction:column !important;gap:6px !important;max-height:none !important;overflow:visible !important;}
.rating-filter-group .rating-chip{width:100% !important;display:flex !important;align-items:center !important;justify-content:flex-start !important;gap:12px !important;min-height:34px !important;padding:6px 10px !important;box-sizing:border-box !important;}
.rating-filter-group .rating-stars{display:inline-flex !important;white-space:nowrap !important;min-width:100px !important;letter-spacing:2px !important;font-size:17px !important;line-height:1 !important;flex:0 0 100px !important;}
.rating-filter-group .rating-label{font-weight:900 !important;line-height:1.2 !important;}
@media(max-width:560px){nav#tabnav .tabnav-btn{gap:5px !important;}nav#tabnav .tabnav-btn .tab-icon{width:23px;height:23px;font-size:19px;flex-basis:23px}.rating-filter-group .rating-stars{min-width:82px!important;flex-basis:82px!important;font-size:14px!important;letter-spacing:1px!important;}}

/* ============ v15: MAIN TABS — NEON BLUE & WHITE ============ */
nav#tabnav.tabnav{
  background:rgba(4,14,26,.78) !important;
  border:1px solid rgba(0,209,255,.4) !important;
  box-shadow:0 0 30px rgba(0,180,255,.18), inset 0 1px rgba(255,255,255,.05) !important;
}
nav#tabnav .tabnav-btn{
  background:linear-gradient(145deg,#081a2c,#040f1c) !important;
  border:1px solid rgba(0,209,255,.35) !important;
  color:#eaf8ff !important;
  box-shadow:inset 0 1px rgba(255,255,255,.05), 0 0 10px rgba(0,190,255,.10) !important;
}
nav#tabnav .tabnav-btn .tab-icon{
  color:#ffffff !important;
  text-shadow:0 0 10px rgba(0,209,255,.85) !important;
}
nav#tabnav .tabnav-btn:hover{
  color:#ffffff !important;
  background:linear-gradient(145deg,#0e3a5c,#082238) !important;
  border-color:#00d1ff !important;
  box-shadow:0 0 24px rgba(0,209,255,.55), inset 0 1px rgba(255,255,255,.2) !important;
  transform:translateY(-1px);
}
nav#tabnav .tabnav-btn:hover .tab-icon{
  color:#ffffff !important;
  text-shadow:0 0 14px rgba(0,209,255,1) !important;
}
nav#tabnav .tabnav-btn.active,
nav#tabnav .tabnav-btn.active:hover,
.tabnav-btn.active,
.tabnav-btn.active:hover{
  color:#ffffff !important;
  background:linear-gradient(145deg,#00c2ff,#0072b8) !important;
  border-color:#ffffff !important;
  box-shadow:0 0 28px rgba(0,209,255,.75), 0 0 12px rgba(255,255,255,.6), inset 0 1px rgba(255,255,255,.55) !important;
  transform:none !important;
}
nav#tabnav .tabnav-btn.active .tab-icon,
.tabnav-btn.active .tab-icon{
  color:#ffffff !important;
  text-shadow:0 0 16px rgba(255,255,255,1), 0 0 24px rgba(0,209,255,.95) !important;
}
nav#tabnav .tabnav-btn .tab-label{color:inherit !important;}
</style>
</head><body>${clone.outerHTML}</body></html>`;
    if(mode==='excel'){
      const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(title.replace(/[\\/:*?"<>|]/g,'_')||'game_archive')+'.xls';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }else{
      const w=window.open('','_blank','width=1200,height=850');
      if(!w){alert(tr('يرجى السماح بالنوافذ المنبثقة للتصدير والطباعة.'));return;}
      w.document.open();w.document.write(html);w.document.close();
      w.focus();setTimeout(()=>w.print(),500);
    }
  }
  function initExportButtons(){
    document.querySelectorAll('.tab-page').forEach(section=>{
      const head=section.querySelector('.section-head'); if(!head||head.querySelector('.section-tools'))return;
      const tools=document.createElement('div');tools.className='section-tools';
      tools.innerHTML=`<button type="button" class="export-icon-btn pdf" data-export="pdf" title="${tr('تصدير PDF')}" aria-label="${tr('تصدير PDF')}"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 16h2.2a1.5 1.5 0 0 0 0-3H8v5M13 18v-5h2a2.5 2.5 0 0 1 0 5h-2M19 13h-3v5"/></svg></button><button type="button" class="export-icon-btn excel" data-export="excel" title="${tr('تصدير Excel 365')}" aria-label="${tr('تصدير Excel 365')}"><svg viewBox="0 0 24 24"><path d="M4 4h10v16H4zM14 7h6v10h-6z"/><path d="m7 8 4 8M11 8l-4 8"/></svg></button><button type="button" class="export-icon-btn print" data-export="print" title="${tr('طباعة')}" aria-label="${tr('طباعة')}"><svg viewBox="0 0 24 24"><path d="M7 8V4h10v4M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7zM18 12h.01"/></svg></button>`;
      head.appendChild(tools);
      tools.addEventListener('click',e=>{const b=e.target.closest('[data-export]');if(!b)return;const mode=b.dataset.export;exportSectionHTML(section.id,mode==='excel'?'excel':'print');});
    });
  }

  /* ================= INIT ================= */
  renderHeroStats();


  /* ================= GLOBAL RIGHT-CLICK MENU ================= */
  function contextGameFromTarget(target){
    const row=target?.closest?.('.g-row, .dt-table tbody tr');
    if(!row) return null;
    let id=null, game=null, record=null;
    if(row.classList.contains('g-row')) id=Number(row.dataset.id);
    else if(row.dataset.rid){
      record=(Array.isArray(dateRecords)?dateRecords:[]).find(r=>String(r.rid)===String(row.dataset.rid));
      id=record?.gameId!=null?Number(record.gameId):null;
      game=id!=null?GAMES.find(g=>Number(g.id)===id):GAMES.find(g=>normDateSearch(g.name)===normDateSearch(record?.name));
    } else if(row.dataset.sizeId) id=Number(row.dataset.sizeId);
    if(!game && id!=null) game=GAMES.find(g=>Number(g.id)===id);
    if(!game && row.dataset.gameName) game=GAMES.find(g=>normDateSearch(g.name)===normDateSearch(row.dataset.gameName));
    return {row,game,record};
  }
  function getGamePath(g){
    if(!g)return '';
    return String(g.gamePath||g.installPath||g.folderPath||g.path||g.location||g.gameLocation||'').trim();
  }
  function openGameLocation(g){
    const path=getGamePath(g);
    if(!path){
      alert(tr('لا يوجد مسار محفوظ لهذه اللعبة. أضف مسار اللعبة في بياناتها أولاً.'));
      return;
    }
    let url=path;
    if(!/^file:\/\//i.test(url)){
      if(/^[A-Za-z]:[\\/]/.test(url)) url='file:///'+url.replace(/\\/g,'/');
      else if(/^\\\\/.test(url)) url='file:'+url.replace(/\\/g,'/');
      else url='file:///'+url.replace(/\\/g,'/');
    }
    window.open(url,'_blank');
  }
  function contextEditRow(info){
    if(!info?.row)return;
    const row=info.row;
    if(row.classList.contains('g-row')){
      row.classList.add('open');
      snapshotGameEditRow(row);
      setGameEditMode(row,true);
      row.querySelector('[data-edit-field]')?.focus();
      return;
    }
    if(row.dataset.rid){
      const btn=row.querySelector('.dt-edit-btn');
      if(btn){btn.click();return;}
    }
    if(row.dataset.sizeId){
      const btn=row.querySelector('.size-edit');
      if(btn){btn.click();return;}
    }
  }
  function contextEditGame(info){
    if(!info?.game)return;
    openLibraryGameFromReport(info.game.name);
    requestAnimationFrame(()=>{
      const row=document.querySelector(`#results-list .g-row[data-id="${Number(info.game.id)}"]`);
      if(row){snapshotGameEditRow(row);setGameEditMode(row,true);row.querySelector('[data-edit-field]')?.focus();}
    });
  }
  function contextAdd(tabId){
    if(tabId==='library-section'){
      const b=document.getElementById('library-add-game-btn'); if(b)b.click();
    }else if(tabId==='dates-section'){
      document.getElementById('date-add-btn')?.click();
    }else if(tabId==='sizes-section'){
      alert(tr('إضافة سجل حجم تتم من خلال بيانات اللعبة في Library.'));
    }else{
      alert(tr('لا توجد نافذة إضافة مستقلة في هذا التبويب.'));
    }
  }
  function ensureGlobalContextMenu(){
    if(document.getElementById('global-context-menu'))return;
    const menu=document.createElement('div');
    menu.id='global-context-menu';
    menu.className='global-context-menu';
    menu.hidden=true;
    menu.innerHTML=`
      <button type="button" data-context-action="location">📁 <span>${tr('فتح مكان اللعبة')}</span></button>
      <button type="button" data-context-action="row-edit">✏️ <span>${tr('التعديل على السطر')}</span></button>
      <button type="button" data-context-action="game-edit">🎮 <span>${tr('التعديل على اللعبة')}</span></button>
      <div class="context-menu-sep"></div>
      <button type="button" data-context-action="add">＋ <span>${tr('إضافة')}</span></button>`;
    document.body.appendChild(menu);
    let info=null, tabId='';
    const hide=()=>{menu.hidden=true;info=null;};
    document.addEventListener('contextmenu',e=>{
      const page=e.target.closest?.('.tab-page');
      if(!page)return;
      e.preventDefault();
      info=contextGameFromTarget(e.target);
      tabId=page.id;
      menu.querySelector('[data-context-action="location"]').disabled=!info?.game;
      menu.querySelector('[data-context-action="row-edit"]').disabled=!info?.row;
      menu.querySelector('[data-context-action="game-edit"]').disabled=!info?.game;
      const rect=menu.getBoundingClientRect();
      const x=Math.min(e.clientX,window.innerWidth-rect.width-8);
      const y=Math.min(e.clientY,window.innerHeight-rect.height-8);
      menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.hidden=false;
    },true);
    menu.addEventListener('click',e=>{
      const btn=e.target.closest('[data-context-action]'); if(!btn||btn.disabled)return;
      const action=btn.dataset.contextAction;
      // Keep the selected context target before hide() clears the menu state.
      const selectedInfo=info;
      const selectedTabId=tabId;
      hide();
      if(action==='location')openGameLocation(selectedInfo?.game);
      else if(action==='row-edit')contextEditRow(selectedInfo);
      else if(action==='game-edit')contextEditGame(selectedInfo);
      else if(action==='add')contextAdd(selectedTabId);
    });
    document.addEventListener('mousedown',e=>{if(!menu.hidden&&!menu.contains(e.target))hide();});
    document.addEventListener('scroll',hide,true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
  }
  ensureGlobalContextMenu();

  renderDashboard();
  renderDrives();
  initTabs();
  initExportButtons();
  initSearchClearButtons();
  const closeLibraryAddGame=()=>{
    const modal=document.getElementById('library-add-game-modal');
    if(modal) modal.style.display='none';
  };
  const goToLibraryTab=()=>{
    const libraryBtn=document.querySelector('.tabnav-btn[data-tab="library-section"]');
    if(libraryBtn){
      libraryBtn.click();
    }else{
      document.querySelectorAll('.tab-page').forEach(p=>p.classList.toggle('active',p.id==='library-section'));
    }
  };
  document.getElementById('library-add-game-btn')?.addEventListener('click',()=>{const m=document.getElementById('library-add-game-modal');m.style.display='block';renderAddGameForm();if(lang==='en')applyLanguage();});
  document.getElementById('close-library-add')?.addEventListener('click',()=>{closeLibraryAddGame();goToLibraryTab();});
  document.getElementById('library-add-game-modal')?.addEventListener('click',e=>{if(e.target.id==='library-add-game-modal'){closeLibraryAddGame();goToLibraryTab();}});
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape') return;
    const modal=document.getElementById('library-add-game-modal');
    if(!modal || modal.style.display==='none') return;
    e.preventDefault();
    closeLibraryAddGame();
    goToLibraryTab();
  });
  if(lang==='en') applyLanguage();
})();

