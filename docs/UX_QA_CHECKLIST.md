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

## Manual UX harness

While the dev server is running, use the dedicated harness page to isolate responsive components:

```text
/tests/ux/index.html?mode=home
/tests/ux/index.html?mode=header
/tests/ux/index.html?mode=card
/tests/ux/index.html?mode=search
/tests/ux/index.html?mode=details
/tests/ux/index.html?mode=series
/tests/ux/index.html?mode=settings
/tests/ux/index.html?mode=player
```

Use browser responsive mode for quick layout checks, then repeat the final gate on real iPhone/iPad hardware because Safari visualViewport, native HLS, safe areas, and touch gestures cannot be fully validated by desktop emulation.

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


## Design-system regression

Verify after every significant UI change:

- Header visibly frosts content scrolling underneath it; it must not read as a flat opaque navy bar.
- Scroll down hides the browser/touch header smoothly; scrolling up reveals it.
- Near the top the header remains visible.
- Header stays visible while its controls/search have focus and while the compact category drawer is open.
- webOS/TV keeps the header visible.
- Phone icon-only header controls are visually centered within 44px touch targets.
- Floating surfaces use the semantic glass hierarchy; no accidental flat black/slate overlay appears.
- Strong cyan is concentrated on focus, active state, primary actions, and playback progress.
- Media-card hover moves the whole card (1.03 + slight lift); image zoom is secondary.
- Touch press feedback does not leave a sticky hover state.
- Keyboard/remote focus uses the consistent cyan outline + glow.
- Details, Search, Settings, PWA guide, Exit dialog, Sidebar, and Player feel like the same product.
- Reduced-motion mode removes nonessential transition motion.

## Player OSD timing regression

Run this after any player UI/state change:

- Start playback and allow the OSD to auto-hide.
- Single tap once: the OSD remains visible for approximately 3 seconds, not a fraction of a second.
- Interact again before the deadline: a fresh full visibility window begins.
- Double-tap seek cannot leave a stale timer that immediately hides the OSD.
- Scrubbing keeps controls visible.
- Pausing keeps controls visible.
- Buffering/error state keeps controls visible.
- Opening Episodes keeps controls visible.
- Closing Episodes while playing returns to normal auto-hide behavior.

The controls timer must retain one generation/deadline owner. Do not add a second independent auto-hide timer.

## iOS reload/resume regression

- Load a large Movies/Series catalog once, leave the section, then return; cached content should appear substantially faster.
- Scroll deep into a library, background/lock the device, then return.
- If iOS preserves the process, the UI should remain intact.
- If iOS discards/reloads the page, stable section/category and saved scroll state should restore.
- Playback progress must be flushed on background/pagehide so a killed page can resume near the last recorded position.
- Do not expect the actual decoder/video element to survive an OS process kill.


## Pass 6 integration regressions

### Catalog / memory
- Enter a specific Movies category, then start a Home global search. Results must eventually include the full Movies + Series libraries, not only the previously loaded category subset.
- End the Home search while staying on Home; VOD/Series arrays loaded only for search should be released from React state while IndexedDB remains reusable.
- From Movies or Series, open Favorites/Watchlist/Continue Watching. This must not trigger a full `get_vod_streams(all)` / `get_series(all)` provider fetch just to render the special list.
- Returning from a special list to All should reload from hot cache/IndexedDB/network as needed.
- A category-specific fetch must not leave the app believing the React array is a complete All catalog.
- Provider failures that return the built-in demo fixture must not persist that fixture to hot cache or IndexedDB for a real provider.
- Legacy demo-fallback cache entries should self-heal instead of being served indefinitely.

### Progress / iOS lifecycle
- Background/pagehide playback progress must be present in localStorage immediately after the player flush callback; it must not depend only on a later React effect.
- VOD/Series/Live entries with the same numeric ID must not read or delete one another's playback progress.
- Multiple stored episode-progress records for one Series should render as one Series card in Continue Watching/Home.
- Episode-level progress must still remain available inside Series details.

### Player pinned states
- While paused, tapping/clicking the video cannot hide the controls.
- While buffering, the OSD remains visible.
- While Episodes is open, controls remain visible; clicking the video closes Episodes and leaves the OSD visible.
- Resume playback and verify normal 3-second auto-hide returns.

### Sidebar gesture
- On iPhone/iPad, tap the category backdrop once: the drawer closes.
- The same gesture must not activate the card underneath.
- Repeat with a quick tap and a slightly longer press to catch Safari synthetic-click differences.

### Global surfaces
- webOS Magic Remote HUD uses the same glass/focus language as the rest of the application.
- Offline indicator is restrained glass/amber status UI and does not bounce continuously.


## Async/catalog race regression

- Rapidly switch Movies -> Series -> Live while catalogs are loading; a late response from the old section must not replace the active section's categories/content.
- Select Favorites/Continue/Watchlist while a normal category request is pending; the stale request must not overwrite the special list.
- Opening a special list must not trigger an unnecessary full VOD/Series provider catalog fetch.
- Returning Home releases large catalog arrays from active application/service memory; returning to the section may rehydrate them from IndexedDB.
- Home global search lazily loads missing full catalogs and releases search-only catalog memory when abandoned.


## Synthetic-category/provider guard

- Selecting Favorites, Continue Watching, or Watchlist must never send `special_*` as an Xtream provider `category_id`.
- Auto-refresh while a special list is open must not start an All-catalog or synthetic-category request.
- Switching between Movies and Series must release the inactive large catalog from application/service memory while leaving IndexedDB intact.
- If a released request finishes late, it may persist to IndexedDB but must not repopulate the released hot/service cache.


## Home scroll restoration

- Scroll Home below the hero cards, background/reload the page, and verify Home scroll restores without falsely hiding the header.
- Navigate Home -> section -> Home and verify the previous Home position can be restored from the saved scroll key.
- Clearing a completed Home global search releases search-owned full catalogs from service/hot memory while leaving IndexedDB intact.
