# LLM Agent Guide

This document is for LLM coding agents working on ASCII VJ Remix. It explains
what context to load first, what project constraints matter most, and which
files usually own each kind of change.

## Fast Context Load

Read these in order before making non-trivial changes:

1. [README](../README.md): product overview, current user-facing feature set,
   install notes, system requirements, license/support/contact information.
2. [Changelog](../CHANGELOG.md): current release feature baseline and recent
   behavioral expectations.
3. [Roadmap](ROADMAP.md): current capabilities, planned work, deferred work, and
   product direction.
4. [Rendering Engine](RENDERING_ENGINE.md): source flow, renderer backends,
   native output architecture, media engine, audio reactivity, and future MIDI
   integration.
5. [Contributor Guide](CONTRIBUTORS.md): development setup, test commands,
   release/updater notes, FFmpeg sidecar policy, and contribution workflow.
6. Project practice docs when relevant:
   [Security](SECURITY.md), [Performance](PERFORMANCE.md),
   [Testing](TESTING.md), [Accessibility](ACCESSIBILITY.md), and
   [Internationalization](I18N.md).

For desktop packaging or permissions work, also inspect:

- [Tauri config](../src-tauri/tauri.conf.json)
- [Tauri capabilities](../src-tauri/capabilities/default.json)
- [macOS Info.plist](../src-tauri/Info.plist)
- [macOS entitlements](../src-tauri/Entitlements.plist)

For renderer or Pop Out work, also inspect:

- [Main app controller](../app.js)
- [GPU renderer directory](../renderers/gpu/)
- [Desktop adapter](../renderers/desktop/tauri-adapter.js)
- [Native output module](../src-tauri/src/native_output.rs)
- [Native output GPU presenter](../src-tauri/src/native_output/gpu.rs)
- [Native camera module](../src-tauri/src/native_output/native_camera.rs)

## Project Identity

ASCII VJ Remix is a local-first native desktop renderer lab for macOS, Windows,
and Linux. The intended product is the Tauri desktop app, not a hosted web app
or browser-only build.

The project combines three lineages:

- [ASCILINE](https://github.com/YusufB5/ASCILINE): high-performance ASCII video
  streaming, adaptive frame encoding, Python/OpenCV experiments, terminal ideas,
  and Canvas fallback lineage.
- `ascii-point-and-click`: high-quality WebGPU/WebGL visual output and local
  browser media-source architecture.
- This repo's Tauri desktop work: standalone packaging, native media/audio
  adapters, native Pop Out output, local release/update infrastructure, and the
  dense VJ control surface.

The point-and-click game UI is out of scope. The app is a creative control
surface for live ASCII/cell visuals.

## Non-Negotiable Constraints

- Runtime must be local-first and offline by default.
- Do not add CDN, hosted font, hosted decoder, telemetry, or online runtime
  dependencies.
- Intentional online runtime paths are limited to the GitHub Releases updater and
  production-only reviewed/sanitized crash report submission.
- Preserve the app name: ASCII VJ Remix.
- Preserve the native app direction for macOS, Windows, and Linux.
- Do not reframe browser mode as the product. Browser/Vite paths are useful for
  development, smoke tests, and renderer portability.
- Keep renderer quality high. WebGPU/WebGL output from the point-and-click
  renderer lineage is the visual quality target.
- Preserve fallback paths unless a replacement is implemented and tested.
- Treat Pop Out performance and latency as critical user-facing behavior.
- Keep user-selected local media local. Do not upload files or camera/audio data.
- Keep stats overlay user-owned. Random presets, WTF mode, and audio presets
  should not turn it off unless the user explicitly does.
- Stream infrastructure exists but is not a normal visible source mode yet.
  Hidden streaming UI should stay hidden until stream mode is productized end to
  end.
- Security, performance, accessibility, and i18n guidance live in dedicated
  practice docs under `docs/`; update them when architectural assumptions
  change.

## Current User-Facing Baseline

Current docs describe the 0.9.2 feature set.

Sources:

- Demo Image is the default startup source.
- Demo Video is the single visible built-in video source.
- Custom local images and videos can be selected.
- Camera is a first-class source.
- Multiple cameras can be mixed locally when the OS/runtime supports concurrent
  capture.
- Camera controls appear directly below Source while Camera is active.

Rendering:

- WebGPU is the primary quality target.
- WebGL2 is the main embedded GPU fallback.
- Canvas2D and pixel Canvas remain compatibility fallbacks.
- Native Pop Out output uses `wgpu` where available, with Metal on macOS and
  corresponding GPU backends on Windows/Linux.
- The active renderer is controlled by one canonical parameter model.
- Native Pop Out preserves glyph-mode and character-set params for traditional
  ASCII presets.
- Native glyph output should keep using bounded fixed atlas/ramp resources;
  `fontFamily` is UI/preview metadata, not a native font-loading sink.

Live behavior:

- Presets are read-only unless created by the user.
- Preset transitions should be smooth crossfades, not fade-to-black.
- Presets should preserve the active media source unless explicitly changed.
- WTF mode runs indefinitely while active and transitions through live-safe
  randomized settings, including anchors from traditional ASCII presets.
- Audio reactivity is enabled by default, starts from Mic/Input by default, and
  modulates live effective params without rewriting saved presets.
- Safe clamps should prevent pure black or pure white outputs from randomized or
  audio-driven states.

UI:

- The current theme is extreme black/white/grey with neon pink and neon blue
  state accents.
- The layout is intentionally dense.
- Do not reduce control density when changing visual styling.
- Avoid adding explanatory marketing text inside the app UI.

## Repository Ownership Map

Use this map to find the likely owner of a change:

| Area | Primary Files |
| --- | --- |
| Main UI, params, presets, source controls, WTF, audio UI | [app.js](../app.js), [index.html](../index.html), [style.css](../style.css) |
| GPU renderer and media source abstraction | [renderers/gpu/](../renderers/gpu/) |
| Tauri adapter and output-display helpers | [renderers/desktop/](../renderers/desktop/) |
| Tauri shell, commands, permissions, updater, native audio, native output | [src-tauri/](../src-tauri/) |
| Native Pop Out renderer | [native_output.rs](../src-tauri/src/native_output.rs), [gpu.rs](../src-tauri/src/native_output/gpu.rs) |
| macOS native camera latency path | [native_camera.rs](../src-tauri/src/native_output/native_camera.rs) |
| Rust media engine, codec, FFmpeg sessions | [src-tauri/src/media_engine/](../src-tauri/src/media_engine/) |
| Built-in demo media and hidden fixtures | [media/](../media/) |
| Codec/vector experiments | [experiments/](../experiments/) |
| Build, smoke, release, Podman, FFmpeg scripts | [scripts/](../scripts/) |
| User/developer docs | [docs/](.) and [README](../README.md) |

## Working Safely

Before editing:

- Check `git status --short`.
- Assume uncommitted changes may be user work.
- Do not reset, checkout, or revert unrelated changes.
- Search with `rg` before changing shared behavior.
- Prefer existing patterns and helper APIs over new abstractions.
- Keep changes scoped to the request.

When editing:

- Use the canonical parameter model rather than creating parallel renderer state.
- Keep source selection, presets, WTF mode, audio modulation, and native output
  synchronization in agreement.
- Preserve Tauri's narrow permissions and capability model.
- Keep runtime assets bundled locally.
- Use existing build scripts rather than ad hoc build commands when possible.
- Update docs when changing product behavior, release behavior, renderer
  architecture, or setup requirements.

## Common Validation Commands

Pick the smallest set that covers the change.

Documentation only:

```bash
git diff --check
```

For broader test selection, read [Testing](TESTING.md).

Frontend/UI/source behavior:

```bash
npm run build
npm run smoke:static
```

Rust/Tauri behavior:

```bash
npm run test:rust
npm run check:desktop
```

Optimized macOS app build:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat /private/tmp/ascii-vj-remix-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat /private/tmp/ascii-vj-remix-updater.password)" npm run tauri -- build --bundles app
```

Release packaging:

```bash
npm run ffmpeg:build-sidecar
npm run check:release
npm run bundle:release
```

Expected local release-build note:

- If Apple Developer ID credentials are absent, Tauri may warn that notarization
  is skipped. That is expected until notarization is enabled.
- If `TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is
  absent while updater artifacts are enabled, release bundling will fail at
  updater signing. Use the local key/password above for local validation, and
  never commit either file.

## Tauri and Packaging Notes

- Tauri v2 is the desktop shell.
- `src-tauri/tauri.conf.json` is the default local/ad-hoc signed config.
- `src-tauri/tauri.notarized.conf.json` is for future Developer ID notarized
  macOS release builds.
- macOS builds in iCloud Drive workspaces redirect target output to
  `/private/tmp/ascii-vj-remix-tauri-target` through the helper scripts to avoid
  iCloud extended attributes breaking codesign.
- Release updater artifacts are signed with a minisign key. The public key is
  committed; the private key belongs in GitHub Actions secrets.
- FFmpeg sidecars must be reviewed, local, and policy-checked. The packaged app
  should not download FFmpeg, codecs, renderer assets, or fonts at runtime.

See [Contributor Guide: Release and Updater Work](CONTRIBUTORS.md#release-and-updater-work)
for the full release/updater procedure.

## Renderer Mental Model

Use this flow when reasoning about bugs:

```text
source selection
  -> source adapter
  -> canonical params
  -> optional live modulation
  -> effective params
  -> renderer runtime
  -> main preview
  -> optional native/browser Pop Out
```

Important implications:

- Saved params and effective params are different. Audio reactivity should
  modify effective params, not saved preset definitions.
- Source identity matters. Preset transitions should not silently reset source
  or restart media playback.
- Native output needs fresh params and frames. If Pop Out looks stale, inspect
  native output synchronization before adding another renderer.
- Camera latency work should prefer latest-frame native capture/presentation
  paths over buffered decode paths.
- Fallback paths matter for Windows/Linux and for environments without the best
  GPU backend.

See [Rendering Engine](RENDERING_ENGINE.md) for deeper architecture details.

## Documentation Update Rules

When behavior changes, update the closest durable doc:

- User-facing feature or install behavior: [README](../README.md).
- Current release behavior: [Changelog](../CHANGELOG.md).
- Planned/deferred work: [Roadmap](ROADMAP.md).
- Renderer architecture, media flow, native output, audio modulation, MIDI
  architecture: [Rendering Engine](RENDERING_ENGINE.md).
- Build, test, release, FFmpeg, Podman, or contributor workflow:
  [Contributor Guide](CONTRIBUTORS.md).
- Security model, local media, permissions, updater signing, or Tauri
  capabilities: [Security](SECURITY.md).
- Performance-sensitive renderer, Pop Out, camera, audio, or source behavior:
  [Performance](PERFORMANCE.md).
- Check selection and manual verification: [Testing](TESTING.md).
- Keyboard/focus/contrast/control-label behavior:
  [Accessibility](ACCESSIBILITY.md).
- User-visible string, locale, or translation architecture:
  [Internationalization](I18N.md).
- Agent onboarding assumptions: this file.

Keep docs native-app focused. Do not add browser-based build instructions to the
README unless the product direction changes.

## Known Future Work To Respect

The roadmap tracks future work. At a high level:

- Productize local stream mode only when the full standalone source workflow is
  ready.
- Add MIDI control, initially targeting an Evolution/M-Audio UC33e through an
  iConnectivity mioXC.
- Continue improving native GPU output and platform-native capture paths.
- Add Apple Developer ID notarization and Windows SmartScreen mitigation.
- Expand real install and updater-hop tests on Windows/Linux machines.

Before implementing any of these, read [Roadmap](ROADMAP.md) and
[Rendering Engine](RENDERING_ENGINE.md), then inspect the current code paths.
