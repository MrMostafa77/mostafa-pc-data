/**
 * sound-effects.js
 * نظام الأصوات - أصوات ويندوز 7
 * كل حدث له ملف صوت في assets/sounds/ (انسخهم من C:\Windows\Media بالأسماء دي).
 * لو ملف مش موجود، بيشغّل النغمة القديمة (Web Audio) بدل الصمت.
 */

const SoundFX = (() => {
  let audioCtx = null;
  let muted = localStorage.getItem('sfx_muted') === 'true';

  function getContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // بعض المتصفحات بتوقف الـ context لحد أول تفاعل من المستخدم
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(freq, duration, type = 'sine', volume = 0.15, delay = 0) {
    if (muted) return;
    try {
      const ctx = getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.05);
    } catch (e) {
      console.warn('SoundFX: تعذر تشغيل الصوت', e);
    }
  }

  // ===== خريطة الأصوات: الحدث -> اسم الملف داخل assets/sounds/ =====
  // تقدر تغيّر اسم أي ملف من هنا. (ممكن تحط أكتر من اسم، بيجرّبهم بالترتيب)
  const SOUND_DIR = 'assets/sounds/';
  const SOUND_MAP = {
    login:    ['Windows Logon Sound.wav'],
    logout:   ['Windows Logoff Sound.wav'],
    navigate: ['Windows Navigation Start.wav'],
    save:     ['Windows Notify.wav'],
    error:    ['Windows Error.wav'],
    warn:     ['Windows Exclamation.wav'],
    add:      ['Windows Balloon.wav'],
    remove:   ['Windows Recycle.wav'],
    open:     ['Windows Menu Command.wav', 'game-open.wav', 'game-open.mp3']
  };
  const fileIndex = {};   // الحدث -> رقم الملف الحالي في القائمة
  const missing = {};     // الحدث -> true لو كل الملفات مش موجودة
  const lastAt = {};      // منع التكرار المزدوج

  function playFile(key, fallback) {
    if (muted) return;
    const now = Date.now();
    if (lastAt[key] && now - lastAt[key] < 150) return;
    lastAt[key] = now;
    const list = SOUND_MAP[key] || [];
    let i = fileIndex[key] || 0;
    if (missing[key] || i >= list.length) { missing[key] = true; fallback(); return; }
    try {
      const a = new Audio(SOUND_DIR + encodeURI(list[i]));
      a.volume = 0.85;
      a.addEventListener('error', () => {
        // الملف مش موجود: جرّب الاسم اللي بعده، ولو خلصوا شغّل النغمة القديمة
        fileIndex[key] = i + 1;
        if (fileIndex[key] >= list.length) missing[key] = true;
        lastAt[key] = 0;
        playFile(key, fallback);
      }, { once: true });
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => { /* المتصفح منع التشغيل قبل أول ضغطة، أو الملف ناقص (بيتعالج في error) */ });
    } catch (e) { fallback(); }
  }

  // ===== النغمات القديمة (احتياطي لو ملف ويندوز مش موجود) =====
  const tones = {
    add()     { playTone(660, 0.08, 'sine', 0.15, 0); playTone(880, 0.1, 'sine', 0.15, 0.08); },
    remove()  { playTone(440, 0.08, 'sine', 0.12, 0); playTone(300, 0.1, 'sine', 0.12, 0.07); },
    save()    { playTone(523, 0.09, 'sine', 0.14, 0); playTone(659, 0.09, 'sine', 0.14, 0.09); playTone(784, 0.12, 'sine', 0.14, 0.18); },
    error()   { playTone(220, 0.15, 'square', 0.1, 0); playTone(180, 0.2, 'square', 0.1, 0.15); },
    warn()    { playTone(520, 0.12, 'triangle', 0.12, 0); playTone(390, 0.16, 'triangle', 0.12, 0.1); },
    login()   { playTone(523, 0.14, 'sine', 0.13, 0); playTone(659, 0.14, 'sine', 0.13, 0.12); playTone(784, 0.14, 'sine', 0.13, 0.24); playTone(1047, 0.3, 'sine', 0.13, 0.36); },
    logout()  { playTone(1047, 0.14, 'sine', 0.13, 0); playTone(784, 0.14, 'sine', 0.13, 0.12); playTone(659, 0.14, 'sine', 0.13, 0.24); playTone(523, 0.3, 'sine', 0.13, 0.36); },
    navigate(){ playTone(1200, 0.04, 'sine', 0.08, 0); playTone(900, 0.05, 'sine', 0.06, 0.03); },
    open()    { playTone(1318, 0.07, 'sine', 0.10, 0); playTone(1760, 0.14, 'sine', 0.08, 0.05); }
  };

  // أي alert() في المشروع (تحذيرات/أخطاء) يطلع معاه صوت التنبيه
  try {
    const nativeAlert = window.alert ? window.alert.bind(window) : null;
    if (nativeAlert) {
      window.alert = function (msg) { playFile('warn', tones.warn); return nativeAlert(msg); };
    }
  } catch (e) { /* ignore */ }

  return {
    playAdd()         { playFile('add', tones.add); },
    playDelete()      { playFile('remove', tones.remove); },
    playSaveSuccess() { playFile('save', tones.save); },
    playError()       { playFile('error', tones.error); },
    playWarn()        { playFile('warn', tones.warn); },
    playLogin()       { playFile('login', tones.login); },
    playLogout()      { playFile('logout', tones.logout); },
    playNavigate()    { playFile('navigate', tones.navigate); },
    playOpen()        { playFile('open', tones.open); },

    // كتم / تشغيل الأصوات
    toggleMute() {
      muted = !muted;
      localStorage.setItem('sfx_muted', muted);
      return muted;
    },

    isMuted() {
      return muted;
    }
  };
})();

// اختياري: اجعله متاح عالمياً لو مش بتستخدم modules
window.SoundFX = SoundFX;
