# Taleela v7.2.0 — اختبار التعديلات

1. ابدأ مباراة وتأكد أن زر أعلى اللعبة يحمل أيقونة خروج واضحة (سهم خروج) وليس أيقونة قائمة.
2. اضغط زر الخروج وتأكد من ظهور رسالة تأكيد المغادرة قبل تنفيذ الخروج.
3. افتح الدردشة، اكتب رسالة لا تتجاوز 10 كلمات واضغط إرسال؛ يجب إرسال الرسالة ثم إغلاق لوحة الدردشة مباشرة، بينما يبقى إشعار الرسالة الصغير ظاهرًا حسب نظام الدردشة.
4. اختر فئة «باب الحارة» عدة مرات. يجب أن تكون غالبية الأسئلة عن أحداث القصة والحلقات (سرقة الذهب، مقتل أبو صالح، الحصار، مقاومة الفرنسيين، مأمون، وغيرها)، لا عن أسماء الممثلين فقط.
5. اختبر الصفحة من هاتف أو DevTools Mobile وتأكد من احترام حواف الشاشة (safe areas) وعدم تغطية العناصر بالـ notch.
6. تحقق من فتح `manifest.webmanifest` و`sw.js` دون 404 عبر Live Server أو الاستضافة.
7. عند الاستضافة عبر HTTPS، تحقق من تسجيل Service Worker من DevTools > Application.
8. تأكد أن اللعبة ما زالت تعمل كلعبة ويب عادية وأن Firebase/Firestore/Anonymous Auth تعمل كالسابق.
9. لا يلزم تعديل Firestore Rules لهذا الإصدار.

## v7.2.1 — In-app notification test

- Browser `alert()`, `confirm()`, and `prompt()` are no longer used by the game code.
- Trigger an invalid room code: an in-app warning should appear at the top of the game page.
- Try leaving a room: a styled in-app confirmation card should appear instead of the browser confirmation dialog.
- Let the bluff or guessing timer expire: an in-app "انتهى الوقت" warning should appear.
- During reveal, the local player receives an in-app correct/incorrect result notification once per round.
