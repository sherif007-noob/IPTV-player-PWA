# IPTV Player PWA

A responsive personal IPTV player for browser/PWA and LG webOS-style use, built with React, TypeScript, Vite, Xtream APIs, native HLS on supported Safari devices, and hls.js on supported desktop browsers.

## Development

Default development URL:

```bash
npm run dev
# http://localhost:8080
```

For a final local verification:

```bash
npm run lint
npm run build
```

The GitHub Actions workflow performs TypeScript validation and the production build. When no package lock exists, CI falls back to `npm install --no-audit --no-fund`.

## Architecture documentation

- [Design system](docs/DESIGN_SYSTEM.md)
- [UX architecture](docs/UX_ARCHITECTURE.md)
- [Player behavior contract](docs/PLAYER_BEHAVIOR.md)
- [Data and cache architecture](docs/DATA_AND_CACHE.md)
- [Cross-device QA checklist](docs/UX_QA_CHECKLIST.md)

## Important playback rule

The existing HLS/seek transport is deliberate. UI/refactor work should not casually rewrite generated-HLS far seeking, native Safari HLS behavior, hls.js behavior, or the backend range bridge. Read `docs/PLAYER_BEHAVIOR.md` before changing playback code.
