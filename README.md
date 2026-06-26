# ASCII VJ Remix

ASCII VJ Remix is a local-first native desktop renderer lab for turning
images, videos, cameras, and audio-reactive signals into high-performance ASCII
and cell-based visuals.

The app is built for VJ-style experimentation: pick a source, choose a preset,
push the renderer hard, pop the output onto another display, and keep tuning
the look live while the media keeps running.

Current documentation describes the 0.9.2 feature set.

## Quick Links

- [Changelog](CHANGELOG.md)
- [Roadmap](docs/ROADMAP.md)
- [Rendering engine guide](docs/RENDERING_ENGINE.md)
- [Contributor guide](docs/CONTRIBUTORS.md)
- [LLM agent guide](docs/AGENTS.md)
- [Security guide](docs/SECURITY.md)
- [Performance guide](docs/PERFORMANCE.md)
- [Testing guide](docs/TESTING.md)
- [Accessibility guide](docs/ACCESSIBILITY.md)
- [Internationalization guide](docs/I18N.md)
- [Release and updater notes](docs/CONTRIBUTORS.md#release-and-updater-work)
- Contact: [alonso@dustwave.xyz](mailto:alonso@dustwave.xyz)
- Support the project: [shop.dustwave.xyz](https://shop.dustwave.xyz) or [pool.dustwave.xyz](https://pool.dustwave.xyz)

## What This Project Is

ASCII VJ Remix is a fork and remix of several related ideas:

- It started from [ASCILINE](https://github.com/YusufB5/ASCILINE), which
  provides a high-performance ASCII video streaming pipeline, Python/FastAPI
  server code, OpenCV frame preparation, adaptive WebSocket frame encoding,
  terminal playback experiments, and Canvas rendering fallbacks.
- It vendors and adapts the renderer from `ascii-point-and-click`, keeping the
  high-quality WebGPU/WebGL visual output.
- It keeps the local-first spirit of a standalone creative tool. The Tauri app
  packages the renderer, demo media, fonts, native output path, and local media
  adapters so day-to-day use does not require online services.
- It uses an extreme black, white, grey, neon pink, and neon blue VJ control
  surface with compact VCR-style typography and sharp rectangular controls.

The result is a live renderer
workbench for stylized ASCII/cell video output.

## Current Capabilities

### Sources

- Built-in Demo Image, used as the default startup source.
- Built-in Demo Video.
- User-selected local image and video files.
- MKV selection support in the desktop file picker. Playback depends on the
  active platform decoder path; the native media path is where broader codec
  support will continue to improve.
- Local webcam/camera input.
- Multiple simultaneous cameras when the operating system and desktop runtime
  allow it.
- Camera mixer layouts: grid, split row, stack, and picture-in-picture.
- Camera controls appear directly under the Source panel while Camera is active.
- Static media and camera frames stay local. They are not uploaded to a server.

### Rendering

- WebGPU renderer is the primary quality target on capable desktop runtimes.
- WebGL2 renderer is the main embedded GPU fallback.
- Canvas2D and pixel Canvas paths remain compatibility fallbacks.
- Native Tauri output window uses a `wgpu` presenter where available:
  - Metal on macOS.
  - D3D12 on Windows.
  - Vulkan/GLES on Linux.
- Native Pop Out preserves glyph-mode and character-set params for traditional
  ASCII presets instead of flattening them into solid cells.
- The renderer exposes live controls for grid, cell size, color, gamma,
  brightness, contrast, saturation, background blend, quantization, jitter,
  sample position, smoothing, FPS, glyph/cell behavior, and performance status.
- Stats overlay is enabled by default and remains user-controlled.

### Presets and Live Controls

- Built-in read-only visual presets, including extreme looks such as Neon
  Sledgehammer, Gamma Sinkhole, Chrome Wound, Candy Fragmenter, Paper Shredder,
  Cyberdelic Riot, Acid Snowstorm, Terminal Collapse, and Neon Razorstorm.
- Built-in traditional ASCII presets, including Classic Camera ASCII, ANSI
  Newsprint, Terminal Mono, and Dense Typewriter.
- Character Set and Font Family controls stay compact so traditional ASCII
  tuning does not crowd the dense live-control surface.
- User presets can be saved, duplicated, updated, deleted, imported, and
  exported.
- Preset transitions crossfade instead of fading to black.
- Transition time is configurable.
- Presets preserve the active media source unless the user explicitly changes
  it.
- WTF mode continuously transitions through randomized live-safe settings and
  leans into both extreme and traditional ASCII preset families while avoiding
  pure white or pure black output.

### Audio Reactivity

- Audio reactivity is on by default.
- Mic/input is the default audio-reactive source.
- Local audio files can drive visual modulation.
- System/display audio is supported where the operating system provides an
  audio track to the desktop app.
- Tauri desktop builds include native audio capture paths for system/input
  audio features.
- Audio analysis tracks RMS, bass, mid, treble, transient energy, beat pulse,
  and spectral movement.
- Audio modulation is non-persistent: it affects live effective render params
  without rewriting saved presets.
- Safe clamps prevent high sensitivity from driving the renderer into pure
  white or pure black screens.

### Pop Out and External Displays

- Pop Out creates a separate output window intended for a projector, capture
  card, or secondary display.
- The main control window remains visible and interactive.
- The desktop output window is native, not a second heavyweight duplicated UI
  surface.
- Output display selection is persisted when Tauri can enumerate displays.

### Desktop Packaging and Updates

- Built with Tauri v2.
- Production runtime is local-only by default.
- The packaged app blocks arbitrary remote HTTP(S) connections through a
  production Content Security Policy.
- The app uses narrow Tauri capabilities split by window:
  - The main control window can open selected media and manage output.
  - The output window has a minimal command surface.
- GitHub Releases updater infrastructure is configured.
- Intentional online paths are limited to the updater check/download flow and
  production-only reviewed/sanitized crash report submission.
- Crash report submission goes through the Rust desktop layer to the
  `https://crash.dustwave.xyz` Cloudflare Worker relay. The webview does not get
  arbitrary HTTP capability and selected media is never uploaded.

### Advanced and Development-Only Paths

The legacy ASCILINE stream path and the newer Rust/FFmpeg stream session work
exist, but stream mode is not currently exposed in the normal Source UI. The
Static/Streaming selector, stream connection label, and buffer counter remain
hidden until the stream workflow is ready as a standalone user feature.

MIDI hardware control is planned, with the first target validation rig being an
Evolution/M-Audio UC33e connected through an iConnectivity mioXC. It is not part
of the current normal-user feature set.

## System Requirements

These requirements are practical guidance for the current renderer, not a
contract. Higher grid sizes, multiple cameras, audio reactivity, and native
output windows all increase load.

### macOS

| Level | Requirement |
| --- | --- |
| Minimum | Apple Silicon Mac, macOS 13 Ventura or newer, 8 GB RAM, Metal-capable GPU, 2 GB free disk space. Official macOS builds are Apple Silicon first. |
| Optimal | M1 Pro/Max, M2 Pro/Max, M3 Pro/Max, or newer; 16 GB RAM or more; macOS 14 Sonoma, macOS 15 Sequoia, or newer; external display/projector for Pop Out. |

Notes:

- Intel Mac support is not the current release target. It may work from source
  if you build a compatible bundle yourself, but it is not the tested path.
- Camera, microphone, and audio capture require explicit macOS privacy grants.
- Downloaded ad-hoc signed builds may still require the normal macOS
  right-click Open or Open Anyway flow until Developer ID notarization is added.

### Windows

| Level | Requirement |
| --- | --- |
| Minimum | Windows 10 22H2 or Windows 11, x64 CPU, WebView2 runtime, D3D12 or WebGL2-capable GPU, 8 GB RAM, 2 GB free disk space. |
| Optimal | Windows 11, recent Intel/AMD/NVIDIA GPU with current drivers, 16 GB RAM or more, hardware media decode, dedicated output display. |

Notes:

- Most current Windows 10/11 systems already include WebView2. If an installer
  reports that WebView2 is missing, install the Microsoft WebView2 Runtime once.
- Windows system audio loopback is planned through WASAPI, but the current
  audio path should be tested per release before relying on it in production.

### Linux

| Level | Requirement |
| --- | --- |
| Minimum | Modern x86_64 Linux distribution, WebKitGTK 4.1 runtime, Mesa or vendor GPU drivers with WebGL2, 8 GB RAM, 2 GB free disk space. |
| Optimal | Ubuntu 24.04, Fedora 40, Arch, or comparable current distro; Wayland or well-configured X11; recent Mesa/NVIDIA drivers; Vulkan-capable GPU; PipeWire for future capture work. |

Notes:

- Linux Tauri uses the system WebKitGTK stack, so GPU feature support varies by
  distribution, WebKitGTK version, and graphics driver.
- WebGL2 may be the practical Linux fallback even when WebGPU is not available.
- Native Linux camera/audio/output behavior needs broader hardware testing.

## Hardware Guidance

| Level | Hardware |
| --- | --- |
| Minimum | 4-core CPU, 8 GB RAM, integrated GPU with WebGL2/Metal/D3D12/Vulkan/GLES support, 1080p display, one camera or one local media source at a time. |
| Optimal | 8 or more performance cores, 16 to 32 GB RAM, Apple Silicon Pro/Max or a recent discrete GPU, hardware video decode, SSD storage, external display/projector, USB or HDMI capture hardware, class-compliant audio interface. |

For live camera work, the best upgrade is often not raw CPU. Use stable USB
cameras, direct USB ports or a powered hub, good lighting, and a machine on AC
power.

## Battery and Heat Warning

ASCII VJ Remix can be demanding. WebGPU/WebGL rendering, high column counts,
multiple cameras, audio analysis, and native output windows can keep the CPU,
GPU, camera, and media decoder active continuously.

On laptops:

- Expect higher battery drain than a normal media player.
- Use AC power for performances or long sessions.
- Lower columns, FPS, camera resolution, and jitter if the machine gets hot.
- Close Pop Out when you do not need a second output surface.
- Prefer the built-in Demo Image or a single video when testing on battery.

## Install Guide

### 1. Download

Download the latest desktop build from:

[https://github.com/aindaco1/ascii-vj-remix/releases](https://github.com/aindaco1/ascii-vj-remix/releases)

The release page may contain macOS, Windows, and Linux installers plus updater
artifacts. Install the package for your operating system.

### 2. Install on macOS

1. Download the macOS app archive or DMG.
2. Move `ASCII VJ Remix.app` to `/Applications` or `~/Applications`.
3. Open it from Finder.
4. If macOS blocks the first launch because the app is not notarized yet:
   - Right-click `ASCII VJ Remix.app`.
   - Choose Open.
   - Confirm Open.
   - If needed, open System Settings -> Privacy & Security and choose Open
     Anyway for ASCII VJ Remix.
5. Grant Camera, Microphone, Screen & System Audio Recording, or System Audio
   Recording permissions when macOS prompts for them.

### 3. Install on Windows

1. Download the Windows installer from GitHub Releases.
2. Run the installer.
3. If Windows SmartScreen warns on a self-signed or new app, choose More info,
   then Run anyway only if you trust the release source.
4. Launch ASCII VJ Remix from the Start menu.
5. Grant camera and microphone permissions if Windows prompts.

### 4. Install on Linux

For an AppImage:

```bash
chmod +x ASCII-VJ-Remix*.AppImage
./ASCII-VJ-Remix*.AppImage
```

For a `.deb` package:

```bash
sudo apt install ./ascii-vj-remix*.deb
```

If the app does not launch, check that WebKitGTK, GPU drivers, and desktop
portal packages are installed for your distribution.

## First Run

1. Launch the app.
2. The renderer should start automatically on Demo Image.
3. Choose a built-in preset from the Presets panel.
4. Use Source to switch to Demo Video, Camera, or a custom local file.
5. Use Audio Reactivity to select Mic/Input, Audio File, or System/Display
   audio.
6. Use Pop Out to create a separate output window for another screen.
7. Use WTF when you want the app to keep generating extreme or traditional
   ASCII-flavored transitions.

If the renderer does not start, press Start once. If it still does not start,
try a lower backend such as WebGL2 or Canvas2D.

## macOS Permissions and Entitlements

There are two different concepts:

- Entitlements are compiled into the app bundle by the developer. They declare
  what kinds of protected system resources the app may request.
- Privacy permissions are granted by you in macOS System Settings after the app
  asks for access.

ASCII VJ Remix currently includes these macOS entitlements and usage strings:

- Camera access for live camera rendering.
- Microphone/audio input access for audio-reactive visuals.
- Screen/audio capture usage descriptions for display or system audio capture.

### Grant Permissions in System Settings

1. Open System Settings.
2. Go to Privacy & Security.
3. Open Camera and enable ASCII VJ Remix.
4. Open Microphone and enable ASCII VJ Remix.
5. Open Screen & System Audio Recording, Screen Recording, or System Audio
   Recording, depending on your macOS version, and enable ASCII VJ Remix.
6. Restart the app after changing these permissions.

macOS may show permission names differently across releases. On newer macOS
versions, system-audio capture can appear as System Audio Recording or as part
of Screen & System Audio Recording.

### Reset macOS Permission Prompts

If permissions are stuck, quit the app and run:

```bash
tccutil reset Camera com.asciline.remix
tccutil reset Microphone com.asciline.remix
tccutil reset ScreenCapture com.asciline.remix
tccutil reset AudioCapture com.asciline.remix
```

Then reopen ASCII VJ Remix and try Camera or Audio Reactivity again. If
`AudioCapture` is not recognized on your macOS version, that reset command can
be ignored.

Permissions are tied to the bundle identifier and app signature. If you used an
older build named `ASCILINE Remix.app`, grant permissions again for
`ASCII VJ Remix.app`.

### Verify Entitlements on macOS

Advanced users can inspect the installed app:

```bash
codesign -d --entitlements :- "/Applications/ASCII VJ Remix.app"
plutil -p "/Applications/ASCII VJ Remix.app/Contents/Info.plist" | grep UsageDescription
```

Do not manually edit the app bundle to add entitlements. Reinstall a properly
signed build instead. Editing the bundle breaks the signature.

## Privacy and Offline Behavior

ASCII VJ Remix is designed to be local-first.

- Local media files stay on your machine.
- Camera frames stay local.
- Audio analysis is local.
- The packaged app should not download renderer assets, fonts, codecs, models,
  or media providers at runtime.
- Intentional online paths are limited to the Tauri updater and production-only
  reviewed/sanitized crash reports.
- Custom desktop file access is session-scoped. If the app says a custom file
  needs access after restart, reselect the file.

See [docs/SECURITY.md](docs/SECURITY.md) for the full local media, permission,
updater, Tauri capability, and FFmpeg sidecar security model.

## Troubleshooting

### Camera says blocked or denied

- Confirm the app is in `/Applications` or `~/Applications`.
- Check System Settings -> Privacy & Security -> Camera.
- Reset Camera permission with `tccutil reset Camera com.asciline.remix`.
- Restart the app.
- Try another camera app to confirm the device is not already locked.

### Microphone or audio input does not start

- Check System Settings -> Privacy & Security -> Microphone.
- Reset with `tccutil reset Microphone com.asciline.remix`.
- Restart the app.
- Select a concrete input device from Audio Reactivity.

### Display or system audio has no audio

Display capture can expose video without an audio track, especially for
app/window capture on macOS. Use System Audio where available. Future work will
move macOS system audio toward Core Audio Taps for a narrower permission
prompt.

### Pop Out is slow

- Lower columns or FPS.
- Close other GPU-heavy apps.
- Use AC power on laptops.
- Try a direct external display connection instead of a wireless display.

### Video format does not play

Try MP4/H.264 first. MKV support depends on the active decode path and platform.
If the embedded media decode path cannot play a file, future native FFmpeg
paths may support it more reliably.

## Development

Development instructions live in [docs/CONTRIBUTORS.md](docs/CONTRIBUTORS.md).
Testing expectations live in [docs/TESTING.md](docs/TESTING.md), and renderer
performance guidance lives in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

The short version:

```bash
npm ci
npm run tauri:dev
npm run check:desktop
```

## Financial Support

If this project is useful to you, support [Dust Wave](https://dustwave.xyz):

- Buy something at [our online shop](https://shop.dustwave.xyz).
- Support a crowdfunding campaign at [The Pool](https://pool.dustwave.xyz), our very own crowdfunding platform.

## Contact

Email Alonso at [alonso@dustwave.xyz](mailto:alonso@dustwave.xyz).

## License

This repository carries the upstream ASCILINE license text: MIT License with an
Anti-Advertisement Restriction. See [LICENSE](LICENSE) for the full license.

In plain language: the project is broadly permissive, but the license includes
an explicit restriction against using the software to serve, deliver, or display
digital advertisements, sponsored content, or commercial marketing to end users.
Read the license itself before redistributing or building on this project.
