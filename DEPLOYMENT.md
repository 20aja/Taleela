# نشر Taleela v8.10.0

## ملفات يجب رفعها

ارفع محتويات مجلد المشروع كاملًا، وبالأخص:

```text
questions/v1/
assets/countries/
js/question-store.js
js/categories.js
js/game.js
sw.js
_headers
firebase.json
```

## Netlify

استبدل ملفات المشروع في المستودع ثم نفذ Commit وPush. بعد اكتمال النشر افتح الموقع مرة واحدة متصلًا بالإنترنت. إذا بقي إصدار قديم، أغلق PWA وافتحه مجددًا أو امسح بيانات الموقع.

## Firebase Hosting

```bash
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

قواعد Firestore ما زالت تستخدم `schemaVersion: 7`. حقلا `usedQuestionIds` و`usedFactKeys` موجودان أصلًا، ويستعملان الآن لحفظ دورة الأسئلة عبر إعادة اللعب.

## Cache

Service Worker الجديد يستخدم Cache باسم الإصدار `v8.10.0-question-bank-v1-no-repeat`، ويعامل ملفات `questions/v1/*.json` كملفات ثابتة Immutable بعد أول تحميل.
