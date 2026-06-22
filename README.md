# 🌌 ASCILINE Engine

**ASCILINE** is a high-performance, cross-platform real-time ASCII video rendering engine. **Our core objective is to transform the web into a highly dynamic and interactive typographic canvas.** By mapping pixels to text-based representations, we unlock new possibilities for web media delivery.

| Output | Details |
| :--- | :--- |
| <img src="https://github.com/user-attachments/assets/ccc727c9-c697-49f2-85e1-6f8c366f2019" width="400" alt="Original Source" /> | **Original Source**<br>Standard MP4 video file. |
| <img src="https://github.com/user-attachments/assets/6bd7f5c0-81de-49fe-ba0d-9a8872ec8ae3" width="400" alt="ASCII Mode" /> | **ASCII Mode**<br>Showcases rendered using Mode 3 (32K Colors) from a 30fps source. |
| <img src="https://github.com/user-attachments/assets/1fd88c3d-97d1-441a-a071-16de24ea82c0" width="400" alt="PIXEL Mode" /> | **PIXEL Mode**<br>Showcases rendered using Mode 5 (16m Colors) combined with the `--pixel` flag for ultra-high fidelity. |

## 🎯 Strategic Vision & Core Capabilities

1. **Pure Typographic Manipulation**: The visual stream is not a standard media file—it's raw HTML/Canvas text. This makes the impossible possible: you can apply real-time CSS filters (neon glows, text shadows, animations) to video content.
2. **Local AI & LLM Ready**: By reducing complex pixel streams into structured logical strings, ASCILINE acts as a perfect bridge for AI. Instead of feeding heavy computer vision models, lightweight LLMs can process semantic video summaries.
3. **Ultra-Low Bandwidth & Zero GPU (valid for ASCII MOD)**: Standard codecs (H.264/VP9) require dedicated hardware decoders, choking microcontrollers and weak devices. ASCILINE offloads the heavy lifting to the backend, streaming only lightweight text frames. By scaling down the output quality (using fewer columns), extremely low bandwidth requirements can be achieved. This means you can play fluid, real-time video on devices with constrained networks and zero GPU capabilities (smart appliances, retro terminals, basic microcontrollers).
4. **Bypassing Browser Constraints**: Modern browsers aggressively throttle autoplay videos, and ad-blockers restrict traditional media frames. To the browser, ASCILINE is simply "JavaScript updating a canvas"—completely invisible to media restrictions.

## 🚀 Technical Features

-   **Cross-Platform**: Runs seamlessly on Windows, macOS, and Linux.
-   **Real-Time ASCII Streaming**: Low-latency video-to-ASCII conversion.
-   **Real-Time Pixel Streaming**: Replaces characters with colored blocks, approaching 360p video quality.
-   **High Performance**: Uses **HTML5 Canvas** for rendering, optimized for cinematic 24-30 FPS playback. High-FPS sources are automatically decimated for stability.
-   **Master Clock Sync**: The audio track acts as the absolute master clock, guaranteeing perfect A/V synchronization.
-   **Low-Overhead Binary Protocol*: Frames are streamed as raw binary (`Uint8Array`) directly to the canvas, saving bandwidth and CPU.
-   **Multiple Color Modes**: Supports everything from classic B&W to 16M color ultra-fidelity.
-   **Flexible Video Management**: Supports JSON playlists (per-video mode & volume), 
      folder-based auto-queuing (filesystem order), single-file mode, and infinite loop 
      playback — all controlled via CLI arguments.

## 🛠️ Architecture

1.  **Backend (Python/FastAPI)**: Decodes video using OpenCV, maps pixels to ASCII characters via NumPy, and streams binary data.
2.  **Frontend (Vanilla JS)**: Receives binary frames via WebSockets, manages a jitter buffer, and renders to a Canvas grid.
3.  **Communication**: Optimized WebSocket protocol with a custom `INIT` handshake for dynamic resolution/FPS adjustment.

### Renderer Lab Fork

This fork also includes a browser-only renderer lab that vendors the `ascii-point-and-click` GPU renderer. It can render built-in demo media, user-selected local files, and one or more local cameras through WebGPU first, then WebGL2 or Canvas fallbacks. Multi-camera input is composited locally with Canvas2D and exposed to the renderer as a normal local media stream. Local files and camera frames stay in the browser; they are not uploaded to the Python server or fetched through online services.

For static browser-only testing, serve the repo over localhost and open the page:

```bash
python3 -m http.server 8010 --bind 127.0.0.1
```

Open `http://127.0.0.1:8010/`. The renderer autostarts with Demo Video 1. Select **Camera** in the Source panel to request webcam access; camera support requires `localhost` or another secure browser context and explicit browser permission. After permission is granted, select multiple camera devices in the Camera panel to build a local camera mix with grid, split, stack, or PiP layouts.

The browser/Tauri path is local-only at runtime. TIFF files are intentionally disabled until a decoder is vendored into the app; no CDN decoder is loaded.

The renderer lab also includes an **Audio Reactivity** panel. It can analyze a local audio file, a microphone/input stream, or browser-supported display/tab audio through Web Audio and modulate live visual renderer params without changing saved presets or uploading audio. Browser display audio is permission-gated and platform/browser-dependent; on Chromium/macOS, sharing a browser tab with audio is the reliable path, while app/window capture often provides no audio track. Future Tauri builds should provide native local-file and system-loopback providers behind the same adapter boundary.

### Frontend and Tauri development

The renderer lab now has a minimal Vite build so the same vanilla HTML/CSS/ESM app can run in a browser or be packaged by Tauri.

```bash
npm install
npm run dev         # Vite dev server on http://127.0.0.1:8010/
npm run build       # static production build in dist/
npm run preview     # preview the production build
npm run check:offline
npm run check:desktop
npm run check:release
npm run check:bundle:debug
npm run smoke:static
```

Tauri v2 scaffolding lives in `src-tauri/`. The desktop shell is intentionally thin: it loads the built renderer lab and keeps browser local-file/camera/audio behavior intact until the native source and output-window adapters are added.

```bash
npm run tauri:dev
npm run tauri:build
```

Tauri commands require the Rust toolchain (`cargo`) in addition to Node 24+. The app config points Tauri dev mode at Vite on `http://127.0.0.1:1420` and production builds at `dist/`.
If `rustup` has installed Rust but `cargo` is not on the shell `PATH`, the npm Tauri scripts will prepend the active Rustup toolchain automatically.

The packaged desktop app must be standalone at runtime. Renderer code, demo media, fonts, GPU assets, decoders, native adapters, and future sidecars should be bundled with the app. Online access is reserved for the explicit Tauri updater path hosted by GitHub Releases. Use the offline bundle check before packaging:

```bash
npm run check:offline
```

Use `npm run check:desktop` before desktop changes. It rebuilds the offline frontend bundle, checks the Tauri local-only security policy, verifies updater metadata generation, and verifies the Tauri shell with a debug no-bundle build. Use `npm run bundle:debug` when you need a local debug `.app`/DMG package.
Use `npm run check:release` before claiming a standalone desktop release. It runs the offline/Tauri/output-display/updater/Rust gates and requires a reviewed FFmpeg sidecar for the current platform. `npm run bundle:release` runs those release gates before building release-mode desktop bundles.
Use `npm run check:bundle:debug` or `npm run check:bundle:release` after a Tauri bundle build to verify the platform bundle exists and includes required desktop metadata/resources. On macOS this checks the `.app` executable, icon, privacy usage strings, FFmpeg resource README, staged FFmpeg manifest/NOTICE files when sidecars are present, and codesign validity.
`npm run test:output-display` runs a deterministic secondary-display simulation for the native output selector and browser pop-out fallback. It covers auto-external placement, explicit display selection, stale preference fallback, and single-display fallback without requiring a real second monitor in CI.

Tauri updater infrastructure is configured for GitHub Releases. Release builds create signed updater artifacts, the release workflow merges platform fragments into `latest.json`, and `plugins.updater.endpoints` points at the latest GitHub release metadata. The private updater signing key must live in the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`; see `docs/TAURI_RELEASES.md`.
On macOS workspaces stored under iCloud Drive, Tauri build output is redirected to `/private/tmp/asciline-remix-tauri-target` so `.app` signing is not broken by iCloud extended attributes. Non-iCloud and CI builds keep the normal `src-tauri/target` output unless `ASCILINE_TAURI_TARGET_DIR` or `CARGO_TARGET_DIR` is set.

The desktop build now includes the Tauri dialog plugin for custom media selection. Files selected through the native dialog are exposed to the webview through Tauri's local asset protocol for the current app session. The app stores the display metadata, not a durable broad filesystem grant; after restart, reselect the file if the Source panel shows **Needs access**.

The packaged Tauri app uses a production Content Security Policy that blocks arbitrary remote HTTP(S) connections, keeps the asset protocol scope empty by default, and relies on Rust to grant session-local access to user-selected media. Development mode has a separate localhost-only CSP for Vite and local stream testing.
Tauri capabilities are split by window: the main renderer lab can open media files and create/place output windows, while the fallback webview output can only listen for render-state events, close itself, and toggle fullscreen. The preferred desktop output is a plain native window with no webview command surface.

macOS bundles merge `src-tauri/Info.plist`, which declares camera, microphone, and screen-capture usage strings for the local camera mixer and audio-reactive inputs. Platform-specific system audio loopback providers are still future native-adapter work.
macOS bundles are ad-hoc self-signed by default with `bundle.macOS.signingIdentity: "-"`. This makes the `.app` codesign-valid, but it is not Apple Developer ID notarization; downloaded public releases may still need Gatekeeper approval until Developer ID signing/notarization is added.

The **Pop Out** command uses a native Tauri output window in desktop builds. The toolbar **Output** selector chooses the target display when Tauri can enumerate monitors, and defaults to an external display when one is available. File-backed video and static PNG/JPEG/GIF/WebP/SVG image output now prefer a native `wgpu` presenter: Metal on macOS, D3D12 on Windows, and Vulkan/GLES on Linux. The presenter uploads the latest decoded source frame, runs the same cell color/jitter math in a GPU compute pass, then presents through a native swapchain surface with `softbuffer` retained as fallback. On macOS, a single selected Camera source uses FFmpeg/AVFoundation directly in Rust before the native GPU/softbuffer presenter so the output window bypasses WebView canvas readback and IPC. Multi-camera mix, stream, and other mirrored sources send bounded raw pixel snapshots of the already-rendered main surface into the native presenter, falling back to encoded snapshots only if raw IPC is unavailable. Browser builds and native-presenter failures keep the old webview output as fallback.

Stream packaging is being ported through the Rust/FFmpeg media engine rather than bundling Python by default. Browser builds and external-server stream mode still work unchanged, while Tauri stream mode can use registered local media sessions backed by the native pipeline.

The initial Rust media-engine prototype owns the FFmpeg process boundary and can probe/decode a local video into RGB frames, then prepare the decoded frames as stream-compatible ASCII color and pixel framebuffers:

```bash
npm run media:decode-preview -- media/point-click-test.mp4 96 54 2
npm run media:pipeline-preview -- media/point-click-test.mp4 96 54 12 5 false
```

Development commands use `ASCILINE_FFMPEG` and `ASCILINE_FFPROBE` when set, then `ffmpeg` and `ffprobe` from `PATH`. Packaged Tauri builds should include reviewed binaries under `src-tauri/resources/ffmpeg/`; the desktop bridge prefers those bundled resources before falling back to `PATH`, so production stream mode does not require a runtime download or system package manager install.
The shared Rust implementation lives behind `media_engine::pipeline`; the desktop bridge calls that module only for selected, registered media sources rather than exposing broad arbitrary-path media commands.

Release CI builds FFmpeg sidecars from the pinned official FFmpeg 8.1.2 source tarball, verifies the source SHA-256, disables network protocols, keeps the build LGPL-compatible, and stages the resulting `ffmpeg`/`ffprobe` binaries before packaging:

```bash
npm run ffmpeg:build-sidecar
npm run check:ffmpeg-release
```

To stage other reviewed FFmpeg binaries into the packaged-resource layout, provide explicit local binary paths and release provenance:

```bash
npm run ffmpeg:stage -- --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe --license LGPL-2.1-or-later --source "reviewed reproducible build notes"
npm run check:ffmpeg-resources
npm run check:ffmpeg-release
```

`ffmpeg:stage` copies the binaries into `src-tauri/resources/ffmpeg/{platform}/bin/`, records versions and SHA-256 hashes in `manifest.json`, and writes a `NOTICE.md`. `check:desktop` validates staged sidecars when present; `check:ffmpeg-release` requires the current platform sidecar before claiming standalone stream packaging. Generated sidecar binaries and manifests are intentionally ignored by Git; release runners recreate them.
On macOS, `check:ffmpeg-resources` also rejects staged binaries that still link to absolute Homebrew/MacPorts-style library paths such as `/opt/homebrew` or `/usr/local`. Use a self-contained build with bundled-relative dylib references or a static build, and make the license choice explicit. The default Homebrew FFmpeg formula is commonly GPL-enabled and dynamically linked, so it is useful for development but should not be treated as a reviewed standalone app sidecar without a deliberate license/distribution review.

## 🗜️ Adaptive Frame Codec (opt-in, backward compatible)

The original binary protocol re-sends the full grid every frame. An opt-in
adaptive codec picks the smallest of three encodings per frame and tags it in a
1-byte header — **without changing the rendered output**:

| tag | encoding | best for |
| :-- | :------- | :------- |
| `0` RAW | framebuffer as-is (legacy) | incompressible frames |
| `1` ZLIB | `zlib(framebuffer)` | general motion |
| `2` DELTA | only the cells that changed since the last frame | static / low-motion |

Clients opt in with `/ws?codec=adaptive`; omit it and you get the **original
protocol byte-for-byte**, so existing clients are unaffected. A keyframe is
forced periodically so dropped packets / late joiners resync. The decoder
(`codec.js`) is shared by the browser and the test suite, so the shipped path is
the tested one.

**Measured wire savings** (mode 5, 200×80 grid):

| content | vs. legacy |
| :------ | :--------- |
| static screen / slideshow | **0.3%** (≈375×) |
| pixel mode | 11.6% (≈8.6×) |
| high-motion / full-frame change | 63% (never worse than legacy) |

An optional `--quality {lossless,high,balanced,low}` enables lossy *temporal
delta*: a colour cell is only re-sent once it drifts past a tolerance from what
the viewer already sees (the character plane stays exact), cutting the hard
cases a further ~15–30% at imperceptible quality. Default is `lossless`
(bit-exact).

**Monitor Bandwidth in Real-Time:**
You can append the `--debug` flag when launching the server to see live bandwidth comparisons (RAW vs WIRE bytes) and the exact compression ratio in your terminal. This is highly useful for measuring the real-time savings of the adaptive codec on your specific video sources.

> Verified through generated vectors and live comparison: Python-encoded vectors
> decode bit-exactly through the shipped browser decoder (`experiments/gen_vectors.py`
> -> `experiments/check_vectors.js`) and the Rust decoder
> (`npm run test:vectors` after vectors exist), and the live
> `adaptive`-vs-`legacy` WebSocket diff remains in `experiments/test_e2e.js`.
> Generate the test clips with `experiments/make_test_clips.sh`.

**LAN / Network Streaming:**
To stream the video on your local network (Wi-Fi), use the `--host` flag:
> python stream_server.py video.mp4 --host 0.0.0.0

## 📦 Installation

### 1. Clone the repository
```bash
git clone https://github.com/YusufB5/ASCILINE.git
cd ASCILINE
```

### 2. Install dependencies
```bash
pip install fastapi uvicorn opencv-python numpy websockets
```

### Podman dev environment on macOS/Linux
This fork includes a Podman-backed setup for reproducible local development and codec experiments. It follows the same macOS pattern as the sibling `pool` repo: prefer Podman app install paths, repair the macOS machine socket, require rootless mode, smoke-test container execution, and use Node 24+ for JavaScript tooling.

```bash
scripts/podman-doctor.sh      # verify Podman CLI, machine, engine, and rootless container execution
scripts/podman_build.sh       # build localhost/asciline-remix-dev:latest
scripts/podman_venv.sh        # create .venv-linux inside the repo from inside the container
scripts/podman_run.sh bash    # enter the container, activating .venv-linux when present
```

The generated `.venv-linux/` is intentionally ignored by Git. It is a Linux virtualenv for container use, not a host macOS Python environment.

For a long-running renderer or static server, enable the run wrapper's supervisor so the command restarts if it exits unexpectedly while the wrapper is still running:

```bash
PORT=8000 ASCILINE_RESTART=1 scripts/podman_run.sh python stream_server.py video.mp4 --host 0.0.0.0 --port 8000
PORT=8010 ASCILINE_RESTART=1 scripts/podman_run.sh python -m http.server 8010 --bind 0.0.0.0
```

Set `ASCILINE_RESTART_DELAY=1` to change the restart pause in seconds. Exit code `0` is treated as an intentional stop; set `ASCILINE_RESTART_ON_SUCCESS=1` to restart after clean exits too. `RESTART=1`, `RESTART_DELAY=1`, and `RESTART_ON_SUCCESS=1` are accepted as shorter aliases.

The wrapper checks that the requested host port is free before starting Podman. If another process owns the port, stop it or use a different host port:

```bash
HOST_PORT=8011 CONTAINER_PORT=8010 ASCILINE_RESTART=1 scripts/podman_run.sh python -m http.server 8010 --bind 0.0.0.0
```

Run the codec/vector suite through the same container:

```bash
scripts/podman_codec_tests.sh
```

After vectors have been generated, the host-side Rust decoder can validate the
same fixtures:

```bash
npm run test:vectors
```

Rust frame-prep parity against the Python/OpenCV stream behavior can be checked
through the Podman-backed reference harness:

```bash
npm run test:frame-prep
npm run test:decode-resize
npm run check:media
```

The image defaults to Node 24 LTS. To smoke-test against the current even-numbered release, rebuild with:

```bash
NODE_MAJOR=26 scripts/podman_build.sh
```

### 🔈 Audio Support (FFmpeg Required)
To enable server-side audio processing (Volume 1-5), you must have FFmpeg installed.

**Option 1: Package Manager (Recommended)**
- **Windows:** `winget install ffmpeg`
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg`

**Option 2: Manual Installation (Windows)**
If you get a `FileNotFoundError` or don't want to modify system variables:
1. Download [FFmpeg ZIP](https://github.com/BtbN/FFmpeg-Builds/releases/latest).
2. Extract `ffmpeg.exe` from the `bin` folder.
3. Drop it directly into your `ASCILINE` project folder alongside `stream_server.py`.
### 3. Run the Web Server

**Single video:**
```bash
python stream_server.py video.mp4 --cols 240
```

**Folder mode — drop your videos into `videos/` and run:**
```bash
python stream_server.py --folder videos --cols 200
python stream_server.py --folder videos --cols 230 --loop          # infinite loop
python stream_server.py --folder videos --mode 5 --pixel --cols 320 --vol 2  # all videos same settings
```
Videos play in **filesystem order** (top to bottom as they appear in the folder, not alphabetically). Just add/remove files from the `videos/` folder to control the queue.

**JSON Playlist — full control per video:**
```bash
python stream_server.py --playlist playlist.json --cols 220
python stream_server.py --playlist playlist.json --cols 220 --loop
```
Use `playlist.json` when you need different `--mode` or `--vol` settings for each video.


Open `http://localhost:8000` in your browser.

### 4. Run directly in Terminal (Standalone)
If you prefer to bypass the web interface, you can render the video directly inside an ANSI-supported terminal (zero-flicker, true color):
```bash
python ascii_video_player2.py video.mp4 --cols 100 --quality 0
```

> ⚠️ **Note:** Do not resize your terminal window during playback, as dynamic text wrapping will corrupt the ASCII layout.

## 🎨 Customization

You can easily customize the look and feel of the engine:

### Styling
Edit `style.css` to change the accent colors and typography using CSS variables:
```css
:root {
    --accent-color: #00ff41; /* Classic Matrix Green */
    --bg-color: #050505;
}
```

### Rendering Modes
The engine supports different fidelity levels via the `--mode` flag:
- `1`: Black & White (DOM mode)
- `2`: 512 Colors
- `3`: 32K Colors
- `4`: 262K Colors
- `5`: 16M Colors (Ultra)

```bash
python stream_server.py --mode 5 --cols 240 --rows 100
```
### 📐 Resolution & Auto-Scaling
By default, you only need to specify the width (`--cols`). ASCILINE will automatically calculate the correct `--rows` based on the source video's aspect ratio to prevent stretching.

- **ASCII Mode Recommended:** `--cols 200` to `--cols 240` (Best balance of text detail and cinematic 30 FPS performance).
- **Pixel Mode Recommended:** `--cols 600` to `--cols 900` (Provides near-HD visual quality. Performance heavily depends on your machine's CPU/VRAM).
- > **Smart Defaults:** If you do not specify a `--cols` value, ASCILINE automatically defaults to `450` when Pixel Mode is enabled, and `200` for standard ASCII text mode. 
- > ⚠️ **Hardware Limits & A/V Sync:** If you push the `--cols` too high for your specific hardware (e.g., `1350` on a laptop vs a gaming desktop), the Python backend won't be able to encode and send the massive frames fast enough. When the video stream lags behind the audio, you will experience A/V desync (audio finishing early). If this happens, simply lower your `--cols` value!
```bash
python stream_server.py video.mp4 --mode 5 --cols 240
# Terminal will show: [AUTO] 1920x1080 → grid 240x67
```
### Server-Side Volume Control
Volume is controlled at the server level via the `--vol` flag (scale 0–5).
When set to `0`, the audio engine (FFmpeg) **never runs**, saving CPU and bandwidth.

| `--vol` | FFmpeg Multiplier | Description |
|---------|------------------|-------------|
| `0`     | —                | Muted (no processing) |
| `1`     | 1.0×             | Normal (default) |
| `3`     | 1.5×             | Loud |
| `5`     | 2.0×             | Double volume |

```bash
python stream_server.py video.mp4 --pixel --cols 560 --vol 0   # Silent
python stream_server.py video.mp4 --cols 220 --vol 3   # Loud
```

### Playlist Format (`playlist.json`)
Each entry can override the global `--mode`, `--pixel`, `--vol`, and `--cols` defaults:
```json
[
    { "video": "intro.mp4",  "mode": 1, "vol": 1 },
    { "video": "main.mp4",   "mode": 5, "pixel": true, "vol": 3, "cols": 520 },
    { "video": "outro.mp4",  "mode": 3, "vol": 2, "cols": 240 }
]
```
Video paths are resolved automatically — the engine checks the project root and the `videos/` subfolder, so you can write just the filename.


### 🟢 Live Interactive Showcase
Experience the ASCILINE engine running live directly in your browser with multiple rendering modes. 👉 **[Try it out at asciline.dev](https://www.asciline.dev)**


## 📈 Star History
[![Star History Chart](https://api.star-history.com/svg?repos=YusufB5/ASCILINE&type=Date)](https://star-history.com/#YusufB5/ASCILINE&Date)

### ☕ Support the Project ❤️ 
If you find this project helpful, you can support me by donating crypto:
* **Solana (SOL / USDC):** `H1wSQAhjgsu7AxenF4e5ZBYiBjkhDLVzkKaZuVPcrE14`
* **Ethereum (ETH / USDT):** `0x85B2f970045c0F7c282089Ab6CF897C20230e086`
* **Bitcoin (BTC):** `bc1qvtcl55v54gkzwnp2zxn70usea3gf5ncncqa0fv`

## 📜 License & Ethical Guardrails

ASCILINE is distributed under the MIT License, but with an anti ad strict ethical guardrail. 

See the [LICENSE](LICENSE) file for the full text, which includes the **ANTI-ADVERTISEMENT RESTRICTION** clause.

## 📬 Contact & Questions
[asciline.engine@gmail.com](mailto:asciline.engine@gmail.com)
