/* GameVault FCM Web Push — stable token registration. */
(function(){
  'use strict';

  const VAPID_KEY='BHdWivFiBhUhLV7nXWiuOPcyMXZpKM5MyR9ctRVNtqNmrpF2VekNm3wHbPQ-Yyg6KBW9a0FGS4rmhgAalz8ecp4';
  const TOKEN_KEY='gameVault_fcm_token_v2';
  const PUSH_SW='./firebase-messaging-sw.js';
  let messaging=null;
  let messageHandlerAttached=false;

  function supported(){
    return 'Notification' in window &&
      'serviceWorker' in navigator &&
      typeof firebase!=='undefined' &&
      typeof firebase.messaging==='function';
  }

  async function register(){
    if(!supported() || Notification.permission!=='granted') return null;

    try{
      if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);

      messaging=firebase.messaging();

      // Keep one stable service-worker registration. Do NOT delete the token on every page load.
      const sw=await navigator.serviceWorker.register(PUSH_SW,{scope:'./'});
      await sw.update();

      const token=await messaging.getToken({
        vapidKey:VAPID_KEY,
        serviceWorkerRegistration:sw
      });

      if(token){
        localStorage.setItem(TOKEN_KEY,token);
        console.log('[GameVault FCM] registration token ready');
      }

      if(!messageHandlerAttached){
        messaging.onMessage(payload=>{
          const n=payload && payload.notification || {};
          const title=n.title || 'GameVault';
          const body=n.body || 'GameVault was updated on another device.';
          if(typeof window.browserNotifyForPush==='function'){
            window.browserNotifyForPush(title,body);
          }
        });
        messageHandlerAttached=true;
      }

      return token || null;
    }catch(err){
      console.warn('[GameVault FCM] setup failed:',err);
      return null;
    }
  }

  window.gameVaultPush={register};

  window.addEventListener('gamevault:notifications-granted',()=>register());
  window.addEventListener('load',()=>setTimeout(register,300));
})();
