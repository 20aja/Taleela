# نشر Taleela v8.0.0

## 1. Netlify

ارفع **محتويات المجلد كاملة**، بما فيها:

```text
index.html
_headers
css/
js/
assets/
manifest.webmanifest
sw.js
```

ملف `_headers` يضبط Cache-Control على Netlify. لا تحذفه.

بعد النشر، غيّر رابط الموقع في Firebase Authentication ضمن Authorized domains إذا لم يكن مضافًا من قبل. أضف اسم النطاق فقط، دون `https://`.

## 2. Firestore Rules

افتح:

```text
Firebase Console
→ Firestore Database
→ Rules
```

احذف القواعد القديمة، والصق محتوى `firestore.rules` ثم انشرها.

القواعد الجديدة مخصصة لـ`schemaVersion: 6`. القواعد القديمة لن تسمح بإنشاء غرف هذه النسخة.

## 3. Firestore Index

الطريقة المفضلة باستخدام Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use taleela-3a077
firebase deploy --only firestore:rules,firestore:indexes
```

ملف الإعداد `firebase.json` يشير إلى:

```text
firestore.rules
firestore.indexes.json
```

إذا لم تنشر الـIndex فورًا، ستستمر قائمة الغرف العامة باستخدام Query احتياطية، لكن نشره يجعل تصفية الغرف المنتهية تتم على الخادم ويقلل القراءات.

## 4. Service Worker القديم

بعد نشر النسخة:

1. افتح الموقع مرة متصلًا بالإنترنت.
2. أغلق التطبيق المثبت تمامًا وأعد فتحه.
3. إذا بقي إصدار قديم، احذف بيانات الموقع أو ألغِ تثبيت PWA وثبّته من جديد.

اسم Cache الجديد:

```text
taleela-static-v8.0.0-stage1
taleela-pages-v8.0.0-stage1
```

## 5. الغرف القديمة

لا تستخدم غرفًا منشأة قبل v8.0.0. أنشئ غرفة جديدة بعد نشر القواعد والملفات.
