# نشر Taleela v8.5.0

## إذا كان Netlify مربوطًا بـ GitHub

1. استبدل ملفات المشروع في مستودع GitHub بمحتويات هذه الحزمة.
2. نفّذ Commit ثم Push.
3. تأكد أن آخر Deploy في Netlify أصبح `Published`.
4. افتح الموقع مرة واحدة مع اتصال بالإنترنت ليُحدّث Service Worker.
5. إذا بقي الإصدار القديم في PWA، أغلقه وأعد فتحه. عند الحاجة امسح بيانات الموقع/Cache مرة واحدة.

## مهم جدًا: Firestore Rules

هذه النسخة غيّرت `firestore.rules`، لذلك **رفع الملفات إلى GitHub/Netlify وحده لا يكفي**.

بعد تحديث الموقع، انشر قواعد Firestore من مشروع Firebase نفسه. إذا كنت تستخدم Firebase CLI من مجلد المشروع:

```bash
firebase deploy --only firestore:rules
```

أو انسخ محتوى `firestore.rules` إلى Firebase Console > Firestore Database > Rules ثم انشره.

إذا لم تنشر القواعد الجديدة، قد تظهر الواجهة وكأنها تسمح حتى 30 جولة بينما Firestore يرفض بعض عمليات إنشاء/تحديث الغرف وفق القواعد القديمة.

## ملفات مهمة يجب ألا تُحذف

```text
_headers
firestore.rules
questions/v8.5.0/
js/question-store.js
sw.js
```

`_headers` يسمح بالتخزين الطويل لملفات `/questions/*` لأن ملفات البنك Versioned.

## التوافق

بنية الغرف ما زالت تستخدم `schemaVersion: 6`. يفضّل بعد النشر إنشاء غرفة جديدة واختبار مباراة حقيقية بأكثر من جهاز، خصوصًا:

- 30 جولة.
- فئة واحدة فقط.
- لاعبان يرسلان الكذبة نفسها.
- تعادل كامل في النقاط والإصابات والخداع.
