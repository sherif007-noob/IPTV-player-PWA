# Responsive UX behavior and verification

The PWA retains its existing colors, gradients, branding and card styling.

- Playback controls hide after three seconds of inactivity during playback. Tap, pointer movement, or keyboard activity reveals them. Pause, buffering, errors, episode selection, scrubbing and keyboard focus keep controls accessible.
- Two short taps within 320 ms on the same outer 40% of the video seek ten seconds. The center reveals controls. Drags, canceled gestures and control buttons do not trigger a double-tap seek.
- The seekbar has a 44px interaction area around the existing track. Pointer capture allows dragging beyond the bar. Dragging previews the absolute movie time without restarting HLS; release commits once; cancellation discards the preview. Arrow keys seek ten seconds, Page Up/Down one minute, Home/End beginning/end.
- Seeking still calls the original generated-HLS seek function: local seeks reuse the current window; distant seeks keep the 140ms restart debounce and source-time offset. The Node/FFmpeg bridge is unchanged.
- Details, search and settings dialogs dismiss on Escape or a press and release on the backdrop. Focus stays inside open dialogs and returns on close. Short landscape layouts allow series details and episodes to scroll together.
- Dynamic viewport heights and safe-area padding account for browser chrome and device cutouts. Headers wrap at smaller widths. Touch targets are at least 44px, inputs avoid iOS focus zoom, pinch zoom remains available, and touch scrolling does not trigger hover focus. Coarse-pointer iPads use the mobile default text scale unless the user selected a scale.

## Checks

Use a current Node runtime (Node 22 recommended). Run `npm run lint` and `npm run build`.

The browser regression fixture uses stubbed media timing and seekable ranges to exercise interaction logic without provider credentials or FFmpeg traffic. It does not certify real iOS HLS decoding. It covers controls, mouse/touch seeking, commit/cancel behavior, generated-source switching, modal dismissal/focus and phone/tablet/desktop layout bounds.

For physical-device acceptance, check Safari and the installed PWA on iPhone/iPad in both orientations, including browser chrome and keyboard open; verify actual provider playback, rapid skips, paused far-seeks, dragging backward across the generated window, and returning from another app. On desktop, also check Tab/Shift+Tab, Space, arrows and Escape.

Run the browser fixture with Playwright installed in a development/test environment:

```sh
npx vite --host 127.0.0.1 --port 4173
# In another terminal:
node tests/ux/browser.cjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright installation; `CHROME_PATH` can select an installed Chrome executable. Otherwise Playwright uses its bundled Chromium. `UX_SCREENSHOT` optionally saves the phone header view. Fixtures are separate from the production entry point and are not included in the build.
