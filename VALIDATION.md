# تقرير التحقق المحلي — Taleela v8.5.0

تم تنفيذ الفحوص الساكنة والمنطقية التالية على الحزمة:

```text
JavaScript syntax                         PASS
CSS parse errors                          0
HTML critical duplicate IDs              0
Question categories                       33
Question records                          21,848
Question IDs unique                       21,848
Question shards                           133
Missing question media                    0
Category counts doubled vs v8.1.0         PASS (all 33)
General 40-question no-exact-repeat test  PASS
```

## اختبار منع التكرار

تم تشغيل `question-store.js` محليًا مع ملفات JSON الحقيقية ومحاكاة `localStorage`:

```text
General selections before exact repeat    40 / 40 unique IDs
Distinct underlying facts in those 40     20
41st selection                             repeat allowed (category exhausted)
```

هذا مهم للعبة من 30 جولة عند اختيار فئة صغيرة واحدة: لن يتكرر نفس Question ID قبل استهلاك الأربعين مدخلًا، مع تفضيل الحقائق المختلفة أولًا.

## ما تم التحقق منه أيضًا

- حد الجولات في الواجهة والمنطق وقواعد Firestore هو 3–30.
- الحد الأدنى للفئات هو 1 والحد الأعلى جميع الفئات.
- منطق الكذبة المشتركة يحتفظ بجميع `authorIds` ويمنح كل صاحب نقطة لكل لاعب خُدع بها.
- كسر التعادل يعتمد على النقاط ثم الإجابات الصحيحة ثم مرات الخداع، والتعادل الكامل يبقى تعادلًا حقيقيًا.
- عداد النتائج السفلي محذوف، مع بقاء Deadline داخلي للانتقال التلقائي.

## حدود التحقق المحلي

لم تُنفّذ مباراة إنتاجية فعلية عبر عدة أجهزة على Firebase/Netlify من بيئة البناء الحالية، ولم يتم تشغيل Firebase Rules Emulator. لذلك يلزم اختبار Smoke قصير بعد النشر وفق `TESTING.md`.
