/* GameVault — Drive Size Scanner
 * زرار جوة تبويب Sizes: تضيف فولدر الألعاب اللي على كل هارد مرة واحدة، وبعدها "Scan All"
 * يمسح كل الهاردات، يحسب حجم كل فولدر لعبة (وفولدرات السلاسل اللي جواها ألعاب)،
 * ويطابقها مع أسماء المكتبة ويسجل الأحجام تلقائي.
 * محتاج Chrome أو Edge (File System Access API). القراءة فقط — مفيش أي تعديل على ملفاتك.
 */
(function(){
  'use strict';

  const DB_NAME='gameVaultSizeScanner', STORE='sources', MAP_KEY='gameVault_sizeFolderMap_v1';
  const SKIP=/^(\$RECYCLE\.BIN|System Volume Information|\.Trash.*|found\.\d+)$/i;
  const SURE=0.85, MIN=0.6;
  const supported=typeof window.showDirectoryPicker==='function';

  /* ---------- IndexedDB (بنحفظ handles الفولدرات عشان مانختارهاش تاني كل مرة) ---------- */
  function openDB(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
  }
  async function tx(mode,fn){
    const db=await openDB();
    return new Promise((res,rej)=>{
      const t=db.transaction(STORE,mode), st=t.objectStore(STORE); let out;
      Promise.resolve(fn(st)).then(v=>{out=v;}).catch(rej);
      t.oncomplete=()=>{db.close();res(out);}; t.onerror=()=>{db.close();rej(t.error);};
    });
  }
  const req=(r)=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const dbAll=()=>tx('readonly',st=>req(st.getAll()));
  const dbPut=(o)=>tx('readwrite',st=>req(st.put(o)));
  const dbDel=(id)=>tx('readwrite',st=>req(st.delete(id)));

  /* ---------- helpers ---------- */
  const norm=x=>String(x||'').trim().toLowerCase();
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const gbTxt=b=>(b/1073741824).toFixed(2)+' GB';
  const loadMap=()=>{try{return JSON.parse(localStorage.getItem(MAP_KEY)||'{}')||{};}catch(e){return {};}};
  const saveMap=m=>{try{localStorage.setItem(MAP_KEY,JSON.stringify(m));}catch(e){}};
  const mapKey=(drive,folder)=>norm(drive)+'|'+norm(folder);
  const G=()=>window.GameVaultSizes;

  async function ensurePerm(handle){
    const o={mode:'read'};
    try{
      if(await handle.queryPermission(o)==='granted')return true;
      return (await handle.requestPermission(o))==='granted';
    }catch(e){return false;}
  }

  /* ---------- حساب الأحجام ---------- */
  class Cancel extends Error{}
  async function dirSize(dir,ctl){
    let bytes=0; const files=[], dirs=[];
    for await(const [name,h] of dir.entries()){
      if(ctl.cancelled)throw new Cancel();
      if(h.kind==='file')files.push(h); else if(!SKIP.test(name))dirs.push(h);
    }
    for(let i=0;i<files.length;i+=48){
      if(ctl.cancelled)throw new Cancel();
      const part=await Promise.all(files.slice(i,i+48).map(f=>f.getFile().then(x=>x.size).catch(()=>{ctl.errors++;return 0;})));
      for(const n of part)bytes+=n; ctl.files+=part.length; ctl.tick();
    }
    for(const d of dirs){ try{bytes+=await dirSize(d,ctl);}catch(e){ if(e instanceof Cancel)throw e; ctl.errors++; } }
    return bytes;
  }
  // فولدر مستوى أول: بيرجع الإجمالي + أحجام الفولدرات اللي جواه (مستوى تاني) + هل فيه exe مباشرة
  async function walkTop(dir,ctl){
    let total=0, hasExe=false; const files=[], subs=[];
    for await(const [name,h] of dir.entries()){
      if(ctl.cancelled)throw new Cancel();
      if(h.kind==='file'){files.push(h); if(/\.exe$/i.test(name))hasExe=true;}
      else if(!SKIP.test(name))subs.push([name,h]);
    }
    for(let i=0;i<files.length;i+=48){
      const part=await Promise.all(files.slice(i,i+48).map(f=>f.getFile().then(x=>x.size).catch(()=>{ctl.errors++;return 0;})));
      for(const n of part)total+=n; ctl.files+=part.length;
    }
    const out=[];
    for(const [name,h] of subs){
      ctl.sub=name; ctl.tick();
      let b=0; try{b=await dirSize(h,ctl);}catch(e){ if(e instanceof Cancel)throw e; ctl.errors++; }
      out.push({name,bytes:b}); total+=b;
    }
    return {total,hasExe,subs:out};
  }
  async function scanSource(src,ctl){
    const top=[];
    for await(const [name,h] of src.handle.entries()) if(h.kind==='directory'&&!SKIP.test(name))top.push([name,h]);
    top.sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
    const items=[];
    for(let i=0;i<top.length;i++){
      const [name,h]=top[i];
      ctl.cur=`${src.drive} • ${name} (${i+1}/${top.length})`; ctl.sub=''; ctl.tick(true);
      let r; try{r=await walkTop(h,ctl);}catch(e){ if(e instanceof Cancel)throw e; ctl.errors++; continue; }
      items.push({name,level:1,bytes:r.total,path:src.drive+'/'+name});
      // فولدر بدون exe مباشرة = فولدر سلسلة، والفولدرات اللي جواه هي الألعاب الفعلية
      if(!r.hasExe) r.subs.forEach(s=>items.push({name:s.name,level:2,bytes:s.bytes,path:src.drive+'/'+name+'/'+s.name}));
    }
    return items;
  }

  /* ---------- المطابقة + التسجيل ---------- */
  function topCands(name,pool,min,limit){
    const api=G(), out=[];
    pool.forEach(g=>{ const sc=api.similarity(name,g.name); if(sc>=min)out.push({game:g,score:sc}); });
    out.sort((x,y)=>y.score-x.score); return out.slice(0,limit);
  }
  function matchForDrive(src,items){
    const api=G(), map=loadMap();
    const all=api.getAllGames();            // حتى الألعاب اللي سجل حجمها اتمسح — لو لقيناها على الهارد هترجع
    const onDrive=all.filter(g=>norm(g.hdd)===norm(src.drive));
    const cand=onDrive.length?onDrive:all;
    const used=new Set(), remembered=[], rest=[];
    items.forEach(it=>{
      const gid=map[mapKey(src.drive,it.name)]; const g=gid&&all.find(x=>Number(x.id)===Number(gid));
      if(g&&!used.has(g.id)&&it.bytes>0){used.add(g.id);remembered.push({game:g,bytes:it.bytes,folder:it.name});} else rest.push(it);
    });
    const {res,missed}=api.matchSizes(rest,cand.filter(g=>!used.has(g.id)),MIN);
    res.forEach(r=>used.add(r.game.id));
    const sure=res.filter(r=>r.score>=SURE).concat(remembered);
    const maybe=res.filter(r=>r.score<SURE).map(r=>({...r,drive:src.drive,note:''}));
    // فولدرات ملقتش لعبة على الهارد ده: جرّب باقي المكتبة (لعبة مسجلة على هارد تاني) — بتتطلب تأكيد
    if(onDrive.length){
      const left=rest.filter(it=>!res.some(r=>r.folder===it.name));
      const others=all.filter(g=>!used.has(g.id)&&norm(g.hdd)!==norm(src.drive));
      const r2=api.matchSizes(left,others,SURE).res;
      r2.forEach(r=>{used.add(r.game.id);maybe.push({...r,drive:src.drive,note:` (مسجلة على هارد: ${r.game.hdd||'—'})`});});
    }
    // ---- صفوف المراجعة: كل تطابق مش مؤكد + اقتراحات للفولدرات اللي ملقتش لها لعبة ----
    const sureIds=new Set(sure.map(r=>Number(r.game.id)));
    const pool=all.filter(g=>!sureIds.has(Number(g.id)));
    const review=[], nomatch=[];
    maybe.forEach(r=>{
      const alts=topCands(r.folder,pool.filter(g=>g.id!==r.game.id),0.4,4);
      review.push({drive:src.drive,folder:r.folder,bytes:r.bytes,pre:true,cands:[{game:r.game,score:r.score},...alts]});
    });
    const claimed=f=>res.some(r=>r.folder===f)||remembered.some(r=>r.folder===f)||maybe.some(r=>r.folder===f);
    const isContainer=it=>it.level===1&&(/series\s*$/i.test(it.name)||items.some(o=>o.level===2&&o.path.startsWith(it.path+'/')&&claimed(o.name)));
    items.forEach(it=>{
      if(!(it.bytes>0)||claimed(it.name)||isContainer(it))return;
      const c=topCands(it.name,pool,0.4,4);
      if(c.length)review.push({drive:src.drive,folder:it.name,bytes:it.bytes,pre:false,cands:c}); else nomatch.push(it.name);
    });
    return {sure,maybe,missed,review,nomatch};
  }

  /* ---------- نافذة المراجعة: تطابقات مش مؤكدة واقتراحات ---------- */
  function reviewDialog(rows){
    return new Promise(resolve=>{
      const ov=document.createElement('div'); ov.className='ssr-ov';
      const pct=v=>Math.round(v*100)+'%';
      rows.sort((a,b)=>(b.pre-a.pre)||(b.cands[0].score-a.cands[0].score));
      ov.innerHTML=`<div class="ssr-box" dir="rtl">
        <div class="ssr-head"><b>🔍 راجع المطابقات</b><span>اللي عليه ✔ هيتسجل حجمه. غيّر اللعبة من القايمة لو الاقتراح غلط.</span></div>
        <div class="ssr-tools"><button type="button" data-a="all">تحديد الكل</button><button type="button" data-a="none">إلغاء التحديد</button><button type="button" data-a="sure">تحديد المحتمل بس</button></div>
        <div class="ssr-list">${rows.map((r,i)=>`<div class="ssr-row" data-i="${i}">
          <input type="checkbox" class="ssr-ck" ${r.pre?'checked':''}>
          <div class="ssr-f"><b>${esc(r.folder)}</b><small>${esc(r.drive)} • ${gbTxt(r.bytes)}${r.pre?'':' • اقتراح ضعيف'}</small></div>
          <span class="ssr-ar">←</span>
          <select class="ssr-sel">${r.cands.map((c,k)=>`<option value="${k}">${esc(c.game.name)} — ${pct(c.score)}${c.game.hdd?` (${esc(c.game.hdd)})`:''}</option>`).join('')}</select></div>`).join('')}</div>
        <div class="ssr-foot"><button type="button" class="btn" data-a="skip">تجاهل الكل</button><button type="button" class="btn ssr-ok" data-a="ok">✔ سجّل المحدد (<span id="ssr-n">0</span>)</button></div></div>`;
      document.body.appendChild(ov);
      const cks=()=>[...ov.querySelectorAll('.ssr-ck')], upd=()=>{ov.querySelector('#ssr-n').textContent=cks().filter(c=>c.checked).length;};
      ov.addEventListener('change',e=>{ if(e.target.classList.contains('ssr-sel')){ e.target.closest('.ssr-row').querySelector('.ssr-ck').checked=true; } upd(); });
      ov.addEventListener('click',e=>{
        const a=e.target.closest('button')?.dataset.a; if(!a)return;
        if(a==='all')cks().forEach(c=>c.checked=true);
        else if(a==='none')cks().forEach(c=>c.checked=false);
        else if(a==='sure')ov.querySelectorAll('.ssr-row').forEach(rw=>{rw.querySelector('.ssr-ck').checked=!!rows[Number(rw.dataset.i)].pre;});
        else if(a==='skip'){ov.remove();resolve([]);return;}
        else if(a==='ok'){
          const out=[]; ov.querySelectorAll('.ssr-row').forEach(rw=>{
            if(!rw.querySelector('.ssr-ck').checked)return;
            const r=rows[Number(rw.dataset.i)], c=r.cands[Number(rw.querySelector('.ssr-sel').value)];
            out.push({row:r,game:c.game});
          });
          ov.remove(); resolve(out); return;
        }
        upd();
      });
      upd();
    });
  }

  async function runScan(sources,ui){
    const ctl={cancelled:false,files:0,errors:0,cur:'',sub:'',t:0,
      tick(force){const n=Date.now(); if(force||n-this.t>200){this.t=n;ui.progress(this);}}};
    ui.busy(true,ctl);
    const warns=[], reviewAll=[], nomatchAll=[], drivesScanned=new Set(), scannedIds=new Set(), foundIds=new Set();
    let applied=0, sureN=0, approvedN=0, rejectedN=0, allSrc=[];
    try{ allSrc=await dbAll(); }catch(e){}
    try{
      // اطلب الصلاحيات كلها الأول (طالما لسه الضغطة على الزرار صالحة)
      const okSrc=[];
      for(const s of sources){
        if(await ensurePerm(s.handle))okSrc.push(s);
        else warns.push(`⚠️ ${s.drive} — «${s.name}»: مفيش صلاحية قراءة (اضغط Scan للفولدر ده لوحده ووافق على الإذن).`);
      }
      for(const s of okSrc){
        let items;
        try{items=await scanSource(s,ctl);}
        catch(e){ if(e instanceof Cancel){warns.push('⏹ اتلغى الفحص.');break;} warns.push(`❌ ${s.drive} — «${s.name}»: ${e.message||e}`); continue; }
        const m=matchForDrive(s,items);
        const n=G().apply(m.sure.map(r=>({id:r.game.id,bytes:r.bytes})));
        applied+=n; sureN+=n; m.sure.forEach(r=>foundIds.add(Number(r.game.id)));
        reviewAll.push(...m.review); nomatchAll.push(...m.nomatch.map(n=>`${s.drive}: ${n}`));
        drivesScanned.add(s.drive); scannedIds.add(s.id);
        s.lastScan=Date.now(); s.lastCount=n+m.maybe.length; s.lastBytes=m.sure.reduce((a,r)=>a+r.bytes,0);
        await dbPut(s);
      }
      // المطابقات غير المؤكدة + الاقتراحات: نافذة مراجعة واحدة في الآخر
      const ignored=[];
      if(reviewAll.length && !ctl.cancelled){
        ui.progress({cur:'في انتظار مراجعتك للمطابقات...',sub:'',files:ctl.files});
        const picked=await reviewDialog(reviewAll.slice());
        const seen=new Set(), take=[], chosenRows=new Set();
        picked.forEach(p=>{ if(seen.has(Number(p.game.id)))return; seen.add(Number(p.game.id)); take.push(p); chosenRows.add(p.row); });
        const n=G().apply(take.map(p=>({id:p.game.id,bytes:p.row.bytes}))); applied+=n; approvedN=n;
        const map=loadMap(); take.forEach(p=>{ foundIds.add(Number(p.game.id)); map[mapKey(p.row.drive,p.row.folder)]=p.game.id; }); saveMap(map);
        rejectedN=reviewAll.length-take.length;
        reviewAll.forEach(r=>{ if(!chosenRows.has(r))ignored.push(`${r.drive}: ${r.folder}`); });
      }
      ignored.push(...nomatchAll);
      // علامات الجدول: الأزرق = اتلقى، X أحمر = لعبة مسجلة على هارد اتفحص كله ومالقيناش لها فولدر
      const missingIds=new Set();
      drivesScanned.forEach(d=>{
        const full=allSrc.filter(x=>norm(x.drive)===norm(d)).every(x=>scannedIds.has(x.id));
        if(!full)return;
        G().getGames().filter(g=>norm(g.hdd)===norm(d)&&!foundIds.has(Number(g.id))).forEach(g=>missingIds.add(Number(g.id)));
      });
      G().setScanStatus([...foundIds],[...missingIds]);
      ctl.result={sure:sureN,approved:approvedN,rejected:rejectedN,missing:missingIds.size,ignored};
    }finally{
      G().refresh();
      ui.busy(false,ctl);
      ui.report(ctl.result,warns,ctl);
      ui.renderSources();
    }
  }

  /* ---------- الواجهة ---------- */
  function injectCSS(){
    const st=document.createElement('style');
    st.textContent=`
    #size-scan-panel{margin:0 0 14px;padding:12px 14px;border:1px solid var(--line-strong,rgba(232,224,199,.28));border-radius:12px;background:rgba(0,0,0,.18)}
    #size-scan-panel .ssp-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
    #size-scan-panel .ssp-head b{color:var(--brass-bright,#E3B15C);margin-inline-end:auto}
    .ssp-src{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 0;border-top:1px dashed var(--line-strong,rgba(232,224,199,.2))}
    .ssp-src .d{font-weight:700;color:var(--brass-bright,#E3B15C);min-width:80px}
    .ssp-src .f{color:var(--parchment,#E8E0C7)}
    .ssp-src .m{color:var(--muted,#8A8B76);font-size:12px;margin-inline-start:auto}
    .ssp-src button,#size-scan-panel .ssp-head button{cursor:pointer}
    #size-scan-progress{display:none;margin-top:8px;font-family:var(--font-mono,monospace);font-size:12.5px;color:var(--verdigris-bright,#7BAF97);word-break:break-all}
    #size-scan-report{display:none;margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.25);font-size:12.5px;line-height:1.6;max-height:160px;overflow:auto}
    #size-scan-report .ssp-sum{display:flex;gap:10px;flex-wrap:wrap}
    #size-scan-report .ssp-stat{display:flex;align-items:center;gap:8px;padding:5px 12px;border-radius:8px;background:rgba(255,255,255,.06)}
    #size-scan-report .ssp-stat b{font-size:18px}
    #size-scan-report .ssp-stat.ok b{color:#2f8bff}
    #size-scan-report .ssp-stat.maybe b{color:#e3b15c}
    #size-scan-report .ssp-stat.miss b{color:#e5484d}
    #size-scan-report .ssp-warns{margin-top:6px;color:var(--rust,#d98a5f)}
    .ssp-warn{color:var(--rust,#B5502F);font-size:13px}
    #size-scan-report .ssp-ign{margin-top:6px;font-size:12px;color:#b8c4d2}
    #size-scan-report .ssp-ign summary{cursor:pointer}
    #size-scan-report .ssp-ign div{margin-top:4px;max-height:110px;overflow:auto;direction:ltr;text-align:left;opacity:.85}
    .ssr-ov{position:fixed;inset:0;z-index:99999;background:rgba(3,8,16,.78);display:flex;align-items:center;justify-content:center;padding:14px}
    .ssr-box{width:min(960px,100%);max-height:90vh;display:flex;flex-direction:column;border-radius:16px;border:1px solid rgba(47,139,255,.4);background:linear-gradient(160deg,#10223a,#0a1527);color:#e8eef6;box-shadow:0 20px 60px rgba(0,0,0,.6)}
    .ssr-head{padding:14px 18px 6px;display:flex;flex-direction:column;gap:3px}.ssr-head b{font-size:18px}.ssr-head span{font-size:12.5px;color:#9aa6b5}
    .ssr-tools{display:flex;gap:8px;padding:6px 18px 10px;flex-wrap:wrap}
    .ssr-tools button{cursor:pointer;padding:4px 12px;border-radius:8px;border:1px solid rgba(130,170,210,.3);background:rgba(255,255,255,.06);color:#cfd8e3;font-size:12px}
    .ssr-list{overflow:auto;padding:0 12px;flex:1}
    .ssr-row{display:flex;align-items:center;gap:10px;padding:8px 8px;border-top:1px solid rgba(130,170,210,.14)}
    .ssr-ck{width:18px;height:18px;flex:0 0 auto;accent-color:#2f8bff}
    .ssr-f{flex:1 1 38%;min-width:0;direction:ltr;text-align:left;display:flex;flex-direction:column;gap:2px}
    .ssr-f b{font-size:13px;word-break:break-word}.ssr-f small{font-size:11px;color:#9aa6b5}
    .ssr-ar{color:#2f8bff;font-size:16px}
    .ssr-sel{flex:1 1 44%;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid rgba(130,170,210,.35);background:#0e1b2d;color:#fff;font-size:12.5px;direction:ltr}
    .ssr-foot{display:flex;justify-content:space-between;gap:10px;padding:12px 18px;border-top:1px solid rgba(130,170,210,.2)}
    .ssr-ok{border-color:#2f8bff !important;background:rgba(47,139,255,.22) !important;font-weight:700}
    @media(max-width:700px){.ssr-row{flex-wrap:wrap}.ssr-ar{display:none}.ssr-f,.ssr-sel{flex:1 1 100%}}`;
    document.head.appendChild(st);
  }

  function init(){
    const sec=document.getElementById('sizes-section'), wrap=document.getElementById('sizes-wrap');
    if(!sec||!wrap||document.getElementById('size-scan-panel'))return;
    injectCSS();
    const panel=document.createElement('div'); panel.id='size-scan-panel';
    panel.innerHTML=`<div class="ssp-head"><b>🔎 فحص الهاردات وتسجيل الأحجام تلقائي</b>
      <button class="btn" id="ssp-add" type="button" title="اختار فولدر الألعاب اللي على هارد معين">📁 إضافة فولدر هارد</button>
      <button class="btn" id="ssp-all" type="button" title="امسح كل الفولدرات المضافة وسجّل الأحجام">🔄 Scan All Drives</button>
      <button class="btn" id="ssp-cancel" type="button" hidden>⏹ إلغاء</button></div>
      <div id="ssp-list"></div><div id="size-scan-progress"></div><div id="size-scan-report"></div>`;
    wrap.parentNode.insertBefore(panel,wrap);
    const $=id=>panel.querySelector(id), list=$('#ssp-list'), prog=$('#size-scan-progress'), rep=$('#size-scan-report');
    let current=null;

    const ui={
      busy(on,ctl){ current=on?ctl:null; $('#ssp-cancel').hidden=!on; $('#ssp-all').disabled=on; $('#ssp-add').disabled=on;
        list.querySelectorAll('button').forEach(b=>b.disabled=on); prog.style.display=on?'block':'none'; if(on){rep.style.display='none';} },
      progress(c){ prog.textContent=`⏳ ${c.cur}${c.sub?' › '+c.sub:''} — ${c.files.toLocaleString('en-US')} ملف`; },
      report(r,warns,ctl){
        const w=(warns||[]).slice();
        if(ctl&&ctl.errors)w.push(`⚠️ ${ctl.errors} ملف/فولدر ما اتقرأش.`);
        rep.innerHTML=(r?`<div class="ssp-sum">
          <div class="ssp-stat ok"><b>${r.sure}</b><span>لقاهم ودوّن أحجامهم</span></div>
          <div class="ssp-stat maybe"><b>${r.approved}</b><span>كان شاكك فيهم ووافقت عليهم</span></div>
          <div class="ssp-stat miss"><b>${r.missing}</b><span>مالقاهمش</span></div></div>`:'')
          +(r&&r.ignored&&r.ignored.length?`<details class="ssp-ign"><summary>📂 ${r.ignored.length} فولدر ماتسجلش (مالقيتش لهم لعبة أو اتجاهلوا)</summary><div>${r.ignored.slice(0,300).map(esc).join('<br>')}</div></details>`:'')
          +(w.length?`<div class="ssp-warns">${w.map(esc).join('<br>')}</div>`:'');
        rep.style.display='block'; },
      renderSources
    };

    async function renderSources(){
      if(!supported){ list.innerHTML='<div class="ssp-warn">المتصفح ده مش بيدعم قراءة الفولدرات. افتح الموقع من Chrome أو Edge.</div>'; $('#ssp-add').disabled=true; $('#ssp-all').disabled=true; return; }
      const src=(await dbAll()).sort((a,b)=>String(a.drive).localeCompare(String(b.drive),undefined,{numeric:true}));
      list.innerHTML=src.length?src.map(s=>`<div class="ssp-src" data-id="${s.id}">
        <span class="d">${esc(s.drive)}</span><span class="f">📁 ${esc(s.name)}</span>
        <span class="m">${s.lastScan?`آخر فحص: ${new Date(s.lastScan).toLocaleString('ar-EG')} • ${s.lastCount||0} لعبة • ${gbTxt(s.lastBytes||0)}`:'لسه ما اتفحصش'}</span>
        <button class="btn ssp-one" type="button">Scan</button><button class="btn ssp-del" type="button" title="شيل الفولدر من القائمة">✖</button></div>`).join('')
        :'<div class="ssp-warn" style="opacity:.85">مفيش هاردات مضافة. دوس «إضافة فولدر هارد» واختار فولدر الألعاب على كل هارد (مرة واحدة بس).</div>';
      list.querySelectorAll('.ssp-src').forEach(row=>{
        const id=Number(row.dataset.id), s=src.find(x=>x.id===id);
        row.querySelector('.ssp-one').onclick=()=>runScan([s],ui);
        row.querySelector('.ssp-del').onclick=async()=>{ if(confirm(`شيل «${s.drive} — ${s.name}» من القائمة؟ (مش هيمسح أي أحجام متسجلة)`)){await dbDel(id);renderSources();} };
      });
    }

    $('#ssp-add').onclick=async()=>{
      let handle; try{handle=await window.showDirectoryPicker({id:'gv-games',mode:'read'});}catch(e){return;}
      const drives=G().getDrives().filter(d=>norm(d)!=='deleted');
      let d=prompt(`اكتب اسم الهارد اللي الفولدر ده عليه — لازم يطابق عمود «الهارد» في المكتبة:\n${drives.join(' / ')}`,'');
      if(d==null)return; d=d.trim(); if(!d)return;
      const known=G().getDrives().find(x=>norm(x)===norm(d));
      if(known)d=known; else if(!confirm(`«${d}» مش موجود ضمن أسماء الهاردات الحالية. تكمل بيه؟`))return;
      for(const s of await dbAll()){ try{ if(await s.handle.isSameEntry(handle)){alert('الفولدر ده مضاف قبل كده.');return;} }catch(e){} }
      await dbPut({drive:d,name:handle.name,handle,lastScan:0,lastCount:0,lastBytes:0});
      await renderSources();
    };
    $('#ssp-all').onclick=async()=>{
      const src=await dbAll(); if(!src.length){alert('أضف فولدر هارد الأول.');return;}
      runScan(src,ui);
    };
    $('#ssp-cancel').onclick=()=>{ if(current)current.cancelled=true; };
    renderSources();
  }

  function boot(){
    const t=setInterval(()=>{ if(window.GameVaultSizes&&document.getElementById('sizes-wrap')){clearInterval(t);init();} },300);
    setTimeout(()=>clearInterval(t),60000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
})();
