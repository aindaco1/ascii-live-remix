# ASCII VJ Remix Renderer Roadmap

## Purpose

ASCII VJ Remix is a fork of ASCILINE focused on renderer experimentation. The goal is to combine:

- The high-performance streamed frame pipeline from this repository: FastAPI, OpenCV frame preparation, adaptive WebSocket codec, audio-master sync, buffering, frame dropping, and Canvas fallback rendering.
- The browser GPU visual output from `ascii-point-and-click`: WebGPU primary rendering, WebGL2 fallback rendering, browser-only media sources, and the point-and-click renderer defaults.

The project is not adopting the `ascii-point-and-click` game UI. This fork should become a renderer lab where video/image sources can be rendered through multiple backends and tuned live with exhaustive controls.

## Confirmed Product Decisions

- The target "quality" is the current WebGPU/WebGL visual output from `ascii-point-and-click`, not its unused glyph atlas/LUT path.
- The app must support both backend-streamed mode and static browser-only mode.
- WebGPU-capable Chromium browsers are the primary target.
- WebGL2 and Canvas are required fallbacks.
- Live reconfiguration over the active WebSocket is preferred.
- Every internal knob should be exposed in the UI.
- Presets are first-class and should switch gracefully over a user-configurable transition duration.
- The rendered output should be able to pop out into its own fullscreen-capable window for use on another display.
- The renderer should start automatically on load with a usable static source when no stream is available.
- The `ascii-point-and-click` renderer and assets should be copied into this repository as source files.
- Browser and Tauri builds should stay local-only at runtime: no CDN decoders, online canvas dependencies, or remote media-provider dependencies in the static path.
- Audio-reactive rendering should be local-only: browser builds use Web Audio against local files, microphone/input streams, or user-selected display audio; Tauri builds should hide platform audio capture behind a desktop adapter.

## Architecture

### Runtime Modes

1. **Stream Mode**
   - Source: FastAPI `/ws` frame stream plus optional `/audio`.
   - Current strengths retained: adaptive codec, audio clock sync, frame buffering, server-side downscale, server-side quantization, and low bandwidth.
   - Client receives decoded frames and hands them to the active renderer backend.

2. **Static Mode**
   - Source: browser-native media (`video`, `image`, local camera, or local multi-camera mix).
   - No Python server required.
   - Uses the copied `ascii-point-and-click` media source and GPU sampling architecture.
   - Can be served by any static HTTP server.
   - Multi-camera input is composited locally through Canvas2D and exposed to the renderers as a single local `MediaStream`.

### Renderer Interface

All renderers should conform to the same interface:

```js
renderer.init({
  targetElement,
  cols,
  rows,
  source,
  params
})

renderer.renderFrame(frame)
renderer.updateParams(params)
renderer.resize()
renderer.destroy()
renderer.getStats()
```

Backends:

- `webgpu`: primary browser GPU path.
- `webgl2`: fallback browser GPU path.
- `canvas2d`: current ASCILINE glyph/text canvas fallback.
- `pixel-canvas`: current ASCILINE pixel frame fallback.

The initial implementation can use a pragmatic adapter layer around the copied point-and-click WebGPU/WebGL2 renderers and the existing Canvas2D path. Later work can consolidate shader code and frame formats.

## Renderer Parameter Model

The app should maintain one canonical parameter object. Controls, presets, URL params, and server control messages all read/write this object.

### Defaults

Use the `ascii-point-and-click` renderer defaults:

```json
{
  "sourceMode": "stream",
  "backend": "auto",
  "cols": 480,
  "fps": 24,
  "saturationBoost": 1.4,
  "contrastBoost": 1.2,
  "cellWidth": 2,
  "cellHeight": 3,
  "solidMode": false,
  "glyphMode": true,
  "bgBlend": 0.3,
  "mode": 5,
  "pixel": false,
  "codec": "adaptive",
  "codecQuality": "lossless",
  "transitionSeconds": 1.5
}
```

### Control Groups

- **Source**
  - stream/static
  - built-in demo video/image selection
  - custom local video/image file picker with Present, Missing, or Needs access status
  - local camera device selection/mixing with permission/status state
  - active source name/status
  - loop
  - muted
  - volume

- **Camera**
  - device multi-select
  - facing mode
  - capture resolution
  - capture FPS
  - mixer layout
  - tile framing
  - local mixer mirror

- **Backend**
  - auto
  - WebGPU
  - WebGL2
  - Canvas2D
  - pixel canvas

- **Grid**
  - columns
  - rows
  - auto rows
  - cell width
  - cell height
  - aspect correction

- **Color**
  - saturation boost
  - contrast boost
  - brightness
  - gamma
  - background blend
  - color quantization
  - render mode

- **Sampling**
  - jitter amount
  - jitter speed
  - sample position
  - smoothing
  - target FPS

- **Stream**
  - adaptive/legacy codec
  - codec quality/tolerance
  - buffer size
  - max buffer multiplier
  - late-frame drop threshold
  - future-frame wait threshold
  - FPS cap

- **Glyph/Cell**
  - glyph mode
  - solid mode
  - character set
  - font family
  - min glyph intensity

- **Performance**
  - stats overlay
  - frame timing
  - wire/raw bandwidth
  - backend capability status

- **Audio Reactivity**
  - local audio file selection
  - microphone/input stream
  - browser display/tab audio when available
  - audio-reactive preset
  - sensitivity
  - smoothing
  - beat, bass, mid, and treble influence amounts
  - live RMS/bass/mid/treble meters

- **Output Display**
  - pop-out window
  - fullscreen request inside pop-out
  - best-effort placement on a secondary display when the browser exposes the Window Management / Screen Details API
  - mirroring status

## Local Environment

Use Podman for a reproducible development shell and Linux virtualenv on macOS. The setup should follow the proven pattern from the sibling `pool` repo:

- Prefer Podman install paths used by Podman Desktop and Homebrew on macOS.
- Detect and export the active `podman-machine-default` socket through `CONTAINER_HOST`.
- Start the macOS Podman machine when it exists but is stopped.
- Retry once when the machine socket is stale.
- Require rootless Podman.
- Smoke-test container execution with a small Alpine container.
- Build one local dev image with Python, FFmpeg, OpenCV dependencies, and Node 24 LTS for JavaScript codec checks.
- Allow `NODE_MAJOR=26 scripts/podman_build.sh` for current-release smoke testing while keeping LTS as the default.
- Create `.venv-linux/` from inside the container so dependency resolution does not depend on the host macOS Python/OpenSSL state.
- Support supervised long-running renderer/static-server commands with `ASCILINE_RESTART=1 scripts/podman_run.sh ...`, restarting unexpected child-command exits until the wrapper is stopped.

Primary commands:

```bash
scripts/podman-doctor.sh
scripts/podman_build.sh
scripts/podman_venv.sh
scripts/podman_run.sh bash
scripts/podman_codec_tests.sh
```

## Live Reconfiguration

### Client-Only Parameters

These can update instantly with `renderer.updateParams()`:

- saturation
- contrast
- brightness
- gamma
- background blend
- jitter amount
- jitter speed
- smoothing
- target FPS
- stats overlay
- transition duration

### Renderer Rebuild Parameters

These may require texture/canvas reallocation:

- backend
- cols
- rows
- cell width
- cell height
- pixel mode
- glyph/solid mode when implemented by different shader programs

The UI should keep the app alive while rebuilding. If a rebuild is needed, initialize the new renderer offscreen or behind the current renderer, crossfade, then clean up the old renderer.

### Stream Control Parameters

These should be sent over the active WebSocket as control messages:

```json
{
  "type": "params",
  "params": {
    "cols": 480,
    "rows": 135,
    "mode": 5,
    "pixel": false,
    "codecQuality": "balanced"
  }
}
```

The server should distinguish between:

- **soft changes**, which can apply immediately to timing/codec parameters.
- **reinit changes**, which require a new `INIT` message and decoder/frame-buffer rebuild while preserving the WebSocket connection.

## Audio-Reactive Rendering

Audio reactivity is an ephemeral modulation layer over the canonical renderer parameters. The saved `params` object remains the source of truth for controls, presets, persistence, source selection, and renderer rebuild decisions. Audio analysis produces `effectiveParams` each animation frame, and renderers consume those effective params for live visual output.

### Browser Sources

- **Audio file:** selected through a local file picker and played through Web Audio. The file remains local and is never uploaded.
- **Mic / input:** captured with `getUserMedia({ audio: true })`; echo cancellation, noise suppression, and automatic gain are disabled by default so analysis receives a cleaner signal.
- **Display audio:** captured with `getDisplayMedia()` when the browser and OS expose a display, window, or tab audio track. This is permission-gated and browser-dependent; Chromium on macOS is most reliable when sharing a browser tab with audio enabled, while app/window capture often omits audio. The UI must treat a video-only display stream as a failed audio source, not as an active listener.

### Analysis Model

- Use one `AudioContext` with an `AnalyserNode` and local source node.
- Extract RMS, bass, mid, treble, spectral flux, beat pulse, and a phase clock.
- Keep analysis low-latency: use an interactive audio context, a short transient analyser for RMS/beat/flux, a higher-resolution spectral analyser for bass/mid/treble, and fast-attack/controlled-release smoothing so rising beats affect renderer params quickly without making releases visually chaotic.
- Keep beat detection simple and deterministic initially: short rolling RMS history, flux confirmation, and cooldown.

### Modulation Semantics

- Audio frames must not mutate or persist `params`.
- Audio frames should only modulate live-safe visual controls by default: brightness, contrast, saturation, gamma, background blend, jitter amount/speed, and sample offsets.
- Structural controls such as backend, source, media URL, grid allocation, camera devices, and shader-program switches remain manual/preset-driven because changing them per beat would cause rebuild churn.
- Manual sliders and preset transitions continue to move the base `params`; audio modulation is recomputed on top of the current base state.
- Stream mode keeps WebSocket control messages tied to base params. Audio changes affect client-side rendering without spamming structural stream controls.

### Tauri Direction

- Keep browser Web Audio providers behind a small audio-source adapter.
- Add Tauri providers later for local audio files selected via dialog and platform-specific loopback/system audio capture.
- Prefer bundling any required native sidecar or Rust audio capture implementation with the app; do not add online audio dependencies.
- Treat system audio capture as platform-specific:
  - macOS app/window/system audio currently uses a native ScreenCaptureKit provider when `getDisplayMedia()` returns no audio track. ScreenCaptureKit is governed by macOS Screen & System Audio Recording permission, so migrate this provider to Core Audio Taps for a narrower System Audio Recording-only prompt once the basic desktop app path is stable.
  - Windows can use WASAPI loopback.
  - Linux may depend on PipeWire/PulseAudio availability.
- Keep modulation output as renderer params so the visual renderer does not care whether the features came from Web Audio or a Tauri-native provider.

## Presets

Presets store complete effective renderer state, not just a partial diff. This makes preset switching predictable and exportable.

```json
{
  "id": "arcade-rain",
  "name": "Arcade Rain",
  "transitionSeconds": 1.5,
  "params": {
    "backend": "auto",
    "cols": 480,
    "cellWidth": 2,
    "cellHeight": 3,
    "saturationBoost": 1.65,
    "contrastBoost": 1.35,
    "bgBlend": 0.25,
    "jitterAmount": 0.45,
    "jitterSpeed": 1.1,
    "solidMode": false,
    "glyphMode": true,
    "mode": 5,
    "pixel": false,
    "codecQuality": "high"
  }
}
```

### Preset Transition Semantics

Preset switching should use a default transition time in seconds. Individual presets may override it.

- Tween numeric client-side parameters with easing.
- Flip boolean/discrete parameters at the midpoint unless they require a renderer rebuild.
- For structural changes, use a two-surface transition:
  - tween non-structural parameters first.
  - keep current renderer visible during the soft tween.
  - initialize the new renderer with the final target state during the last transition phase.
  - crossfade old and new renderer surfaces, never fade to black.
  - preserve source aspect ratio and avoid zooming static media during preset switches.
  - preserve static video playback time and play state when the source file is unchanged.
  - clean up the old renderer.

### Preset Management UI

- Apply preset.
- Save current as preset.
- Update selected preset from current controls.
- Duplicate preset.
- Rename preset.
- Delete user presets.
- Set startup preset.
- Import/export preset JSON.
- Default transition time slider.
- Per-preset transition override.

### Built-In Presets

- **Point & Click Default**
  - Baseline copied from `ascii-point-and-click`.

- **Arcade Rain**
  - Higher saturation, mild jitter, darker blend. Good for neon footage.

- **CRT Ghost**
  - Lower contrast, slight background blend, slow jitter, softer colors.

- **Posterized Dream**
  - Strong contrast, lower color precision, minimal jitter.

- **Night Vision Terminal**
  - High contrast, reduced saturation, green-biased visual profile.

- **Ditherpunk Ultra**
  - High columns, tiny cells, strong saturation. Performance stress preset.

- **Soft Newspaper**
  - Low saturation, higher background blend, wider cells. Print-like.

- **Signal Loss**
  - Medium grid, high jitter, stronger background blend, glitchy but controlled.

- **Cinema ASCII**
  - Stable sampling and 24 FPS for video playback.

- **Pixel Mirage**
  - Solid/cell mode, high columns, boosted saturation.

- **Solar Guillotine**
  - Near-max resolution, hard contrast, high saturation, and fast jitter.

- **Acid Snowstorm**
  - Full saturation, bright exposure, aggressive jitter, and low codec quality for stress testing.

- **Blacklight Crush**
  - Dark, crushed, high-gamma neon look.

- **Velvet Void**
  - Very dark, coarse, low-saturation, heavy background blend.

- **Teletext Reactor**
  - Chunky solid-cell, high quantization, saturated teletext-style rendering.

- **Static Cathedral**
  - Maximum columns, high contrast, heavy blend, and fast jitter.

- **Icewire Grid**
  - Cold monochrome high-detail look with no jitter.

- **Infrared Riot**
  - Saturated, unstable, heat-map-like motion profile.

- **Chrome Wound**
  - Zero saturation, maximum contrast, bright metallic monochrome.

- **Paper Shredder**
  - Huge cells, high quantization, bleached print texture.

- **Whiteout Bloom**
  - High brightness, low contrast, washed-out glare.

- **Terminal Collapse**
  - Dark, coarse, high-jitter, low-color terminal failure mode.

Built-ins should be read-only. Users can duplicate them to customize.

## UI Direction

This is a tool surface, not a landing page.

- First viewport should be the usable lab.
- Large preview/canvas area.
- Top bar for source, backend, play/pause, status, and active preset.
- Right inspector for dense controls.
- Preset rail/list near the controls.
- Pop-out output button in the preview toolbar.
- Compact metrics: FPS, buffer, backend, frame size, wire/raw bandwidth.
- Visual direction inspired by the sibling `240-mp-jellyfin` project: sharp rectangular controls, VCR-style monospace typography, uppercase labels, video-blue surfaces, lavender secondary text, and pale cyan active selections.
- No point-and-click verb bar, inventory, or game UI.

## Pop-Out / External Display Mode

The output surface should support a separate display workflow without making the renderer lab UI fullscreen.

Initial implementation:

- Add a preview-toolbar command that opens a same-origin pop-out window.
- Mirror the active render surface into the pop-out:
  - static WebGPU/WebGL2 canvas when available.
  - static Canvas fallback canvas.
  - stream Canvas output.
- Include a fullscreen command inside the pop-out window because browsers require fullscreen to be triggered by a user gesture in that window.
- Use `window.getScreenDetails()` when available to place and size the pop-out on a non-primary screen.
- Fall back to a normal popup window when multi-screen placement is unavailable, denied, or unsupported.

Follow-up implementation:

- Optionally run a second renderer instance directly in the pop-out window for WebGPU/WebGL backends if canvas mirroring proves lossy or expensive.
- Persist preferred pop-out behavior.
- Add an explicit mirror health indicator.

## Tauri Desktop App Track

The desktop app should be a thin, secure wrapper around the renderer lab, not a rewrite. The static browser-only renderer must remain fully usable in a normal browser and should become the primary packaged experience inside Tauri.

### Packaging Strategy

- Use Tauri v2.
- Keep the frontend framework minimal. The current vanilla HTML/CSS/ESM app can be migrated to Vite without adopting React/Svelte/etc.
- Add a real frontend build step so Tauri packages built assets instead of depending on a dev static server.
- Treat standalone offline operation as a release blocker:
  - no CDN imports, remote decoders, remote fonts, analytics, telemetry, hosted media, or provider SDKs in the packaged runtime.
  - bundle renderer code, demo media, fonts, GPU assets, and any future native capture/stream sidecars with the app.
  - keep network behavior limited to the explicit GitHub Releases updater path and invoke it only through a deliberate app update flow.
  - run an offline bundle check against `dist/` before packaging.
- Keep packaged Tauri runtime policy local-only: production CSP must block arbitrary remote HTTP(S), Tauri capabilities must not grant remote origins command access, and the asset protocol scope should stay empty except for Rust-owned session-local selected media grants.
- Treat the Python/FastAPI stream server as optional:
  - **Default desktop app:** static browser-only renderer, custom local files, presets, pop-out/fullscreen output.
  - **Advanced/dev stream mode:** connect to an external server or launch a bundled sidecar.
  - **Long-term native stream path:** port the server-side media preparation path to Rust/FFmpeg or a standalone sidecar binary so end users do not need Python.
- Bundle built-in demo videos, images, fonts, and renderer assets as Tauri resources.
- Bundle reviewed FFmpeg/ffprobe binaries under `src-tauri/resources/ffmpeg/{os}-{arch}/bin/`; desktop stream commands should prefer env overrides for dev/CI, packaged resources for release, and `PATH` only as a development fallback. Use the staging/check scripts so each packaged binary carries version, SHA-256, license, source, and NOTICE metadata. Release validation must reject sidecars that are not actually standalone, including macOS binaries with absolute Homebrew/MacPorts-style dylib dependencies. The default release workflow now builds sidecars from the pinned official FFmpeg 8.1.2 source tarball with LGPL-compatible, network-disabled flags before packaging.

### File and Media Access

- Keep browser file-picker support for static browser mode.
- Add a Tauri adapter layer for desktop builds:
  - use Tauri dialog APIs to choose files and folders.
  - use filesystem/path APIs only through explicit capabilities.
  - convert selected filesystem paths into webview-loadable media URLs using Tauri's asset protocol.
- Register selected desktop media with a Rust-owned session registry before native stream commands can read it; stream/probe commands should accept only registry ids, not arbitrary paths.
- Keep media path handling behind a small source-provider interface so browser `File`/`blob:` and Tauri filesystem paths are interchangeable from the renderer's perspective.
- Add an audio-source adapter with the same boundary: browser `File`/`MediaStream` sources now, Tauri filesystem/system-loopback sources later.

### Windowing and External Displays

- Map the existing pop-out concept to native Tauri windows.
- Use one main control window and one optional output window.
- The output window should support borderless fullscreen, display selection, and independent size/position persistence.
- Keep browser pop-out behavior as the web fallback.

### Security Model

- Start with a narrow capability set:
  - dialog open-file/open-folder.
  - read access only to explicitly selected media paths.
  - app config/preset storage.
  - process restart capability only for installing signed updater packages.
- Split Tauri window capabilities so the output window cannot open dialogs, create more webviews, enumerate displays, or reposition other windows.
- Keep `withGlobalTauri` disabled unless a specific API requires it.
- Avoid broad home-directory read permissions.
- Set CSP deliberately once asset protocol/media needs are known. **Initial production/dev CSPs are in place and checked by `npm run check:tauri-policy`.**

### Cross-Platform Distribution

- macOS:
  - Apple Silicon release builds.
  - include camera, microphone, and screen-capture usage descriptions before testing media capture in packaged builds.
  - ad-hoc self-sign local/release bundles by default.
  - Developer ID signing/notarization is deferred until the app identity and distribution plan are ready for broader macOS testing.
  - when resumed, automate Developer ID certificate import, hardened-runtime signing, notarization submission, staple, and `spctl` validation once Apple credentials are available.
  - validate fullscreen output-window behavior on secondary displays.
- Windows:
  - WebView2/runtime assumptions documented; prefer a bundled/fixed runtime strategy if the app must install and run without network.
  - NSIS or MSI bundle target after smoke tests.
  - test WebGPU/WebGL2 behavior across Chromium WebView2 versions.
- Linux:
  - AppImage first for portability, then `.deb`/RPM if needed.
  - test WebKitGTK/WebGPU reality early; WebGL2 may be the practical primary backend on Linux Tauri until WebGPU support is proven.

### Tauri Preparation Phases

1. **Frontend Build Readiness**
   - Add `package.json`, Vite, and a deterministic static build output.
   - Preserve the current static-server workflow.
   - Move source files only as much as Vite requires.
   - Add a repeatable offline-runtime check for packaged frontend assets.
   - Status: initial Vite build scaffold is in place. Runtime media, fonts, and renderer asset folders are copied into `dist/` after build so packaged desktop output remains local-only. `npm run check:offline` now rebuilds and scans `dist/` for remote runtime URLs.

2. **Tauri Skeleton**
   - Add `src-tauri/`.
   - Configure app metadata, icon placeholders, main window dimensions, dev URL, and frontend dist path.
   - Verify `tauri dev` on macOS.
   - Keep npm Tauri scripts resilient when Rustup installed Rust but the active shell does not expose `cargo`.
   - Status: initial Tauri v2 project/config files are in place. Rustup has a stable toolchain installed in this environment; npm Tauri scripts now discover that toolchain when `cargo` is not on `PATH`. Cross-platform app icons have been generated from the desktop source icon and are referenced explicitly by the Tauri bundle config.

3. **Tauri Source Adapter**
   - Detect `window.__TAURI_INTERNALS__` or equivalent runtime marker through a small adapter.
   - Implement desktop file selection and media URL conversion.
   - Keep browser file selection unchanged.
   - Status: initial adapter is in place. Tauri builds use a Rust-owned native dialog command, register the selected media under a session-local id, and allow only selected files through the local asset protocol for custom media playback; browser builds keep the existing File System Access / file input path. Selected desktop paths are session-scoped and show **Needs access** after restart until persisted-scope behavior is deliberately added.

4. **Native Output Window**
   - Replace browser pop-out with a Tauri output window in desktop builds.
   - Preserve browser pop-out fallback.
   - Add display selection and fullscreen persistence.
   - Status: native output is in place. Tauri desktop builds now prefer a plain native output window backed by a native `wgpu` surface, using Metal on macOS, D3D12 on Windows, and Vulkan/GLES on Linux. Rust resolves bundled demo media resources or session-registered custom media ids for file-backed video sources, decodes through the bundled FFmpeg path, uploads the latest source frame to the GPU, applies the same cell color math/sample/jitter controls as the browser WebGPU renderer in a compute pass, and updates params live without a second webview-rendered canvas. Static PNG/JPEG/GIF/WebP/SVG images decode locally in Rust and render through the same native GPU presenter. `softbuffer` remains a compatibility fallback if GPU adapter/surface setup or a GPU frame fails. On macOS, single-camera Pop Out now prefers a platform-native AVFoundation capture provider compiled into the Tauri binary: `AVCaptureVideoDataOutput` discards late frames, stores only the newest BGRA frame after RGB conversion, and feeds the existing native GPU presenter without WebView canvas readback, IPC snapshots, FFmpeg subprocess buffering, or FFmpeg FPS conversion. FFmpeg/AVFoundation remains a camera fallback if the native provider cannot start. Multi-camera mix, stream, and other mirrored sources send bounded raw pixel snapshots of the already-rendered main surface into the same native presenter, falling back to encoded snapshots only if raw IPC is unavailable. The older `output.html` webview remains as a fallback for browser builds and native-presenter failures. The main toolbar exposes a persisted output-display selector backed by Tauri monitor enumeration, with auto-external placement as the default when multiple displays are available. A deterministic secondary-display simulation test covers auto-external placement, explicit display selection, stale preference fallback, and browser pop-out screen placement without requiring real multi-monitor hardware in CI. Follow-up work still needs real secondary-display validation plus native multi-camera mixing and stream output; mirrored sources remain bounded by WebView canvas readback plus IPC. The next camera-latency step is replacing the current native RGB copy/upload path with direct CVPixelBuffer/Metal texture sharing on macOS, then adding Media Foundation/D3D texture sharing on Windows and PipeWire/V4L2/Vulkan or GLES interop on Linux.

5. **Optional Stream Sidecar**
   - Decide whether to package Python, package a compiled server sidecar, or port the stream path.
   - If sidecar is used, add lifecycle management, port selection, logs, and crash recovery.
   - Status: in progress. Directional decision: prefer a Rust/FFmpeg port for the long-term packaged stream path. Keep Python/FastAPI as a dev/external-server path until the Rust media pipeline is implemented and tested. The first Rust media-engine slices now own FFmpeg/ffprobe process args, probe local video metadata, stream RGB24 frames without buffering the whole decode, prepare text, `[char,R,G,B]`, and `[B,G,R]` stream framebuffers, and compose decode -> prep -> adaptive encode -> Rust decode verification through the reusable `media_engine::pipeline` module. Tauri now has registered-source probe, pipeline-preview, start-session, read-frame/read-frame-batch, stop-session, and list-session commands that accept selected media ids/session ids, and `StreamRuntime` can consume native session frame batches through the same canvas decode/render path used by WebSocket stream mode. Raw RGB frame-prep parity against Python/OpenCV passes through `npm run test:frame-prep`; FFmpeg/OpenCV decode-resize parity uses bounded metrics through `npm run test:decode-resize`; `npm run check:media` also runs native session preview validation in ASCII-color and pixel modes. FFmpeg resource validation now rejects macOS sidecars that still depend on absolute non-system package-manager library paths. Release CI now source-builds and stages pinned FFmpeg 8.1.2 sidecars before packaging. See `docs/RUST_FFMPEG_PORT.md`.

6. **CI and Release Packaging**
   - Add GitHub Actions matrix builds for macOS, Windows, and Linux.
   - Add smoke tests for static mode and app launch.
   - Add signing/notarization/release steps once app identity is stable.
   - Status: in progress. The desktop workflow installs Node 24 and Rust, verifies the offline frontend bundle, checks the Tauri local-only security policy, runs the output-display simulation, verifies updater manifest generation, and runs a Tauri debug no-bundle build on macOS, Windows, and Linux. The release workflow now builds pinned LGPL FFmpeg/ffprobe sidecars from official source before the release gate, then requires the offline bundle, Tauri policy, output-display simulation, updater manifest test, current-platform reviewed FFmpeg sidecar, and Rust tests before release bundling. Release builds generate signed updater artifacts, self-sign macOS bundles ad-hoc, collect publishable assets, merge platform updater fragments into `latest.json`, and publish installers/updater metadata to GitHub Releases. Post-publish release smoke jobs download the public GitHub Release on real Windows and Linux runners, install the MSI/deb artifacts, verify bundled FFmpeg/ffprobe resources, run a bounded packaged-app launch, and force an updater-hop check/download through the Tauri updater plugin against the signed `latest.json` package. The smoke runner also supports a true previous-installed-version updater install hop; releases before v0.1.5 bootstrap that hook, and later releases automatically update the newest eligible previous release to the just-published version. See `docs/TAURI_RELEASES.md`.

7. **macOS Developer ID Notarization**
   - Add GitHub secrets and workflow steps for Developer ID certificate import.
   - Switch macOS release builds from ad-hoc signing to Developer ID signing when notarization secrets are present.
   - Submit release artifacts to Apple notarization, wait for completion, staple the result, and verify with `spctl -a -vv`.
   - Keep ad-hoc signing as the local/default fallback when Apple credentials are absent.
   - Status: deferred. The initial conditional workflow path and helper scripts are already in place, but this work is intentionally paused until Developer ID credentials and a broader macOS distribution plan are ready. Current macOS builds remain codesign-valid with ad-hoc signing by default. If `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, and App Store Connect or Apple ID notarization secrets are present later, the release workflow can import the Developer ID Application certificate into a temporary keychain, switch to `src-tauri/tauri.notarized.conf.json`, let Tauri sign/notarize/staple the macOS bundle, and run a Developer ID plus Gatekeeper validation step against the generated artifacts.

Reference docs used for the initial plan:

- Tauri v2 prerequisites.
- Tauri v2 project/configuration docs.
- Tauri v2 filesystem, dialog, capabilities, resources, sidecar, and GitHub distribution docs.

## Implementation Phases

### Phase 1: Roadmap and Source Layout

- Add this roadmap.
- Copy point-and-click renderer/media source/assets into this repo.
- Convert page asset paths so the app works from a static server and the FastAPI server.
- Extend FastAPI static serving for copied renderer assets.

### Phase 2: Renderer Lab Shell

- Replace the blog page with a renderer lab app shell.
- Preserve the existing hidden audio element and player/canvas surfaces where useful.
- Add source mode controls.
- Add backend selector and status.
- Add inspector sliders/toggles for all known params.
- Gate inspector controls by active source/backend so every visible knob has an active runtime path.
- Add stats overlay.

### Phase 3: Static Browser-Only Mode

- Load browser-native video/image sources.
- Include two copied point-and-click MP4 fixtures as Demo Video 1 and Demo Video 2.
- Keep any derived transition-test clips out of the visible Source menu unless they add distinct coverage.
- Support automatic media type detection without requiring a user-facing media type selector.
- Support custom local video/image files as a single-select source-list item with Present, Missing, or Needs access status.
- Support local webcam/camera as a browser-only source through `MediaDevices.getUserMedia`.
- Support multiple simultaneous local camera devices when the browser/OS exposes them.
- Composite selected cameras locally with Canvas2D; no camera frames should leave the browser process.
- Keep camera frames local to the browser; do not upload or route them through the Python server.
- Expose camera device selection, facing mode, capture size, FPS, mirror, mixer layout, and framing only when Camera is the active static source.
- Render through copied WebGPU/WebGL2 renderer.
- Keep Canvas fallback path available.
- Allow source URL changes without page reload.

### Phase 4: Stream Renderer Integration

- Keep the adaptive codec decode path.
- Adapt decoded stream frames to the renderer interface.
- Add live WebSocket control messages.
- Add server-side handling for soft and reinit params.

### Phase 5: Presets and Transitions

- Implement built-in presets.
- Persist user presets in localStorage.
- Add import/export.
- Implement numeric tween transitions.
- Implement crossfade renderer rebuild transitions.

### Phase 6: Verification and Tuning

- Run codec vector tests.
- Run stream legacy/adaptive e2e tests when media is available.
- Add browser smoke tests for:
  - static source load.
  - WebGL2 fallback.
  - Canvas fallback.
  - preset application.
  - live slider changes.
  - live stream reinit controls such as stream mode, pixel mode, grid size, and FPS cap.
  - conditional control visibility for stream, static GPU, and static Canvas contexts.
  - transition crossfade.
- Capture screenshots and inspect visual layout at desktop and mobile-ish widths.

### Phase 7: External Output Workflow

- Add pop-out output mirroring.
- Add in-pop-out fullscreen controls.
- Add best-effort secondary display placement through the Screen Details API.
- Validate static and streamed output mirroring.

### Phase 8: Desktop App Preparation

- Add a Vite build path while keeping static browser mode. **Done.**
- Add a Tauri v2 skeleton after the frontend build is deterministic. **Done.**
- Add a source-provider adapter for browser files vs. Tauri-selected filesystem paths. **Done.**
- Add a Rust-owned selected-media registry for Tauri native stream/probe commands. **Initial implementation done.**
- Implement a native Tauri output window after browser pop-out behavior stabilizes. **Native `wgpu` video/static image/SVG/single-camera output is preferred; `softbuffer`, raw-pixel mirror surfaces, and old webview output remain fallbacks.**
- Decide on the stream sidecar/native rewrite strategy before packaging stream mode for end users.
- Validate native stream session batches through the Rust/FFmpeg media pipeline before packaging stream mode. **Initial implementation done.**
- Keep `npm run check:offline`, `npm run check:desktop`, and `npm run smoke:static` passing before packaging changes.

### Phase 9: Audio-Reactive Controls

- Add the compact Audio Reactivity panel.
- Add local audio file, input, and display-audio sources through Web Audio. **Initial implementation done.** Mic/input starts automatically, concrete input devices are selectable without a synthetic Default row, switching input devices restarts capture, and browser display capture now rejects video-only streams with a clear status.
- Add analysis meters and audio-reactive presets.
- Route generated features through a non-persistent `effectiveParams` layer.
- Verify static GPU/WebGL, Canvas fallback, stream Canvas, preset transitions, and pop-out output continue to consume current render params without regressions.

### Phase 10: Native System Audio Providers

- Add a Tauri audio-source adapter branch for native feature streams so renderer modulation remains DRY across Web Audio and Rust-native providers.
- Implement macOS native system audio capture:
  - current bridge: ScreenCaptureKit `SCStream` with `capturesAudio`, stereo 48 kHz audio, and current-process audio excluded where possible.
  - next bridge: Core Audio Taps (`AudioHardwareCreateProcessTap`/aggregate-device tap) with `NSAudioCaptureUsageDescription` so ASCILINE can request System Audio Recording only instead of Screen & System Audio Recording.
  - support all-system audio first, then app/process-level filtering if the Core Audio Tap path proves stable.
  - analyze PCM in Rust or forward bounded feature frames to JS; do not stream raw unbounded audio samples over Tauri IPC.
  - preserve current mic/input Web Audio behavior as the default and use native system audio only when the user selects System Audio in Tauri.
  - keep all implementation and dependencies bundled locally with the app.
- Add Windows WASAPI loopback and Linux PipeWire/PulseAudio providers after macOS is stable.

## Validation Strategy

Existing:

- `experiments/gen_vectors.py`
- `experiments/check_vectors.js`
- `experiments/test_e2e.js`
- `src-tauri/examples/check_codec_vectors.rs`
- `npm run test:vectors`
- `npm run test:frame-prep`
- `npm run test:decode-resize`

New:

- Static browser smoke test with generated or copied test media.
- Screenshot checks for the lab UI.
- Param update checks through DOM events.
- Fake-device camera smoke test for Camera selection, permission/status UI, device constraints, mirror toggle, presets, and fallback backends.
- Simulated multi-camera smoke test for the local camera mixer, device checklist, layout switching, and Canvas2D capture stream output.
- WebSocket control-message test once server handling is in place.

## Open Technical Risks

- Browser support for WebGPU varies; WebGL2 fallback must remain reliable.
- Static browser mode cannot load arbitrary local files without user selection or HTTP serving.
- Local camera capture requires a secure context such as `localhost` and explicit browser permission; device labels may remain blank until permission is granted.
- Simultaneous multi-camera capture depends on browser, OS, and hardware availability; some devices may reject concurrent capture or fixed constraints.
- Desktop packaging has initial macOS camera, microphone, and screen-capture usage descriptions; permission behavior still needs hands-on packaged-app validation across macOS, Windows, and Linux.
- Some WebSocket changes are not truly soft because OpenCV decoder resize changes require reinitialization.
- `ascii-point-and-click` assets include glyph/LUT files that are not part of the current quality target; keep them vendored for future experimentation but do not block the WebGPU/WebGL block-rendering path on them.
- TIFF support is disabled until a local decoder is vendored; the static/Tauri path must not load a CDN decoder.
- Homebrew FFmpeg is useful for development but is commonly GPL-enabled and dynamically linked against `/opt/homebrew`; standalone release packaging needs an explicit license decision and a self-contained sidecar build with bundled-relative dependencies.

## Definition of Done

- The repo documents the plan and architecture.
- The app launches into a renderer lab, not a blog page.
- Users can switch between stream and static modes.
- Users can render built-in media, custom local files, and one or more local camera sources without server upload.
- Users can tune exposed renderer, stream, and performance parameters live where technically possible.
- Users can create, save, import/export, and apply presets.
- Preset switches animate gracefully using the configured transition time.
- WebGPU is primary, WebGL2 fallback is available, Canvas fallback remains available.
- Existing codec tests still pass.
