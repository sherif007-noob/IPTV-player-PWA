# Player Behavior Contract

The player is a working playback subsystem. UI changes must not casually alter its transport, HLS source switching, or seek architecture.

## Playback architecture

The current flow is:

`Provider -> Node backend/proxy -> HLS -> browser video element`

Platform behavior:

- Safari/iPhone uses native HLS when available.
- Desktop uses hls.js when supported.
- Provider HLS is passed through the HLS playback path.
- Non-HLS VOD/episode media can use generated HLS through the backend.
- Far seeks for generated HLS restart the HLS source with an absolute `start` value.
- The existing range bridge/backend seek transport must remain intact unless a playback-specific change explicitly requires it.

## Control visibility

Player controls use a **generation + deadline** model.

When controls are revealed:

1. every previous hide generation is invalidated
2. controls become visible immediately
3. a fresh visible-until deadline is set (normally 3000ms)
4. only the timer belonging to that generation may hide controls

This prevents stale timers from hiding a freshly revealed OSD.

Controls remain visible while any of these are true:

- playback is paused
- the player is buffering
- a playback error is visible
- the episode drawer is open
- the seek bar is being scrubbed
- keyboard focus is actively inside player controls

Do not reintroduce multiple independent hide timers.

## Pointer/touch gestures

### Single tap/click

When hidden, a normal tap reveals the controls for a fresh visibility window. When already visible, tapping the video gesture area hides the controls.

Touch taps on the left/right zones wait briefly to distinguish single tap from double-tap seeking.

### Double tap

For non-live playback:

- double tap left: seek -10 seconds
- double tap right: seek +10 seconds
- matching side taps within roughly 330ms form a double tap
- repeated skip operations use the seek cursor so rapid skips accumulate correctly

Live playback does not use VOD-style +/-10 double-tap seeking.

## Scrubbing

The seek surface:

- supports pointer capture for continuous drag
- displays a scrub preview time
- commits the target on pointer release
- supports keyboard seeking
- uses the existing far-seek logic when the requested target is outside the currently seekable generated-HLS window

Do not replace far-seek transport with a direct `video.currentTime` assignment for unreachable positions.

## Keyboard controls

The player supports keyboard/remote operation. Preserve:

- Space/play-pause behavior
- Arrow/Page seek controls
- Home/End seek behavior where applicable
- Escape/back handling at the application navigation layer
- visible `.tv-focus` treatment on interactive controls

## Episode behavior

Series playback may expose the episode drawer. Selecting an episode switches playback through the existing application callback. Automatic next-episode behavior must continue to work.

## Progress persistence

Playback progress is recorded periodically and is also flushed when the document becomes hidden or the page receives `pagehide`. This is important on iOS because Safari may discard the page process while backgrounded.

A full iOS process kill cannot preserve the decoder/video element. The application restores persisted progress rather than pretending the media session survived.

## Visual contract

The OSD uses:

- subtle readability gradients
- floating dark frosted-glass top/bottom docks
- glass secondary controls
- cyan primary play/pause
- luminous sky progress
- glass buffering, seek feedback, episode drawer, and error surfaces
- 300ms OSD fade/translate

See `DESIGN_SYSTEM.md` for exact tokens and focus behavior.
