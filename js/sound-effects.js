/**
 * sound-effects.js
 * نظام أصوات تنبيه بسيط - بدون ملفات خارجية (Web Audio API)
 * أحداث مدعومة: إضافة ناجحة، حذف، حفظ/مزامنة ناجحة، خطأ
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
