import test from 'node:test';
import assert from 'node:assert/strict';
import { crashFingerprint, crashGroupingSummary } from '../src/fingerprint.js';
import { sanitizeCrashPayload } from '../src/sanitize.js';

const env = { CRASH_ALLOWED_APP_IDENTIFIER: 'com.asciline.remix' };

test('sanitizes paths, URLs, emails, and secret-looking context keys', () => {
  const report = sanitizeCrashPayload({
    app: { identifier: 'com.asciline.remix', version: '0.9.2' },
    report: {
      kind: 'frontend-error',
      surface: 'frontend',
      message: 'failed /Users/alice/private.mov alice@example.com',
      stack: 'Error: x\n    at file:///Users/alice/app.js:1:2',
      context: {
        backend: 'webgpu',
        token: 'secret',
        mediaUrl: 'asset://localhost/private.mov'
      }
    }
  }, env);

  assert.equal(report.app.identifier, 'com.asciline.remix');
  assert.match(report.report.message, /\[redacted-path\]/);
  assert.match(report.report.message, /\[redacted-email\]/);
  assert.match(report.report.stack, /\[redacted-url\]/);
  assert.equal(report.report.context.token, '[redacted]');
  assert.match(report.report.context.mediaUrl, /\[redacted-url\]/);
});

test('rejects reports from unexpected app identifiers', () => {
  assert.throws(() => sanitizeCrashPayload({
    app: { identifier: 'other.app' },
    report: { message: 'boom' }
  }, env), /identifier/);
});

test('fingerprint is stable across local paths and patch versions', async () => {
  const left = sanitizeCrashPayload({
    app: { identifier: 'com.asciline.remix', version: '0.9.2' },
    report: {
      kind: 'frontend-error',
      surface: 'renderer',
      message: 'Renderer failed at frame 123',
      stack: 'Error\n at file:///Users/alice/app.js:10:20'
    }
  }, env);
  const right = sanitizeCrashPayload({
    app: { identifier: 'com.asciline.remix', version: '0.9.3' },
    report: {
      kind: 'frontend-error',
      surface: 'renderer',
      message: 'Renderer failed at frame 456',
      stack: 'Error\n at file:///Users/bob/app.js:90:40'
    }
  }, env);

  assert.equal(await crashFingerprint(left), await crashFingerprint(right));
});

test('fingerprint groups same platform and error code across message and stack variants', async () => {
  const left = sanitizeCrashPayload({
    app: { identifier: 'com.asciline.remix', version: '0.9.2', os: 'macos', arch: 'aarch64' },
    report: {
      kind: 'renderer-error',
      surface: 'renderer',
      message: 'WebGPU adapter failed after 12 frames',
      stack: 'AdapterError\n at file:///Users/alice/webgpu.js:10:20',
      context: {
        errorCode: 'GPU_DEVICE_LOST',
        backend: 'webgpu',
        sourceMode: 'static'
      }
    }
  }, env);
  const right = sanitizeCrashPayload({
    app: { identifier: 'com.asciline.remix', version: '0.9.3', os: 'macos', arch: 'aarch64' },
    report: {
      kind: 'renderer-error',
      surface: 'renderer',
      message: 'Device lost while rendering different media',
      stack: 'DeviceLost\n at file:///Users/bob/renderer.js:90:40',
      context: {
        errorCode: 'gpu_device_lost',
        backend: 'webgpu',
        sourceMode: 'static'
      }
    }
  }, env);

  assert.equal(crashGroupingSummary(left).basis, 'error-code');
  assert.equal(await crashFingerprint(left), await crashFingerprint(right));
});

test('fingerprint separates different error codes on the same platform', async () => {
  const base = {
    app: { identifier: 'com.asciline.remix', version: '0.9.2', os: 'macos', arch: 'aarch64' },
    report: {
      kind: 'renderer-error',
      surface: 'renderer',
      message: 'Renderer failed',
      stack: 'Error\n at file:///Users/alice/renderer.js:10:20',
      context: {
        backend: 'webgpu',
        sourceMode: 'static'
      }
    }
  };
  const deviceLost = sanitizeCrashPayload({
    ...base,
    report: {
      ...base.report,
      context: { ...base.report.context, errorCode: 'GPU_DEVICE_LOST' }
    }
  }, env);
  const validation = sanitizeCrashPayload({
    ...base,
    report: {
      ...base.report,
      context: { ...base.report.context, errorCode: 'GPU_VALIDATION_ERROR' }
    }
  }, env);

  assert.notEqual(await crashFingerprint(deviceLost), await crashFingerprint(validation));
});
