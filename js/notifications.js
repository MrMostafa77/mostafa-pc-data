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
  function add(title,msg){
    const now=Date.now();
    if(items[0] && items[0].title===title && now-items[0].time<2500) return;
    items.unshift({title,msg,time:now}); save(); updateBadge(); render();
  }
  function browserNotify(title,msg){
    if(!('Notification' in window) || Notification.permission!=='granted') return;
    try{ const n=new Notification(title,{body:msg,icon:'assets/hero-logo-banner.png',tag:'gamevault-update'}); n.onclick=()=>{window.focus();n.close();}; }catch(e){}
  }
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
    list.innerHTML=items.map(x=>'<div class="notify-item"><strong>'+esc(x.title)+'</strong><span>'+esc(x.msg)+' · '+new Date(x.time).toLocaleString()+'</span></div>').join('');
  }
  function openPanel(){
    if(!panel) build();
    panel.hidden=!panel.hidden;
    if(!panel.hidden){try{localStorage.setItem(SEEN,String(items.length));}catch(e){} updateBadge();}
  }
  function build(){
    panel=document.createElement('div'); panel.className='notify-panel'; panel.hidden=true;
    panel.innerHTML='<div class="notify-head"><h3>Notifications</h3><button class="icon-btn" id="notify-close" type="button">✕</button></div><div class="notify-list"></div><div class="notify-actions"><button id="notify-permission" type="button">🔔 Enable browser notifications</button><button id="notify-clear" type="button">Clear</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('#notify-close').onclick=()=>panel.hidden=true;
    panel.querySelector('#notify-clear').onclick=()=>{items=[];save();updateBadge();render();};
    panel.querySelector('#notify-permission').onclick=async()=>{
      if(!('Notification' in window)){alert('This browser does not support notifications.');return;}
      try{const p=await Notification.requestPermission(); if(p==='granted'){browserNotify('GameVault','Browser notifications are enabled.');} }catch(e){}
    };
    render();
  }
  function init(){
    const btn=document.getElementById('notifications-btn'); if(!btn)return;
    btn.addEventListener('click',openPanel); build(); updateBadge();
    window.addEventListener('gamevault:cloud-update',e=>{
      const keys=e&&e.detail&&e.detail.keys||[]; if(!keys.length)return;
      const [title,msg]=titleFor(keys); add(title,msg); browserNotify(title,msg);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
