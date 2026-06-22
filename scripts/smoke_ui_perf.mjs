#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeLogPath = path.join(tmpdir(), 'asciline-native-output.log');
const mediaLogPath = '/tmp/asciline-media-diagnostics.log';
const releaseApp = '/private/tmp/asciline-remix-tauri-target/release/bundle/macos/ASCII VJ Remix.app';
const durationMs = Number(process.env.ASCILINE_UI_PERF_SMOKE_DURATION_MS || '9000');
const sampleMs = Number(process.env.ASCILINE_UI_PERF_SMOKE_SAMPLE_MS || '500');

if (!existsSync(releaseApp)) {
  console.error(`ui-perf-smoke: missing optimized app: ${releaseApp}`);
  console.error('Build one first: npm run tauri -- build --bundles app');
  process.exit(1);
}

rmSync(nativeLogPath, { force: true });
rmSync(mediaLogPath, { force: true });

const env = {
  ...process.env,
  ASCILINE_SOURCE_APP: releaseApp,
  ASCILINE_SYNC_SYSTEM_APP: process.env.ASCILINE_SYNC_SYSTEM_APP || '0',
  ASCILINE_FOREGROUND: process.env.ASCILINE_UI_PERF_SMOKE_FOREGROUND || '0',
  ASCILINE_UI_PERF_SMOKE: '1',
  ASCILINE_UI_PERF_SMOKE_DURATION_MS: String(durationMs || 9000),
  ASCILINE_UI_PERF_SMOKE_SAMPLE_MS: String(sampleMs || 500),
  ASCILINE_UI_PERF_SMOKE_BACKEND: process.env.ASCILINE_UI_PERF_SMOKE_BACKEND || 'auto',
  ASCILINE_UI_PERF_SMOKE_MEDIA:
    process.env.ASCILINE_UI_PERF_SMOKE_MEDIA || 'media/point-click-test-30s.mp4'
};

const launch = spawnSync('bash', ['scripts/run_local_desktop_app.sh'], {
  cwd: root,
  stdio: 'inherit',
  env
});

if (launch.status !== 0) {
  process.exit(launch.status || 1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let reportLine = null;
const deadline = Date.now() + Math.max(15000, durationMs + 10000);
while (Date.now() < deadline) {
  if (existsSync(mediaLogPath)) {
    reportLine = readFileSync(mediaLogPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('[ASCILINE_UI_PERF_REPORT]'))
      .at(-1);
    if (reportLine) break;
  }
  await wait(250);
}

if (!reportLine) {
  console.error('ui-perf-smoke: no ASCILINE_UI_PERF_REPORT found');
  process.exit(1);
}

const jsonStart = reportLine.indexOf('{');
const report = JSON.parse(reportLine.slice(jsonStart));

console.log([
  'UI perf smoke:',
  `ok=${report.ok}`,
  `mainAvg=${Number(report.mainAvgFps || 0).toFixed(1)}fps`,
  `mainMin=${Number(report.mainMinFps || 0).toFixed(1)}fps`,
  `nativeOk=${Number(report.nativeOkHz || 0).toFixed(1)}hz`,
  `nativeFailed=${report.nativeFailed || 0}`,
  `displays=${report.outputDisplayCount || 0}`,
  `backend=${report.backend || 'unknown'}`,
  `media=${report.mediaUrl || 'unknown'}`
].join(' '));

if (report.phases) {
  for (const [phase, stats] of Object.entries(report.phases)) {
    console.log([
      `  ${phase}:`,
      `mainAvg=${Number(stats.mainAvgFps || 0).toFixed(1)}fps`,
      `mainMin=${Number(stats.mainMinFps || 0).toFixed(1)}fps`,
      `nativeOk=${Number(stats.nativeOkHz || 0).toFixed(1)}hz`
    ].join(' '));
  }
}

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const analyzer = spawnSync(process.execPath, ['scripts/analyze_native_output_log.mjs', nativeLogPath], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

if (analyzer.status !== 0) {
  process.exit(analyzer.status || 1);
}
