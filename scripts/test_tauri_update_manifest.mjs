import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectReleaseAssets,
  createUpdateFragment,
  githubReleaseAssetName,
  inferInstallerPlatform,
  inferPlatform,
  installerForArtifactName,
  mergeUpdateFragments,
  normalizeSignature
} from './lib/tauri_update_manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'asciline-updater-manifest-'));
const bundleRoot = path.join(tempRoot, 'bundle');
const outDir = path.join(tempRoot, 'release-assets');

await mkdir(path.join(bundleRoot, 'macos'), { recursive: true });
await writeFile(path.join(bundleRoot, 'macos', 'ASCILINE Remix.app.tar.gz'), 'artifact');
await writeFile(path.join(bundleRoot, 'macos', 'ASCILINE Remix.app.tar.gz.sig'), 'signed-base64');
await writeFile(path.join(bundleRoot, 'macos', 'ASCILINE Remix.dmg'), 'dmg');

assert.equal(normalizeSignature(' abc '), 'abc');
assert.equal(normalizeSignature('{"signature":"xyz"}'), 'xyz');
assert.equal(githubReleaseAssetName('ASCILINE Remix_0.1.0_amd64.deb'), 'ASCILINE.Remix_0.1.0_amd64.deb');
assert.equal(inferPlatform({ explicitPlatform: 'darwin-aarch64' }), 'darwin-aarch64');
assert.equal(inferPlatform({ artifactName: 'ASCILINE Remix.app.tar.gz', env: { RUNNER_OS: 'macOS', RUNNER_ARCH: 'ARM64' } }), 'darwin-aarch64');
assert.equal(installerForArtifactName('ASCILINE Remix_0.1.0_amd64.deb'), 'deb');
assert.equal(inferInstallerPlatform({ artifactName: 'ASCILINE Remix_0.1.0_amd64.deb', env: { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' } }), 'linux-x86_64-deb');

const copied = await collectReleaseAssets({ bundleRoot, outDir });
assert.deepEqual(copied.map((filePath) => path.basename(filePath)).sort(), [
  'ASCILINE.Remix.app.tar.gz',
  'ASCILINE.Remix.app.tar.gz.sig',
  'ASCILINE.Remix.dmg'
]);

const fragmentPath = path.join(outDir, 'updater-fragment-macos.json');
const fragment = await createUpdateFragment({
  root,
  bundleRoot: outDir,
  outFile: fragmentPath,
  repo: 'aindaco1/ascii-live-remix',
  tag: 'v0.1.0',
  version: '0.1.0',
  platform: 'darwin-aarch64',
  pubDate: '2026-06-20T00:00:00.000Z'
});
assert.equal(fragment.platforms['darwin-aarch64-app'].signature, 'signed-base64');
assert.equal(fragment.platforms['darwin-aarch64-app'].url, 'https://github.com/aindaco1/ascii-live-remix/releases/download/v0.1.0/ASCILINE.Remix.app.tar.gz');
assert.equal(fragment.platforms['darwin-aarch64'].signature, 'signed-base64');
assert.equal(fragment.platforms['darwin-aarch64'].url, 'https://github.com/aindaco1/ascii-live-remix/releases/download/v0.1.0/ASCILINE.Remix.app.tar.gz');

const latestPath = path.join(tempRoot, 'latest.json');
const { manifest } = await mergeUpdateFragments({
  fragmentsDir: outDir,
  outFile: latestPath
});
assert.equal(manifest.version, '0.1.0');
assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-aarch64-app']);
assert.equal(JSON.parse(await readFile(latestPath, 'utf8')).platforms['darwin-aarch64'].signature, 'signed-base64');

console.log('Tauri updater manifest tests passed.');
