import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RELEASE_ASSET_PATTERNS = [
  /\.app\.tar\.gz$/i,
  /\.appimage\.tar\.gz$/i,
  /\.msi\.zip$/i,
  /\.nsis\.zip$/i,
  /\.dmg$/i,
  /\.msi$/i,
  /\.exe$/i,
  /\.appimage$/i,
  /\.deb$/i,
  /\.rpm$/i,
  /\.zip$/i,
  /\.sig$/i
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${arg.slice(2)}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile()) {
        out.push(filePath);
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function isReleaseAsset(filePath) {
  const name = path.basename(filePath);
  return RELEASE_ASSET_PATTERNS.some((pattern) => pattern.test(name));
}

function archForUpdater(arch) {
  const normalized = String(arch || '').toLowerCase();
  if (['x64', 'x86_64', 'amd64'].includes(normalized)) return 'x86_64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'aarch64';
  return normalized || 'x86_64';
}

function osForUpdater(os) {
  const normalized = String(os || '').toLowerCase();
  if (normalized === 'macos' || normalized === 'darwin') return 'darwin';
  if (normalized === 'windows' || normalized === 'win32') return 'windows';
  if (normalized === 'linux') return 'linux';
  return normalized;
}

function inferPlatform({ explicitPlatform, artifactName, env = process.env } = {}) {
  if (explicitPlatform) return explicitPlatform;

  const name = String(artifactName || '').toLowerCase();
  const runnerOs = env.RUNNER_OS || process.platform;
  const runnerArch = env.RUNNER_ARCH || process.arch;
  const os = osForUpdater(runnerOs);

  let arch = archForUpdater(runnerArch);
  if (name.includes('aarch64') || name.includes('arm64')) arch = 'aarch64';
  if (name.includes('x86_64') || name.includes('x64') || name.includes('amd64')) arch = 'x86_64';

  if (!['darwin', 'windows', 'linux'].includes(os)) {
    throw new Error(`cannot infer updater OS from ${runnerOs}; pass --platform explicitly`);
  }

  return `${os}-${arch}`;
}

function artifactScore(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith('.app.tar.gz')) return 10;
  if (name.endsWith('.appimage.tar.gz')) return 20;
  if (name.endsWith('.msi.zip')) return 30;
  if (name.endsWith('.nsis.zip')) return 35;
  if (name.endsWith('.appimage')) return 50;
  if (name.endsWith('.msi')) return 60;
  if (name.endsWith('.exe')) return 70;
  if (name.endsWith('.deb')) return 80;
  if (name.endsWith('.rpm')) return 85;
  if (name.endsWith('.dmg')) return 90;
  return 100;
}

function githubReleaseAssetName(name) {
  return String(name || '').replace(/\s+/g, '.');
}

function githubReleaseAssetUrl(baseUrl, artifactName) {
  return `${baseUrl}/${encodeURIComponent(githubReleaseAssetName(artifactName))}`;
}

function installerForArtifactName(artifactName) {
  const name = String(artifactName || '').toLowerCase();
  if (name.endsWith('.app.tar.gz')) return 'app';
  if (name.endsWith('.appimage.tar.gz') || name.endsWith('.appimage')) return 'appimage';
  if (name.endsWith('.msi.zip') || name.endsWith('.msi')) return 'msi';
  if (name.endsWith('.nsis.zip') || name.endsWith('-setup.exe') || name.endsWith('.exe')) return 'nsis';
  if (name.endsWith('.deb')) return 'deb';
  if (name.endsWith('.rpm')) return 'rpm';
  return '';
}

function inferInstallerPlatform({ explicitPlatform, artifactName, env = process.env } = {}) {
  const base = inferPlatform({ explicitPlatform, artifactName, env });
  const installer = installerForArtifactName(artifactName);
  return installer ? `${base}-${installer}` : base;
}

function normalizeSignature(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('empty updater signature');
  if (!text.startsWith('{')) return text;
  const parsed = JSON.parse(text);
  const signature = parsed.signature || parsed.sig;
  if (!signature) throw new Error('signature JSON is missing a signature field');
  return String(signature).trim();
}

function gitHubReleaseBaseUrl(repo, tag) {
  if (!repo) throw new Error('missing GitHub repository; pass --repo owner/name or set GITHUB_REPOSITORY');
  if (!tag) throw new Error('missing release tag; pass --tag or set GITHUB_REF_NAME');
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
}

async function readTauriVersion(root) {
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  return String(config.version || '').trim();
}

async function collectReleaseAssets({ bundleRoot, outDir }) {
  if (!(await exists(bundleRoot))) throw new Error(`bundle root does not exist: ${bundleRoot}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const copied = [];
  const seenNames = new Set();
  for (const filePath of await walkFiles(bundleRoot)) {
    if (!isReleaseAsset(filePath)) continue;
    const name = githubReleaseAssetName(path.basename(filePath));
    if (seenNames.has(name)) {
      throw new Error(`duplicate release asset basename would overwrite another asset: ${name}`);
    }
    seenNames.add(name);
    const target = path.join(outDir, name);
    await copyFile(filePath, target);
    copied.push(target);
  }

  if (copied.length === 0) throw new Error(`no release assets found under ${bundleRoot}`);
  return copied.sort((a, b) => a.localeCompare(b));
}

async function signedArtifactPairs(bundleRoot) {
  const files = await walkFiles(bundleRoot);
  const signatures = files.filter((filePath) => filePath.endsWith('.sig'));
  const pairs = [];
  for (const signaturePath of signatures) {
    const artifactPath = signaturePath.slice(0, -4);
    if (!(await exists(artifactPath))) continue;
    pairs.push({
      artifactPath,
      signaturePath,
      artifactName: path.basename(artifactPath),
      signature: normalizeSignature(await readFile(signaturePath, 'utf8'))
    });
  }
  return pairs.sort((a, b) => artifactScore(a.artifactPath) - artifactScore(b.artifactPath) || a.artifactName.localeCompare(b.artifactName));
}

async function createUpdateFragment({
  root,
  bundleRoot,
  outFile,
  repo = process.env.GITHUB_REPOSITORY,
  tag = process.env.GITHUB_REF_NAME,
  version,
  notes,
  pubDate,
  platform,
  assetBaseUrl
}) {
  const pairs = await signedArtifactPairs(bundleRoot);
  if (pairs.length === 0) {
    throw new Error(`no signed updater artifacts found under ${bundleRoot}`);
  }

  const finalVersion = version || await readTauriVersion(root);
  const baseUrl = (assetBaseUrl || gitHubReleaseBaseUrl(repo, tag)).replace(/\/+$/, '');
  const grouped = new Map();
  const platforms = {};
  const selectedArtifacts = [];

  for (const pair of pairs) {
    const key = inferPlatform({ explicitPlatform: platform, artifactName: pair.artifactName });
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(pair);

    const installerKey = inferInstallerPlatform({ explicitPlatform: platform, artifactName: pair.artifactName });
    if (installerKey !== key) {
      if (platforms[installerKey]) throw new Error(`duplicate updater platform in artifacts: ${installerKey}`);
      platforms[installerKey] = {
        signature: pair.signature,
        url: githubReleaseAssetUrl(baseUrl, pair.artifactName)
      };
      selectedArtifacts.push({
        platform: installerKey,
        artifact: pair.artifactName,
        ignoredAlternates: []
      });
    }
  }

  for (const [key, candidates] of grouped) {
    candidates.sort((a, b) => artifactScore(a.artifactPath) - artifactScore(b.artifactPath) || a.artifactName.localeCompare(b.artifactName));
    const selected = candidates[0];
    selectedArtifacts.push({
      platform: key,
      artifact: selected.artifactName,
      ignoredAlternates: candidates.slice(1).map((candidate) => candidate.artifactName)
    });
    platforms[key] = {
      signature: selected.signature,
      url: githubReleaseAssetUrl(baseUrl, selected.artifactName)
    };
  }

  const fragment = {
    version: finalVersion,
    notes: notes || `ASCILINE Remix ${finalVersion}`,
    pub_date: pubDate || new Date().toISOString(),
    platforms,
    _source: {
      artifacts: selectedArtifacts
    }
  };

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(fragment, null, 2)}\n`);
  return fragment;
}

async function mergeUpdateFragments({ fragmentsDir, outFile, version, notes, pubDate }) {
  if (!(await exists(fragmentsDir))) throw new Error(`fragments directory does not exist: ${fragmentsDir}`);
  const files = (await walkFiles(fragmentsDir)).filter((filePath) => /updater-fragment.*\.json$/i.test(path.basename(filePath)));
  if (files.length === 0) throw new Error(`no updater fragments found under ${fragmentsDir}`);

  const fragments = [];
  for (const filePath of files) {
    fragments.push({ filePath, value: JSON.parse(await readFile(filePath, 'utf8')) });
  }

  const finalVersion = version || fragments[0].value.version;
  const finalNotes = notes || fragments[0].value.notes || `ASCILINE Remix ${finalVersion}`;
  const finalPubDate = pubDate || fragments[0].value.pub_date || new Date().toISOString();
  const platforms = {};

  for (const fragment of fragments) {
    if (fragment.value.version !== finalVersion) {
      throw new Error(`${fragment.filePath} has version ${fragment.value.version}; expected ${finalVersion}`);
    }
    for (const [platform, entry] of Object.entries(fragment.value.platforms || {})) {
      if (platforms[platform]) throw new Error(`duplicate updater platform in fragments: ${platform}`);
      if (!entry.signature || !entry.url) throw new Error(`${fragment.filePath} has invalid ${platform} entry`);
      platforms[platform] = {
        signature: entry.signature,
        url: entry.url
      };
    }
  }

  const manifest = {
    version: finalVersion,
    notes: finalNotes,
    pub_date: finalPubDate,
    platforms
  };

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, files };
}

export {
  collectReleaseAssets,
  createUpdateFragment,
  githubReleaseAssetName,
  githubReleaseAssetUrl,
  inferInstallerPlatform,
  inferPlatform,
  installerForArtifactName,
  isReleaseAsset,
  mergeUpdateFragments,
  normalizeSignature,
  parseArgs,
  signedArtifactPairs
};
