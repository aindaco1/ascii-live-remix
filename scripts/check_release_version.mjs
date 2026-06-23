#!/usr/bin/env node
import fs from 'node:fs';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === '--github-output') {
      out.githubOutput = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Usage: node scripts/check_release_version.mjs [options]

Validates that release version metadata is synchronized.

Options:
  --github-output    Write version and tag outputs to GITHUB_OUTPUT
  --help             Show this help
`);
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function readCargoPackageVersion(path) {
  const cargoToml = fs.readFileSync(path, 'utf8');
  const packageSection = cargoToml.split(/\n\[/, 1)[0];
  return packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

function appendGithubOutput(outputs) {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT is not set');
  }
  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const tauriConfig = readJson('src-tauri/tauri.conf.json');
const versions = {
  'package.json': packageJson.version,
  'package-lock.json': packageLock.packages?.['']?.version,
  'src-tauri/Cargo.toml': readCargoPackageVersion('src-tauri/Cargo.toml'),
  'src-tauri/tauri.conf.json': tauriConfig.version,
};
const missing = Object.entries(versions).filter(([, version]) => !version);
if (missing.length > 0) {
  console.error(`Missing version metadata: ${missing.map(([path]) => path).join(', ')}`);
  process.exit(1);
}

const version = packageJson.version;
const mismatched = Object.entries(versions).filter(([, other]) => other !== version);
if (mismatched.length > 0) {
  console.error(`Version metadata must match package.json (${version}).`);
  for (const [path, other] of mismatched) {
    console.error(`- ${path}: ${other}`);
  }
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Version must be SemVer-compatible, got ${version}.`);
  process.exit(1);
}

const tag = `v${version}`;
if (args.githubOutput) appendGithubOutput({ version, tag });
console.log(`Release version metadata is synchronized for ${version} (${tag}).`);
