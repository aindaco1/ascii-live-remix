#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = mkdtempSync(path.join(tmpdir(), 'asciline-native-output-smoke-'));
const reportPath = path.join(tempDir, 'report.json');
const logPath = path.join(tmpdir(), 'asciline-native-output.log');
const defaultReleaseApp =
  '/private/tmp/asciline-remix-tauri-target/release/bundle/macos/ASCII VJ Remix.app';
const sourceApp = process.env.ASCILINE_SOURCE_APP || defaultReleaseApp;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!existsSync(sourceApp)) {
  console.error(`native-output-smoke: missing optimized app: ${sourceApp}`);
  console.error('Build one first, for example: npm run tauri -- build --bundles app');
  process.exit(1);
}

rmSync(logPath, { force: true });

const launchEnv = {
  ...process.env,
  ASCILINE_SOURCE_APP: sourceApp,
  ASCILINE_FOREGROUND: '1',
  ASCILINE_SYNC_SYSTEM_APP: process.env.ASCILINE_SYNC_SYSTEM_APP || '0',
  ASCILINE_NATIVE_OUTPUT_SMOKE: '1',
  ASCILINE_NATIVE_OUTPUT_SMOKE_MEDIA:
    process.env.ASCILINE_NATIVE_OUTPUT_SMOKE_MEDIA || 'media/point-click-test-30s.mp4',
  ASCILINE_NATIVE_OUTPUT_SMOKE_DURATION_MS:
    process.env.ASCILINE_NATIVE_OUTPUT_SMOKE_DURATION_MS || '7000',
  ASCILINE_DESKTOP_SMOKE_REPORT: reportPath
};

const launch = spawnSync('bash', ['scripts/run_local_desktop_app.sh'], {
  cwd: root,
  stdio: 'inherit',
  env: launchEnv
});

if (launch.status !== 0) {
  process.exit(launch.status || 1);
}

if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  console.log(
    `Native output smoke: ok=${report.ok} backend=${report.backend || 'unknown'} media=${report.media_url || 'unknown'} elapsed=${report.elapsed_ms}ms`
  );
}

run(process.execPath, ['scripts/analyze_native_output_log.mjs', logPath]);
