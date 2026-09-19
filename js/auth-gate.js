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

  function init() {
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
