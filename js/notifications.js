/* GameVault Notifications — old shared project, no account system required yet. */
(function(){
  'use strict';
  const STORE='gameVault_notifications_v1';
  const SEEN='gameVault_notification_seen_v1';
  const MAX=40;
  let items=load();
  let panel=null;

  function load(){try{return JSON.parse(localStorage.getItem(STORE)||'[]')||[]}catch(e){return[]}}
  function save(){try{localStorage.setItem(STORE,JSON.stringify(items.slice(0,MAX)));}catch(e){}}
  function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function titleFor(keys){
    const k=new Set(keys||[]);
    if(k.has('gameVault_dateRecords_v4')) return ['🎮 Game Dates updated','A game date/play record was changed on another device.'];
    if(k.has('gameVault_userGames_v1')||k.has('gameVault_fieldOverrides_v1')||k.has('mostafa_pc_deleted_games_v1')) return ['📚 Library updated','The game library was changed on another device.'];
    if(k.has('gameVault_favorites_v1')) return ['⭐ Favorites updated','Favorites were changed on another device.'];
    if(k.has('gameVault_gameTags_v1')) return ['🏷️ Tags updated','Game tags were changed on another device.'];
    if(k.has('gameVault_sizeOverrides_v1')||k.has('gameVault_sizeDeleted_v1')||k.has('gameVault_driveCapacities_v1')) return ['💾 Storage data updated','Storage information was changed on another device.'];
    return ['🔄 GameVault updated','Data was changed on another device.'];
  }

  /* ===== Detailed notifications: which game, which tab, who edited, click-to-open ===== */
  const TAB_NAMES={
    home:{ar:'الرئيسية',en:'Home',icon:'🏠'},
    drives:{ar:'الهاردات',en:'Drives',icon:'🗄️'},
    library:{ar:'المكتبة',en:'Library',icon:'📚'},
    sizes:{ar:'الأحجام',en:'Sizes',icon:'💾'},
    dates:{ar:'تواريخ الألعاب',en:'Game Dates',icon:'🎮'}
  };
  const TAB_IDS={home:'dashboard-section',drives:'drives-section',library:'library-section',sizes:'sizes-section',dates:'dates-section'};
  const VERBS={
    edited:{ar:'اتعدلت',en:'was edited'},
    added:{ar:'اتضافت',en:'was added'},
    deleted:{ar:'اتحذفت',en:'was deleted'},
    fav_add:{ar:'اتضافت للمفضلة',en:'was added to Favorites'},
    fav_remove:{ar:'اتشالت من المفضلة',en:'was removed from Favorites'},
    tags_edited:{ar:'اتعدلت التاجات بتاعتها',en:'had its tags edited'},
    date_added:{ar:'اتضاف ليها سجل لعب',en:'got a new play record'},
    date_edited:{ar:'اتعدل ليها سجل لعب',en:'had a play record edited'},
    date_deleted:{ar:'اتحذف منها سجل لعب',en:'had a play record deleted'},
    size_edited:{ar:'اتعدل حجمها',en:'had its size edited'},
    size_deleted:{ar:'اتحذف سجل حجمها',en:'had its size record deleted'},
    upcoming_add:{ar:'اتضافت للألعاب القادمة',en:'was added to Upcoming games'},
    upcoming_remove:{ar:'اتشالت من الألعاب القادمة',en:'was removed from Upcoming games'}
  };
  const GENERIC_TEXT={
    drives:{ar:'بيانات الهاردات اتعدلت',en:'Drives data was edited'},
    date_options:{ar:'خيارات تواريخ الألعاب اتعدلت',en:'Game Dates options were edited'},
    other:{ar:'بيانات الموقع اتعدلت',en:'Site data was edited'}
  };
  const MANY_LIMIT=4;

  function curLang(){ try{ return localStorage.getItem('gameVault_lang_v1')==='ar'?'ar':'en'; }catch(e){ return 'en'; } }
  function parse(v){ try{ return (v==null||v==='')?null:JSON.parse(v); }catch(e){ return null; } }
  function asArray(v){ return Array.isArray(v)?v:[]; }
  function asObject(v){ return (v&&typeof v==='object'&&!Array.isArray(v))?v:{}; }
  function same(a,b){ try{ return JSON.stringify(a)===JSON.stringify(b); }catch(e){ return false; } }

  function nameMap(prev){
    const map={};
    try{ asArray(window.GameVaultData&&window.GameVaultData.games).forEach(g=>{ if(g&&g.id!=null) map[g.id]=g.name; }); }catch(e){}
    try{ asArray(parse(prev&&prev['gameVault_userGames_v1'])).forEach(g=>{ if(g&&g.id!=null) map[g.id]=g.name; }); }catch(e){}
    try{ asArray(parse(localStorage.getItem('gameVault_userGames_v1'))).forEach(g=>{ if(g&&g.id!=null) map[g.id]=g.name; }); }catch(e){}
    return map;
  }
  function changedFields(a,b){
    a=asObject(a); b=asObject(b);
    const f=[]; new Set(Object.keys(a).concat(Object.keys(b))).forEach(k=>{ if(!same(a[k],b[k])) f.push(k); });
    return f;
  }
  function fieldsDetail(list){ return list.length?list.slice(0,3).join(', ')+(list.length>3?'…':''):''; }
  function idSet(v){ return new Set(asArray(v).map(Number)); }

  // returns [{kind, game, tab, detail, target}] for ONE changed key
  function describeKey(key,oldRaw,names){
    const oldV=parse(oldRaw), newV=parse(localStorage.getItem(key));
    const out=[];
    const gname=id=>names[id]||('#'+id);
    const libTarget=id=>({tab:'library',name:names[id]||'',gameId:id});
    switch(key){
      case 'gameVault_userGames_v1':{
        const o={},n={}; asArray(oldV).forEach(g=>{ if(g) o[g.id]=g; }); asArray(newV).forEach(g=>{ if(g) n[g.id]=g; });
        Object.keys(n).forEach(id=>{
          if(!o[id]) out.push({kind:'added',game:n[id].name,tab:'library',target:libTarget(id)});
          else if(!same(o[id],n[id])) out.push({kind:'edited',game:n[id].name,tab:'library',detail:fieldsDetail(changedFields(o[id],n[id])),target:libTarget(id)});
        });
        Object.keys(o).forEach(id=>{ if(!n[id]) out.push({kind:'deleted',game:o[id].name,tab:'library',target:{tab:'library'}}); });
        break;}
      case 'gameVault_fieldOverrides_v1':{
        const o=asObject(oldV), n=asObject(newV);
        new Set(Object.keys(o).concat(Object.keys(n))).forEach(id=>{
          if(same(o[id],n[id])) return;
          out.push({kind:'edited',game:gname(id),tab:'library',detail:fieldsDetail(changedFields(o[id],n[id])),target:libTarget(id)});
        });
        break;}
      case 'mostafa_pc_deleted_games_v1':{
        const o=idSet(oldV); idSet(newV).forEach(id=>{ if(!o.has(id)) out.push({kind:'deleted',game:gname(id),tab:'library',target:{tab:'library'}}); });
        break;}
      case 'gameVault_dateRecords_v4':{
        const o={},n={}; asArray(oldV).forEach(r=>{ if(r) o[r.rid]=r; }); asArray(newV).forEach(r=>{ if(r) n[r.rid]=r; });
        Object.keys(n).forEach(rid=>{
          const t={tab:'dates',name:n[rid].name,rid:rid};
          if(!o[rid]) out.push({kind:'date_added',game:n[rid].name,tab:'dates',target:t});
          else if(!same(o[rid],n[rid])) out.push({kind:'date_edited',game:n[rid].name,tab:'dates',detail:fieldsDetail(changedFields(o[rid],n[rid])),target:t});
        });
        Object.keys(o).forEach(rid=>{ if(!n[rid]) out.push({kind:'date_deleted',game:o[rid].name,tab:'dates',target:{tab:'dates',name:o[rid].name}}); });
        break;}
      case 'gameVault_sizeOverrides_v1':{
        const o=asObject(oldV), n=asObject(newV);
        new Set(Object.keys(o).concat(Object.keys(n))).forEach(id=>{
          if(same(o[id],n[id])) return;
          const a=(o[id]==null?'—':o[id]), b=(n[id]==null?'—':n[id]);
          out.push({kind:'size_edited',game:gname(id),tab:'sizes',detail:a+' → '+b+' GB',target:{tab:'sizes',name:names[id]||'',gameId:id}});
        });
        break;}
      case 'gameVault_sizeDeleted_v1':{
        const o=idSet(oldV); idSet(newV).forEach(id=>{ if(!o.has(id)) out.push({kind:'size_deleted',game:gname(id),tab:'sizes',target:{tab:'sizes'}}); });
        break;}
      case 'gameVault_favorites_v1':{
        const o=idSet(oldV), n=idSet(newV);
        n.forEach(id=>{ if(!o.has(id)) out.push({kind:'fav_add',game:gname(id),tab:'library',target:libTarget(id)}); });
        o.forEach(id=>{ if(!n.has(id)) out.push({kind:'fav_remove',game:gname(id),tab:'library',target:libTarget(id)}); });
        break;}
      case 'gameVault_gameTags_v1':{
        const o=asObject(oldV), n=asObject(newV);
        new Set(Object.keys(o).concat(Object.keys(n))).forEach(id=>{
          if(same(o[id],n[id])) return;
          out.push({kind:'tags_edited',game:gname(id),tab:'library',detail:asArray(n[id]).join(', '),target:libTarget(id)});
        });
        break;}
      case 'gameVault_upcomingGames_v1':{
        const o=idSet(oldV), n=idSet(newV);
        n.forEach(id=>{ if(!o.has(id)) out.push({kind:'upcoming_add',game:gname(id),tab:'home',target:{tab:'home'}}); });
        o.forEach(id=>{ if(!n.has(id)) out.push({kind:'upcoming_remove',game:gname(id),tab:'home',target:{tab:'home'}}); });
        break;}
      case 'gameVault_driveCapacities_v1': case 'gameVault_hiddenDrives_v1': case 'gameVault_driveOtherSpace_v1':
        out.push({kind:'generic',text:'drives',tab:'drives',target:{tab:'drives'}}); break;
      case 'mostafa_pc_date_options_v1':
        out.push({kind:'generic',text:'date_options',tab:'dates',target:{tab:'dates'}}); break;
      default:
        out.push({kind:'generic',text:'other',tab:'home',target:{tab:'home'}});
    }
    return out;
  }

  // Whole cloud-update event -> list of structured notifications
  function describeChanges(detail){
    const keys=(detail&&detail.keys)||[], prev=(detail&&detail.prev)||{}, by=(detail&&detail.by)||{};
    const names=nameMap(prev), seen=new Set(), result=[];
    keys.forEach(key=>{
      let list=[];
      try{ list=describeKey(key,prev[key],names); }catch(e){ list=[]; }
      if(!list.length) return;
      const who=by[key]||'';
      if(list.length>MANY_LIMIT){
        list=[{kind:'many',count:list.length,tab:list[0].tab,target:{tab:list[0].tab}}];
      }
      list.forEach(c=>{
        c.by=who;
        const sig=[c.tab,c.kind,c.game||'',c.text||''].join('|');
        if(seen.has(sig)) return; seen.add(sig);
        result.push(c);
      });
    });
    return result;
  }

  function tabLabel(tab,lang){ const t=TAB_NAMES[tab]||TAB_NAMES.home; return t[lang]; }
  function sentence(c,lang){
    lang=lang||curLang();
    const who=c.by||(lang==='ar'?'مستخدم آخر':'another user');
    const tab=tabLabel(c.tab,lang);
    if(c.kind==='many') return lang==='ar'
      ? c.count+' تعديلات في التبويب ('+tab+') بواسطة ('+who+')'
      : c.count+' changes in tab ('+tab+') by ('+who+')';
    if(c.kind==='generic'){ const g=GENERIC_TEXT[c.text]||GENERIC_TEXT.other; return lang==='ar'
      ? g.ar+' في التبويب ('+tab+') بواسطة ('+who+')'
      : g.en+' in tab ('+tab+') by ('+who+')'; }
    const v=(VERBS[c.kind]||VERBS.edited)[lang];
    return lang==='ar'
      ? 'اللعبة ('+c.game+') في التبويب ('+tab+') '+v+' بواسطة ('+who+')'
      : 'Game ('+c.game+') in tab ('+tab+') '+v+' by ('+who+')';
  }
  function headline(c,lang){ const t=TAB_NAMES[c.tab]||TAB_NAMES.home; return t.icon+' '+t[lang||curLang()]; }

  /* ===== click on a notification -> open the place of the edit ===== */
  function hitStyle(){
    if(document.getElementById('gv-notify-style')) return;
    const st=document.createElement('style'); st.id='gv-notify-style';
    st.textContent='.notify-item.clickable{cursor:pointer;transition:border-color .15s,background .15s}'
      +'.notify-item.clickable:hover{border-color:#d9a64f;background:rgba(217,166,79,.10)}'
      +'.notify-item small{display:block;margin-top:3px;color:#d9b36a;font-size:11px}'
      +'@keyframes gvNotifyHit{0%,100%{box-shadow:0 0 0 0 rgba(255,215,126,0)}30%,70%{box-shadow:0 0 0 3px rgba(255,215,126,.9)}}'
      +'.gv-notify-hit{animation:gvNotifyHit 1.8s ease 1;outline:2px solid rgba(255,215,126,.55);outline-offset:-2px}';
    document.head.appendChild(st);
  }
  function flash(row){
    row.scrollIntoView({behavior:'smooth',block:'center'});
    row.classList.add('gv-notify-hit'); setTimeout(()=>row.classList.remove('gv-notify-hit'),2000);
  }
  function findRow(t){
    try{
      if(t.tab==='dates'&&t.rid) return document.querySelector('#dates-wrap tr[data-rid="'+CSS.escape(String(t.rid))+'"]');
      if(t.tab==='sizes'&&t.gameId!=null) return document.querySelector('tr[data-size-id="'+CSS.escape(String(t.gameId))+'"]');
    }catch(e){}
    return null;
  }
  function focusRow(t,tries){
    let row=findRow(t);
    if(row){ flash(row); return; }
    if(tries===0 && t.name){ // not on the visible page -> filter by the game name, then look again
      const inp=document.getElementById(t.tab==='dates'?'dates-search-input':'sizes-search-input');
      if(inp){ inp.value=t.name; inp.dispatchEvent(new Event('input',{bubbles:true})); }
    }
    if(tries<4) setTimeout(()=>focusRow(t,tries+1),300);
  }
  function go(t){
    if(!t||!t.tab) return;
    try{ if(panel) panel.hidden=true; }catch(e){}
    try{ window.focus(); }catch(e){}
    if(t.tab==='library'&&t.name&&typeof window.__gvOpenLibraryGame==='function'){
      if(window.__gvOpenLibraryGame(t.name)) return;
    }
    const btn=document.querySelector('.tabnav-btn[data-tab="'+TAB_IDS[t.tab]+'"]');
    if(btn) btn.click();
    if((t.tab==='dates'&&t.rid)||(t.tab==='sizes'&&t.gameId!=null)) setTimeout(()=>focusRow(t,0),350);
  }

  function add(title,msg,extra){
    const now=Date.now();
    const sig=extra&&extra.c?[extra.c.tab,extra.c.kind,extra.c.game||'',extra.c.text||'',extra.c.by||''].join('|'):title;
    if(items.slice(0,10).some(x=>(x.sig||x.title)===sig && now-x.time<2500)) return;
    const it={title,msg,time:now,sig};
    if(extra&&extra.c){ it.c=extra.c; it.target=extra.c.target; }
    items.unshift(it); save(); updateBadge(); render();
  }
  function browserNotify(title,msg,target){
    if(!('Notification' in window) || Notification.permission!=='granted') return;
    try{ const n=new Notification(title,{body:msg,icon:'assets/hero-logo-banner.png',tag:'gamevault-update'}); n.onclick=()=>{window.focus();n.close();if(target)go(target);}; }catch(e){}
  }
  window.browserNotifyForPush=browserNotify;

  function updateBadge(){
    const badge=document.getElementById('notifications-badge');
    if(!badge) return;
    let seen=0; try{seen=Number(localStorage.getItem(SEEN)||0)}catch(e){}
    const unread=Math.max(0,items.length-seen);
    badge.textContent=String(unread); badge.hidden=unread===0;
  }
  function render(){
    if(!panel) return;
    const list=panel.querySelector('.notify-list');
    if(!items.length){list.innerHTML='<div class="notify-empty">No notifications yet.</div>';return;}
    const lang=curLang();
    list.innerHTML=items.map((x,i)=>{
      const time=' · '+new Date(x.time).toLocaleString();
      if(x.c){
        const click=x.target&&x.target.tab;
        return '<div class="notify-item'+(click?' clickable':'')+'" data-i="'+i+'"><strong>'+esc(headline(x.c,lang))+'</strong>'
          +'<span>'+esc(sentence(x.c,lang))+time+'</span>'
          +(x.c.detail?'<small>'+esc(x.c.detail)+'</small>':'')+'</div>';
      }
      return '<div class="notify-item"><strong>'+esc(x.title)+'</strong><span>'+esc(x.msg)+time+'</span></div>';
    }).join('');
  }
  function openPanel(){
    if(!panel) build();
    panel.hidden=!panel.hidden;
    if(!panel.hidden){try{localStorage.setItem(SEEN,String(items.length));}catch(e){} updateBadge(); syncPermissionState();}
  }
  function currentPermission(){
    try{ if('Notification' in window) return Notification.permission; }catch(e){}
    return 'unsupported';
  }
  function permissionButtonLabel(state=currentPermission()){
    if(state==='unsupported') return '🔔 Browser notifications not supported';
    if(state==='granted') return '✅ Browser notifications enabled';
    if(state==='denied') return '🚫 Browser notifications blocked';
    return '🔔 Enable browser notifications';
  }
  function refreshPermissionButton(state){
    if(!panel) return;
    const b=panel.querySelector('#notify-permission');
    if(!b) return;
    const s=state || currentPermission();
    b.textContent=permissionButtonLabel(s);
    b.disabled=(s==='granted' || s==='denied' || s==='unsupported');
    b.setAttribute('data-permission',s);
  }
  async function syncPermissionState(){
    // Notification.permission is the authoritative value for this UI.
    // Do not let Permissions API return a different state and overwrite it.
    const state=currentPermission();
    refreshPermissionButton(state);
    try{
      if(navigator.permissions && navigator.permissions.query){
        const result=await navigator.permissions.query({name:'notifications'});
        if(result && !result.__gamevaultBound){
          result.__gamevaultBound=true;
          result.onchange=()=>refreshPermissionButton(currentPermission());
        }
      }
    }catch(e){}
    refreshPermissionButton(currentPermission());
    return currentPermission();
  }
  function build(){
    panel=document.createElement('div'); panel.className='notify-panel'; panel.hidden=true;
    panel.innerHTML='<div class="notify-head"><h3>Notifications</h3><button class="icon-btn" id="notify-close" type="button">✕</button></div><div class="notify-list"></div><div class="notify-actions"><button id="notify-permission" type="button"></button><button id="notify-clear" type="button">Clear</button></div>';
    document.body.appendChild(panel);
    hitStyle();
    panel.querySelector('.notify-list').addEventListener('click',e=>{
      const el=e.target.closest('.notify-item.clickable'); if(!el) return;
      const it=items[Number(el.dataset.i)]; if(it&&it.target) go(it.target);
    });
    panel.querySelector('#notify-close').onclick=()=>panel.hidden=true;
    panel.querySelector('#notify-clear').onclick=()=>{items=[];save();updateBadge();render();};
    panel.querySelector('#notify-permission').onclick=async()=>{
      if(!('Notification' in window)){alert('This browser does not support notifications.'); refreshPermissionButton(); return;}
      if(Notification.permission==='granted'){ refreshPermissionButton(); return; }
      if(Notification.permission==='denied'){ alert('Notifications are blocked for this site. Allow them from the browser site settings, then refresh the page.'); refreshPermissionButton(); return; }
      try{
        const p=await Notification.requestPermission();
        refreshPermissionButton(p);
        if(p==='granted'){ browserNotify('GameVault','Browser notifications are enabled.'); window.dispatchEvent(new Event('gamevault:notifications-granted')); }
        else if(p==='denied') alert('Notifications are currently blocked for this site. If Chrome shows Allow in Site settings, refresh the page and open Notifications again.');
      }catch(e){ refreshPermissionButton(); }
    };
    syncPermissionState();
    render();
  }
  window.__gvNotifyDescribe=describeChanges; window.__gvNotifySentence=sentence;
  function init(){
    if('Notification' in window){ document.addEventListener('visibilitychange',()=>syncPermissionState()); window.addEventListener('focus',()=>syncPermissionState()); }
    const btn=document.getElementById('notifications-btn'); if(!btn)return;
    btn.addEventListener('click',()=>{ openPanel(); syncPermissionState(); }); build(); updateBadge(); syncPermissionState();
    window.addEventListener('gamevault:cloud-update',e=>{
      const detail=(e&&e.detail)||{}; const keys=detail.keys||[]; if(!keys.length)return;
      let list=[];
      try{ list=describeChanges(detail); }catch(err){ list=[]; }
      if(!list.length){ // safety net: same behaviour as before
        const [title,msg]=titleFor(keys); add(title,msg); browserNotify(title,msg); return;
      }
      const lang=curLang();
      list.forEach(c=>{ add(headline(c,lang),sentence(c,lang),{c}); });
      const first=list[0];
      browserNotify(list.length>1?('🔔 GameVault ('+list.length+')'):headline(first,lang), sentence(first,lang)+(list.length>1?(lang==='ar'?' …و'+(list.length-1)+' كمان':' …and '+(list.length-1)+' more'):''), first.target);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
