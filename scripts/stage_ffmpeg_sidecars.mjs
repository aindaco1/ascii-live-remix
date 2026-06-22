import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ffmpegRoot = path.join(root, 'src-tauri', 'resources', 'ffmpeg');

function hostPlatformId() {
  const os = {
    darwin: 'macos',
    win32: 'windows',
    linux: 'linux'
  }[process.platform] || process.platform;
  const arch = {
    x64: 'x86_64',
    arm64: 'aarch64'
  }[process.arch] || process.arch;
  return `${os}-${arch}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === 'skip-version-run' || key === 'help') {
      out[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    out[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    i += 1;
  }
  return out;
}

function usage() {
  return [
    'Usage:',
    '  npm run ffmpeg:stage -- --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe --license LGPL-2.1-or-later --source "reviewed build notes"',
    '',
    'Options:',
    '  --platform <id>           Defaults to host id such as macos-aarch64 or windows-x86_64.',
    '  --variant <text>          Optional build variant, for example lgpl-static.',
    '  --skip-version-run        Use with --ffmpeg-version and --ffprobe-version for cross-platform binaries.',
    '  --ffmpeg-version <text>   Required when --skip-version-run is used.',
    '  --ffprobe-version <text>  Required when --skip-version-run is used.'
  ].join('\n');
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find(Boolean) || '';
}

function binaryName(tool, platformId) {
  return platformId.startsWith('windows-') ? `${tool}.exe` : tool;
}

async function fileInfo(sourcePath, destinationPath, version) {
  const bytes = await readFile(destinationPath);
  const metadata = await stat(destinationPath);
  return {
    name: path.basename(destinationPath),
    source: sourcePath,
    path: path.relative(ffmpegRoot, destinationPath).split(path.sep).join('/'),
    bytes: metadata.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    version
  };
}

function readVersion(tool, binaryPath, providedVersion, skipVersionRun) {
  if (skipVersionRun) {
    if (!providedVersion) {
      throw new Error(`--${tool}-version is required with --skip-version-run`);
    }
    return providedVersion;
  }

  const result = spawnSync(binaryPath, ['-version'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024
  });
  if (result.error) {
    throw new Error(`failed to run ${binaryPath} -version: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${binaryPath} -version exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }
  return firstLine(result.stdout);
}

async function stageBinary(tool, sourcePath, platformId, destinationDir) {
  const resolvedSource = path.resolve(sourcePath);
  const metadata = await stat(resolvedSource);
  if (!metadata.isFile()) {
    throw new Error(`${tool} path is not a file: ${resolvedSource}`);
  }

  const destination = path.join(destinationDir, binaryName(tool, platformId));
  await copyFile(resolvedSource, destination);
  if (!platformId.startsWith('windows-')) {
    await chmod(destination, 0o755);
  }
  return { resolvedSource, destination };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const ffmpeg = args.ffmpeg || process.env.ASCILINE_FFMPEG;
  const ffprobe = args.ffprobe || process.env.ASCILINE_FFPROBE;
  const license = args.license || process.env.ASCILINE_FFMPEG_LICENSE;
  const source = args.source || process.env.ASCILINE_FFMPEG_SOURCE;
  const platformId = args.platform || process.env.ASCILINE_FFMPEG_PLATFORM || hostPlatformId();
  const variant = args.variant || process.env.ASCILINE_FFMPEG_VARIANT || '';

  if (!ffmpeg || !ffprobe || !license || !source) {
    throw new Error(`${usage()}\n\nMissing required --ffmpeg, --ffprobe, --license, or --source.`);
  }

  const platformDir = path.join(ffmpegRoot, platformId);
  const binDir = path.join(platformDir, 'bin');
  await mkdir(binDir, { recursive: true });

  const stagedFfmpeg = await stageBinary('ffmpeg', ffmpeg, platformId, binDir);
  const stagedFfprobe = await stageBinary('ffprobe', ffprobe, platformId, binDir);
  const ffmpegVersion = readVersion('ffmpeg', stagedFfmpeg.destination, args.ffmpegVersion, args.skipVersionRun);
  const ffprobeVersion = readVersion('ffprobe', stagedFfprobe.destination, args.ffprobeVersion, args.skipVersionRun);

  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: platformId,
    variant,
    license,
    source,
    files: [
      await fileInfo(stagedFfmpeg.resolvedSource, stagedFfmpeg.destination, ffmpegVersion),
      await fileInfo(stagedFfprobe.resolvedSource, stagedFfprobe.destination, ffprobeVersion)
    ]
  };

  await writeFile(
    path.join(platformDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await writeFile(
    path.join(platformDir, 'NOTICE.md'),
    [
      `# FFmpeg Notice (${platformId})`,
      '',
      `License: ${license}`,
      `Source/build review: ${source}`,
      variant ? `Variant: ${variant}` : null,
      '',
      'This package contains FFmpeg and ffprobe binaries staged for ASCII VJ Remix.',
      'Keep the corresponding license text and source/build provenance with release materials.',
      ''
    ].filter(Boolean).join('\n')
  );

  console.log(JSON.stringify({
    platform: platformId,
    manifest: path.relative(root, path.join(platformDir, 'manifest.json')),
    files: manifest.files.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
