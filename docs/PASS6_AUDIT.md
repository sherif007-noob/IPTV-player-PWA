# Pass 6 Implementation Audit

Date: 2026-09-18

This audit reviews the combined implementation from Passes 1–5 as a system, not as isolated commits. The original WebOS repository was not modified; this audit applies to `sherif007-noob/IPTV-player-PWA`.

## Scope reviewed

- design tokens and semantic visual primitives
- overlay/frosted scroll-aware header
- header control sizing/centering
- player OSD design and auto-hide state machine
- sidebar gesture/backdrop behavior
- shared modal/focus stack
- Home, cards, Details, Search, Settings, PWA, Remote HUD, Offline surfaces
- iPhone landscape scrolling
- VOD/Series catalog loading and memory behavior
- IndexedDB persistence and stale refresh
- app/category/scroll restoration
- playback progress persistence
- HLS/far-seek architecture preservation
- project documentation and QA contract

## Fixed during Pass 6

### Catalog and memory

- Special Favorites/Watchlist/Continue Watching lists no longer force a full Movies/Series provider fetch. They render directly from persisted user state.
- Entering a special VOD/Series list releases the currently held catalog array from React state to reduce iOS memory pressure.
- Catalog completeness is now tracked accurately: loading a category subset marks the React array as a subset rather than pretending it is still the full catalog.
- Home global search lazily loads missing full VOD/Series catalogs only when the user actually searches.
- Full arrays loaded solely for Home search are released when no longer needed, except when navigation transfers ownership to the matching Movies/Series view.
- Category "All" count is hidden while only a subset/special list is loaded instead of displaying a misleading subset count.

### Cache correctness

- Added a wrapper hot-memory cache before IndexedDB to avoid repeated IndexedDB transactions for hot catalogs.
- Stale persistent catalogs now force the wrapped Xtream RAM cache cold before background refresh so stale-while-revalidate can actually reach the provider.
- Manual invalidation clears hot + persistent catalog caches.
- Built-in demo fallback catalogs returned after a real-provider failure are rejected and are never persisted as provider data.
- Legacy persisted demo-fallback entries are detected and self-healed.

### iOS state/progress resilience

- Playback progress mutation now writes synchronously to localStorage as part of the mutation, so `visibilitychange` / `pagehide` safety does not depend on a later React effect.
- Continue Watching presentation deduplicates multiple episode records from the same Series into one Series card while preserving episode-level records for resume/details.

### Progress identity

- Normal progress replacement/removal is keyed by content type + ID instead of ID alone.
- Card/details progress lookup is type-aware, preventing overlapping Live/VOD/Series numeric IDs from reading each other's progress.

### Player behavior

- Control auto-hide remains generation/deadline owned; no second independent hide timer was introduced.
- Paused, buffering, error, episode-drawer, scrubbing, and keyboard-focus states pin controls visible.
- Mouse video clicks no longer hide controls while the player is in a pinned state.
- Existing HLS/native-HLS/generated-HLS/far-seek functions remain present.

### Sidebar/modal interaction

- Compact sidebar backdrop now remains mounted through the click gesture and closes on the click itself.
- Pointer down/up stop propagation without canceling the click Safari needs to close the drawer.
- Shared dialog focus restoration now respects a remaining topmost stacked dialog instead of restoring focus outside it.

### Visual-system completeness

- Home portal now uses shared card motion/glass/action primitives instead of its own backdrop-blur implementation.
- webOS Magic Remote HUD migrated to semantic glass controls and TV focus.
- Offline indicator migrated to restrained amber glass and continuous bounce was removed.
- Current major floating surfaces contain no legacy opaque black/slate-90% modal treatments.
- Canonical `.tv-focus` definition is singular and the old 180ms player fade override is gone.

## Playback baseline comparison

The current branch was compared against known-good seek/playback commit:

`7c841256835357a96b2a05b30e95a0cfbe43ba58`

The comparison shows:

- `server.ts` changed by one line for the intentional default port change to 8080.
- `src/services/xtream.ts` is not part of the UX-pass diff from that baseline.
- `VideoPlayer.tsx` contains the expected interaction/OSD additions while the generated-HLS, native-HLS, hls.js, absolute-start/far-seek markers remain present.

Real playback behavior still requires device/runtime testing.

## Static verification completed

Current-main source inspection confirms:

- one canonical `.tv-focus` base definition
- old 180ms OSD fade removed
- old duplicate focus block removed
- semantic tokens present
- real overlay header rules present
- generation/deadline player controls present
- eager startup VOD/Series full preload absent
- IndexedDB + in-flight request dedupe + hot catalog layer present
- session/scroll persistence present
- synchronous progress write present
- modal backdrop gesture validation present
- documentation reflects current cache/player/header architecture

## Automated build status

The model's isolated local runner could not clone the repository because outbound DNS access to GitHub is unavailable in that environment. Therefore Pass 6 does **not** claim a fresh local `npm run lint` / `npm run build` result.

The GitHub connector's combined-status endpoint returned no statuses for the latest push, and its commit workflow-run helper exposes pull-request-triggered runs only. A new green push Action or a user-run local build is still required for final automated confirmation.

## Needs real-device confirmation

- strength/quality of actual header backdrop frost on iPhone Safari
- scroll-down hide / scroll-up reveal feel
- phone header icon centering
- sidebar one-tap close without card click-through
- iPhone portrait/landscape scroll behavior
- player single-tap 3-second visibility
- paused/buffering/episode-drawer pinned controls
- double-tap +/-10 seeking
- scrub/far seek
- native iPhone HLS
- desktop hls.js
- app background/lock/reload restoration
- webOS remote/focus behavior
- iPad split/narrow layouts

Use `UX_QA_CHECKLIST.md` as the final gate.

## Known limitations

- iOS may kill a Safari/PWA process under memory pressure. The app can restore cached/state data but cannot preserve the destroyed media decoder.
- First uncached Home global search still requires loading full Movies/Series catalogs because the current cross-library search works over local catalog metadata.
- A stale-while-revalidate background refresh updates cache; an already rendered React list may continue showing its stale snapshot until the next data load.
- The underlying Xtream service can still produce demo fallback arrays internally on provider errors; the persistence wrapper now rejects them for real-provider catalog results.
- `src/index.css` remains large and contains responsive overrides with deliberate `!important` usage to override utility classes. Critical selector conflicts were audited, but splitting the stylesheet would be a future maintainability improvement.

## Optional future improvements

- Commit a package lock and return CI to deterministic `npm ci`.
- Split `src/index.css` into design tokens, shell/responsive, player, modal/details, and component layers while preserving source order.
- Add true list virtualization for extremely large rendered catalogs if chunked rendering becomes insufficient.
- Add a provider-backed search endpoint only if the target Xtream servers expose a reliable search capability; otherwise retain lazy local full-catalog search.
- Add automated browser interaction tests for header scroll direction, sidebar backdrop gestures, dialog focus stack, and player OSD timer semantics.


## Final Pass 6 hardening addendum

The final audit round added these additional protections after the initial report was written:

- Provider/catalog requests now use a request-generation guard so a late response from Movies/Series/category A cannot overwrite a newer active section/category.
- `special_*` synthetic categories are explicitly blocked at the generic provider-loading boundary and in automated refresh handling.
- Switching sections releases the inactive VOD/Series catalog memory while IndexedDB remains intact.
- Catalog memory release increments a memory generation; a network request that started before the release may still persist its result to IndexedDB, but it cannot repopulate the released hot cache and its wrapped service cache is cleared on completion.
- Category-first loading no longer deserializes a persistent full `all` catalog merely to serve one missing category. Persistent exact-category cache is preferred; otherwise the provider category endpoint is used. A full catalog is filtered only when it is already hot in memory.
- Home scroll is now stored/restored through the same lightweight scroll-key system as library/category views.
- Navigation/category transitions save the outgoing scroll surface before changing state.
- Completed Home global-search catalogs are released from service/hot memory when search is cleared.
- VOD/Series catalog counts are persisted separately as tiny provider-scoped metadata (`iptv_catalog_counts_v1`) so the Home dashboard keeps accurate last-known counts after heavy arrays are released or Safari reloads.
- The header icon-only CSS breakpoint now ends at 639px to align with Tailwind's `sm` label breakpoint; the active Home icon contrast and clear-search centering were also corrected.
- Duplicate Home/Stream card transform rules and explicit poster zoom classes were removed so `.interactive-card` is the sole owner of card lift/press/poster zoom behavior.

These additions are included in the current `UX_QA_CHECKLIST.md` regression gate.


## Final cache-integrity hardening

The last Pass 6 review identified and fixed two additional stale-data hazards:

- VOD/Series detail-request dedupe/cache keys are now provider-scoped (normalized server + username + content ID). Switching providers/accounts can no longer reuse a five-minute detail payload from another provider that happens to share the same numeric ID.
- Persistent catalog invalidation now has a separate persistence generation. Requests that began before a manual persistent-cache invalidation may finish, but they are not allowed to write their old result back into IndexedDB after the invalidation completes. Ordinary navigation-only memory release still permits useful late results to persist for future rehydration.


### Final async-dedupe and detail-cache bounds

- In-flight catalog dedupe cleanup is identity-safe: an older Promise can no longer delete a newer Promise's map entry after invalidation/key reuse.
- Provider-scoped VOD/Series detail caches are bounded and prune expired entries, preventing long-running sessions/provider switches from accumulating detail payloads indefinitely.
