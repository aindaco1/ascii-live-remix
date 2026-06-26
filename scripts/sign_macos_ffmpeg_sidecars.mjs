import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(process.env.ASCILINE_RELEASE_ROOT || process.cwd());
const ffmpegRoot = path.resolve(
  process.env.ASCILINE_FFMPEG_ROOT || path.join(root, 'src-tauri', 'resources', 'ffmpeg')
);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    out[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    i += 1;
  }
  return out;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...options
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}: ${output}`);
  }
  return output;
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function macosPlatformDirs() {
  const entries = await readdir(ffmpegRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('macos-'))
    .map((entry) => path.join(ffmpegRoot, entry.name))
    .sort();
}

async function updateManifest(platformDir, signedFiles) {
  const manifestPath = path.join(platformDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const byName = new Map(manifest.files.map((file) => [file.name, file]));

  for (const binaryPath of signedFiles) {
    const metadata = await stat(binaryPath);
    const name = path.basename(binaryPath);
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(`${manifestPath} does not include ${name}`);
    }
    entry.bytes = metadata.size;
    entry.sha256 = await sha256(binaryPath);
    entry.macosSignature = {
      developerId: true,
      hardenedRuntime: true,
      secureTimestamp: true
    };
  }

  manifest.signedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function verifySignature(binaryPath) {
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', binaryPath]);
  const details = run('/usr/bin/codesign', ['-dvvv', binaryPath]);

  if (!details.includes('Authority=Developer ID Application')) {
    throw new Error(`${binaryPath} is not signed by a Developer ID Application certificate`);
  }
  if (!/Timestamp=/.test(details)) {
    throw new Error(`${binaryPath} does not report a secure timestamp`);
  }
  if (!/(Runtime Version=|flags=.*runtime)/.test(details)) {
    throw new Error(`${binaryPath} does not report hardened runtime`);
  }
}

async function signBinary(binaryPath, identity) {
  await chmod(binaryPath, 0o755);
  run('/usr/bin/codesign', [
    '--force',
    '--timestamp',
    '--options',
    'runtime',
    '--sign',
    identity,
    binaryPath
  ]);
  verifySignature(binaryPath);
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS FFmpeg sidecar signing can only run on macOS');
  }

  const args = parseArgs(process.argv.slice(2));
  const identity = args.identity || process.env.APPLE_SIGNING_IDENTITY;
  if (!identity) {
    throw new Error('APPLE_SIGNING_IDENTITY is required to sign macOS FFmpeg sidecars');
  }

  let signedCount = 0;
  for (const platformDir of await macosPlatformDirs()) {
    const binDir = path.join(platformDir, 'bin');
    const binaries = [path.join(binDir, 'ffmpeg'), path.join(binDir, 'ffprobe')];
    const present = [];

    for (const binaryPath of binaries) {
      if (!(await fileExists(binaryPath))) {
        throw new Error(`missing macOS FFmpeg sidecar: ${path.relative(root, binaryPath)}`);
      }
      await signBinary(binaryPath, identity);
      present.push(binaryPath);
      signedCount += 1;
      console.log(`Signed macOS FFmpeg sidecar: ${path.relative(root, binaryPath)}`);
    }

    await updateManifest(platformDir, present);
  }

  if (signedCount === 0) {
    throw new Error(`no macOS FFmpeg sidecars found under ${path.relative(root, ffmpegRoot)}`);
  }

  console.log(`Signed ${signedCount} macOS FFmpeg sidecar(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
