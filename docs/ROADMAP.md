# ASCILINE Remix Renderer Roadmap

## Purpose

ASCILINE Remix is a fork of ASCILINE focused on renderer experimentation. The goal is to combine:

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

## Architecture

### Runtime Modes

1. **Stream Mode**
   - Source: FastAPI `/ws` frame stream plus optional `/audio`.
   - Current strengths retained: adaptive codec, audio clock sync, frame buffering, server-side downscale, server-side quantization, and low bandwidth.
   - Client receives decoded frames and hands them to the active renderer backend.

2. **Static Mode**
   - Source: browser-native media (`video`, `image`, or canvas-backed TIFF decode).
   - No Python server required.
   - Uses the copied `ascii-point-and-click` media source and GPU sampling architecture.
   - Can be served by any static HTTP server.

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
  - media URL
  - media type
  - loop
  - muted
  - volume

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
- Treat the Python/FastAPI stream server as optional:
  - **Default desktop app:** static browser-only renderer, custom local files, presets, pop-out/fullscreen output.
  - **Advanced/dev stream mode:** connect to an external server or launch a bundled sidecar.
  - **Long-term native stream path:** port the server-side media preparation path to Rust/FFmpeg or a standalone sidecar binary so end users do not need Python.
- Bundle built-in demo videos, images, fonts, and renderer assets as Tauri resources.

### File and Media Access

- Keep browser file-picker support for static browser mode.
- Add a Tauri adapter layer for desktop builds:
  - use Tauri dialog APIs to choose files and folders.
  - use filesystem/path APIs only through explicit capabilities.
  - convert selected filesystem paths into webview-loadable media URLs using Tauri's asset protocol.
- Keep media path handling behind a small source-provider interface so browser `File`/`blob:` and Tauri filesystem paths are interchangeable from the renderer's perspective.

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
  - optional process capability only when sidecar stream mode is enabled.
- Keep `withGlobalTauri` disabled unless a specific API requires it.
- Avoid broad home-directory read permissions.
- Set CSP deliberately once asset protocol/media needs are known.

### Cross-Platform Distribution

- macOS:
  - Apple Silicon and Intel builds.
  - signing/notarization before broad testing.
  - validate fullscreen output-window behavior on secondary displays.
- Windows:
  - WebView2/runtime assumptions documented.
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

2. **Tauri Skeleton**
   - Add `src-tauri/`.
   - Configure app metadata, icon placeholders, main window dimensions, dev URL, and frontend dist path.
   - Verify `tauri dev` on macOS.

3. **Tauri Source Adapter**
   - Detect `window.__TAURI_INTERNALS__` or equivalent runtime marker through a small adapter.
   - Implement desktop file selection and media URL conversion.
   - Keep browser file selection unchanged.

4. **Native Output Window**
   - Replace browser pop-out with a Tauri output window in desktop builds.
   - Preserve browser pop-out fallback.
   - Add display selection and fullscreen persistence.

5. **Optional Stream Sidecar**
   - Decide whether to package Python, package a compiled server sidecar, or port the stream path.
   - If sidecar is used, add lifecycle management, port selection, logs, and crash recovery.

6. **CI and Release Packaging**
   - Add GitHub Actions matrix builds for macOS, Windows, and Linux.
   - Add smoke tests for static mode and app launch.
   - Add signing/notarization/release steps once app identity is stable.

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

- Add a Vite build path while keeping static browser mode.
- Add a Tauri v2 skeleton after the frontend build is deterministic.
- Add a source-provider adapter for browser files vs. Tauri-selected filesystem paths.
- Implement a native Tauri output window after browser pop-out behavior stabilizes.
- Decide on the stream sidecar/native rewrite strategy before packaging stream mode for end users.

## Validation Strategy

Existing:

- `experiments/gen_vectors.py`
- `experiments/check_vectors.js`
- `experiments/test_e2e.js`

New:

- Static browser smoke test with generated or copied test media.
- Screenshot checks for the lab UI.
- Param update checks through DOM events.
- WebSocket control-message test once server handling is in place.

## Open Technical Risks

- Browser support for WebGPU varies; WebGL2 fallback must remain reliable.
- Static browser mode cannot load arbitrary local files without user selection or HTTP serving.
- Some WebSocket changes are not truly soft because OpenCV decoder resize changes require reinitialization.
- `ascii-point-and-click` assets include glyph/LUT files that are not part of the current quality target; keep them vendored for future experimentation but do not block the WebGPU/WebGL block-rendering path on them.
- TIFF support depends on UTIF loaded from CDN unless vendored later.

## Definition of Done

- The repo documents the plan and architecture.
- The app launches into a renderer lab, not a blog page.
- Users can switch between stream and static modes.
- Users can tune exposed renderer, stream, and performance parameters live where technically possible.
- Users can create, save, import/export, and apply presets.
- Preset switches animate gracefully using the configured transition time.
- WebGPU is primary, WebGL2 fallback is available, Canvas fallback remains available.
- Existing codec tests still pass.
