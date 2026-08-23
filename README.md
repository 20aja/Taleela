# Taleela — تعليلة v8.0.0 (Performance Stage 1)

هذه النسخة تعيد هندسة طبقة Firestore لتقليل البطء والتعارض بين اللاعبين مع المحافظة على الواجهة ومنطق اللعب وبنك الأسئلة.

## التغييرات الأساسية

- أصبحت وثيقة الغرفة خفيفة وتحتوي بيانات الحالة العامة فقط.
- نُقل اللاعبون إلى `rooms/{roomId}/players/{uid}`.
- نُقلت الجولات إلى `rooms/{roomId}/rounds/{roundId}`.
- نُقلت الأكاذيب والتخمينات والجاهزية إلى وثائق مستقلة لكل لاعب.
- إرسال الكذبة أو التخمين لم يعد يعيد كتابة وثيقة الغرفة ولا يستخدم Transaction مشتركة.
- أصبح هناك Room Store واحد مشترك بدل مستمع غرفة مستقل في `app.js` وآخر في `game.js`.
- تحديثات Presence لا تعيد رسم السؤال والنتائج والواجهة كاملة.
- `game.js` يُحمّل بعد دخول غرفة فقط، و`questions.js` يُحمّل على جهاز المضيف عند بدء المباراة فقط.
- جرى تحسين Service Worker واستراتيجية Cache.
- تم ضغط `home.png` إلى WebP، وتحويل صور المستخدمين إلى WebP.
- رمز الغرفة أصبح هو نفسه معرف وثيقة Firestore، لذلك الانضمام لا يحتاج Query للبحث عن الرمز.

## بنية Firestore الجديدة

```text
rooms/{roomCode}
  players/{uid}
  avatars/{avatarId}
  presence/{uid}
  rounds/{roundId}
    bluffs/{uid}
    guesses/{uid}
    revealReady/{uid}
  messages/{messageId}
```

هذه النسخة تستخدم `schemaVersion: 6`. الغرف المنشأة بالإصدارات السابقة غير متوافقة؛ أنشئ غرفًا جديدة بعد النشر.

## الملفات المطلوبة للنشر

- ملفات الموقع كاملة إلى Netlify.
- `firestore.rules` إلى Firestore Rules.
- `firestore.indexes.json` إلى Firestore Indexes، ويُفضّل نشره بواسطة Firebase CLI.

راجع `DEPLOYMENT.md` و`TESTING.md` قبل اعتماد النسخة.
