import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function commandWorks(command, args = ['--version'], env = process.env) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32'
  });
  return result.status === 0;
}

function rustupToolchainBin() {
  const result = spawnSync('rustup', ['which', 'cargo'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) return null;

  const cargoPath = result.stdout.trim();
  return cargoPath ? path.dirname(cargoPath) : null;
}

const env = { ...process.env };

if (!commandWorks('cargo', ['--version'], env)) {
  const toolchainBin = rustupToolchainBin();
  if (toolchainBin) {
    env.PATH = `${toolchainBin}${path.delimiter}${env.PATH || ''}`;
  }
}

if (process.platform === 'darwin') {
  const systemSwiftRuntime = '/usr/lib/swift';
  const swiftRuntimePaths = existsSync(systemSwiftRuntime)
    ? [systemSwiftRuntime]
    : [
        '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx',
        '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx',
        '/Library/Developer/CommandLineTools/usr/lib/swift/macosx',
        '/Library/Developer/CommandLineTools/usr/lib/swift-5.5/macosx'
      ].filter(existsSync);
  if (swiftRuntimePaths.length) {
    const existing = env.DYLD_FALLBACK_LIBRARY_PATH || '';
    env.DYLD_FALLBACK_LIBRARY_PATH = [
      ...swiftRuntimePaths,
      ...existing.split(path.delimiter).filter(Boolean)
    ].join(path.delimiter);
  }
}

const child = spawn('cargo', process.argv.slice(2), {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
