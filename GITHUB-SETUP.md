# تشغيل GameVault على GitHub Pages

## 1) ارفع محتويات هذا المجلد
يجب أن يكون `index.html` في جذر المستودع، وليس داخل مجلد إضافي.

## 2) فعّل GitHub Pages
Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## 3) Firebase
المشروع يستخدم إعدادات Firebase الموجودة في `firebase-config.js`.
يجب أن تكون Firestore Rules مطابقة لملف `firestore.rules` حتى تعمل المزامنة من كل الأجهزة.

> مهم: القواعد تسمح بالقراءة والكتابة لأي حساب مسجّل دخول فقط. عطّل إنشاء حسابات جديدة من Firebase Console ← Authentication ← Settings ← User actions.

## 4) المزامنة
- البيانات المشتركة محفوظة في Firestore.
- التغييرات تصل للأجهزة المفتوحة عبر Firestore realtime listener.
- يوجد fallback polling كل 15 ثانية (والتبويب ظاهر فقط) في حال انقطع realtime على بعض الشبكات/الأجهزة.
- صور الأغلفة تُحفظ في IndexedDB محليًا وتُزامن مع Firestore على أجزاء.

## 5) لا تفتح index.html بـ file://
استخدم رابط GitHub Pages أو السيرفر المحلي.
