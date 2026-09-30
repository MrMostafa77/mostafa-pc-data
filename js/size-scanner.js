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
  function matchForDrive(src,items){
    const api=G(), map=loadMap();
    const all=api.getGames();
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
    return {sure,maybe,missed,matchedIds:new Set([...sure.map(r=>r.game.id),...maybe.map(r=>r.game.id)])};
  }

  async function runScan(sources,ui){
    const ctl={cancelled:false,files:0,errors:0,cur:'',sub:'',t:0,
      tick(force){const n=Date.now(); if(force||n-this.t>200){this.t=n;ui.progress(this);}}};
    ui.busy(true,ctl);
    const log=[], maybeAll=[], driveMatched={}, drivesScanned=new Set();
    let applied=0, totalBytes=0;
    try{
      // اطلب الصلاحيات كلها الأول (طالما لسه الضغطة على الزرار صالحة)
      const okSrc=[];
      for(const s of sources){
        if(await ensurePerm(s.handle))okSrc.push(s);
        else log.push(`⚠️ ${s.drive} — «${s.name}»: مفيش صلاحية قراءة. اضغط Scan بتاع الفولدر ده لوحده ووافق على الإذن.`);
      }
      for(const s of okSrc){
        let items;
        try{items=await scanSource(s,ctl);}
        catch(e){ if(e instanceof Cancel){log.push('⏹ اتلغى الفحص.');break;} log.push(`❌ ${s.drive} — «${s.name}»: ${e.message||e}`); continue; }
        const m=matchForDrive(s,items);
        const n=G().apply(m.sure.map(r=>({id:r.game.id,bytes:r.bytes})));
        applied+=n; m.sure.forEach(r=>totalBytes+=r.bytes);
        maybeAll.push(...m.maybe);
        (driveMatched[norm(s.drive)]=driveMatched[norm(s.drive)]||new Set());
        m.matchedIds.forEach(id=>driveMatched[norm(s.drive)].add(id)); drivesScanned.add(s.drive);
        s.lastScan=Date.now(); s.lastCount=n+m.maybe.length; s.lastBytes=m.sure.reduce((a,r)=>a+r.bytes,0);
        await dbPut(s);
        log.push(`✅ ${s.drive} — «${s.name}»: ${items.filter(i=>i.level===1).length} فولدر، اتسجل ${n} لعبة`+(m.maybe.length?` (+${m.maybe.length} محتاجة تأكيد)`:'')+`.`);
        if(m.missed.length)log.push(`   فولدرات ملقتش لها لعبة في المكتبة (${m.missed.length}): `+m.missed.slice(0,25).join(' | ')+(m.missed.length>25?' ...':''));
      }
      // ألعاب مسجلة على الهارد في المكتبة ومالقيناش لها فولدر
      drivesScanned.forEach(d=>{
        const set=driveMatched[norm(d)]||new Set();
        const gone=G().getGames().filter(g=>norm(g.hdd)===norm(d)&&!set.has(g.id));
        if(gone.length)log.push(`ℹ️ ${gone.length} لعبة مسجلة على «${d}» ومالقيتش فولدر ليها (أحجامها ما اتغيرتش): `+gone.slice(0,25).map(g=>g.name).join(' | ')+(gone.length>25?' ...':''));
      });
      // المطابقات غير المؤكدة: سؤال واحد في الآخر
      if(maybeAll.length && !ctl.cancelled){
        const txt=maybeAll.map(r=>`• [${r.drive}] ${r.folder}  ←→  ${r.game.name}${r.note}`).join('\n');
        if(confirm(`${maybeAll.length} تطابق مش مؤكد 100%، راجعهم:\n\n${txt.slice(0,1800)}${txt.length>1800?'\n...':''}\n\nموافق = سجّلهم وافتكرهم للمرات الجاية، إلغاء = تجاهلهم.`)){
          const n=G().apply(maybeAll.map(r=>({id:r.game.id,bytes:r.bytes}))); applied+=n;
          const map=loadMap(); maybeAll.forEach(r=>{map[mapKey(r.drive,r.folder)]=r.game.id;}); saveMap(map);
          log.push(`✅ اتسجل ${n} تطابق بعد تأكيدك.`);
        } else log.push(`↩️ اتجاهل ${maybeAll.length} تطابق غير مؤكد.`);
      }
    }finally{
      G().refresh();
      ui.busy(false,ctl);
      ui.report([`تم تسجيل ${applied} حجم لعبة — قريت ${ctl.files.toLocaleString('en-US')} ملف`+(ctl.errors?` (${ctl.errors} ملف/فولدر ما اتقرأش)`:'')+'.',...log].join('\n'));
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
    #size-scan-report{display:none;margin-top:10px;padding:10px;border-radius:8px;background:rgba(0,0,0,.25);white-space:pre-wrap;font-size:12.5px;line-height:1.7;max-height:280px;overflow:auto}
    .ssp-warn{color:var(--rust,#B5502F);font-size:13px}`;
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
      report(t){ rep.textContent=t; rep.style.display='block'; },
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
