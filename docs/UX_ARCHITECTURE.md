# UX Architecture

This document describes the structural interaction model across phone, tablet, desktop, installed PWA, and webOS/TV.

## Application shell

The root is a viewport-sized, overflow-controlled shell. Major screens own their intended scroll surfaces instead of relying on page/window scrolling.

Core layers:

1. scroll-aware top header
2. main body/content stage
3. optional category drawer/rail
4. modal stack
5. fullscreen player
6. optional webOS remote HUD/offline indicators

## Header

The header is an absolute overlay above the content plane. The application measures its real height with `ResizeObserver` and exposes `--app-header-height`.

Content receives enough top spacing to remain initially readable while still scrolling beneath the header, which makes the frost visually meaningful.

Browser/touch header behavior is direction-aware:

- downward scroll hides it after a small movement threshold
- upward scroll reveals it
- tiny jitter is ignored
- near the top it stays visible
- drawer/focus state keeps it visible
- restored scroll positions initialize the tracker and do not count as user scrolling

webOS keeps the header visible for predictable remote navigation.

## Scroll ownership

### Home

`#home-portal-dashboard` is the Home scroll surface.

### Library

`#main-scrollable-content-grid` / `.library-scroll-stage` is the library scroll surface. The breadcrumb/subheader stays in normal flow within that plane, visually continuing the header chrome at the top but scrolling away with the library instead of becoming a second sticky header.

This one-scroll-plane approach also avoids the prior iPhone landscape issue caused by nested viewport-height + overflow containers.

## Category navigation

At >= 768px the category sidebar behaves as a persistent rail. Below that breakpoint it becomes a modal-like drawer using the shared dialog/focus infrastructure.

Compact drawer requirements:

- full-height
- focus trapped while open
- backdrop consumes the whole tap gesture
- backdrop closing must never click the card beneath it
- body scrolling is locked through the dialog infrastructure
- Escape/back closes the drawer before navigating away

## Cards and content density

Large catalogs render incrementally instead of mounting every title at once. The visible count grows in chunks when nearing the bottom or when Load More is activated.

Poster grids are width-driven with `auto-fill/minmax`, avoiding rigid device model assumptions.

Interaction differs by capability:

- fine pointer: hover lift + secondary image zoom
- touch/coarse pointer: press feedback, no sticky hover
- keyboard/remote: `.tv-focus` spatial focus aura

## Modals

`ModalShell` + `useDialog` provide the common modal behavior:

- role/dialog semantics
- focus trap
- Escape closes only the topmost dialog
- opener focus restoration
- stack-safe scroll locking
- backdrop gesture validation
- iOS visual viewport/safe-area sizing

Details, Search, Settings, Exit confirmation, and iOS install instructions all use this foundation.

## Details

Movie and Series details share the modal system but adapt layout by content and viewport.

Phone portrait uses one primary vertical scroll surface. Series season controls remain reachable while episode rows stack vertically.

Tablet/desktop can use denser multi-column episode layouts.

## Player

The player is a fullscreen layer with a separate gesture plane and floating OSD. See `PLAYER_BEHAVIOR.md`.

## Back-navigation priority

Visible-state back handling is ordered:

1. Exit confirmation
2. Player
3. Details
4. Settings
5. Compact category drawer
6. Active header search
7. Category filter
8. Current section
9. Home/root exit behavior

Normal Safari/browser history is not permanently trapped. Installed PWA/webOS may own platform-back behavior.

## Responsive reference points

The current CSS uses capability and width/height queries rather than device-name checks.

Important boundaries include:

- phone-focused styling: <= 640px
- compact category navigation: < 768px
- tablet ranges around 641-1024px
- short landscape handling: max-height 500px
- touch/hover behavior: `(hover)` and `(pointer)` media features

Keep behavior capability-driven when possible.


## Special library lists and Home search

Favorites, Watchlist, and Continue Watching do not require an "All Movies/Series" provider fetch. They are rendered from persisted user-state entries filtered by section.

Home global search is the exception where a full catalog may be required. It is loaded lazily only when the user actually starts a Home search, rather than at application startup. Search-only catalog arrays are eligible to be released after the Home search ends to reduce iOS memory pressure.
