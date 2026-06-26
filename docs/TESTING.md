# Testing

This guide documents the current automated checks, manual verification paths,
and future test expectations for ASCII VJ Remix.

Testing focuses on offline bundles, renderer startup, source switching,
native output, media/camera/audio behavior, Tauri permissions, FFmpeg sidecars,
release artifacts, and updater manifests.

## Quick Reference

```bash
npm run build                    # Vite production build plus local asset copy
npm run check:offline            # Build and verify bundled/offline assets
npm run smoke:static             # Static UI/renderer smoke harness
npm run check:tauri-policy       # Production CSP and local-only runtime policy
npm run test:output-display      # Secondary-display placement simulation
npm run test:updater-manifest    # Tauri latest.json/updater manifest tests
npm run test:macos-secret-args   # macOS notarization secret argument safety
npm run test:ffmpeg-policy       # FFmpeg policy checks
npm run check:ffmpeg-resources   # FFmpeg sidecar resource metadata checks
npm run test:frame-prep          # Rust/JS frame-prep parity
npm run test:decode-resize       # Decode/resize parity checks
npm run check:media              # Media pipeline checks
npm run test:render-math         # Shared renderer math vectors
npm run test:crash-relay         # Cloudflare crash relay sanitizer/rate-limit tests
npm run test:vectors             # Adaptive codec vector checks
npm run test:rust                # Rust tests
npm run check:desktop            # Main desktop validation gate
npm run check:release            # Release-oriented gate; expects staged FFmpeg sidecar
npm run bundle:debug             # Build and validate local debug bundle
npm run bundle:release           # Release gate, release build, bundle check
npm run smoke:native-output      # Native output performance helper
npm run smoke:ui-perf            # UI performance helper
npm run smoke:release-install    # Release artifact install/updater smoke
```

For documentation-only changes:

```bash
git diff --check
```

## Test Categories

| Area | Current Checks |
| --- | --- |
| Offline runtime | `npm run check:offline`, `scripts/check_offline_bundle.mjs` |
| Static UI harness | `npm run smoke:static` |
| Tauri policy | `npm run check:tauri-policy` |
| Output display logic | `npm run test:output-display` |
| Updater manifests | `npm run test:updater-manifest` |
| macOS secret handling | `npm run test:macos-secret-args` |
| FFmpeg policy/resources | `npm run test:ffmpeg-policy`, `npm run check:ffmpeg-resources`, `npm run check:ffmpeg-release` |
| Media frame prep/decode | `npm run test:frame-prep`, `npm run test:decode-resize`, `npm run check:media` |
| Renderer math parity | `npm run test:render-math`, Rust shared-vector tests through `npm run test:rust` |
| Crash relay | `npm run test:crash-relay` |
| Adaptive codec vectors | `npm run test:vectors` |
| Rust/Tauri modules | `npm run test:rust` |
| Native output performance | `npm run smoke:native-output`, `npm run test:native-output-log` |
| UI performance | `npm run smoke:ui-perf` |
| Release install/update | `npm run smoke:release-install` |

## Recommended Check Sets

### Documentation Only

```bash
git diff --check
```

### Frontend UI, CSS, Presets, Sources, Audio UI

```bash
npm run build
npm run smoke:static
```

Add manual checks for source switching, preset transitions, WTF mode, and audio
reactivity when behavior changes.

### Renderer Backend Changes

```bash
npm run build
npm run test:render-math
npm run smoke:static
npm run check:media
```

Also manually compare WebGPU and WebGL2 output for representative presets.

### Native Output or Pop Out Changes

```bash
npm run test:output-display
npm run smoke:native-output
npm run test:native-output-log
npm run test:rust
```

Use an optimized app build before making performance conclusions.
For glyph-mode changes, include at least one traditional ASCII preset in manual
Pop Out checks and confirm Character Set/Font Family changes do not hide the
Glyph/Cell controls.

### Tauri Commands, Permissions, or Capabilities

```bash
npm run check:tauri-policy
npm run test:crash-relay
npm run test:rust
npm run check:desktop
```

Manually verify macOS Camera, Microphone, Screen/System Audio, and Pop Out
behavior when the permission model changes.

For crash-report changes, also verify that debug builds capture locally but do
not submit, release builds use only `https://crash.dustwave.xyz/v1/reports`, and
the output window has no crash-report permissions.

### FFmpeg and Media Engine

```bash
npm run test:ffmpeg-policy
npm run check:ffmpeg-resources
npm run check:media
npm run test:rust
```

For release sidecars:

```bash
npm run test:ffmpeg-source-build
npm run check:ffmpeg-release
```

### Release and Updater

```bash
npm run check:release
npm run bundle:release
npm run smoke:release-install
```

Run `npm run ffmpeg:build-sidecar` before `npm run check:release` on a clean
clone. `npm run bundle:release` runs the sidecar build step automatically.

The release smoke downloads artifacts from GitHub Releases and checks installer
layout, bundled assets, signed updater packages, and `latest.json` behavior.
Updater-hop smoke uses `0.9.0` as the default minimum previous version because
older `0.1.x` releases were signed with a different updater key.

## Manual Smoke Checklist

Use this after user-facing renderer, source, audio, or output changes:

1. Launch the desktop app.
2. Confirm Demo Image appears and renderer starts automatically.
3. Switch to Demo Video and confirm playback starts.
4. Switch back to Demo Image and confirm the renderer does not get stuck.
5. Select Camera and confirm permission prompt/device behavior.
6. Select Mic/Input and confirm Audio Reactivity starts or requests permission.
7. Switch audio devices and confirm capture restarts automatically.
8. Trigger Display/System Audio where supported and confirm errors are useful
   when the selected source has no audio track.
9. Click several presets and confirm smooth transitions.
10. Select a traditional ASCII preset and confirm Character Set and Font Family
    remain compact and visible.
11. Toggle WTF mode on and off and confirm it remains responsive and can visit
    traditional ASCII-looking states.
12. Open Pop Out and confirm the main preview stays responsive.
13. Confirm Pop Out reflects presets, WTF mode, and audio reactivity while fully
    visible.
14. Confirm Stats Overlay reports the active preset/source/backend/grid/FPS.
15. Close Pop Out and confirm CPU/GPU usage settles.

## Hardware and Platform Checks

The app depends on real hardware and OS media stacks. Automated tests cannot
cover everything yet.

Important manual matrices:

- macOS Apple Silicon with built-in camera and external display.
- macOS with external USB camera.
- macOS with system audio capture.
- Windows with WebView2, D3D12/WebGL2, camera, mic, and installer path.
- Linux with WebKitGTK, GPU acceleration, camera, mic, and AppImage/deb path.
- Future MIDI rig: Evolution/M-Audio UC33e through iConnectivity mioXC.

When reporting hardware results, include:

- OS version.
- CPU/GPU.
- app version and build type.
- source type.
- backend.
- Pop Out state.
- audio source.
- camera device names and requested resolution/FPS.

## Podman Checks

Podman is mainly for a reproducible Linux-like dev shell and legacy
Python/OpenCV/vector work. It is not the production runtime.

Useful commands:

```bash
scripts/podman-doctor.sh
scripts/podman_build.sh
scripts/podman_venv.sh
scripts/podman_codec_tests.sh
```

The Podman image defaults to Node 24. Use `NODE_MAJOR=26` only when explicitly
testing a newer Node baseline.

## CI and Release Expectations

Release CI should:

- build macOS, Windows, and Linux artifacts.
- verify offline bundle behavior.
- verify Tauri policy.
- build/check FFmpeg sidecars.
- run Rust and media tests.
- generate updater manifest fragments.
- merge fragments into `latest.json`.
- upload installers, updater packages, signatures, and `latest.json`.
- run install smoke checks after publishing.

Future release hardening should add:

- real Windows and Linux install smoke tests on physical or VM machines.
- end-to-end updater hop from an older installed app to a newer release.
- macOS Developer ID notarization validation.
- Windows SmartScreen/AuthentiCode validation.

## Known Gaps

- No comprehensive automated accessibility suite yet.
- No full i18n/l10n test suite yet.
- No golden visual output suite for presets yet.
- No automated camera latency benchmark yet.
- No automated MIDI controller integration tests yet.
- Linux native media/camera/audio coverage needs broader machine testing.
