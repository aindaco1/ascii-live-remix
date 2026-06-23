#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const releaseTag = args.releaseTag || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
const version = String(args.version || releaseTag.replace(/^v/, '')).trim();
const timeoutMs = Number(args.timeoutMs || 180000);
const mode = args.mode || 'install-and-updater';
const previousReleaseArg = args.previousReleaseTag
  || process.env.ASCILINE_PREVIOUS_RELEASE_TAG
  || process.env.PREVIOUS_RELEASE_TAG
  || 'auto';
const updaterInstallSmokeMinVersion = String(
  args.updaterInstallSmokeMinVersion
    || process.env.ASCILINE_UPDATER_SMOKE_MIN_VERSION
    || '0.9.0'
).replace(/^v/, '');

try {
  await main();
} catch (error) {
  fail(error.message || String(error));
}

async function main() {
  if (!version) {
    throw new Error('missing release version; pass --version or --release-tag');
  }

  const current = await loadReleaseContext({
    assetsDir: path.resolve(args.assetsDir || 'release-smoke'),
    releaseTag,
    expectedVersion: version
  });
  const previous = await resolvePreviousReleaseContext(current);

  if (process.platform === 'win32') {
    await smokeWindows(current, previous);
  } else if (process.platform === 'linux') {
    await smokeLinux(current, previous);
  } else {
    throw new Error(`release install smoke only supports Windows and Linux, got ${process.platform}`);
  }
}

async function smokeWindows(current, previous) {
  await assertWindowsAssets(current);

  if (previous) {
    await smokeWindowsUpdaterHop(current, previous);
  }

  if (!previous || mode === 'direct-install-after-hop') {
    await installWindows(current);
    const exe = await findWindowsExecutable();
    await verifyWindowsInstall(exe, current.version);

    if (mode !== 'install-only') {
      await runLaunchSmoke(exe, [], current.version);
      await runUpdaterDownloadSmoke(exe, [], current);
    }

    console.log(`Windows release install smoke passed for ${current.version}: ${exe}`);
  }
}

async function smokeWindowsUpdaterHop(current, previous) {
  await assertWindowsAssets(previous);
  await installWindows(previous);
  let exe = await findWindowsExecutable();
  await verifyWindowsInstall(exe, previous.version);
  await runLaunchSmoke(exe, [], previous.version);

  await runUpdaterInstallSmoke(exe, [], current, previous);
  exe = await waitForWindowsLaunchVersion(current.version);
  await verifyWindowsInstall(exe, current.version);
  await runUpdaterDownloadSmoke(exe, [], current);

  console.log(`Windows updater hop smoke passed: ${previous.version} -> ${current.version}`);
}

async function smokeLinux(current, previous) {
  await assertLinuxAssets(current);

  if (previous) {
    await smokeLinuxUpdaterHop(current, previous);
  }

  if (!previous || mode === 'direct-install-after-hop') {
    const packageName = await installLinux(current);
    const exe = await verifyLinuxInstall(packageName, current.version);

    if (mode !== 'install-only') {
      await runLaunchSmoke(exe, linuxAppPrefix(), current.version);
      await runUpdaterDownloadSmoke(exe, linuxAppPrefix(), current);
    }

    console.log(`Linux release install smoke passed for ${current.version}: ${exe}`);
  }
}

async function smokeLinuxUpdaterHop(current, previous) {
  await assertLinuxAssets(previous);
  const previousPackageName = await installLinux(previous);
  let exe = await verifyLinuxInstall(previousPackageName, previous.version);
  await runLaunchSmoke(exe, linuxAppPrefix(), previous.version);

  await runUpdaterInstallSmoke(exe, linuxAppPrefix(), current, previous);
  exe = await waitForLinuxPackageVersion(previousPackageName, current.version);
  await runLaunchSmoke(exe, linuxAppPrefix(), current.version);
  await runUpdaterDownloadSmoke(exe, linuxAppPrefix(), current);

  console.log(`Linux updater hop smoke passed: ${previous.version} -> ${current.version}`);
}

async function installWindows(context) {
  const msi = await findOne(context.assetsDir, /_x64_en-US\.msi$/i, 'Windows MSI installer');
  run('msiexec.exe', ['/i', msi, '/qn', '/norestart'], { timeout: timeoutMs });
}

async function verifyWindowsInstall(exe, expectedVersion) {
  const appRoot = path.dirname(exe);
  await requireNestedFile(appRoot, /ffmpeg\.exe$/i, 'bundled Windows ffmpeg.exe');
  await requireNestedFile(appRoot, /ffprobe\.exe$/i, 'bundled Windows ffprobe.exe');
  await runLaunchSmoke(exe, [], expectedVersion);
}

async function installLinux(context) {
  const deb = await findOne(context.assetsDir, /\.deb$/i, 'Linux deb installer');
  const packageName = run('dpkg-deb', ['-f', deb, 'Package']).stdout.trim();

  run('sudo', ['apt-get', 'update'], { timeout: timeoutMs });
  run('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', deb], { timeout: timeoutMs });

  return packageName;
}

async function verifyLinuxInstall(packageName, expectedVersion) {
  const packageStatus = run('dpkg-query', ['-W', '-f=${Package} ${Version}', packageName]).stdout.trim();
  if (!packageStatus.includes(expectedVersion)) {
    throw new Error(`installed package version mismatch: ${packageStatus}`);
  }

  const installedFiles = run('dpkg', ['-L', packageName]).stdout.split(/\r?\n/).filter(Boolean);
  const exe = installedFiles.find((file) => /\/bin\/ascii-vj-remix$/i.test(file))
    || installedFiles.find((file) => /\/bin\/asciline-remix$/i.test(file))
    || installedFiles.find((file) => /ascii-vj-remix$/i.test(file))
    || installedFiles.find((file) => /asciline-remix$/i.test(file));
  if (!exe) throw new Error(`could not locate installed executable for ${packageName}`);
  if (!installedFiles.some((file) => /ffmpeg$/i.test(file))) {
    throw new Error('bundled Linux ffmpeg is missing from installed package');
  }
  if (!installedFiles.some((file) => /ffprobe$/i.test(file))) {
    throw new Error('bundled Linux ffprobe is missing from installed package');
  }
  return exe;
}

async function runLaunchSmoke(exe, prefix, expectedVersion) {
  const report = path.join(await mkdtemp(path.join(os.tmpdir(), 'asciline-launch-smoke-')), 'report.json');
  const env = {
    ...process.env,
    ASCILINE_DESKTOP_SMOKE: 'launch',
    ASCILINE_DESKTOP_SMOKE_DELAY_MS: '1500',
    ASCILINE_DESKTOP_SMOKE_REPORT: report,
    ASCILINE_SMOKE_REPORT: report
  };
  run(prefix[0] || exe, prefix[0] ? [...prefix.slice(1), exe] : [], { env, timeout: timeoutMs });
  const value = await readJson(report);
  if (!value.ok || value.kind !== 'launch') {
    throw new Error(`launch smoke failed: ${JSON.stringify(value)}`);
  }
  if (value.package_version !== expectedVersion) {
    throw new Error(`launch smoke package version ${value.package_version} does not match ${expectedVersion}`);
  }
}

async function runUpdaterDownloadSmoke(exe, prefix, context) {
  const value = await runUpdaterSmoke(exe, prefix, {
    context,
    smokeMode: 'download',
    forceUpdate: true,
    forcedFromVersion: '0.0.0'
  });
  if (!Number.isFinite(value.downloaded_bytes) || value.downloaded_bytes <= 0) {
    throw new Error(`updater did not download a signed package: ${JSON.stringify(value)}`);
  }
}

async function runUpdaterInstallSmoke(exe, prefix, current, previous) {
  if (compareVersions(previous.version, current.version) >= 0) {
    throw new Error(`previous release ${previous.version} is not older than current release ${current.version}`);
  }

  const value = await runUpdaterSmoke(exe, prefix, {
    context: current,
    smokeMode: 'install',
    forceUpdate: false,
    forcedFromVersion: previous.version,
    silentInstall: true
  });
  if (!value.install_started) {
    throw new Error(`updater install smoke did not start installation: ${JSON.stringify(value)}`);
  }
}

async function runUpdaterSmoke(exe, prefix, options) {
  const report = path.join(await mkdtemp(path.join(os.tmpdir(), 'asciline-updater-smoke-')), 'report.json');
  const env = {
    ...process.env,
    ASCILINE_UPDATER_SMOKE: options.smokeMode,
    ASCILINE_UPDATER_EXPECT_VERSION: options.context.version,
    ASCILINE_UPDATER_SMOKE_FORCE_FROM_VERSION: options.forcedFromVersion,
    ASCILINE_UPDATER_SMOKE_REPORT: report,
    ASCILINE_SMOKE_REPORT: report
  };
  if (options.forceUpdate) {
    env.ASCILINE_UPDATER_SMOKE_FORCE_UPDATE = '1';
  }
  if (options.silentInstall) {
    env.ASCILINE_UPDATER_SMOKE_SILENT_INSTALL = '1';
  }

  run(prefix[0] || exe, prefix[0] ? [...prefix.slice(1), exe] : [], { env, timeout: timeoutMs });
  const value = await readJson(report);
  if (!value.ok || value.kind !== 'updater' || !value.found_update) {
    throw new Error(`updater smoke failed: ${JSON.stringify(value)}`);
  }
  if (value.update_version !== options.context.version) {
    throw new Error(`updater reported ${value.update_version}, expected ${options.context.version}`);
  }
  return value;
}

async function waitForWindowsLaunchVersion(expectedVersion) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const exe = await findWindowsExecutable();
      await runLaunchSmoke(exe, [], expectedVersion);
      return exe;
    } catch (error) {
      lastError = error;
      await delay(5000);
    }
  }
  throw new Error(`installed Windows app did not reach ${expectedVersion}: ${lastError?.message || 'timed out'}`);
}

async function waitForLinuxPackageVersion(packageName, expectedVersion) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await verifyLinuxInstall(packageName, expectedVersion);
    } catch (error) {
      lastError = error;
      await delay(5000);
    }
  }
  throw new Error(`installed Linux package did not reach ${expectedVersion}: ${lastError?.message || 'timed out'}`);
}

async function assertWindowsAssets(context) {
  await findOne(context.assetsDir, /_x64_en-US\.msi$/i, 'Windows MSI installer');
  assertUpdaterEntry(context, 'windows-x86_64-msi', /\.msi$/i);
  assertUpdaterEntry(context, 'windows-x86_64', /\.msi$/i);
}

async function assertLinuxAssets(context) {
  await findOne(context.assetsDir, /\.deb$/i, 'Linux deb installer');
  await findOne(context.assetsDir, /\.AppImage$/i, 'Linux AppImage updater package');
  assertUpdaterEntry(context, 'linux-x86_64-deb', /\.deb$/i);
  assertUpdaterEntry(context, 'linux-x86_64', /\.AppImage$/i);
}

function linuxAppPrefix() {
  if (process.env.ASCILINE_NO_XVFB === '1') return [];
  return ['xvfb-run', '-a'];
}

async function loadReleaseContext({ assetsDir, releaseTag: tag, expectedVersion }) {
  const latestJson = await readJson(path.join(assetsDir, 'latest.json'));
  const foundVersion = String(latestJson.version || '').trim();
  if (!foundVersion) {
    throw new Error(`${assetsDir}/latest.json is missing version`);
  }
  if (expectedVersion && foundVersion !== expectedVersion) {
    throw new Error(`latest.json version ${foundVersion} does not match expected ${expectedVersion}`);
  }
  return {
    assetsDir,
    releaseTag: tag || `v${foundVersion}`,
    version: foundVersion,
    latestJson
  };
}

async function resolvePreviousReleaseContext(current) {
  if (previousReleaseArg === 'none' || previousReleaseArg === 'false' || mode === 'install-only') {
    return null;
  }

  const previousTag = previousReleaseArg === 'auto'
    ? await resolveAutomaticPreviousReleaseTag(current.version)
    : previousReleaseArg;
  if (!previousTag) return null;

  const previousVersion = previousTag.replace(/^v/, '');
  if (compareVersions(previousVersion, updaterInstallSmokeMinVersion) < 0) {
    const message = `previous release ${previousTag} predates install-capable smoke hooks; minimum is v${updaterInstallSmokeMinVersion}`;
    if (previousReleaseArg === 'auto') {
      console.log(`${message}. Skipping true updater self-replacement hop for this release.`);
      return null;
    }
    throw new Error(message);
  }

  const previousRoot = await mkdtemp(path.join(os.tmpdir(), 'asciline-previous-release-'));
  const previousAssetsDir = path.join(previousRoot, 'assets');
  await mkdir(previousAssetsDir, { recursive: true });
  run('gh', ['release', 'download', previousTag, '--dir', previousAssetsDir, '--clobber'], { timeout: timeoutMs });
  return loadReleaseContext({
    assetsDir: previousAssetsDir,
    releaseTag: previousTag,
    expectedVersion: previousVersion
  });
}

async function resolveAutomaticPreviousReleaseTag(currentVersion) {
  let releases = [];
  try {
    releases = JSON.parse(run('gh', [
      'release',
      'list',
      '--exclude-drafts',
      '--exclude-pre-releases',
      '--limit',
      '50',
      '--json',
      'tagName'
    ], { timeout: timeoutMs }).stdout);
  } catch (error) {
    if (process.env.CI) {
      throw new Error(`could not resolve previous release automatically: ${error.message}`);
    }
    console.log(`Could not resolve previous release automatically: ${error.message}`);
    return null;
  }

  const candidates = releases
    .map((release) => release.tagName)
    .filter(Boolean)
    .map((tagName) => ({ tagName, version: tagName.replace(/^v/, '') }))
    .filter((release) => isSemver(release.version))
    .filter((release) => compareVersions(release.version, currentVersion) < 0)
    .filter((release) => compareVersions(release.version, updaterInstallSmokeMinVersion) >= 0)
    .sort((a, b) => compareVersions(b.version, a.version));

  return candidates[0]?.tagName || null;
}

async function findWindowsExecutable() {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  for (const root of roots) {
    const found = await findNestedFile(root, /^(ASCII VJ Remix|ascii-vj-remix|asciline-remix)\.exe$/i, 6)
      || await findNestedFile(root, /ascii.*vj.*remix.*\.exe$/i, 6)
      || await findNestedFile(root, /asciline.*remix.*\.exe$/i, 6);
    if (found) return found;
  }
  throw new Error('could not locate installed ASCII VJ Remix executable');
}

async function requireNestedFile(root, pattern, label) {
  const found = await findNestedFile(root, pattern, 8);
  if (!found) throw new Error(`missing ${label} under ${root}`);
  return found;
}

async function findNestedFile(root, pattern, maxDepth) {
  async function walk(current, depth) {
    if (depth < 0) return null;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isFile() && pattern.test(entry.name)) return filePath;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = await walk(path.join(current, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  }
  return walk(root, maxDepth);
}

async function findOne(root, pattern, label) {
  const files = await walkFiles(root);
  const found = files.find((file) => pattern.test(path.basename(file)));
  if (!found) throw new Error(`missing ${label} under ${root}`);
  return found;
}

async function walkFiles(root) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile()) out.push(filePath);
    }
  }
  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`failed to read ${filePath}: ${error.message}`);
  }
}

function assertUpdaterEntry(context, platform, urlPattern) {
  const entry = context.latestJson.platforms?.[platform];
  if (!entry) throw new Error(`latest.json is missing ${platform}`);
  if (!entry.signature) throw new Error(`latest.json ${platform} entry is missing signature`);
  if (!urlPattern.test(decodeURIComponent(entry.url || ''))) {
    throw new Error(`latest.json ${platform} URL does not match expected updater artifact: ${entry.url}`);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    env: options.env || process.env
  });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with ${result.status}\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function isSemver(value) {
  return /^v?\d+\.\d+\.\d+$/.test(value);
}

function parseSemver(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`not a semver release: ${value}`);
  return match.slice(1).map((part) => Number(part));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fail(message) {
  console.error(`release install smoke failed: ${message}`);
  process.exit(1);
}
