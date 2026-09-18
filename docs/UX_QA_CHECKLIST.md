# Cross-device UX QA checklist

This checklist is the final regression gate for the responsive UX work. It intentionally covers iPhone, iPad, desktop/browser, installed PWA, and webOS/TV behavior without changing the playback transport.

## Automated gate

Run these before device testing:

```bash
npm install --no-audit --no-fund
npm run lint
npm run build
```

If a lockfile is later committed, prefer `npm ci` instead of `npm install`.

## iPhone

Test Safari and the installed PWA where available.

### Portrait
- Home cards are compact and fully tappable.
- Header fits without horizontal overflow.
- Search keyboard does not cover the input or result list.
- Category drawer opens, traps focus, closes on backdrop/Escape, and restores focus.
- Movie details scroll as one surface; tapping outside closes them.
- Series details keep season controls reachable and episode cards comfortably tappable.
- Single tap toggles player controls.
- Double tap left/right seeks -10/+10 seconds.
- Repeated double taps accumulate correctly.
- Seekbar can be dragged continuously and committed at release.
- Far seek still switches instantly through the existing HLS path.
- Episode panel behaves like a bottom sheet and dismisses cleanly.
- Controls auto-hide only while playing and inactive.

### Landscape
- Safe areas around the notch/Dynamic Island are respected.
- Player controls do not cover excessive video area.
- Details remain usable at short viewport heights.
- Episode list and seekbar remain reachable.
- Rotate back to portrait without stale layout or scroll lock.

## iPad

Test portrait, landscape, and split-screen/narrow-window mode.

- Sidebar is persistent at tablet widths and becomes a drawer only below the compact breakpoint.
- Home keeps a balanced tablet layout.
- Two-column episode layout remains readable.
- Search/filter rows remain touchable without hover dependence.
- Software keyboard reduces the visible app/modal height instead of covering fields.
- Pointer/trackpad hover behavior works when a fine pointer is present.
- Touch behavior still uses touch-sized hit targets.

## Desktop

- Header remains one/two rows according to available width without overlap.
- Sidebar can be toggled and remains persistent at desktop widths.
- Mouse movement reveals player controls.
- Inactivity hides controls while playback continues.
- Clicking video toggles controls.
- Keyboard arrows seek; Space toggles play/pause; Escape closes overlays/player in the expected order.
- Seekbar supports mouse drag and keyboard control.
- Hover/focus effects remain intact for a fine pointer.
- Resize through 767/768 px and 640/641 px without stale drawer/modal state.

## Navigation/back order

Verify this exact visible-state priority:

1. Exit confirmation
2. Player
3. Details
4. Settings
5. Compact category drawer
6. Active search
7. Category filter
8. Current section
9. Home/root exit behavior

Normal Safari/browser history must not be permanently trapped. Installed PWA/webOS platform-back behavior should remain app-owned.

## Playback regression

Do not consider the UX work complete unless all of these still work:

- Live TV start/stop.
- VOD initial playback.
- Resume from stored timestamp.
- -10/+10 buttons.
- Rapid repeated skip accumulation.
- Touch double-tap skip.
- Mouse/touch scrub within the current HLS window.
- Far seek outside the current generated HLS window.
- Episode switching.
- Automatic next episode behavior.
- Pause/resume after seeking.
- Player close and progress persistence.
- iPhone native HLS path.
- Desktop hls.js path.

## Modal/focus regression

For Details, Search, Settings/Login, Exit confirmation, and iOS install instructions:

- Backdrop click/tap closes only when the gesture starts and ends on the backdrop.
- Escape closes the topmost dialog.
- Tab/Shift+Tab stay inside the topmost dialog.
- Closing restores focus to the opener.
- Body/page scrolling stays locked while any modal is open.
- Stacked dialogs do not unlock body scrolling prematurely.
- Safe areas and the iOS visual viewport are respected.

## Known focus model to verify manually

Media cards remain keyboard/remote-selectable while also containing Favorite/Watchlist action buttons. This pattern is retained to protect existing webOS spatial navigation. Verify that:
- Enter/Space on the card opens/plays the card.
- Favorite/Watchlist actions do not trigger card selection.
- Remote/fine-pointer focus remains predictable.
