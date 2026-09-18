# Data and Cache Architecture

The application separates short-lived runtime state, persistent catalog data, and PWA shell caching.

## Catalog strategy

Large VOD/Series catalogs are not eagerly preloaded at startup.

The catalog lookup order is:

1. wrapper hot-memory catalog cache
2. IndexedDB persistent catalog cache
3. wrapped Xtream service / provider network

The persistence wrapper is enabled in `src/main.tsx` by importing `src/catalogPersistence.ts`.

## IndexedDB

Implementation: `src/services/catalogStore.ts`

Database:

- name: `iptv-player-cache`
- version: 1
- object store: `catalogs`
- key: `<provider>::<kind>::<categoryId>`

Catalog kinds currently persisted:

- `vod`
- `series`

The provider namespace uses normalized server URL + username. Passwords are not part of the cache key.

Only metadata/URLs are stored. Poster image blobs are not persisted by this catalog store.

## Request deduplication

`src/catalogPersistence.ts` keeps an in-flight map. Identical VOD/Series catalog requests share one Promise instead of launching duplicate huge provider requests.

This is especially important for very large providers and rapid view/category transitions.

## Freshness

Persistent catalog TTL is currently **6 hours**.

If a cached exact catalog exists:

- return it immediately
- keep a hot in-memory copy for repeated reads without another IndexedDB transaction
- if stale, invalidate the wrapped service RAM cache and start a background provider refresh
- replace hot + persistent data after a successful refresh

If a category-specific cache is missing but an `all` catalog exists, category data may be derived locally by filtering `category_id`.

If no cache can satisfy the request, the provider is queried.

## Manual refresh

Manual refresh clears the service cache and awaits persistent catalog invalidation before re-authenticating/refetching.

The app should not race a provider refresh against deletion of stale IndexedDB records.

## Lightweight UI restoration

Small UI state is stored separately from catalog data.

Current localStorage keys include:

- `iptv_app_session_v1` — stable section + selected category
- `iptv_scroll_v1:<view>:<category>` — scroll position

Transient/sensitive UI such as partially entered Settings credentials is not restored as an application view.

On `visibilitychange` / `pagehide`, the app stores scroll state and the player flushes progress.

## iOS/Safari lifecycle

iOS may kill a Safari/PWA page under memory pressure. The app cannot guarantee the JavaScript process remains alive.

The resilience strategy is therefore:

- avoid eager huge VOD/Series preloads
- cap rendered DOM items
- persist catalog metadata in IndexedDB
- persist lightweight view/scroll state
- persist playback progress before backgrounding
- restore quickly if Safari reloads the page

## PWA service worker

Configured in `vite.config.ts` with `vite-plugin-pwa`.

The service worker caches the application shell/static assets. Navigation fallback excludes `/api/`.

Do **not** blindly runtime-cache Xtream provider API calls or streaming endpoints. Catalog metadata belongs in IndexedDB; streaming data remains transport-controlled.

## Failure behavior

IndexedDB helpers intentionally degrade gracefully. If IndexedDB is unavailable or errors, catalog loading falls back to normal network/service behavior rather than making the app unusable.


## Full-library search and special lists

The app does not keep full VOD/Series catalogs in RAM merely to show Favorites, Watchlist, or Continue Watching. Those special lists are rendered directly from lightweight persisted user state.

Home's "search all library titles" behavior is lazy: the first active Home search loads missing full VOD/Series catalogs on demand (using hot cache / IndexedDB first). Catalog arrays loaded only for that Home search are released from React state when the search ends, while IndexedDB remains available for fast reuse.


## Continue Watching storage

Episode progress is retained per episode so Details can calculate/resume episode-level state. User-facing Continue Watching grids collapse multiple episode records from the same Series into one Series card, using the newest stored order.

Playback progress mutations synchronously write the updated progress list to localStorage. The normal React persistence effect remains as a backup, but iOS background/pagehide safety does not depend on that later effect running.


## Provider failure / demo fallback safety

The underlying Xtream service can return built-in demo arrays when a provider request fails. The persistent wrapper compares returned catalogs against the exported demo fixtures. For a real provider it rejects the fallback result, does **not** write it to hot cache or IndexedDB, and self-heals matching legacy persisted fallback entries before retrying the provider path. This prevents a transient network/provider failure from masquerading as real catalog data or poisoning the persistent cache for the normal TTL.


## Memory release

IndexedDB is the durable catalog layer; full catalogs do not need to stay resident in JavaScript memory after navigation. When the app returns Home or abandons a full-library search, it releases wrapper hot caches and the underlying Xtream service catalog cache. This trades a future IndexedDB read for substantially lower iOS memory pressure.
