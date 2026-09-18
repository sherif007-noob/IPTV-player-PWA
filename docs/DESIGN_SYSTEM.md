# Design System

This document is the visual contract for IPTV Player. New UI should follow these rules instead of introducing component-specific colors, blur values, glow values, or motion timings.

## Visual identity

The product uses an **obsidian/navy canvas**, restrained **dark frosted glass**, and **electric sky/cyan** interaction feedback. Indigo/violet provide ambient depth, amber is used for favorites/ratings, emerald for progress/status, and rose for destructive/error states.

The interface should feel cinematic and quiet at rest. Strong cyan is intentionally rare: use it for keyboard/remote focus, active navigation, primary actions, and playback progress.

## Surface hierarchy

There are three visual levels.

### Level 0 — Canvas

Content lives on the dark canvas. The body uses `--ds-canvas` with subtle radial sky/indigo atmosphere. Do not turn the application background into flat pure black.

### Level 1 — Content surfaces

Poster cards, episode cards, search rows, and similar content objects use dark translucent surfaces, thin borders, shadows, and interaction motion. Avoid expensive backdrop blur on every media card.

Use:

- `.interactive-card` for card motion
- `.glass-card` when a card genuinely benefits from a translucent surface
- thin `--ds-glass-border` / `--ds-glass-border-soft` borders

### Level 2 — Floating chrome

Real backdrop frost is reserved for UI floating over content:

- app header
- category drawer
- player OSD
- modals
- dropdowns
- floating card actions
- search/settings surfaces
- episode drawer

Use the semantic primitives:

- `.glass-chrome` — strongest floating chrome
- `.glass-surface` — panel/strip
- `.glass-control` — buttons, inputs, compact controls
- `.glass-modal` — modal cards
- `.glass-backdrop` — modal/drawer backdrop

Do not add opaque `bg-black/*` or `bg-slate-900` floating surfaces unless the surface is intentionally media content rather than chrome.

## Canonical tokens

Tokens live at the top of `src/index.css`.

Key values:

- `--ds-canvas: #07090e`
- `--ds-glass-chrome: rgba(7, 12, 26, 0.58)`
- `--ds-glass-panel: rgba(15, 23, 42, 0.62)`
- `--ds-glass-control: rgba(15, 23, 42, 0.54)`
- `--ds-glass-modal: rgba(15, 23, 42, 0.70)`
- `--ds-glass-border: rgba(255,255,255,0.10)`
- `--ds-sky: #38bdf8`
- `--ds-sky-strong: #0ea5e9`
- `--ds-motion-fast: 150ms`
- `--ds-motion-normal: 300ms`
- `--ds-motion-slow: 500ms`
- `--ds-ease-premium: cubic-bezier(0.16, 1, 0.3, 1)`
- `--ds-touch-target: 44px`

## Focus and TV navigation

Every remote/keyboard-selectable interactive element uses `.tv-focus` or `.neon-focus`.

Canonical focused state:

- scale: `1.02`
- outline: 2px `--ds-sky`
- outline offset: 2px
- outer sky glow
- subtle inset sky glow
- z-index raised to 10

Do not replace focus with color-only feedback. Focus must remain spatially obvious on television.

Touch/coarse pointers should not receive sticky hover styling.

## Motion

### Media cards

Primary card interaction:

- whole card: `scale(1.03)`
- vertical lift: `-0.25rem`
- duration: 300ms
- easing: standard/premium ease-out

Secondary image motion:

- image scale: `1.08`
- duration: 500ms

Touch press:

- `scale(0.985)`
- approximately 120ms

Home hero icons may scale to `1.10` with a mild ambient bloom.

### OSD and chrome

Header, drawer, and player OSD transitions use the normal 300ms timing. Avoid bouncy spring motion.

Respect `prefers-reduced-motion`.

## Header

The header is an overlay, not a solid layout block. Content scrolls beneath it so `backdrop-filter` has actual content to frost.

Behavior:

- near the top (<= 12px scroll): visible
- meaningful downward movement (~18px accumulated): hide
- upward movement (~12px accumulated): reveal
- hide/reveal uses translate + opacity
- opening the compact category drawer forces it visible
- focus inside the header forces it visible
- webOS/TV keeps the header visible

Header controls use `.header-control`; phone icon-only controls additionally use `.header-icon-control-mobile`. A 44px hit target is independent from the visible icon size.

## Player

The player uses subtle top/bottom readability gradients plus floating frosted OSD surfaces. Do not return to full-width opaque black control bars.

Use:

- `.player-osd-surface` for top/bottom docks
- `.player-control` for secondary controls
- `.player-primary-control` for play/pause
- `.luminous-progress` / sky gradient for playback progress

See `PLAYER_BEHAVIOR.md` before changing player interaction logic.

## Primary actions

Use `.primary-action` for intentional primary actions outside the player. Do not make every action cyan. Secondary actions should generally be glass controls.

## Accessibility and sizing

- coarse-pointer interactive targets: at least 44px where practical
- readable focus outline must remain visible
- safe-area insets must be respected on iPhone/iPad
- text fields may use the browser-required >=16px effective size on coarse pointers to avoid iOS zoom
- layout must remain usable with TV font scaling from 100% through 210%

## Maintenance rule

Before adding a new color, blur, shadow, focus effect, or motion value, first check whether an existing `--ds-*` token or semantic class already represents the intended meaning. Prefer semantic reuse over local Tailwind styling.
