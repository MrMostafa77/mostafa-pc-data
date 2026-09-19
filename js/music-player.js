// ============================================================
// music-player.js — مشغل ساوند تراك (YouTube IFrame API)
// ============================================================
// - الموسيقى بتبدأ بعد تسجيل الدخول (مش على شاشة الدخول).
// - زرار 🎵 في الهيدر بيفتح لوحة تحكم: تشغيل/إيقاف، السابق/التالي، الصوت، كتم.
// - بيفتكر: مستوى الصوت، الكتم، الإيقاف، وآخر مقطوعة (localStorage).
// - لو فيديو مش مسموح بتضمينه أو اتشال، بيتخطاه لوحده.
// - لازم الموقع يتفتح من سيرفر (http/https) مش file:// — زي باقي المشروع.
//
// عشان تغيّر/تضيف مقطوعات: عدّل المصفوفة MUSIC_TRACKS تحت
// (الـ ID هو الحروف اللي بعد v= في رابط اليوتيوب).
// ============================================================

(function () {
  'use strict';

  var MUSIC_TRACKS = [
    'TNhBXdAe7dk',
    'e59IINeIXk8',
    'Cv0y0On8ZGQ',
    'u116HbMOF_Y',
    'SGQhtPW3FU8',
    '9ZEhqORSfNg',
    'jS-p7BvMRMg'
  ];
  var DEFAULT_VOLUME = 35; // من 0 لـ 100

  var LS = {
    vol: 'gv_music_volume',
    muted: 'gv_music_muted',
    paused: 'gv_music_paused',
    idx: 'gv_music_track'
  };

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (e) {}
  }

  var started = false;
  var player = null;
  var ready = false;
  var idx = 0;
  var wantPlay = true;
  var errorStreak = 0;
  var pausedBySignOut = false;
  var els = {};

  function $(id) { return document.getElementById(id); }

  // ---------------- UI ----------------
  function buildUI() {
    var btn = document.createElement('button');
    btn.className = 'ui-btn music-btn';
    btn.id = 'music-btn';
    btn.type = 'button';
    btn.title = 'Soundtrack';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '🎵';
    var anchor = $('theme-toggle');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
    else { btn.className += ' music-btn-floating'; document.body.appendChild(btn); }

    var pop = document.createElement('div');
    pop.className = 'music-popup';
    pop.id = 'music-popup';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Soundtrack player');
    pop.innerHTML =
      '<div class="music-popup-head"><strong>Soundtrack</strong>' +
        '<button type="button" class="music-popup-close" id="music-close" aria-label="Close">×</button></div>' +
      '<div class="music-video"><div id="music-yt"></div></div>' +
      '<div class="music-title" id="music-title">Loading…</div>' +
      '<div class="music-count" id="music-count"></div>' +
      '<div class="music-controls">' +
        '<button type="button" id="music-prev" aria-label="Previous track" title="Previous">⏮</button>' +
        '<button type="button" id="music-play" aria-label="Play" title="Play / Pause">▶</button>' +
        '<button type="button" id="music-next" aria-label="Next track" title="Next">⏭</button>' +
        '<button type="button" id="music-mute" aria-label="Mute" title="Mute">🔊</button>' +
        '<input type="range" id="music-vol" min="0" max="100" step="1" aria-label="Volume">' +
      '</div>' +
      '<div class="music-note" id="music-note" hidden></div>';
    document.body.appendChild(pop);

    els = {
      btn: btn, pop: pop,
      title: $('music-title'), count: $('music-count'), note: $('music-note'),
      play: $('music-play'), mute: $('music-mute'), vol: $('music-vol')
    };

    var vol = parseInt(lsGet(LS.vol, DEFAULT_VOLUME), 10);
    if (isNaN(vol)) vol = DEFAULT_VOLUME;
    els.vol.value = Math.max(0, Math.min(100, vol));
    updateMuteIcon(lsGet(LS.muted, '0') === '1');
    updateCount();

    btn.addEventListener('click', function (e) { e.stopPropagation(); togglePopup(); });
    $('music-close').addEventListener('click', function () { togglePopup(false); });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { togglePopup(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') togglePopup(false); });

    els.play.addEventListener('click', onPlayPause);
    $('music-prev').addEventListener('click', function () { go(idx - 1); });
    $('music-next').addEventListener('click', function () { go(idx + 1); });
    els.mute.addEventListener('click', onMute);
    els.vol.addEventListener('input', onVolume);
  }

  function togglePopup(force) {
    if (!els.pop) return;
    var open = typeof force === 'boolean' ? force : !els.pop.classList.contains('is-open');
    els.pop.classList.toggle('is-open', open);
    els.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function showNote(msg) {
    if (!els.note) return;
    if (msg) { els.note.textContent = msg; els.note.hidden = false; }
    else { els.note.hidden = true; }
  }

  function updateCount() {
    if (els.count) els.count.textContent = (idx + 1) + ' / ' + MUSIC_TRACKS.length;
  }

  function setPlayingUI(isPlaying) {
    if (!els.play) return;
    els.play.textContent = isPlaying ? '⏸' : '▶';
    els.play.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    els.btn.classList.toggle('is-playing', isPlaying);
  }

  function updateMuteIcon(muted) {
    if (!els.mute) return;
    els.mute.textContent = muted ? '🔇' : '🔊';
    els.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  function updateTitle() {
    if (!player || !ready) return;
    try {
      var d = player.getVideoData && player.getVideoData();
      if (d && d.title) els.title.textContent = d.title;
    } catch (e) {}
  }

  // ---------------- Controls ----------------
  function onPlayPause() {
    if (!ready) return;
    var state = player.getPlayerState();
    var playing = state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
    if (playing) {
      wantPlay = false; lsSet(LS.paused, '1');
      player.pauseVideo();
    } else {
      wantPlay = true; lsSet(LS.paused, '0');
      showNote('');
      player.playVideo();
    }
  }

  function onMute() {
    if (!ready) return;
    var nowMuted = !player.isMuted();
    if (nowMuted) player.mute(); else player.unMute();
    lsSet(LS.muted, nowMuted ? '1' : '0');
    updateMuteIcon(nowMuted);
  }

  function onVolume() {
    var v = parseInt(els.vol.value, 10) || 0;
    lsSet(LS.vol, v);
    if (!ready) return;
    player.setVolume(v);
    if (v > 0 && player.isMuted()) { player.unMute(); lsSet(LS.muted, '0'); updateMuteIcon(false); }
  }

  function go(i) {
    var n = MUSIC_TRACKS.length;
    idx = ((i % n) + n) % n;
    lsSet(LS.idx, idx);
    updateCount();
    wantPlay = true; lsSet(LS.paused, '0');
    showNote('');
    if (ready) player.loadVideoById(MUSIC_TRACKS[idx]);
  }

  // ---------------- Autoplay fallback ----------------
  var gestureArmed = false;
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    showNote('Click anywhere to start the music');
    var fire = function () {
      document.removeEventListener('click', fire, true);
      document.removeEventListener('keydown', fire, true);
      document.removeEventListener('touchend', fire, true);
      gestureArmed = false;
      if (ready && wantPlay) { showNote(''); player.playVideo(); }
    };
    document.addEventListener('click', fire, true);
    document.addEventListener('keydown', fire, true);
    document.addEventListener('touchend', fire, true);
  }

  // ---------------- YouTube player ----------------
  function loadYT(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') prev();
      cb();
    };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = function () { els.title.textContent = 'Soundtrack unavailable'; showNote('Could not reach YouTube (check your internet).'); };
    document.head.appendChild(s);
  }

  function createPlayer() {
    var vars = {
      autoplay: wantPlay ? 1 : 0, controls: 0, disablekb: 1, fs: 0,
      modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3
    };
    if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
    player = new YT.Player('music-yt', {
      width: 200, height: 200,
      videoId: MUSIC_TRACKS[idx],
      playerVars: vars,
      events: {
        onReady: onReady,
        onStateChange: onState,
        onError: onError,
        onAutoplayBlocked: function () { if (wantPlay) armGesture(); }
      }
    });
  }

  function onReady() {
    ready = true;
    player.setVolume(parseInt(els.vol.value, 10) || 0);
    if (lsGet(LS.muted, '0') === '1') player.mute();
    updateTitle();
    if (wantPlay) {
      // لو المتصفح منع التشغيل التلقائي، بنستنى أول ضغطة
      setTimeout(function () {
        if (!wantPlay) return;
        var s = player.getPlayerState();
        if (s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING) armGesture();
      }, 2500);
    } else {
      els.title.textContent = els.title.textContent || 'Paused';
    }
  }

  function onState(e) {
    var S = YT.PlayerState;
    if (e.data === S.PLAYING) {
      errorStreak = 0;
      setPlayingUI(true);
      showNote('');
      updateTitle();
    } else if (e.data === S.PAUSED) {
      setPlayingUI(false);
    } else if (e.data === S.ENDED) {
      go(idx + 1);
    } else if (e.data === S.CUED || e.data === S.BUFFERING) {
      updateTitle();
    }
  }

  function onError() {
    errorStreak++;
    if (errorStreak >= MUSIC_TRACKS.length) {
      setPlayingUI(false);
      els.title.textContent = 'No playable tracks';
      showNote('None of the tracks could be played here (embedding disabled or removed).');
      return;
    }
    var bad = idx + 1;
    var keep = wantPlay;
    go(idx + 1);
    wantPlay = keep;
    showNote('Track ' + bad + ' can’t be played here — skipped.');
  }

  // ---------------- Sign-out handling ----------------
  function hookSignOut() {
    var orig = window.GameVaultSignOut;
    if (typeof orig === 'function') {
      window.GameVaultSignOut = function () {
        pausedBySignOut = true;
        togglePopup(false);
        try { if (ready) player.pauseVideo(); } catch (e) {}
        return orig.apply(this, arguments);
      };
    }
    try {
      if (window.firebase && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && pausedBySignOut) {
            pausedBySignOut = false;
            if (ready && wantPlay) { try { player.playVideo(); } catch (e) {} armGesture(); }
          }
        });
      }
    } catch (e) {}
  }

  // ---------------- Init ----------------
  function init() {
    if (started || !MUSIC_TRACKS.length) return;
    started = true;
    var saved = parseInt(lsGet(LS.idx, 0), 10);
    idx = (isNaN(saved) || saved < 0 || saved >= MUSIC_TRACKS.length) ? 0 : saved;
    wantPlay = lsGet(LS.paused, '0') !== '1';
    buildUI();
    setPlayingUI(false);
    loadYT(createPlayer);
    hookSignOut();
  }

  // ما نبدأش غير بعد تسجيل الدخول (نفس البوابة اللي بيستناها cloud-sync.js)
  if (window.GameVaultAuthReady && typeof window.GameVaultAuthReady.then === 'function') {
    window.GameVaultAuthReady.then(init);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
