# Taleela v7.3.0 — Mobile continuity test

1. Install the site as a PWA on Android/iOS supported browser.
2. Join a room and start a round. Put the app in the background for 30–90 seconds, return: the same room/round must be restored.
3. Swipe the app away / let the OS recreate the PWA process, reopen it: the stored Firebase anonymous UID + active-room record should restore the same membership unless the room was deleted or the player was kicked.
4. Press the explicit Leave/Exit button: reopening must start from Home (active session is cleared).
5. Host in waiting room: remove a non-host player. The removed player should be returned to Home and the avatar becomes available.
6. On a phone <=390px, guessing and reveal options must remain two cards per row.
7. Focus either room-code input on mobile: autocapitalize=characters, autocorrect off, spellcheck off; typed text is normalized to uppercase by JS.

Note: mobile keyboards can ignore suggestion/autocorrect hints depending on OS/keyboard settings; the app still normalizes the code to A–Z/0–9 uppercase before joining.
