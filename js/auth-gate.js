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

  var ICON_GAMEPAD_BIG =
    '<svg viewBox="0 0 64 44" aria-hidden="true"><defs><linearGradient id="agGp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b83ff"/><stop offset="1" stop-color="#2352e0"/></linearGradient></defs>' +
    '<path fill="url(#agGp)" d="M14 2h36c7 0 11 4 13 12l1 7c1 8 1 16-5 20-5 3-9-1-12-6l-3-5H20l-3 5c-3 5-7 9-12 6-6-4-6-12-5-20l1-7C2 6 7 2 14 2Z"/>' +
    '<path fill="#fff" d="M18 12h4v4h4v4h-4v4h-4v-4h-4v-4h4z"/>' +
    '<circle cx="43" cy="13" r="2.6" fill="#fff"/><circle cx="49" cy="19" r="2.6" fill="#fff"/><circle cx="37" cy="19" r="2.6" fill="#fff"/><circle cx="43" cy="25" r="2.6" fill="#fff"/></svg>';
  var ICON_GAMEPAD_BTN =
    '<svg viewBox="0 0 64 44" aria-hidden="true"><path fill="#fff" d="M14 2h36c7 0 11 4 13 12l1 7c1 8 1 16-5 20-5 3-9-1-12-6l-3-5H20l-3 5c-3 5-7 9-12 6-6-4-6-12-5-20l1-7C2 6 7 2 14 2Z"/>' +
    '<path fill="#2f6bff" d="M18 12h4v4h4v4h-4v4h-4v-4h-4v-4h4z"/><circle cx="43" cy="13" r="2.6" fill="#2f6bff"/><circle cx="49" cy="19" r="2.6" fill="#2f6bff"/><circle cx="37" cy="19" r="2.6" fill="#2f6bff"/><circle cx="43" cy="25" r="2.6" fill="#2f6bff"/></svg>';
  var ICON_GOOGLE =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  var ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c5 0 8.5 4 10 7-.6 1.2-1.5 2.5-2.7 3.6M6.6 6.7C4.5 8.2 3 10.3 2 12c1.5 3 5 7 10 7 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  var ICON_EYE_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1.5-3 5-7 10-7s8.5 4 10 7c-1.5 3-5 7-10 7S3.5 15 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'auth-gate-overlay';
    overlay.innerHTML =
      '<div class="auth-gate-card">' +
        '<div class="auth-gate-controller-icon" aria-hidden="true">' + ICON_GAMEPAD_BIG + '</div>' +
        '<h1 class="auth-gate-title"><span>GAME</span> <span class="auth-gate-title-accent">VAULT</span></h1>' +
        '<p class="auth-gate-sub" id="auth-gate-sub">Play<i>•</i>Connect<i>•</i>Enjoy</p>' +
        '<form id="auth-gate-form" autocomplete="on">' +
          '<div class="auth-gate-input-wrap"><svg class="auth-gate-field-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.5 3.1-5.5 7-5.5s6.3 2 7 5.5"/></svg><input class="auth-gate-input" id="auth-gate-user" type="text" placeholder="Username" aria-label="Username" autocomplete="username" required></div>' +
          '<div class="auth-gate-input-wrap"><svg class="auth-gate-field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input class="auth-gate-input has-eye" id="auth-gate-pass" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" required>' +
            '<button type="button" class="auth-gate-eye" id="auth-gate-eye" aria-label="Show password">' + ICON_EYE_OFF + '</button></div>' +
          '<div id="auth-gate-error" class="auth-gate-error" hidden></div>' +
          '<button type="submit" class="auth-gate-submit" id="auth-gate-submit">' + ICON_GAMEPAD_BTN + '<span class="auth-btn-label">Sign In</span></button>' +
        '</form>' +
        '<div class="auth-gate-or"><span>or</span></div>' +
        '<button type="button" class="auth-gate-google" id="auth-gate-google">' + ICON_GOOGLE + '<span>Continue with Google</span></button>' +
        '<p class="auth-gate-signup">Don\'t have an account? <a href="#" id="auth-gate-signup">Sign Up</a></p>' +
      '</div>' +
      buildContactFooter();
    document.body.appendChild(overlay);

    // إظهار/إخفاء الباسورد
    var passEl = overlay.querySelector('#auth-gate-pass');
    var eyeBtn = overlay.querySelector('#auth-gate-eye');
    eyeBtn.addEventListener('click', function () {
      var show = passEl.type === 'password';
      passEl.type = show ? 'text' : 'password';
      eyeBtn.innerHTML = show ? ICON_EYE_ON : ICON_EYE_OFF;
      eyeBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    // جوجل والتسجيل الجديد: موجودين في التصميم بس مقفولين عن قصد.
    // قواعد Firestore بتسمح لأي مستخدم مسجّل دخول، فتفعيلهم كان هيسمح
    // لأي حد يعمل حساب ويقرا/يعدّل بياناتك.
    function closedMsg(e) {
      e.preventDefault();
      showError('التسجيل الجديد والدخول بجوجل مقفولين. الدخول بحساب مسموح فقط.');
    }
    overlay.querySelector('#auth-gate-google').addEventListener('click', closedMsg);
    overlay.querySelector('#auth-gate-signup').addEventListener('click', closedMsg);
    return overlay;
  }

  function setLoading(isLoading) {
    var btn = document.getElementById('auth-gate-submit');
    if (!btn) return;
    btn.disabled = isLoading;
    var label = btn.querySelector('.auth-btn-label');
    if (label) label.textContent = isLoading ? '...' : 'Sign In';
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
  // بيانات التواصل اللي بتظهر تحت شاشة الدخول — عدّل القيم هنا بس
  // ============================================================
  var LOGIN_CONTACT = {
    facebook:  '',   // رابط صفحتك على فيسبوك، مثال: https://facebook.com/username
    whatsapp:  '+966 537013542',   // رقم واتساب بصيغة دولية من غير +، مثال: 201012345678
    instagram: '',   // رابط انستجرام، مثال: https://instagram.com/username
    phone:     '+966 537013542'    // رقم التواصل اللي هيظهر تحت الأيقونات، مثال: +20 101 234 5678
  };

  // ============================================================
  // Login background slideshow — صور محلية من assets/backgrounds
  // بتتغير كل 4 ثواني، بدون أي تأثير انتقال (تبديل مباشر).
  // ============================================================
  var LOGIN_BG_IMAGES = [
    'assets/login-bg/game-01.jpg',
    'assets/login-bg/game-02.jpg',
    'assets/login-bg/game-03.jpg',
    'assets/login-bg/game-04.jpg',
    'assets/login-bg/game-05.jpg',
    'assets/login-bg/game-06.jpg',
    'assets/login-bg/game-07.jpg',
    'assets/login-bg/game-08.jpg',
    'assets/login-bg/game-09.jpg',
    'assets/login-bg/game-10.jpg',
    'assets/login-bg/game-11.jpg',
    'assets/login-bg/game-12.jpg',
    'assets/login-bg/game-13.jpg',
    'assets/login-bg/game-14.jpg',
    'assets/login-bg/game-15.jpg',
    'assets/login-bg/game-16.jpg',
    'assets/login-bg/game-17.jpg',
    'assets/login-bg/game-18.jpg',
    'assets/login-bg/game-19.jpg',
    'assets/login-bg/game-20.jpg'
  ];
  var LOGIN_BG_INTERVAL_MS = 4000;
  var loginBgTimer = null;

  function startGameBackgrounds() {
    if (document.getElementById('game-login-bg')) return;

    var bg = document.createElement('div');
    bg.id = 'game-login-bg';
    bg.setAttribute('aria-hidden', 'true');
    document.body.prepend(bg);

    // الصورة الأولى فورًا، والتانية بتتحمّل مسبقًا عشان التبديل يبقى فوري من غير وميض
    var current = 0;
    function preload(i) { var img = new Image(); img.src = LOGIN_BG_IMAGES[i % LOGIN_BG_IMAGES.length]; }
    function show(i) {
      bg.style.backgroundImage = 'url("' + LOGIN_BG_IMAGES[i] + '")';
      preload(i + 1);
    }
    show(current);
    loginBgTimer = setInterval(function () {
      current = (current + 1) % LOGIN_BG_IMAGES.length;
      show(current);
    }, LOGIN_BG_INTERVAL_MS);
  }

  // بعد الدخول الخلفية بتتشال وبيقف التبديل
  function stopGameBackgrounds() {
    if (loginBgTimer) { clearInterval(loginBgTimer); loginBgTimer = null; }
    var bg = document.getElementById('game-login-bg');
    if (bg) bg.remove();
  }

  function contactLink(cls, href, label, svg) {
    if (!href) return '<span class="auth-contact-icon ' + cls + ' is-empty" title="' + label + '">' + svg + '</span>';
    return '<a class="auth-contact-icon ' + cls + '" href="' + href + '" target="_blank" rel="noopener" aria-label="' + label + '" title="' + label + '">' + svg + '</a>';
  }

  function buildContactFooter() {
    var c = LOGIN_CONTACT;
    var wa = c.whatsapp ? 'https://wa.me/' + String(c.whatsapp).replace(/\D/g, '') : '';
    var svgAttrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var fb = '<svg ' + svgAttrs + '><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>';
    var wsp = '<svg ' + svgAttrs + '><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/></svg>';
    var ig = '<svg ' + svgAttrs + '><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></svg>';
    var phoneHtml = c.phone
      ? '<a class="auth-contact-phone" href="tel:' + String(c.phone).replace(/[^\d+]/g, '') + '" dir="ltr">' + c.phone + '</a>'
      : '';
    return '<div class="auth-gate-contact">' +
      '<div class="auth-contact-icons">' +
        contactLink('is-facebook', c.facebook, 'Facebook', fb) +
        contactLink('is-whatsapp', wa, 'WhatsApp', wsp) +
        contactLink('is-instagram', c.instagram, 'Instagram', ig) +
      '</div>' + phoneHtml +
    '</div>';
  }

  function init() {
    startGameBackgrounds();
    // لو مفيش إعدادات Firebase حقيقية أصلاً، سيبي التطبيق يشتغل عادي
    // من غير حماية (بالظبط زي ما كان قبل كده).
    if (typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey ||
        firebaseConfig.apiKey.indexOf('ضع_هنا') !== -1) {
      stopGameBackgrounds();
      revealApp(true);
      resolveReady();
      return;
    }

    if (typeof firebase === 'undefined' || !firebase.auth) {
      console.error('Firebase Auth SDK not loaded — check the <script> tags in index.html');
      stopGameBackgrounds();
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
        stopGameBackgrounds();
        revealApp(true);
        if (!readySent) { readySent = true; resolveReady(); }
      } else {
        overlay.style.display = 'flex';
        startGameBackgrounds();
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
