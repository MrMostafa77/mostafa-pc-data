(async()=>{
  const [games,playLogs]=await Promise.all([
    fetch('data/games.json',{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error('games.json');return r.json()}),
    fetch('data/play-logs.json',{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error('play-logs.json');return r.json()})
  ]);
  window.GameVaultData={games,playLogs};
  const s=document.createElement('script');s.src='js/app.js';s.defer=true;document.body.appendChild(s);
})().catch(err=>{console.error(err);document.getElementById('boot-error').hidden=false;});
