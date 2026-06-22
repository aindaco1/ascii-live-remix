# Tauri Release and Update Runbook

ASCII VJ Remix desktop builds must remain standalone at runtime. The only intentional online path is the Tauri updater, which checks GitHub release metadata when the app chooses to invoke the updater plugin.

## Signing Model

- Tauri updater packages are signed with a minisign key pair.
- The public updater key is committed in `src-tauri/tauri.conf.json`.
- The private updater key must never be committed. Store it as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional and should be set only if the private key was generated with a password.

The current public key was generated with:

```bash
npm run tauri -- signer generate --ci -w /private/tmp/asciline-remix-updater.key
```

For this local workspace, the generated private key is at `/private/tmp/asciline-remix-updater.key`. Add the contents of that file to the GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY` before running a release workflow. This key was generated without a password, so leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset or set it to an empty string.

To automate uploading the key with GitHub CLI:

```bash
npm run updater:secret:check
npm run updater:secret:set
npm run release:secrets:check
```

The script passes the key to `gh secret set` over stdin, not as a command-line argument, so the secret is not exposed through shell history or process listings. Use `-- --repo owner/repo` or `-- --key /path/to/key` after the npm script if the defaults are wrong.

## macOS App Signing

`src-tauri/tauri.conf.json` sets `bundle.macOS.signingIdentity` to `"-"`, which asks Tauri/codesign for ad-hoc signing. This makes local bundles code-sign-valid and avoids shipping a completely unsigned `.app`.

Ad-hoc signing is not Apple notarization. A GitHub-downloaded app can still show Gatekeeper warnings because Apple requires a Developer ID certificate and notarization for the cleanest first-open experience. The current setup is the best self-signed/default path; broad public distribution should later add Developer ID signing and notarization.

Local macOS media privacy grants can be sensitive to the final app signature. `scripts/run_local_desktop_app.sh` accepts `ASCILINE_CODESIGN_IDENTITY="<identity>"` so local test builds can be re-signed with a stable local/self-signed code-signing identity instead of a changing ad-hoc signature. Keep using `-` when no local identity is available.

Create a local self-signed code-signing identity once:

```bash
npm run desktop:codesign:local
```

Then run local builds with:

```bash
ASCILINE_CODESIGN_IDENTITY="ASCII VJ Remix Local Code Signing" npm run desktop:run-local
```

macOS will still require you to grant media permissions once for that new stable identity, but subsequent local rebuilds should reuse the same TCC grants as long as the bundle identifier and signing identity stay stable.

## Developer ID Notarization Track

Developer ID signing and notarization is deferred until the app identity and public macOS distribution plan are ready. This is separate from the current ad-hoc signing path, which remains the default.

Required inputs:

- Apple Developer Program membership.
- `APPLE_CERTIFICATE`: base64-encoded `.p12` export of the Developer ID Application certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the exported `.p12`.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password.
- Apple notarization credentials, preferably App Store Connect API credentials:
  - `APPLE_API_KEY`: App Store Connect key id.
  - `APPLE_API_ISSUER`: App Store Connect issuer id.
  - `APPLE_API_KEY_P8`: raw contents of the downloaded `.p8` key.
- Apple ID notarization credentials are also supported instead:
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`
- The release workflow imports the certificate into a temporary keychain, sets `APPLE_SIGNING_IDENTITY`, and passes `src-tauri/tauri.notarized.conf.json` to Tauri so local ad-hoc signing remains the default.

Check whether the repository has enough secrets for notarized releases:

```bash
npm run release:secrets:check:notarized
```

The check reads only secret names through GitHub CLI, never secret values.

To upload the Apple secrets with App Store Connect API credentials:

```bash
npm run release:secrets:set:macos -- \
  --certificate /path/to/developer-id-application.p12 \
  --certificate-password-file /path/to/p12-password.txt \
  --api-key ABCDE12345 \
  --api-issuer 00000000-0000-0000-0000-000000000000 \
  --api-key-file /path/to/AuthKey_ABCDE12345.p8
```

To use Apple ID notarization credentials instead:

```bash
npm run release:secrets:set:macos -- \
  --certificate /path/to/developer-id-application.p12 \
  --certificate-password-file /path/to/p12-password.txt \
  --apple-id-file /path/to/apple-id-email.txt \
  --apple-password-file /path/to/app-specific-password.txt \
  --apple-team-id TEAMID12345
```

When `--keychain-password-file` is omitted, the script generates a random temporary keychain password and stores it in the `KEYCHAIN_PASSWORD` GitHub secret. All secret values are sent to GitHub CLI over stdin and are not printed.

Release gates to add:

- Verify `codesign -dvvv --entitlements :-` reports the Developer ID identity and hardened runtime.
- Submit the macOS artifact for notarization during the release workflow. **Initial conditional workflow path is in place.**
- Staple notarization to the `.app` or DMG as appropriate. **Handled by Tauri when notarization credentials are present and `--skip-stapling` is not used.**
- Run `spctl -a -vv` against the final artifact in CI or a local release validation step. **Initial conditional workflow check is in place via `npm run check:macos-notarization`.**

## GitHub Release Flow

Release publishing is handled by `.github/workflows/release-desktop.yml`.

1. Tag a release, or run the workflow manually with a tag.
2. Each platform runs the release gates, builds a Tauri bundle, verifies the bundle, collects publishable assets, and writes an updater fragment.
3. The publish job downloads all platform assets, merges the updater fragments into `latest.json`, creates or updates the GitHub Release, and uploads the installers, updater packages, signatures, and `latest.json`.
4. Windows and Linux post-publish smoke jobs download the public GitHub Release, install the MSI/deb artifact on fresh hosted runners, verify bundled FFmpeg/ffprobe resources, run a bounded packaged-app launch, and force a Tauri updater check/download against the published signed updater package.
5. When a previous release with install-capable smoke hooks exists, the same smoke job downloads that older release, installs it, invokes the real Tauri updater install path, waits for the installed app to become the new version, and then repeats the launch/updater checks. In that path, CI does not also reinstall the same current MSI/deb afterward; the current package has already been exercised through the updater installer.

The app is configured to check:

```text
https://github.com/aindaco1/ascii-live-remix/releases/latest/download/latest.json
```

The generated `latest.json` points each platform entry at tag-specific release assets.

## Local Validation

Use these checks before publishing release changes:

```bash
npm run check:desktop
npm run test:updater-manifest
npm run check:bundle:debug
```

On this macOS iCloud Drive workspace, Tauri build output is redirected to `/private/tmp/asciline-remix-tauri-target` to avoid iCloud extended attributes breaking `codesign`. Normal CI and non-iCloud workspaces continue to use `src-tauri/target`. Override with `ASCILINE_TAURI_TARGET_DIR` or `CARGO_TARGET_DIR` when needed.

For a local debug bundle with the generated updater key:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat /private/tmp/asciline-remix-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run bundle:debug
```

`npm run check:release` also runs updater-manifest validation, but it intentionally requires a reviewed standalone FFmpeg sidecar for the current platform. The GitHub release workflow satisfies that gate by running `npm run ffmpeg:build-sidecar` before `check:release`; it builds from the pinned official FFmpeg 8.1.2 source tarball, verifies the source SHA-256, disables FFmpeg network protocols, and stages LGPL-compatible FFmpeg/ffprobe binaries as local Tauri resources.

Runtime builds remain offline. The release workflow may download official source during CI, but the packaged app includes the built sidecars and never downloads FFmpeg, codecs, or renderer assets at runtime.

## Release Smoke Tests

The release workflow runs `scripts/smoke_tauri_release_install.mjs` after publishing. It intentionally downloads artifacts from GitHub Releases instead of reusing local build directories, so it catches missing assets, bad `latest.json` URLs, installer layout problems, and broken signed updater downloads.

The app has CI-only smoke hooks that are inert unless these environment variables are set:

- `ASCILINE_DESKTOP_SMOKE=launch`: exits after a short bounded launch and writes a report.
- `ASCILINE_UPDATER_SMOKE=download`: invokes the real Tauri updater plugin, checks `latest.json`, downloads the selected signed updater package, verifies its signature, writes a report, and exits.
- `ASCILINE_UPDATER_SMOKE=install`: invokes the same updater path, downloads and verifies the package, writes a pre-install report, and calls Tauri's installer path. Windows exits from inside the updater install call after launching the installer, so the smoke script verifies completion by relaunching the installed app and checking its reported package version.
- `ASCILINE_UPDATER_SMOKE_FORCE_FROM_VERSION`: records the forced older-version hop used by CI. The download smoke uses this to exercise updater selection against the just-published version even when the installed app is already current.

The true app-driven updater hop needs a previous release that already contains `ASCILINE_UPDATER_SMOKE=install`. Releases before v0.1.5 can only participate in direct install and updater download smoke. Starting with the next release after v0.1.5, CI automatically selects the newest eligible previous release, updates it to the just-published release, and verifies the installed version changed.
