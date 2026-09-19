// ============================================================
// شاشة الدخول — Firebase Authentication
// ============================================================
// المفروض ده يتحمّل بعد firebase-config.js وقبل cloud-sync.js.
// وظيفته: يمنع باقي التطبيق (cloud-sync.js وبالتالي app.js) من
// الشغل لحد ما المستخدم يسجّل دخول بنجاح.
//
// Firebase Authentication بيطلب "إيميل" مش "يوزر نيم" عادي، فعشان
// شاشة الدخول تظهر "اسم مستخدم" بس، بنحوّل الاسم اللي المستخدم
// بيكتبه إلى إيميل وهمي ثابت الصيغة: username@gamevault.local
// وبعدين بنستخدم الإيميل ده مع signInWithEmailAndPassword.
// (لازم تعمل يوزر في Firebase Console بنفس الإيميل ده — الشرح في
// كيفية_النشر.md)
// ============================================================

(function () {
  var AUTH_EMAIL_DOMAIN = '@gamevault.local';

  function usernameToEmail(username) {
    return username.trim().toLowerCase().replace(/\s+/g, '') + AUTH_EMAIL_DOMAIN;
  }

  // باقي السكريبتات (cloud-sync.js) بتستنى على البروميس ده قبل ما
  // تبدأ تشتغل فعليًا.
  var resolveReady;
  window.GameVaultAuthReady = new Promise(function (res) { resolveReady = res; });

  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'auth-gate-overlay';
    overlay.innerHTML =
      '<div class="auth-gate-card">' +
        '<img src="assets/hero-logo-icon.png" alt="" class="auth-gate-logo" onerror="this.style.display=\'none\'">' +
        '<h1 class="auth-gate-title">Mostafa\'s PC Data</h1>' +
        '<p class="auth-gate-sub" id="auth-gate-sub">Sign in to continue</p>' +
        '<form id="auth-gate-form" autocomplete="on">' +
          '<label class="auth-gate-label" for="auth-gate-user">Username</label>' +
          '<input class="auth-gate-input" id="auth-gate-user" type="text" autocomplete="username" required>' +
          '<label class="auth-gate-label" for="auth-gate-pass">Password</label>' +
          '<input class="auth-gate-input" id="auth-gate-pass" type="password" autocomplete="current-password" required>' +
          '<div id="auth-gate-error" class="auth-gate-error" hidden></div>' +
          '<button type="submit" class="ui-btn auth-gate-submit" id="auth-gate-submit">Sign In</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function setLoading(isLoading) {
    var btn = document.getElementById('auth-gate-submit');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.textContent = isLoading ? '...' : 'Sign In';
  }

  function showError(msg) {
    var el = document.getElementById('auth-gate-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function friendlyError(code) {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'اسم المستخدم أو كلمة المرور غلط.';
      case 'auth/too-many-requests':
        return 'محاولات كتير غلط، جرب تاني بعد شوية.';
      case 'auth/network-request-failed':
        return 'مشكلة في الاتصال بالإنترنت.';
      case 'auth/user-disabled':
        return 'الحساب ده متعطّل.';
      default:
        return 'حصل خطأ (' + (code || 'unknown') + ')، جرب تاني.';
    }
  }

  function revealApp(show) {
    // ملحوظة: index.html فيه <div class="wrap"> جوه <div class="wrap">
    // تانية (الشعار والساعة وأزرار الهيدر جوه الـ wrap الداخلية)، فلازم
    // نظبط كل عناصر .wrap مش بس أول واحد، وإلا الداخلية تفضل مخفية.
    document.querySelectorAll('.wrap').forEach(function (el) {
      el.style.visibility = show ? 'visible' : 'hidden';
    });
  }



  // ============================================================
  // Game background slideshow for the login screen
  // Uses Wikipedia's public page-image endpoint to resolve artwork
  // from the game titles, so no image files are required in the app.
  // ============================================================
  var GAME_LOGIN_BACKGROUNDS = [
    'Resident Evil 2','Max Payne','Max Payne 2: The Fall of Max Payne',
    'A Plague Tale: Innocence','Resident Evil 4','Need for Speed: Most Wanted',
    'Call of Juarez: Gunslinger','Assassin\'s Creed II','Mafia II','BioShock Infinite',
    'Assassin\'s Creed Brotherhood','Assassin\'s Creed Revelations','Max Payne 3',
    'Condemned: Criminal Origins','Hitman: Absolution','Outlast','Assassin\'s Creed IV: Black Flag',
    'Ryse: Son of Rome','Knights of the Temple: Infernal Crusade','Alien: Isolation',
    'Assassin\'s Creed Unity','Grand Theft Auto V','Grand Theft Auto: Vice City',
    'Rise of the Tomb Raider','Layers of Fear','Inside','Mad Max','Resident Evil 7: Biohazard',
    'Hellblade: Senua\'s Sacrifice','The Evil Within 2','Assassin\'s Creed Origins','Metro Exodus',
    'Call of Juarez: Bound in Blood','Sekiro: Shadows Die Twice','Control','Visage',
    'Assassin\'s Creed Odyssey','The Witcher 3: Wild Hunt','Grand Theft Auto IV',
    'Middle-earth: Shadow of Mordor','Batman: Arkham Knight','F.E.A.R.','Oxenfree',
    'Middle-earth: Shadow of War','Ori and the Blind Forest','Red Dead Redemption 2',
    'Ori and the Will of the Wisps','Horizon Zero Dawn','Titanfall 2','Doom Eternal',
    'NieR:Automata','Mafia','Call of Duty 4: Modern Warfare','Return of the Obra Dinn',
    'Cyberpunk 2077','Hitman 3','Resident Evil Village','Alan Wake','God of War',
    'Marvel\'s Spider-Man','A Plague Tale: Requiem','Uncharted 4: A Thief\'s End','Elden Ring',
    'BioShock','Hogwarts Legacy','The Last of Us Part I','Need for Speed: Porsche Unleashed',
    'Resident Evil 4','Yakuza 0','Deathloop','The Walking Dead: Season One','Horizon Forbidden West',
    'Marvel\'s Spider-Man 2','Ghost of Tsushima','God of War Ragnarök','Senua\'s Saga: Hellblade II',
    'Alan Wake 2','Until Dawn','Star Wars Jedi: Survivor','Assassin\'s Creed Mirage',
    'The Last of Us Part II','Mandragora','Clair Obscur: Expedition 33','Days Gone',
    'Indiana Jones and the Great Circle','Hollow Knight','Hollow Knight: Silksong','Black Myth: Wukong',
    'Prince of Persia: The Lost Crown','Doom: The Dark Ages','Mortal Kombat 1','Uncharted: The Lost Legacy',
    'Shinobi: Art of Vengeance','Stellar Blade','Resident Evil Requiem','Pragmata','007 First Light',
    'Assassin\'s Creed IV: Black Flag Resynced'
  ];

  var GAME_LOGIN_ALIASES = {
    'Resident Evil Requiem': 'Resident Evil Requiem',
    'Resident Evil 4': 'Resident Evil 4',
    'Resident Evil 7: Biohazard': 'Resident Evil 7: Biohazard',
    'Resident Evil Village': 'Resident Evil Village',
    'Assassin\'s Creed IV: Black Flag Resynced': 'Assassin\'s Creed IV: Black Flag Resynced',
    'Senua\'s Saga: Hellblade II': 'Senua\'s Saga: Hellblade II'
  };

  function startGameBackgrounds() {
    if (document.getElementById('game-login-bg')) return;

    var bg = document.createElement('div');
    bg.id = 'game-login-bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<div class="game-login-bg-layer is-active"></div><div class="game-login-bg-layer"></div><div class="game-login-bg-shade"></div>';
    document.body.prepend(bg);

    var layers = bg.querySelectorAll('.game-login-bg-layer');
    var active = 0;
    var current = 0;
    var images = [];

    function showNext() {
      if (!images.length) return;
      var next = (current + 1) % images.length;
      var nextLayer = layers[1 - active];
      nextLayer.style.backgroundImage = 'url("' + images[next].replace(/"/g, '%22') + '")';
      nextLayer.classList.add('is-active');
      layers[active].classList.remove('is-active');
      active = 1 - active;
      current = next;
    }

    function resolveTitle(title) {
      var query = GAME_LOGIN_ALIASES[title] || title;
      var url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail&pithumbsize=1600&titles=' + encodeURIComponent(query);
      return fetch(url, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.query || !data.query.pages) return null;
          var pages = Object.keys(data.query.pages);
          if (!pages.length || pages[0] === '-1') return null;
          return data.query.pages[pages[0]].thumbnail && data.query.pages[pages[0]].thumbnail.source || null;
        })
        .catch(function () { return null; });
    }

    // Resolve in small batches so the login screen remains lightweight.
    var batchSize = 8;
    var cursor = 0;
    function loadBatch() {
      var batch = GAME_LOGIN_BACKGROUNDS.slice(cursor, cursor + batchSize);
      cursor += batchSize;
      if (!batch.length) {
        if (images.length) {
          layers[0].style.backgroundImage = 'url("' + images[0].replace(/"/g, '%22') + '")';
          setInterval(showNext, 6500);
        }
        return;
      }
      Promise.all(batch.map(resolveTitle)).then(function (urls) {
        urls.forEach(function (u) { if (u && images.indexOf(u) === -1) images.push(u); });
        if (images.length === 1) layers[0].style.backgroundImage = 'url("' + images[0].replace(/"/g, '%22') + '")';
        loadBatch();
      });
    }
    loadBatch();
  }

  function init() {
    startGameBackgrounds();
    // لو مفيش إعدادات Firebase حقيقية أصلاً، سيبي التطبيق يشتغل عادي
    // من غير حماية (بالظبط زي ما كان قبل كده).
    if (typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey ||
        firebaseConfig.apiKey.indexOf('ضع_هنا') !== -1) {
      revealApp(true);
      resolveReady();
      return;
    }

    if (typeof firebase === 'undefined' || !firebase.auth) {
      console.error('Firebase Auth SDK not loaded — check the <script> tags in index.html');
      revealApp(true);
      resolveReady();
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    var overlay = buildOverlay();
    var readySent = false;

    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});

    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        overlay.style.display = 'none';
        revealApp(true);
        if (!readySent) { readySent = true; resolveReady(); }
      } else {
        overlay.style.display = 'flex';
        revealApp(false);
      }
    });

    document.getElementById('auth-gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var username = document.getElementById('auth-gate-user').value;
      var password = document.getElementById('auth-gate-pass').value;
      document.getElementById('auth-gate-error').hidden = true;
      setLoading(true);
      firebase.auth().signInWithEmailAndPassword(usernameToEmail(username), password)
        .catch(function (err) { showError(friendlyError(err.code)); })
        .finally(function () { setLoading(false); });
    });
  }

  // متاحة عشان تقدر تضيف زرار "تسجيل خروج" في أي مكان في الواجهة:
  // onclick="GameVaultSignOut()"
  window.GameVaultSignOut = function () {
    // Presence must be marked offline before auth is cleared.
    var markOffline = (typeof window.GameVaultPresenceSignOut === 'function')
      ? window.GameVaultPresenceSignOut()
      : Promise.resolve();
    Promise.resolve(markOffline).finally(function () {
      if (window.firebase && firebase.auth) firebase.auth().signOut();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
