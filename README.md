# GameVault Professional Optimized v4

نسخة Static محسنة للأداء مع SPA سريع: التبويبات لا تعيد رسم كل البيانات عند كل انتقال، وكل تبويب ثقيل يتم رسمه عند فتحه فقط.

## البيانات
- `data/games.json` — بيانات الألعاب
- `data/play-logs.json` — سجلات اللعب
- `data/date-options.json` — خيارات التواريخ
- `assets/covers/` — أغلفة منفصلة
- `assets/backgrounds/` — خلفيات منفصلة

## التشغيل
اضغط `run-local.bat`. لا يحتاج Python أو PHP أو Node.js؛ يستخدم PowerShell الموجود في Windows.

فتح `index.html` مباشرة عبر `file://` قد يمنع المتصفح من قراءة JSON.
