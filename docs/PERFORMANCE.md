# Performance

This guide documents the current performance model, target behaviors, and
validation practices for ASCII VJ Remix.

Performance work is about frame pacing, GPU
output, media decode, camera latency, audio-reactive response, native Pop Out,
and keeping the dense control UI responsive while the renderer is under load.

## Performance Principles

- Test performance with optimized builds when making performance claims.
- Preserve renderer quality before accepting a faster but visibly worse path.
- Avoid renderer restarts for live-safe control changes.
- Prefer latest-frame semantics for live camera and output paths.
- Keep main preview and Pop Out FPS measured separately.
- Keep audio analysis responsive without shipping raw unbounded audio buffers
  across IPC.
- Keep randomization, presets, audio reactivity, and MIDI on the same coalesced
  live-control path.
- Keep all runtime assets local so performance does not depend on network
  availability.
- Keep crash reporting off the render path. Capture, queueing, sanitization, and
  submission must be bounded and must not block frame presentation or live
  controls.
- Watch thermals and battery. This app can intentionally keep CPU, GPU, camera,
  media decode, and audio analysis active.

## Practical Targets

These are practical targets, not hard guarantees across all hardware.

| Area | Target |
| --- | --- |
| Demo Image | Renderer starts automatically and remains responsive while presets/WTF/audio change params. |
| Demo Video | Smooth playback through source switches and preset transitions without restarting video unless source changes. |
| Main preview | Should not collapse to low single-digit FPS when Pop Out is open on supported hardware. |
| Pop Out | Native output should approach display refresh on Demo Image and Demo Video in optimized builds. |
| Camera Pop Out | Prefer latest-frame native capture/presentation paths to minimize visible latency. |
| Audio reactivity | Visual response should feel immediate while preserving stable RMS/band/beat analysis. |
| Source switching | Built-in image/video switches should be bounded and should not leave the renderer stuck. |
| Control UI | Sliders, preset buttons, source selection, and WTF toggle should remain interactive under render load. |

## Renderer Performance Model

The renderer follows this flow:

```text
source adapter
  -> canonical params
  -> optional live modulation
  -> effective params
  -> renderer runtime
  -> main preview
  -> optional native/browser Pop Out
```

Performance regressions often happen when one layer bypasses this model.

Rules:

- Use the canonical parameter model for UI controls, presets, WTF mode, audio
  modulation, native output sync, and future MIDI.
- Batch high-frequency control changes to animation frames where possible.
- Do not rebuild renderer resources for numeric control changes that can be
  updated as uniforms/params.
- Separate source changes from visual param changes.
- Preserve active media playback time when visual presets change.
- Keep discrete changes controlled and predictable during transitions.

## Backend Notes

### WebGPU

WebGPU is the primary visual quality target. It should stay the first choice on
capable Chromium/WebView runtimes.

Watch for:

- external texture import costs on video frames.
- storage texture sizing after grid/cell changes.
- shader changes that increase per-pixel work at high output sizes.
- transition paths that accidentally create extra full renderers for too long.

### WebGL2

WebGL2 is the most important embedded GPU fallback. It should visually track
WebGPU as closely as practical.

Watch for:

- per-frame texture upload cost.
- context loss handling.
- extra canvas readbacks.
- precision differences in gamma, quantization, and saturation.

### Canvas2D and Pixel Canvas

Canvas paths preserve compatibility and ASCILINE lineage. They are not the
highest-quality path, but they must stay functional.

Watch for:

- text/glyph rendering cost at high column counts.
- per-cell loops at high target FPS.
- stream compatibility regressions.

### Native Pop Out

The native output path exists because a second full webview/canvas renderer was
not fast enough for the product goal.

Rules:

- Use native `wgpu` output when available.
- Keep output-window permissions minimal.
- Prefer direct frame transfer or latest-frame native capture paths.
- Keep glyph-mode resources bounded. Character-set changes should update the
  small glyph ramp/params, not trigger unbounded font loading or large dynamic
  atlas allocation.
- Avoid blocking the main UI while the output window presents.
- Keep counters/logs available for frame acquisition, presentation, param
  version, source version, and pacing regressions.

## Source-Specific Budgets

### Static Images

Static image rendering should be the cheapest path. Jitter, audio modulation,
and WTF transitions can animate the output without reloading the image.

Avoid:

- re-decoding or re-uploading the same image for every preset.
- resetting source identity during preset transitions.

### Video Files

Video source changes are structural; preset changes are not.

Avoid:

- restarting video on preset changes.
- waiting for a transition midpoint before applying continuous numeric params.
- doing unnecessary readbacks from the video canvas.

### Cameras

Camera latency matters more than buffering smoothness.

Rules:

- Prefer latest-frame semantics.
- Keep camera resolution/FPS adjustable.
- Do not queue old camera frames when the renderer falls behind.
- Use platform-native capture/texture paths where they produce meaningful
  latency reductions.
- For multi-camera, be explicit about the mixing cost and the selected layout.

### Audio Reactivity

Audio analysis should be stable but not sluggish.

Rules:

- Keep analyzer windows and smoothing low enough for live response.
- Use feature vectors such as RMS, bass, mid, treble, flux, beat pulse, and
  phase rather than unbounded raw samples.
- Clamp modulation so high sensitivity cannot drive pure black or pure white
  screens.
- Restart capture automatically when the selected input device changes.

### Crash Reporting

Crash reporting must stay opportunistic and low overhead.

Rules:

- Capture small structured reports only; do not attach frames, screenshots,
  media files, raw audio, or long logs.
- Keep local queues bounded by report count and byte size.
- Submit asynchronously from Rust with short network timeouts.
- Never wait on crash-report submission before starting renderers, switching
  sources, opening Pop Out, or applying live controls.
- In debug/dev builds, capture locally but refuse network submission.

## Battery and Thermal Guidance

The app can be heavy by design.

For laptop use:

- Use AC power for performances.
- Lower columns, FPS, camera resolution, and jitter when thermals climb.
- Close Pop Out when it is not needed.
- Avoid multiple cameras on battery unless necessary.
- Treat fans and thermal throttling as performance signals, not just noise.

## Validation Commands

General build/offline checks:

```bash
npm run build
npm run check:offline
```

Static/browser harness:

```bash
npm run smoke:static
```

Native output and UI performance helpers:

```bash
npm run smoke:native-output
npm run smoke:ui-perf
npm run test:native-output-log
```

Desktop and release gates:

```bash
npm run check:desktop
npm run check:release
```

Media pipeline:

```bash
npm run check:media
npm run test:rust
```

Secondary-display simulation:

```bash
npm run test:output-display
```

## Manual Performance Checks

Before shipping renderer, source, output, or audio changes, manually verify:

- Demo Image starts on load.
- Demo Video plays without manual renderer start.
- Switching Demo Image and Demo Video is fast.
- Preset transitions are smooth and do not flash original media frames.
- At least one traditional ASCII preset, such as Classic Camera ASCII, renders
  correctly in the main preview and Pop Out.
- WTF mode runs indefinitely and source switching does not wedge the renderer.
- Audio reactivity visibly changes output with Mic/Input selected.
- Pop Out keeps the main preview responsive.
- Pop Out reflects WTF and audio-reactive changes while fully visible.
- Camera Pop Out does not freeze on the first frame.
- Stats Overlay reports believable FPS/grid/source/preset data.

For optimized-build performance claims, use the built app rather than the dev
server or debug bundle.

## Regression Signals

Investigate immediately when:

- main preview caps at a low FPS only while Pop Out is open.
- Pop Out only updates correctly when dragged partly off screen.
- preset transitions pause before numeric params start changing.
- video restarts on preset change.
- source switching takes multiple seconds for built-in media.
- audio reactivity has obvious visual delay after beat/transient changes.
- camera output freezes or accumulates stale frames.
- CPU/GPU usage spikes after closing Pop Out.

## Future Performance Work

- Repeatable optimized-build benchmark suite.
- Synthetic timestamped camera latency tests.
- Audio-reactivity response-time tests.
- Golden-output or bounded visual tests for representative presets.
- Native texture-sharing paths on Windows and Linux comparable to the macOS
  camera/output work.
- Performance dashboards for main preview FPS, output FPS, frame drops, and
  param-version propagation.
