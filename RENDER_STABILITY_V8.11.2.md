# Taleela v8.11.2 — Render Stability

This patch addresses lobby-wide micro-flashes by:

- separating room-document renders from player-collection renders;
- making screen switching idempotent;
- avoiding lobby backdrop-filter compositor repaints;
- removing transform-on-tap compositor promotion in the lobby;
- disabling player insertion animation;
- preventing scroll anchoring in independently updated lobby grids.

No game scoring or question-bank logic was changed.
