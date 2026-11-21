// ============================================================
// GameVault local soundtrack player
// Local MP3 files only — no YouTube, no ads, no external player.
// Starts on the login screen after the first user interaction and
// continues while the single-page app is used.
// ============================================================
(function () {
  'use strict';

  var TRACKS = [
    { file: 'The First Departure.mp3', title: 'The First Departure' },
    { file: 'The Human League - (Keep Feeling) Fascination.mp3', title: 'The Human League - (Keep Feeling) Fascination' },
    { file: "Assassin's Creed 2 OST - Dreams of Venice.mp3", title: "Assassin's Creed 2 — Dreams of Venice" },
    { file: "Assassin's Creed Brotherhood OST - City of Rome (Track 02).mp3", title: "Assassin's Creed Brotherhood — City of Rome (Track 02)" },
    { file: "Assassin's Creed Brotherhood OST - City of Rome.mp3", title: "Assassin's Creed Brotherhood — City of Rome" },
    { file: "Assassin's Creed Revelations (The Complete Recordings) OST - Istanbul (Track 29).mp3", title: "Assassin's Creed Revelations — Istanbul" },
    { file: 'Max Payne - Main Theme.mp3', title: 'Max Payne — Main Theme' },
    { file: 'Mirage Theme  Assassin\'s Creed Mirage Original Game Soundtrack  Brendan Angelides.mp3', title: "Assassin's Creed Mirage — Mirage Theme" },
    { file: 'Odin’s Plunder.mp3', title: 'Odin’s Plunder' },
    { file: 'Ravensthorpe.mp3', title: 'Ravensthorpe' }
  ];

  var BASE = 'assets/music/';
  var LS = { index: 'gv_local_music_index', volume: 'gv_local_music_volume', muted: 'gv_local_music_muted', playing: 'gv_local_music_playing' };
  var audio, idx = 0, volume = 35, muted = false, ui;
  var initialized = false;

  function get(k, fallback) { try { var v = localStorage.getItem(k); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function clamp(v) { return Math.max(0, Math.min(100, parseInt(v, 10) || 0)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function srcFor(track) { return BASE + encodeURIComponent(track.file).replace(/%2F/g, '/'); }

  function buildUI() {
    if (document.getElementById('gv-local-music')) return;
    var root = document.createElement('div');
    root.id = 'gv-local-music';
    root.innerHTML =
      '<button type="button" class="gv-music-toggle" aria-label="Open music player" title="Music">♫</button>' +
      '<section class="gv-music-panel" aria-label="Music player" hidden>' +
        '<div class="gv-music-head"><div><div class="gv-music-label">GAMEVAULT MUSIC</div><div class="gv-music-track"></div></div><button type="button" class="gv-music-close" aria-label="Close">×</button></div>' +
        '<div class="gv-music-progress"><span class="gv-music-time gv-time-current">0:00</span><input class="gv-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek"><span class="gv-music-time gv-time-total">0:00</span></div>' +
        '<div class="gv-music-controls">' +
          '<button type="button" data-act="prev" title="Previous">⏮</button>' +
          '<button type="button" data-act="stop" title="Stop">■</button>' +
          '<button type="button" data-act="play" class="gv-play" title="Play / Pause">▶</button>' +
          '<button type="button" data-act="next" title="Next">⏭</button>' +
          '<button type="button" data-act="mute" class="gv-mute" title="Mute / Unmute">🔊</button>' +
        '</div>' +
        '<div class="gv-music-volume"><span>VOL</span><input class="gv-volume" type="range" min="0" max="100" value="35" step="1" aria-label="Volume"><span class="gv-volume-value">35%</span></div>' +
        '<div class="gv-music-status"></div>' +
      '</section>';
    document.body.appendChild(root);
    ui = root;
    ui.querySelector('.gv-music-toggle').addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
    ui.querySelector('.gv-music-close').addEventListener('click', function () { closePanel(); });
    ui.querySelector('[data-act="prev"]').addEventListener('click', previous);
    ui.querySelector('[data-act="stop"]').addEventListener('click', stop);
    ui.querySelector('[data-act="play"]').addEventListener('click', togglePlay);
    ui.querySelector('[data-act="next"]').addEventListener('click', next);
    ui.querySelector('[data-act="mute"]').addEventListener('click', toggleMute);
    ui.querySelector('.gv-volume').addEventListener('input', function (e) { setVolume(e.target.value); });
    ui.querySelector('.gv-seek').addEventListener('input', function (e) {
      if (!audio || !isFinite(audio.duration) || !audio.duration) return;
      audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
    });
    ui.querySelector('.gv-music-panel').addEventListener('click', function (e) { e.stopPropagation(); });
    render();
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    sec = Math.floor(sec); var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function render() {
    if (!ui) return;
    var track = TRACKS[idx];
    ui.querySelector('.gv-music-track').textContent = track ? track.title : 'No track';
    ui.querySelector('.gv-volume').value = volume;
    ui.querySelector('.gv-volume-value').textContent = volume + '%';
    ui.querySelector('.gv-mute').textContent = muted ? '🔇' : '🔊';
    ui.querySelector('.gv-play').textContent = audio && !audio.paused ? '❚❚' : '▶';
    ui.querySelector('.gv-music-toggle').classList.toggle('is-playing', !!(audio && !audio.paused));
    ui.querySelector('.gv-music-status').textContent = audio && !audio.paused ? 'Playing' : 'Paused';
    ui.querySelector('.gv-time-current').textContent = formatTime(audio && audio.currentTime);
    ui.querySelector('.gv-time-total').textContent = formatTime(audio && audio.duration);
  }

  function load(index, autoplay) {
    if (!TRACKS.length) return;
    idx = (index + TRACKS.length) % TRACKS.length;
    set(LS.index, idx);
    if (!audio) return;
    audio.src = srcFor(TRACKS[idx]);
    audio.load();
    render();
    if (autoplay) {
      audio.play().then(function () { set(LS.playing, '1'); render(); }).catch(function () { render(); });
    }
  }

  function startFromGesture() {
    if (!audio || get(LS.playing, '1') !== '1') return;
    audio.play().then(function () { set(LS.playing, '1'); render(); }).catch(function () {});
  }

  function togglePlay() {
    if (!audio) return;
    if (audio.paused) { audio.play().then(function () { set(LS.playing, '1'); render(); }).catch(function () {}); }
    else { audio.pause(); set(LS.playing, '0'); render(); }
  }
  function stop() { if (!audio) return; audio.pause(); audio.currentTime = 0; set(LS.playing, '0'); render(); }
  function previous() { load(idx - 1, true); }
  function next() { load(idx + 1, true); }
  function setVolume(v) {
    volume = clamp(v); set(LS.volume, volume);
    if (audio) audio.volume = muted ? 0 : volume / 100;
    if (volume > 0 && muted) { muted = false; set(LS.muted, '0'); }
    render();
  }
  function toggleMute() {
    muted = !muted; set(LS.muted, muted ? '1' : '0');
    if (audio) audio.volume = muted ? 0 : volume / 100;
    render();
  }
  function togglePanel() {
    var p = ui.querySelector('.gv-music-panel'); p.hidden = !p.hidden;
  }
  function closePanel() { ui.querySelector('.gv-music-panel').hidden = true; }

  function init() {
    if (initialized) return; initialized = true;
    idx = clamp(get(LS.index, 0)); if (idx >= TRACKS.length) idx = 0;
    volume = clamp(get(LS.volume, 35)); if (volume === 0) volume = 35;
    muted = get(LS.muted, '0') === '1';
    audio = new Audio();
    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = muted ? 0 : volume / 100;
    audio.addEventListener('ended', next);
    audio.addEventListener('timeupdate', render);
    audio.addEventListener('loadedmetadata', render);
    audio.addEventListener('play', function () { set(LS.playing, '1'); render(); });
    audio.addEventListener('pause', render);
    audio.addEventListener('error', function () { if (ui) ui.querySelector('.gv-music-status').textContent = 'Unable to load this track'; });
    load(idx, false);
    buildUI();

    // The first user interaction anywhere on the login page (or app) starts audio.
    var gesture = function () {
      startFromGesture();
      document.removeEventListener('pointerdown', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('touchstart', gesture, true);
    };
    document.addEventListener('pointerdown', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('touchstart', gesture, true);
  }

  window.GameVaultMusic = {
    play: function () { if (audio) audio.play().catch(function () {}); },
    pause: function () { if (audio) audio.pause(); },
    stop: stop,
    next: next,
    previous: previous,
    setVolume: setVolume,
    mute: function () { if (!muted) toggleMute(); },
    unmute: function () { if (muted) toggleMute(); },
    toggle: togglePlay,
    getTracks: function () { return TRACKS.slice(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
