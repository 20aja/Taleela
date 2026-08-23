# نشر Taleela v8.1.0

هذه النسخة مبنية فوق v8.0.0 الذي اختبرته سابقًا.

## إذا كان Netlify مربوطًا بـGitHub

1. استبدل ملفات المشروع في مستودع GitHub بمحتويات هذه الحزمة.
2. نفذ Commit ثم Push.
3. انتظر حتى يصبح آخر Deploy في Netlify بالحالة `Published`.
4. افتح الموقع مرة واحدة متصلًا بالإنترنت ليُحدّث Service Worker.
5. أغلق PWA وأعد فتحه. إذا بقي إصدار قديم، احذف بيانات الموقع أو أعد تثبيت التطبيق.

## Firestore Rules

**لا يوجد تغيير في Rules بين v8.0.0 وv8.1.0.**
إذا كانت قواعد v8.0.0 منشورة وتعمل، اتركها كما هي.

## ملفات مهمة يجب ألا تُحذف

```text
_headers
questions/
js/question-store.js
sw.js
```

`_headers` يجعل ملفات `/questions/*` قابلة للتخزين لمدة طويلة لأنها Versioned داخل `questions/v8.1.0/`.

## Cache الجديد

```text
taleela-static-v8.1.0-question-shards
taleela-pages-v8.1.0-question-shards
```

## الغرف

بنية Firestore ما زالت `schemaVersion: 6`، لذلك غرف v8.0.0 الجديدة متوافقة. يفضّل إنشاء غرفة جديدة للاختبار بعد النشر.
