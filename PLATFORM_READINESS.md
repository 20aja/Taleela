# Taleela v7.2.0 — Web / Android / iOS readiness

## Web
The project remains a plain static HTML/CSS/JavaScript application. Firebase Hosting configuration is included in `firebase.json`.

Typical future deployment commands (after installing Firebase CLI and logging in):

```bash
firebase deploy --only hosting
```

The project also includes:
- `manifest.webmanifest`
- `sw.js`
- 192px and 512px app icons
- safe-area support for phones with notches
- standalone/mobile web app meta tags

## Android / iOS later
The front end is compatible with a WebView wrapper such as Capacitor because it does not depend on React/Vue or a server-rendered framework. The Firebase Web SDK remains HTTPS-based and the Service Worker registration is automatically skipped if `window.Capacitor` exists.

When converting later, keep these principles:
1. Keep the web source as the single UI codebase.
2. Add Capacitor as a packaging layer rather than rewriting the game.
3. Configure Android/iOS network permissions and Firebase authorized domains/settings as needed.
4. Keep Firestore Security Rules as the real authorization layer.
5. Test anonymous authentication and multiplayer reconnection on real devices.

No Capacitor dependency was added in this version, so the current browser project stays simple and unchanged operationally.
