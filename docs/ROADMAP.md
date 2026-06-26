# ASCII VJ Remix Roadmap

This roadmap separates the current 0.9.0 feature baseline from planned work.
It is meant to guide product, renderer, desktop packaging, and contribution
decisions.

## Product Direction

ASCII VJ Remix is a local-first renderer lab for live ASCII and cell-based
visuals. It combines:

- ASCILINE's high-performance ASCII video lineage: adaptive frame encoding,
  Python/OpenCV experiments, terminal playback ideas, Canvas fallback paths, and
  stream-oriented media preparation.
- The `ascii-point-and-click` renderer's high-quality WebGPU/WebGL visual
  output and browser-native media-source architecture.
- A Tauri desktop shell that keeps the app standalone, offline by default, and
  usable for live output workflows.

The project is not adopting the point-and-click game UI. The target is a dense
creative control surface for video, image, camera, audio-reactive, and future
MIDI-driven ASCII visuals.

## Current Feature Baseline: 0.9.0

### Local-First Desktop App With Vite Harness

- The same vanilla HTML/CSS/ESM renderer lab runs inside Tauri, with a Vite
  static harness retained for development and smoke tests.
- Vite builds a deterministic `dist/` bundle.
- Runtime assets are copied locally into the build output.
- Packaged desktop builds are designed to run without online connectivity.
- Intentional online runtime paths are limited to the GitHub Releases updater and
  production-only reviewed/sanitized crash report submission.

### Source Workflow

- The normal UI starts in static local-source mode.
- Demo Image is the default startup source.
- Demo Video is the single visible built-in video source.
- Extra point-and-click MP4 fixtures remain hidden development/test assets.
- Custom local image/video files can be selected through the desktop/webview
  file picker path.
- Tauri custom files are exposed through a session-local asset protocol grant,
  not broad filesystem access.
- Camera is a first-class source.
- Multiple camera devices can be selected when the OS and embedded webview allow
  concurrent capture.
- The camera mixer composites multiple cameras locally with Canvas2D.
- Camera controls appear directly below Source while Camera is active.
- Static media URL and manual media-type selectors are intentionally absent from
  the normal UI. Source type is inferred.

### Stream Status

- Legacy FastAPI/WebSocket streaming code remains in the repository.
- The adaptive RAW/ZLIB/DELTA codec is still part of the codebase and test
  suite.
- Rust/FFmpeg media session work exists for future local stream-mode packaging.
- StreamRuntime can consume native session batches in Tauri development paths.
- Stream mode is not yet a normal user-facing source mode.
- The Static/Streaming selector, buffer counter, stream connection label, and
  stream-specific control surface stay hidden until stream mode is productized
  end to end.

### Rendering Backends

- WebGPU is the primary quality target on capable Chromium/WebView runtimes.
- WebGL2 is the main GPU fallback.
- Canvas2D glyph/text and pixel Canvas remain compatibility fallbacks.
- Auto backend selection prefers the best available renderer while preserving a
  manual backend selector.
- The renderer uses a single canonical parameter model for UI controls, presets,
  randomization, audio modulation, and output synchronization.

### Live Renderer Controls

The current control model includes:

- Source: built-in media, custom files, Camera, loop, mute, volume.
- Camera: device multi-select, facing mode when relevant, capture size, capture
  FPS, layout, framing, mirror.
- Backend: Auto, WebGPU, WebGL2, Canvas2D, Pixel Canvas.
- Grid: columns, rows, auto rows, cell width, cell height, aspect correction.
- Color: saturation, contrast, brightness, gamma, background blend,
  quantization, stream color mode where relevant.
- Sampling: target FPS, jitter amount, jitter speed, sample X/Y, smoothing.
- Glyph/Cell: glyph mode, solid mode, compact character set and font family
  menus, minimum glyph intensity.
- Performance: stats overlay, backend status, FPS, grid size.
- Audio Reactivity: source, preset, input device, sensitivity, smoothing, beat,
  bass, mid, treble, live meters.
- Output: Pop Out, output display selector, fullscreen-capable output window.

Controls are conditionally hidden when they are not relevant to the active
source/backend.

### UI Theme

- The UI uses an extreme black/white/grey palette with neon pink and neon blue
  state accents instead of the earlier saturated blue surfaces.
- Dense control layout, compact panel sizing, and VCR-style monospace
  typography are preserved.
- Graphite panel levels separate the app shell, toolbar, inspector, groups, and
  rows without reducing readability.
- White is the primary active/focus accent and replaces the earlier light
  blue/purple surfaces.
- Neon blue is reserved for ready/on states.
- Neon pink is reserved for warning, update, and WTF states.
- Red remains reserved for error states.
- Theme color is centralized through CSS tokens so future palette changes do
  not require scattered hard-coded edits.

### Presets and Transitions

- Built-in presets are read-only.
- Users can save, duplicate, update, delete, import, and export presets.
- Preset panel stays compact while supporting a large preset set.
- Transitions use the configured duration in seconds.
- Numeric params tween smoothly.
- Discrete params flip at controlled points when necessary.
- Renderer rebuilds use two-surface crossfades instead of fade-to-black.
- Transitions preserve media source and video playback time when the source is
  unchanged.
- Current built-ins include:
  - Point & Click Default.
  - Classic Camera ASCII.
  - ANSI Newsprint.
  - Terminal Mono.
  - Dense Typewriter.
  - Neon Sledgehammer.
  - Arcade Rain.
  - Gamma Sinkhole.
  - Chrome Wound.
  - Candy Fragmenter.
  - Posterized Dream.
  - Dead Channel Confetti.
  - Solar Guillotine.
  - Paper Shredder.
  - Cyberdelic Riot.
  - Night Vision Terminal.
  - White-Hot Decoder.
  - Acid Snowstorm.
  - Pixel Mirage.
  - Chromatic Meltdown.
  - Blacklight Crush.
  - Signal Loss.
  - Sugar Voltage.
  - Teletext Reactor.
  - Bitcrush Sunburn.
  - Ditherpunk Ultra.
  - Terminal Collapse.
  - Infrared Riot.
  - Laser Rot.
  - Static Cathedral.
  - Toxic Halftone.
  - Plasma Bruise.
  - Magma Telemetry.
  - Glitch Orchid.
  - Ultraviolet Siren.
  - Neon Razorstorm.

### WTF Mode

- WTF mode toggles continuous randomized transitions.
- It uses randomized transition durations.
- It leans into extreme preset families, traditional ASCII preset anchors, and
  randomized live-safe controls.
- It avoids pure black and pure white output states.
- It does not turn off Stats Overlay.
- Source switching cancels and resumes safely without leaving the renderer stuck
  on the previous source.

### Audio-Reactive Rendering

- Audio Reactivity is enabled by default.
- Mic/Input is the default audio source.
- Concrete audio devices can be selected.
- Switching audio input devices restarts capture automatically.
- Audio file reactivity works locally.
- Browser display/tab audio works when the platform provides audio tracks.
- Tauri desktop builds include native audio capture providers for desktop
  testing.
- Analysis extracts RMS, bass, mid, treble, spectral flux, beat pulse, and a
  phase clock.
- Modulation is applied as effective params and does not persist back into
  saved presets.
- Safe clamps prevent high sensitivity from causing pure black or pure white
  screens.
- Stats Overlay reports the active audio-reactive preset/state.

### Native Output and Pop Out

- The main UI remains the control surface.
- Pop Out opens a separate output window.
- Tauri desktop builds prefer a native `wgpu` output surface.
- macOS uses Metal.
- Windows targets D3D12 through `wgpu`.
- Linux targets Vulkan/GLES through `wgpu`.
- Static images, SVGs, video files, and single-camera sources can use native
  output paths.
- Traditional glyph-mode presets preserve their character-set masks in native
  `wgpu` output.
- Native glyph output uses bounded fixed atlas/ramp resources rather than
  loading user-selected fonts in the native path.
- macOS single-camera Pop Out uses a native AVFoundation capture path to reduce
  camera latency.
- Native-output failures retain a webview/canvas fallback.
- Output display selection is persisted when monitor enumeration is available.
- Secondary-display placement is covered by deterministic simulation tests.

### Desktop Security and Packaging

- Tauri v2 is the desktop shell.
- Production CSP blocks arbitrary remote HTTP(S) runtime access.
- Asset protocol scope is empty by default and expanded only for session-local
  selected media.
- Capabilities are split between main and output windows.
- Main window can select media, manage output, use audio providers, and invoke
  updater actions.
- Output window has minimal listen/close/fullscreen permissions.
- macOS camera, microphone, screen capture, and audio capture usage strings are
  present.
- macOS builds are ad-hoc self-signed by default.
- Developer ID signing/notarization workflow scaffolding exists but is deferred.
- GitHub Releases updater infrastructure is configured.
- Release CI builds signed updater artifacts when the private key is present.
- Production crash reporting captures bounded sanitized frontend, Tauri command,
  and Rust panic reports and sends them through a Cloudflare Worker relay to
  aggregated GitHub issues when enabled.

### FFmpeg and Media Engine Work

- Rust media-engine modules can probe and decode local video through FFmpeg.
- Frame prep can produce ASCILINE-compatible ASCII color and pixel buffers.
- Adaptive codec encode/decode parity is tested.
- FFmpeg sidecars are staged with version, SHA-256, license, source, and NOTICE
  metadata.
- Release CI source-builds pinned FFmpeg 8.1.2 sidecars with network protocols
  disabled and LGPL-compatible configuration.
- Packaged stream mode is not yet promoted to normal users.

### Validation

Current checks include:

- `npm run smoke:static`.
- `npm run check:offline`.
- `npm run check:desktop`.
- `npm run check:release`.
- `npm run test:output-display`.
- `npm run test:updater-manifest`.
- `npm run test:frame-prep`.
- `npm run test:decode-resize`.
- `npm run check:media`.
- `npm run test:rust`.
- `npm run test:vectors`.
- `npm run test:render-math`.
- `npm run test:crash-relay`.
- Native output log analysis and performance smoke helpers.

The maintained validation matrix lives in [Testing](TESTING.md). Renderer and
output performance expectations live in [Performance](PERFORMANCE.md), and the
runtime security model lives in [Security](SECURITY.md).

## Future Features

### Native MIDI Hardware Control

Build the MIDI control layer around a generic control target registry, with the
Evolution/M-Audio UC33e through iConnectivity mioXC as the first validation rig.

Scope:

- Native Tauri MIDI adapter using a cross-platform Rust MIDI backend.
- MIDI input enumeration, connection status, and last-message monitor.
- MIDI Learn mode.
- Mapping persistence separate from visual presets.
- Mapping import/export.
- Soft takeover/pickup for faders and knobs.
- Value shaping: min/max, invert, deadband, smoothing, linear/exponential/log
  curves.
- Button modes: trigger, toggle, momentary, preset next/previous, WTF toggle,
  audio toggle, pop-out actions where safe.
- UC33e starter profile after real hardware messages are captured.
- Fake MIDI event injection for CI.

Regression rule: MIDI must route through the same live-control paths as the UI.
It must not restart media or bypass preset/audio/WTF semantics unless the mapped
target is explicitly structural.

### Productized Stream Mode

Promote stream mode only when it is coherent for normal users.

Scope:

- Decide whether the normal stream path is Rust/FFmpeg, a bundled sidecar, an
  external-server connector, or a combination.
- Keep Python/FastAPI as a development/reference path unless explicitly
  packaged.
- Add a clear Stream source workflow without polluting the default Source panel.
- Restore stream-specific metrics only when useful: buffer, wire/raw bandwidth,
  codec mode, stream latency, reinit status.
- Preserve native output and preset transition behavior in stream mode.
- Verify WebSocket control-message behavior for soft and reinit params.
- Add end-to-end stream smoke tests with representative media.

### Native System Audio Improvements

Improve desktop system audio capture while keeping audio features local.

Scope:

- macOS: migrate from ScreenCaptureKit system-audio fallback toward Core Audio
  Taps so the app can request a narrower System Audio Recording permission where
  possible.
- Windows: add WASAPI loopback.
- Linux: add PipeWire/PulseAudio providers.
- Keep feature frames bounded. Do not stream unbounded raw audio samples over
  Tauri IPC.
- Preserve Web Audio mic/input behavior as the browser-compatible fallback.

### Direct Camera Texture Pipelines

Continue reducing camera latency and copy overhead.

Scope:

- macOS: AVFoundation/CVPixelBuffer to Metal texture sharing.
- Windows: Media Foundation to D3D texture sharing.
- Linux: PipeWire/V4L2 to Vulkan/GLES interop where realistic.
- Native multi-camera mixing without forcing all paths through WebView canvas
  readback.
- Keep latest-frame semantics for live performance instead of buffering old
  camera frames.

### Rendering Engine Consolidation

Reduce duplicated shader/math behavior across browser GPU, Canvas, stream, and
native output paths.

0.9.2 status:

- Shared JavaScript render math helpers and vector fixtures exist under
  `renderers/shared/`.
- GPU color-processing vectors are consumed by both JavaScript and Rust native
  output tests.
- Canvas and stream color helpers remain intentionally legacy-named and
  behavior-preserving. Full numerical unification is still future work.

Scope:

- Define a renderer parameter schema shared by UI, presets, audio, WTF, MIDI,
  browser renderers, stream renderers, and native output.
- Keep color processing numerically consistent across WebGPU, WebGL2, Canvas,
  and native `wgpu`.
- Add golden-output or bounded visual tests for representative presets.
- Make backend fallbacks visible and diagnosable.
- Continue preserving WebGPU/WebGL visual quality while improving native-output
  latency.

### Preset and Profile Management

Expand user-facing preset workflows.

Scope:

- Rename user presets.
- Startup preset selection.
- Preset folders/tags.
- Preset search/filter.
- Separate preset packs from MIDI mappings.
- Import validation with readable errors.
- Export bundles containing visual presets, audio-reactive settings, and future
  MIDI profiles without including private media paths.

### Release Hardening

Move from local/self-signed packages to a smoother public distribution path.

Scope:

- macOS Developer ID signing and notarization:
  - enroll and maintain Apple Developer Program credentials for release signing.
  - store Developer ID certificate and notarization credentials as GitHub
    Actions secrets.
  - build macOS release artifacts with hardened runtime enabled.
  - submit macOS app bundles or DMGs to Apple notarization during release CI.
  - staple notarization tickets to shipped artifacts.
  - validate final artifacts with `codesign --verify`, entitlement inspection,
    `spctl -a -vv`, and a first-open smoke test on a clean macOS machine.
  - keep ad-hoc signing as the local development fallback.
- Windows SmartScreen mitigation:
  - sign Windows installers and executables with an Authenticode code-signing
    certificate.
  - prefer EV code signing if distribution volume or user friction justifies
    the cost and token/CI workflow complexity.
  - add timestamping so signatures remain valid after certificate expiry.
  - keep publisher name, app name, installer metadata, and version metadata
    stable across releases to build reputation.
  - publish release artifacts consistently through GitHub Releases and the
    Tauri updater.
  - document expected first-install SmartScreen behavior while reputation is
    building.
  - smoke-test install/open/update behavior on clean Windows machines, not only
    hosted CI runners.
- Windows installer smoke tests on real machines beyond CI.
- Linux AppImage/deb validation across common distributions.
- End-to-end updater hop tests from an older installed release to a newer one.
- Fixed WebView2 runtime strategy if the Windows app must install without
  online prerequisites.

### Performance Harness

Build repeatable performance tests for renderer and output regressions.

Scope:

- Optimized-build tests only for output-window performance claims.
- Main-window FPS and output-window FPS measured separately.
- Camera latency tests with synthetic or timestamped frames.
- Preset transition smoothness checks.
- Audio-reactivity response-time checks.
- Native output logs with counters for acquired frames, presented frames, param
  version, source version, and display pacing.

### Documentation and Examples

Turn the repo docs into a maintained documentation set.

Scope:

- Keep README user-focused.
- Keep contributor docs tested.
- Keep rendering-engine docs aligned with code changes.
- Keep [Security](SECURITY.md), [Performance](PERFORMANCE.md),
  [Testing](TESTING.md), [Accessibility](ACCESSIBILITY.md), and
  [Internationalization](I18N.md) aligned with the native desktop architecture.
- Add screenshots of the black UI theme for normal user setup, Pop Out, and
  permissions workflows.
- Add hardware setup guides for cameras, audio interfaces, projectors, and the
  UC33e/mioXC rig.
- Add a troubleshooting matrix for permissions, GPU fallback, and output-window
  issues.
- Add automated accessibility checks for keyboard/focus/ARIA behavior.
- Add a bundled i18n catalog only when there is a real localization workflow.

## Open Risks

- WebGPU support varies across browsers and Tauri webviews.
- Linux WebGPU support may remain inconsistent for a while.
- Multi-camera capture depends on OS, camera firmware, USB topology, and browser
  behavior.
- macOS privacy prompts can be sensitive to bundle identifier and signing
  identity.
- FFmpeg licensing must remain an explicit release gate.
- Native media decode and GPU interop differ significantly by platform.
- High-rate future MIDI events could cause UI churn without animation-frame
  coalescing.
- Streaming must not return to the normal UI until it is reliable enough for
  non-developer users.

## Definition of Done for 1.0

- App installs cleanly on macOS, Windows, and Linux.
- Desktop app works offline except for deliberate update checks.
- Demo Image, Demo Video, custom files, and Camera work from first launch.
- Pop Out is performant and stable on the primary supported platforms.
- Presets, WTF, audio reactivity, and live controls do not restart media unless
  the user changes source or a structural rebuild is unavoidable.
- Stream mode is either productized or clearly absent from normal-user UI.
- MIDI controller support is implemented or explicitly deferred from 1.0.
- macOS release artifacts are Developer ID signed, notarized, stapled, and
  Gatekeeper-validated for public distribution, or the release is explicitly
  marked as a local/test build.
- Windows release artifacts are Authenticode signed, timestamped, and tested
  against SmartScreen behavior on clean machines, with remaining first-install
  warnings documented.
- Rendering-engine docs, contributor docs, and changelog match the release.
