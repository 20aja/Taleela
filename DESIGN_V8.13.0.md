# Taleela v8.13.0 — Concept Match UI

This release rebuilds the visual layer to closely follow the approved concept mockup while preserving the v8.11.2 render-stability fix and existing game logic.

## Main visual changes
- Desktop gameplay composition: players rail on the left, central game panel, round/category cluster at top-left, centered phase title, circular timer at top-right.
- Compact step-based round progress matching the approved concept.
- Flatter dark-indigo cards with purple outlines and restrained gradients.
- Question/media/input proportions rebuilt to match the concept rather than merely recoloring the old layout.
- Lobby rebuilt as a two-panel room composition with compact row settings, player rail, categories and green start action.
- Join modal restyled to the compact purple concept card.
- Responsive mobile layout remains intentionally simplified to keep gameplay usable on small screens.

## Stability
- No scoring, question-bank, Firestore schema, or gameplay-rule changes.
- v8.11.2 differential rendering/flicker protections remain intact.
- Service Worker cache version: v8.13.0-concept-match-render-stable.
