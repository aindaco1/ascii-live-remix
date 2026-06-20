#!/usr/bin/env node

import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const assetsDir = path.resolve(args.assetsDir || 'release-smoke');
const releaseTag = args.releaseTag || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
const version = String(args.version || releaseTag.replace(/^v/, '')).trim();
const timeoutMs = Number(args.timeoutMs || 180000);
const mode = args.mode || 'install-and-updater';

if (!version) {
  fail('missing release version; pass --version or --release-tag');
}

const latestJson = await readJson(path.join(assetsDir, 'latest.json'));
if (latestJson.version !== version) {
  fail(`latest.json version ${latestJson.version} does not match expected ${version}`);
}

if (process.platform === 'win32') {
  await smokeWindows();
} else if (process.platform === 'linux') {
  await smokeLinux();
} else {
  fail(`release install smoke only supports Windows and Linux, got ${process.platform}`);
}

async function smokeWindows() {
  const msi = await findOne(assetsDir, /_x64_en-US\.msi$/i, 'Windows MSI installer');
  assertUpdaterEntry('windows-x86_64-msi', /\.msi$/i);
  assertUpdaterEntry('windows-x86_64', /\.msi$/i);

  if (mode !== 'updater-only') {
    run('msiexec.exe', ['/i', msi, '/qn', '/norestart'], { timeout: timeoutMs });
  }

  const exe = await findWindowsExecutable();
  const appRoot = path.dirname(exe);
  await requireNestedFile(appRoot, /ffmpeg\.exe$/i, 'bundled Windows ffmpeg.exe');
  await requireNestedFile(appRoot, /ffprobe\.exe$/i, 'bundled Windows ffprobe.exe');

  if (mode !== 'install-only') {
    await runInstalledSmoke(exe, []);
    await runUpdaterSmoke(exe, []);
  }

  console.log(`Windows release install smoke passed for ${version}: ${exe}`);
}

async function smokeLinux() {
  const deb = await findOne(assetsDir, /\.deb$/i, 'Linux deb installer');
  await findOne(assetsDir, /\.AppImage$/i, 'Linux AppImage updater package');
  assertUpdaterEntry('linux-x86_64-deb', /\.deb$/i);
  assertUpdaterEntry('linux-x86_64', /\.AppImage$/i);

  const packageName = run('dpkg-deb', ['-f', deb, 'Package']).stdout.trim();

  if (mode !== 'updater-only') {
    run('sudo', ['apt-get', 'update'], { timeout: timeoutMs });
    run('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', deb], { timeout: timeoutMs });
  }

  const packageStatus = run('dpkg-query', ['-W', '-f=${Package} ${Version}', packageName]).stdout.trim();
  if (!packageStatus.includes(version)) {
    fail(`installed package version mismatch: ${packageStatus}`);
  }

  const installedFiles = run('dpkg', ['-L', packageName]).stdout.split(/\r?\n/).filter(Boolean);
  const exe = installedFiles.find((file) => /\/bin\/asciline-remix$/i.test(file))
    || installedFiles.find((file) => /asciline-remix$/i.test(file));
  if (!exe) fail(`could not locate installed executable for ${packageName}`);
  if (!installedFiles.some((file) => /ffmpeg$/i.test(file))) fail('bundled Linux ffmpeg is missing from installed package');
  if (!installedFiles.some((file) => /ffprobe$/i.test(file))) fail('bundled Linux ffprobe is missing from installed package');

  if (mode !== 'install-only') {
    await runInstalledSmoke(exe, linuxAppPrefix());
    await runUpdaterSmoke(exe, linuxAppPrefix());
  }

  console.log(`Linux release install smoke passed for ${version}: ${exe}`);
}

async function runInstalledSmoke(exe, prefix) {
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
    fail(`launch smoke failed: ${JSON.stringify(value)}`);
  }
  if (value.package_version !== version) {
    fail(`launch smoke package version ${value.package_version} does not match ${version}`);
  }
}

async function runUpdaterSmoke(exe, prefix) {
  const report = path.join(await mkdtemp(path.join(os.tmpdir(), 'asciline-updater-smoke-')), 'report.json');
  const env = {
    ...process.env,
    ASCILINE_UPDATER_SMOKE: 'download',
    ASCILINE_UPDATER_EXPECT_VERSION: version,
    ASCILINE_UPDATER_SMOKE_FORCE_UPDATE: '1',
    ASCILINE_UPDATER_SMOKE_FORCE_FROM_VERSION: '0.0.0',
    ASCILINE_UPDATER_SMOKE_REPORT: report,
    ASCILINE_SMOKE_REPORT: report
  };
  run(prefix[0] || exe, prefix[0] ? [...prefix.slice(1), exe] : [], { env, timeout: timeoutMs });
  const value = await readJson(report);
  if (!value.ok || value.kind !== 'updater' || !value.found_update) {
    fail(`updater smoke failed: ${JSON.stringify(value)}`);
  }
  if (value.update_version !== version) {
    fail(`updater reported ${value.update_version}, expected ${version}`);
  }
  if (!Number.isFinite(value.downloaded_bytes) || value.downloaded_bytes <= 0) {
    fail(`updater did not download a signed package: ${JSON.stringify(value)}`);
  }
}

function linuxAppPrefix() {
  if (process.env.ASCILINE_NO_XVFB === '1') return [];
  return ['xvfb-run', '-a'];
}

async function findWindowsExecutable() {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  for (const root of roots) {
    const found = await findNestedFile(root, /^(ASCILINE Remix|asciline-remix)\.exe$/i, 6)
      || await findNestedFile(root, /asciline.*remix.*\.exe$/i, 6);
    if (found) return found;
  }
  fail('could not locate installed ASCILINE Remix executable');
}

async function requireNestedFile(root, pattern, label) {
  const found = await findNestedFile(root, pattern, 8);
  if (!found) fail(`missing ${label} under ${root}`);
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
  if (!found) fail(`missing ${label} under ${root}`);
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
    fail(`failed to read ${filePath}: ${error.message}`);
  }
}

function assertUpdaterEntry(platform, urlPattern) {
  const entry = latestJson.platforms?.[platform];
  if (!entry) fail(`latest.json is missing ${platform}`);
  if (!entry.signature) fail(`latest.json ${platform} entry is missing signature`);
  if (!urlPattern.test(decodeURIComponent(entry.url || ''))) {
    fail(`latest.json ${platform} URL does not match expected updater artifact: ${entry.url}`);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    env: options.env || process.env
  });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} failed with ${result.status}\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`missing value for ${arg}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

function fail(message) {
  console.error(`release install smoke failed: ${message}`);
  process.exit(1);
}
