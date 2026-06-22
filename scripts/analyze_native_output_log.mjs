#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const defaultLog = path.join(tmpdir(), 'asciline-native-output.log');
const logPath = process.argv[2] || defaultLog;

function usage() {
  return [
    'Usage: node scripts/analyze_native_output_log.mjs [path/to/asciline-native-output.log]',
    '',
    'Analyzes NativeOutputDisplayLinkStats lines and fails when native Pop Out presentation,',
    'source frame feed, or reactive parameter sync drops below the expected live-output budget.'
  ].join('\n');
}

function parseLine(line) {
  if (!line.includes('[NativeOutputDisplayLinkStats]')) return null;
  const fields = {};
  for (const match of line.matchAll(/([A-Za-z]+)=([^\s]+)/g)) {
    const [, key, raw] = match;
    const value = Number.parseFloat(raw);
    fields[key] = Number.isFinite(value) ? value : raw;
  }
  return fields.elapsedMs === undefined ? null : fields;
}

function rate(next, previous, key) {
  const dtSeconds = (next.elapsedMs - previous.elapsedMs) / 1000;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return 0;
  return (Number(next[key] || 0) - Number(previous[key] || 0)) / dtSeconds;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

if (!existsSync(logPath)) {
  console.error(`native-output-log: missing log file: ${logPath}`);
  process.exit(1);
}

const samples = readFileSync(logPath, 'utf8')
  .split(/\r?\n/)
  .map(parseLine)
  .filter(Boolean);

if (samples.length < 2) {
  console.error(`native-output-log: need at least 2 display-link samples, found ${samples.length}`);
  process.exit(1);
}

const windows = [];
for (let index = 1; index < samples.length; index += 1) {
  const previous = samples[index - 1];
  const next = samples[index];
  const dtSeconds = (next.elapsedMs - previous.elapsedMs) / 1000;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) continue;
  windows.push({
    start: previous.elapsedMs / 1000,
    end: next.elapsedMs / 1000,
    dtSeconds,
    presentedFps: rate(next, previous, 'presented'),
    sourceFps: rate(next, previous, 'frameVersion'),
    paramFps: rate(next, previous, 'paramVersion'),
    modulatedFps: rate(next, previous, 'modulated'),
    fpsSkips: rate(next, previous, 'fpsSkips'),
    pendingSkips: Number(next.pendingSkips || 0) - Number(previous.pendingSkips || 0),
    gpuFailures: Number(next.gpuFailures || 0) - Number(previous.gpuFailures || 0),
    renderAvgMs: Number(next.renderMs || 0),
    presentFpsTarget: Number(next.presentFps || 0),
    surface: next.surface
  });
}

if (!windows.length) {
  console.error('native-output-log: no usable elapsed windows found');
  process.exit(1);
}

const recent = windows.slice(-5);
const summary = {
  samples: samples.length,
  windows: windows.length,
  presentedFpsAvg: average(recent.map((window) => window.presentedFps)),
  sourceFpsAvg: average(recent.map((window) => window.sourceFps)),
  paramFpsAvg: average(recent.map((window) => window.paramFps)),
  modulatedFpsAvg: average(recent.map((window) => window.modulatedFps)),
  reactiveFpsAvg: average(
    recent
      .map((window) => Math.max(window.paramFps, window.modulatedFps))
      .filter((value) => value >= 10)
  ),
  pendingSkipsTotal: recent.reduce((sum, window) => sum + window.pendingSkips, 0),
  gpuFailuresTotal: recent.reduce((sum, window) => sum + window.gpuFailures, 0),
  surface: samples.at(-1)?.surface || 'unknown'
};

console.log('Native Pop Out performance windows:');
for (const window of recent) {
  console.log([
    `${window.start.toFixed(1)}-${window.end.toFixed(1)}s`,
    `presented=${window.presentedFps.toFixed(1)}fps`,
    `source=${window.sourceFps.toFixed(1)}fps`,
    `params=${window.paramFps.toFixed(1)}fps`,
    `modulated=${window.modulatedFps.toFixed(1)}fps`,
    `target=${window.presentFpsTarget.toFixed(1)}fps`,
    `pendingSkips=${window.pendingSkips}`,
    `gpuFailures=${window.gpuFailures}`,
    `surface=${window.surface}`
  ].join(' '));
}

console.log([
  'Summary:',
  `presentedAvg=${summary.presentedFpsAvg.toFixed(1)}fps`,
  `sourceAvg=${summary.sourceFpsAvg.toFixed(1)}fps`,
  `paramsAvg=${summary.paramFpsAvg.toFixed(1)}fps`,
  `modulatedAvg=${summary.modulatedFpsAvg.toFixed(1)}fps`,
  `reactiveAvg=${summary.reactiveFpsAvg.toFixed(1)}fps`,
  `surface=${summary.surface}`
].join(' '));

const issues = [];
if (summary.surface !== 'success') {
  issues.push(`surface status is ${summary.surface}`);
}
if (summary.gpuFailuresTotal > 0) {
  issues.push(`GPU failures observed in recent windows: ${summary.gpuFailuresTotal}`);
}
if (summary.pendingSkipsTotal > 2) {
  issues.push(`main-thread presentation backlog observed: ${summary.pendingSkipsTotal} pending skips`);
}
if (summary.presentedFpsAvg < 55) {
  issues.push(`presented FPS below budget: ${summary.presentedFpsAvg.toFixed(1)} < 55`);
}
if (summary.sourceFpsAvg > 0 && summary.sourceFpsAvg < 20) {
  issues.push(`source frame feed below 24fps media budget: ${summary.sourceFpsAvg.toFixed(1)} < 20`);
}
if (summary.reactiveFpsAvg > 0 && summary.reactiveFpsAvg < 45) {
  issues.push(`live reactive updates below budget: ${summary.reactiveFpsAvg.toFixed(1)} < 45`);
}

if (issues.length) {
  console.error(`Native Pop Out performance check failed:\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
