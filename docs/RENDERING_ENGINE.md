# Rendering Engine

This document describes how ASCII VJ Remix renders sources into ASCII/cell
visual output across browser and Tauri desktop contexts.

Related practice docs:

- [Performance](PERFORMANCE.md) for renderer/output latency and FPS validation.
- [Security](SECURITY.md) for local media, Tauri capability, updater, and
  FFmpeg sidecar boundaries.
- [Testing](TESTING.md) for the current renderer, media, native output, and
  release validation matrix.
- [Accessibility](ACCESSIBILITY.md) and [Internationalization](I18N.md) for
  control-surface UX rules that affect renderer-facing controls.

## Goals

- Preserve the high-quality WebGPU/WebGL output adapted from
  `ascii-point-and-click`.
- Keep ASCILINE's fast Canvas and adaptive stream lineage available as fallback
  and development infrastructure.
- Keep normal app use local-first and offline.
- Keep all live controls routed through one canonical parameter model.
- Allow presets, WTF mode, audio reactivity, and future MIDI control to compose
  without forking renderer state.
- Keep Pop Out output as close to latency-free as possible, especially for live
  camera sources.

## High-Level Data Flow

```text
Source selection
  -> source adapter
  -> canonical params
  -> optional live modulation
  -> effective params
  -> renderer runtime
  -> main preview
  -> optional native/browser Pop Out
```

Source selection can come from built-in media, user-selected files, camera
streams, mixed cameras, or development stream sessions. The renderer runtime
chooses the best backend for the active source and environment.

## Source Layer

### Built-In Media

The visible built-ins are:

- Demo Image: `media/demo.svg`.
- Demo Video: `media/demo-video-2.mp4`.

Hidden fixtures such as `media/point-click-test.mp4` and
`media/point-click-test-30s.mp4` remain for development, parity tests, and
performance smoke tests.

### Custom Files

Browser mode uses browser file APIs and blob URLs. Tauri mode uses a native
dialog command and registers the selected file under a session-local media id.
That media id is exposed to the webview through Tauri's asset protocol.

The important security boundary is that the renderer receives a playable media
URL or registered id. It does not gain broad filesystem access.

### Cameras

Browser camera capture uses `getUserMedia`.

For a single camera:

```text
MediaDevices.getUserMedia
  -> hidden video element
  -> MediaSource abstraction
  -> WebGPU/WebGL2/Canvas renderer
```

For multiple cameras:

```text
N camera streams
  -> hidden video elements
  -> Canvas2D mixer
  -> captured/mixed media source
  -> renderer
```

Camera controls include device selection, capture size, FPS, layout, framing,
and mirror. Facing-mode controls are hidden when irrelevant to the selected
device capabilities.

Tauri native Pop Out has an additional macOS path for single-camera output:

```text
AVFoundation capture
  -> latest BGRA/RGB frame
  -> native output renderer
```

That path avoids WebView canvas readback and was introduced to reduce camera
latency.

### Audio

Audio is not a visual source. It is an analysis source that modulates render
params.

Browser audio sources:

- local audio file.
- mic/input through `getUserMedia`.
- display/tab audio through `getDisplayMedia` when the platform exposes an
  audio track.

Tauri desktop audio sources:

- browser/Web Audio providers where available.
- native system/input audio feature providers for desktop builds.

The audio layer outputs features, not raw visual frames.

### Stream Sessions

Stream sessions are development/advanced infrastructure in 0.9.0.

Legacy path:

```text
Python/FastAPI/OpenCV
  -> ASCILINE frame preparation
  -> adaptive WebSocket frames
  -> JS decoder
  -> Canvas stream runtime
```

Rust/FFmpeg path:

```text
registered media id
  -> Rust media session
  -> FFmpeg probe/decode
  -> Rust frame preparation
  -> adaptive encode
  -> Tauri batch read
  -> StreamRuntime
```

The normal Source UI hides stream mode until this workflow is ready for normal
users.

## Parameter Model

The app maintains one canonical parameter object, commonly referred to in code
as `params`.

Major parameter groups:

- source: source mode, media URL/id, media type, source name.
- camera: selected device ids, resolution, FPS, layout, framing, mirror.
- backend: auto, WebGPU, WebGL2, Canvas2D, Pixel Canvas.
- grid: columns, rows, auto rows, cell width, cell height, aspect correction.
- color: saturation, contrast, brightness, gamma, background blend,
  quantization.
- sampling: FPS, jitter amount, jitter speed, sample X/Y, smoothing.
- glyph/cell: glyph mode, solid mode, compact character set and font family
  menus, minimum glyph intensity.
- stream: codec, quality, tolerance, buffer settings, frame timing.
- UI/performance: stats overlay, transition seconds.

The control surface, presets, persistence, source changes, WTF mode, audio
reactivity, native output, and future MIDI all read from or write through this
model.

### Shared Renderer Math

Version 0.9.2 starts reducing duplicated renderer math without changing visible
Canvas or stream output.

Shared JavaScript helpers live in:

```text
renderers/shared/render-math.js
renderers/shared/render-math-vectors.json
```

The shared module currently owns:

- GPU-style color processing used by software snapshots and native parity tests.
- Legacy Canvas color processing.
- Legacy stream color processing.
- shader-style jitter hash helpers.
- compact charset and luminance-to-glyph helpers.

The legacy Canvas and stream functions are intentionally named separately from
the GPU function. Canvas/stream quantization and background-blend behavior are
preserved in 0.9.2 so this release does not introduce visual regressions while
the shader/math contract is being consolidated.

`npm run test:render-math` validates the JavaScript helpers against shared
vectors. Rust native output tests consume the same vector file for GPU color
processing parity.

### Effective Params

Some features should affect live rendering without changing saved state.

Audio reactivity is the main example:

```text
base params
  + audio feature modulation
  -> effective params
  -> renderer.updateParams()
```

Effective params must not persist back into user presets unless the user
explicitly saves the current state as a preset.

## Backend Selection

Backend `auto` attempts the highest-quality viable path first.

Typical browser priority:

1. WebGPU.
2. WebGL2.
3. Canvas2D.
4. Pixel Canvas when selected or required.

The user can override the backend manually. Controls that do not apply to the
active backend are hidden or disabled.

## WebGPU Renderer

The WebGPU renderer is the primary quality target.

Video sources use `importExternalTexture()` per frame. Image sources upload once
with `copyExternalImageToTexture()` into a `texture_2d<f32>`.

The renderer uses a two-stage GPU flow:

1. Cell pass:
   - divide the source into a grid.
   - sample one point per cell.
   - apply animated per-cell jitter.
   - optionally mirror X.
   - apply color processing.
   - write one processed color per cell to a storage texture.
2. Render pass:
   - draw a fullscreen triangle.
   - map output pixels to cells using cell width/height.
   - fetch the processed cell color.
   - fill the output canvas.

Color processing includes:

- saturation boost around luminance average.
- contrast boost around midpoint.
- brightness.
- gamma.
- optional color quantization.
- background blend toward the app's dark canvas color.

Jitter uses a deterministic hash seeded by cell position and time, so static
images can animate without changing source media.

## WebGL2 Renderer

The WebGL2 backend mirrors the WebGPU visual model as closely as practical:

- video frames upload with `texImage2D()` per frame.
- images upload once.
- first pass samples one color per cell into a cell-color texture.
- second pass expands the cell-color texture to the visible canvas.
- shader uniforms match the WebGPU parameter set where possible.

WebGL2 is the most important browser fallback because it is widely available on
machines that do not expose WebGPU.

## Canvas Renderers

Canvas paths preserve ASCILINE compatibility and low-level fallback behavior.

Canvas2D glyph/text mode renders character-like cells. Pixel Canvas renders
colored block/pixel data more directly.

These paths are important for:

- older browsers or webviews.
- stream-frame compatibility.
- testing the adaptive codec output.
- environments where GPU initialization fails.

Canvas fallback should remain functional even when it is not the highest-quality
path.

## Static Runtime

`StaticRuntime` manages browser-native local sources and GPU/Canvas backends.

Responsibilities:

- load or rebuild the active source.
- choose backend.
- start and stop media playback.
- keep the renderer alive across live-safe param changes.
- rebuild renderer surfaces when structural params change.
- preserve video playback state when changing presets that do not change the
  source.
- update stats.

For structural changes, the runtime uses layered renderer surfaces:

```text
old renderer stays visible
  -> new renderer initializes behind or beside it
  -> non-structural params tween
  -> surfaces crossfade
  -> old renderer is destroyed
```

This avoids black frames during preset transitions.

## Stream Runtime

`StreamRuntime` handles ASCILINE-style encoded frame streams.

It can consume:

- WebSocket frames from the legacy Python/FastAPI server.
- native Rust/FFmpeg session batches in Tauri development paths.

Stream frames carry INIT metadata and framebuffer messages. The JS decoder
supports:

- legacy raw frames.
- adaptive RAW.
- adaptive ZLIB.
- adaptive DELTA.

Stream mode remains hidden from the normal Source UI in 0.9.0. It is retained
for development and future productization.

## Adaptive Codec

The adaptive codec exists to reduce bandwidth compared with sending the full
framebuffer every frame.

Each encoded frame chooses one of:

- RAW: full framebuffer.
- ZLIB: compressed framebuffer.
- DELTA: cells changed since the previous frame.

Codec quality can allow tolerance-based temporal deltas for color planes while
keeping character planes exact where applicable.

Compatibility rules:

- existing legacy clients can still receive raw frames.
- JS and Rust decoders must stay compatible with Python-generated vectors.
- codec changes require vector tests.

## Rust/FFmpeg Media Pipeline

The Rust/FFmpeg path ports the Python/FastAPI stream preparation path toward a
desktop-packaged local engine.

Current shape:

```text
Tauri selected media
  -> Rust registry id
  -> ffprobe metadata
  -> ffmpeg RGB frame reader
  -> frame preparation
  -> adaptive encoder
  -> native session batches
  -> StreamRuntime or validation tools
```

Key modules:

- `media_engine::ffmpeg`: FFmpeg/ffprobe process boundary, video probe, RGB
  reader, camera reader options.
- `media_engine::frame_prep`: ASCILINE-compatible text/color/pixel framebuffer
  preparation.
- `media_engine::codec`: adaptive codec encoder/decoder.
- `media_engine::pipeline`: decode -> prep -> encode -> optional decode
  verification.

Frame preparation modes:

- text mode: grayscale to ASCII palette.
- color modes 2 through 5: `[char, R, G, B]` cells with quantized color levels.
- pixel mode: `[B, G, R]` cells.

The Rust path is not intended to replace the WebGPU/WebGL static renderer. It is
the long-term answer for packaged stream-style media preparation and broader
native decode support.

## Native Output Renderer

The native output renderer exists because a second WebView-rendered pop-out was
too expensive for low-latency live output.

Desktop flow:

```text
main UI params/source state
  -> Tauri native output command
  -> native output state
  -> source frame acquisition
  -> native `wgpu` presenter
  -> output window
```

For file-backed images/videos, Rust resolves bundled resources or registered
media ids, decodes frames, uploads the latest frame to the GPU, applies cell
color math, and presents through the native swapchain.

For macOS single-camera output, AVFoundation captures latest frames directly for
the native presenter.

For glyph-mode presets, native output consumes the same canonical `glyphMode`
and `charset` params as the control surface. The native `wgpu` presenter uses a
bundled fixed bitmap glyph atlas and luminance ramp so traditional ASCII presets
stay text-like in Pop Out instead of becoming solid color cells.
`fontFamily` remains a preview/control-surface parameter; the native path does
not load arbitrary fonts and instead masks cells through the fixed atlas/ramp.

For fallback/mirrored sources, bounded raw pixel snapshots can be sent from the
main renderer to the native output.

Native output design rules:

- output window should not own broad Tauri permissions.
- presenter should consume latest params live.
- latest-frame semantics are preferred over deep buffering.
- primary renderer behavior must not regress when Pop Out is open.
- browser fallback must remain available.

## Audio-Reactive Modulation

Audio analysis updates effective render params at frame rate.

Features:

- RMS.
- bass.
- mid.
- treble.
- spectral flux.
- beat pulse.
- phase/sway.

Modulation targets are live-safe visual controls:

- brightness.
- contrast.
- saturation.
- gamma.
- background blend.
- jitter amount.
- jitter speed.
- sample offsets.

Structural controls such as source, backend, grid allocation, and camera devices
are not modulated per beat because they would cause renderer churn.

## Presets, WTF Mode, and Future MIDI

These are all control layers over the same parameter model.

Presets:

- apply known parameter sets.
- may specify transition duration.
- can be saved/imported/exported by users.

WTF mode:

- creates randomized target params.
- anchors some random states around extreme preset families and traditional
  ASCII presets.
- transitions indefinitely until stopped.
- avoids unsafe all-white/all-black states.

Future MIDI:

- should use a shared control target registry.
- should call the same setters as visible UI controls.
- should respect live-safe vs structural target metadata.
- should not fork renderer state.

## Packaging and Offline Runtime

The renderer must not depend on online assets at runtime.

Packaged assets include:

- frontend bundle.
- renderer code.
- GPU assets.
- fonts.
- built-in demo media.
- Tauri native code.
- future reviewed FFmpeg sidecars.

Production CSP blocks arbitrary remote HTTP(S) runtime access. The asset
protocol is scoped narrowly and session-locally for user-selected media.

## Testing Strategy

Renderer-related tests should cover:

- static source startup.
- source switching.
- camera source and fake-device paths.
- preset application.
- transition smoothness.
- WebGL2 and Canvas fallbacks.
- output display placement.
- native output performance and log analysis.
- adaptive codec vectors.
- Rust/Python frame-prep parity.
- FFmpeg/OpenCV decode/resize bounded parity.

Useful commands:

```bash
npm run smoke:static
npm run test:output-display
npm run smoke:native-output
npm run smoke:ui-perf
npm run test:vectors
npm run test:frame-prep
npm run test:decode-resize
npm run check:media
npm run test:rust
```

## Open Engineering Work

- Consolidate duplicated color math across WebGPU, WebGL2, Canvas, stream, and
  native output.
- Add more direct texture-sharing camera paths:
  - AVFoundation/CVPixelBuffer/Metal on macOS.
  - Media Foundation/D3D on Windows.
  - PipeWire/V4L2/Vulkan or GLES on Linux.
- Productize stream mode or keep it hidden.
- Add MIDI control registry and native MIDI adapter.
- Improve native system audio capture through narrower platform APIs.
- Add performance tests that reproduce user-reported Pop Out/main-window
  contention automatically.
