/**
 * sound-effects.js
 * نظام أصوات تنبيه بسيط - بدون ملفات خارجية (Web Audio API)
 * أحداث مدعومة: إضافة ناجحة، حذف، حفظ/مزامنة ناجحة، خطأ
 */

const SoundFX = (() => {
  let audioCtx = null;
  let muted = localStorage.getItem('sfx_muted') === 'true';
  const OPEN_SOUND_FILES = ['assets/sounds/game-open.wav', 'assets/sounds/game-open.mp3'];
  let openFileIndex = 0;
  let lastOpenAt = 0;

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

  return {
    // ➕ إضافة صورة/عنصر بنجاح - نغمة صاعدة قصيرة
    playAdd() {
      playTone(660, 0.08, 'sine', 0.15, 0);
      playTone(880, 0.1, 'sine', 0.15, 0.08);
    },

    // 🗑️ حذف عنصر - نغمة هابطة قصيرة
    playDelete() {
      playTone(440, 0.08, 'sine', 0.12, 0);
      playTone(300, 0.1, 'sine', 0.12, 0.07);
    },

    // 💾 حفظ / مزامنة ناجحة - نغمتين لطيفة
    playSaveSuccess() {
      playTone(523, 0.09, 'sine', 0.14, 0);
      playTone(659, 0.09, 'sine', 0.14, 0.09);
      playTone(784, 0.12, 'sine', 0.14, 0.18);
    },

    // ⚠️ خطأ - نغمة منخفضة "بزز"
    playError() {
      playTone(220, 0.15, 'square', 0.1, 0);
      playTone(180, 0.2, 'square', 0.1, 0.15);
    },

    // 🎮 فتح لعبة / الدخول عليها - صوت ويندوز 7
    // حط ملف الصوت في: assets/sounds/game-open.wav (أو .mp3)
    // لو الملف مش موجود بيشغّل نغمة قريبة منه بدل الصمت.
    playOpen() {
      if (muted) return;
      const now = Date.now();
      if (now - lastOpenAt < 250) return; // منع التكرار المزدوج
      lastOpenAt = now;
      const fallback = () => {
        playTone(1318, 0.07, 'sine', 0.10, 0);
        playTone(1760, 0.14, 'sine', 0.08, 0.05);
      };
      try {
        const a = new Audio(OPEN_SOUND_FILES[openFileIndex]);
        a.volume = 0.8;
        a.addEventListener('error', () => {
          if (openFileIndex < OPEN_SOUND_FILES.length - 1) { openFileIndex++; }
          else { fallback(); }
        }, { once: true });
        const pr = a.play();
        if (pr && pr.catch) pr.catch(() => {
          if (openFileIndex < OPEN_SOUND_FILES.length - 1) openFileIndex++;
          else fallback();
        });
      } catch (e) { fallback(); }
    },

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
