# Taleela v8.11.2 — Render Stability Hotfix

This hotfix removes the brief UI flash caused by rebuilding unchanged DOM after Firestore updates.

Changes:
- Lobby player cards are updated incrementally instead of clearing the whole player list.
- Category cards are preserved and only their state/classes are updated.
- Ready/start button contents are only replaced when their semantic state changes.
- Round category choices are not rebuilt when unchanged.
- Question images are preserved when the image source/alt did not change.
- Guess option cards are not rebuilt for unrelated Firestore updates.
- Reveal cards are not rebuilt when only reveal-ready counters change.
- Service-worker/cache version bumped to v8.11.2.

No scoring rules, question-bank data, or Firebase schema were changed.
