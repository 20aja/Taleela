# Taleela v7.3.1 — Mobile UI Fix

- Mobile-only spacing/alignment pass.
- Final winner card reduced on phones.
- Score/progress bars no longer restart on every Firestore snapshot.
- Round/final leaderboards are rendered again only when scoreboard data actually changes.
- Answer/reveal options stay two cards per row on phones.
- Touch icons use explicit flex/grid centering.
- Service worker cache bumped to v7.3.1.

## Mobile test
1. Open as installed PWA and as browser tab.
2. Play through a round and leave the result screen visible for at least 20 seconds; the score bar must remain stable.
3. Verify two answer cards per row at 360px and 390px widths.
4. Verify exit/chat/close/send icons are visually centered.
5. Verify final winner card is compact and centered.
