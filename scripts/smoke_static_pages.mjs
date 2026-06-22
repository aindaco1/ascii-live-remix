import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const host = process.env.SMOKE_HOST || '127.0.0.1';
const port = Number(process.env.SMOKE_PORT || 4173);
const baseUrl = `http://${host}:${port}`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function findChromiumExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE && existsSync(process.env.CHROMIUM_EXECUTABLE)) {
    return process.env.CHROMIUM_EXECUTABLE;
  }

  const cacheDir = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cacheDir)) {
    const candidates = readdirSync(cacheDir)
      .filter((entry) => entry.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse()
      .map((entry) => path.join(cacheDir, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function waitForServer(url, timeoutMs = 12000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
      } else {
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

async function runSmoke() {
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    throw new Error('No Chromium executable found. Set CHROMIUM_EXECUTABLE to a local Chromium or Chrome path.');
  }

  const preview = spawn(process.execPath, [viteBin, 'preview', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let previewOutput = '';
  preview.stdout.on('data', (chunk) => { previewOutput += chunk.toString(); });
  preview.stderr.on('data', (chunk) => { previewOutput += chunk.toString(); });

  try {
    await waitForServer(`${baseUrl}/`);

    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    });
    const errors = [];

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`main:${msg.text()}`); });
    await page.addInitScript(() => {
      const original = navigator.mediaDevices || {};
      const audioDevices = [
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Smoke Mic A', groupId: 'smoke' },
        { kind: 'audioinput', deviceId: 'mic-a', label: 'Smoke Mic A', groupId: 'smoke' },
        { kind: 'audioinput', deviceId: 'mic-b', label: 'Smoke Mic B', groupId: 'smoke' },
        { kind: 'videoinput', deviceId: 'cam-a', label: 'Smoke Camera', groupId: 'smoke' }
      ];
      window.__smokeAudioCapture = { mic: 0, display: 0, constraints: [] };
      window.__smokeAudioSources = [];
      const decorateTrack = (track, label, deviceId) => {
        if (!track) return;
        try {
          Object.defineProperty(track, 'label', { configurable: true, value: label });
        } catch {}
        const originalGetSettings = track.getSettings?.bind(track);
        track.getSettings = () => ({ ...(originalGetSettings?.() || {}), deviceId });
      };
      const makeAudioStream = (label = 'Smoke audio', deviceId = 'mic-a') => {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return new MediaStream();
        const context = new AudioContextCtor();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.frequency.value = 220;
        oscillator.connect(destination);
        oscillator.start();
        decorateTrack(destination.stream.getAudioTracks?.()[0], label, deviceId);
        window.__smokeAudioSources.push({ context, oscillator });
        return destination.stream;
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          ...original,
          enumerateDevices: async () => audioDevices,
          getUserMedia: async (constraints = {}) => {
            window.__smokeAudioCapture.mic += 1;
            window.__smokeAudioCapture.constraints.push(constraints);
            const requested = constraints?.audio?.deviceId?.exact || 'mic-a';
            const device = audioDevices.find((candidate) => candidate.deviceId === requested) || audioDevices[1];
            return makeAudioStream(device.label, device.deviceId);
          },
          getDisplayMedia: async () => {
            window.__smokeAudioCapture.display += 1;
            return makeAudioStream('Smoke Display Audio', 'display-audio');
          }
        }
      });
    });
    const response = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ascilineRemix && document.querySelectorAll('#source-list [role=option]').length >= 3, null, { timeout: 15000 });
    await page.waitForFunction(
      () => window.__smokeAudioCapture?.mic >= 1 && window.ascilineRemix?.audioReactiveRuntime?.active,
      null,
      { timeout: 15000 }
    );
    const main = await page.evaluate(() => ({
      status: document.querySelector('#backend-status')?.textContent,
      outputDisplay: {
        value: document.querySelector('#output-display')?.value || '',
        disabled: Boolean(document.querySelector('#output-display')?.disabled),
        options: [...document.querySelectorAll('#output-display option')].map((option) => option.textContent.trim())
      },
      audioReactive: {
        source: document.querySelector('#audio-reactive-source')?.value || '',
        status: document.querySelector('#audio-reactive-status')?.textContent || '',
        input: document.querySelector('#audio-reactive-input')?.value || '',
        inputOptions: [...document.querySelectorAll('#audio-reactive-input option')].map((option) => option.textContent.trim()),
        toggle: document.querySelector('#audio-reactive-toggle')?.textContent || '',
        pressed: document.querySelector('#audio-reactive-toggle')?.getAttribute('aria-pressed') || '',
        active: Boolean(window.ascilineRemix?.audioReactiveRuntime?.active),
        calls: window.__smokeAudioCapture
      },
      sources: [...document.querySelectorAll('#source-list [role=option]')].map((el) => el.textContent.trim())
    }));
    if (main.outputDisplay.value !== 'auto' || !main.outputDisplay.options.includes('Auto')) {
      throw new Error('Main page output-display selector did not initialize to Auto');
    }
    if (
      main.audioReactive.source !== 'input' ||
      !main.audioReactive.active ||
      main.audioReactive.toggle !== 'Stop' ||
      main.audioReactive.pressed !== 'true' ||
      main.audioReactive.calls?.mic < 1 ||
      main.audioReactive.input !== 'mic-a' ||
      main.audioReactive.inputOptions.includes('Default - Smoke Mic A')
    ) {
      throw new Error(`Audio input should auto-start and request mic capture: ${JSON.stringify(main.audioReactive)}`);
    }

    await page.selectOption('#audio-reactive-input', 'mic-b');
    await page.waitForFunction(
      () => window.__smokeAudioCapture?.mic >= 2 &&
        window.__smokeAudioCapture?.constraints?.at(-1)?.audio?.deviceId?.exact === 'mic-b' &&
        window.ascilineRemix?.audioReactiveRuntime?.active,
      null,
      { timeout: 5000 }
    );

    await page.waitForFunction(() => window.ascilineRemix?.running && document.querySelector('#toggle-play')?.textContent === 'Stop', null, { timeout: 15000 });
    const sourceSwitches = [
      ['demo-image', 'image'],
      ['demo-video-1', 'video'],
      ['demo-video-2', 'video']
    ];
    for (const [sourceId, mediaType] of sourceSwitches) {
      await page.click(`#source-list [data-source-id="${sourceId}"]`);
      await page.waitForFunction(
        ({ sourceId, mediaType }) => {
          const app = window.ascilineRemix;
          const active = document.querySelector(`#source-list [data-source-id="${sourceId}"]`)?.getAttribute('aria-selected') === 'true';
          return Boolean(app?.running && !app?.starting && app.params?.mediaType === mediaType && active && document.querySelector('#toggle-play')?.textContent === 'Stop');
        },
        { sourceId, mediaType },
        { timeout: 15000 }
      );
      if (mediaType === 'video') {
        const startTime = await page.evaluate(() => {
          const source = window.ascilineRemix?._staticMediaSource?.();
          const video = source?.isVideo ? source.element : null;
          return video?.currentTime || 0;
        });
        await page.waitForFunction(
          (previousTime) => {
            const source = window.ascilineRemix?._staticMediaSource?.();
            const video = source?.isVideo ? source.element : null;
            return Boolean(
              video &&
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              !video.paused &&
              Math.abs((video.currentTime || 0) - previousTime) > 0.05
            );
          },
          startTime,
          { timeout: 15000 }
        );
      }
    }

    await page.evaluate(() => { window.__smokeAudioCapture.display = 0; });
    await page.selectOption('#audio-reactive-source', 'display');
    await page.waitForFunction(() => window.__smokeAudioCapture?.display === 1, null, { timeout: 5000 });
    const afterDisplaySelect = await page.evaluate(() => ({
      calls: window.__smokeAudioCapture,
      enabled: Boolean(window.ascilineRemix?.audioReactive?.enabled),
      active: Boolean(window.ascilineRemix?.audioReactiveRuntime?.active),
      status: document.querySelector('#audio-reactive-status')?.textContent || ''
    }));
    if (afterDisplaySelect.calls.display !== 1 || !afterDisplaySelect.enabled || !afterDisplaySelect.active) {
      throw new Error(`Display audio source selection should start capture: ${JSON.stringify(afterDisplaySelect)}`);
    }
    if (/user gesture/i.test(afterDisplaySelect.status)) {
      throw new Error(`Display audio start still hit user gesture gating: ${JSON.stringify(afterDisplaySelect)}`);
    }

    const output = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    output.on('console', (msg) => { if (msg.type() === 'error') errors.push(`output:${msg.text()}`); });
    const outputResponse = await output.goto(`${baseUrl}/output.html`, { waitUntil: 'domcontentloaded' });
    await output.waitForFunction(() => window.ascilineOutput, null, { timeout: 10000 });
    await output.evaluate(() => window.ascilineOutput.applyState({
      label: 'Smoke Demo',
      params: {
        sourceMode: 'static',
        backend: 'webgl2',
        mediaUrl: 'media/demo.svg',
        mediaType: 'image',
        sourceName: 'Demo Image',
        loop: true,
        muted: true,
        volume: 1,
        cols: 160,
        rows: 0,
        autoRows: true,
        fps: 24,
        saturationBoost: 1.4,
        contrastBoost: 1.2,
        brightness: 1,
        gamma: 1,
        bgBlend: 0.3,
        quantizeBits: 0,
        jitterAmount: 0.2,
        jitterSpeed: 1,
        sampleX: 0.5,
        sampleY: 0.5,
        smoothing: false,
        cellWidth: 2,
        cellHeight: 3,
        solidMode: false,
        glyphMode: true,
        aspectCorrection: 1
      },
      mediaState: null
    }));
    await output.waitForSelector('#output-stage canvas', { timeout: 15000 });
    const outputState = await output.evaluate(() => ({
      status: document.querySelector('#output-status')?.textContent,
      canvasCount: document.querySelectorAll('#output-stage canvas').length
    }));
    await output.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#030405';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff2bd6';
      ctx.fillRect(8, 6, 48, 24);
      window.ascilineOutput.applyState({
        outputMode: 'mirror',
        label: 'Mirror Smoke',
        params: { sourceMode: 'static' }
      });
      window.ascilineOutput.applyMirrorFrame({
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        smoothing: false,
        label: 'Mirror Smoke'
      });
    });
    await output.waitForFunction(() => document.body.classList.contains('has-frame'), null, { timeout: 5000 });
    const mirrorState = await output.evaluate(() => ({
      status: document.querySelector('#output-status')?.textContent,
      canvasCount: document.querySelectorAll('#output-stage canvas').length,
      hasFrame: document.body.classList.contains('has-frame')
    }));
    if (!mirrorState.hasFrame || mirrorState.canvasCount !== 1 || mirrorState.status !== 'Mirror Smoke') {
      throw new Error(`Mirror output did not render a frame: ${JSON.stringify(mirrorState)}`);
    }

    await browser.close();

    const result = {
      mainStatus: response.status(),
      outputStatus: outputResponse.status(),
      main,
      output: outputState,
      mirrorOutput: mirrorState,
      errors
    };
    console.log(JSON.stringify(result, null, 2));
    if (errors.length) throw new Error(`Console errors: ${errors.join('; ')}`);
  } catch (error) {
    if (previewOutput.trim()) {
      console.error(previewOutput.trim());
    }
    throw error;
  } finally {
    preview.kill('SIGTERM');
  }
}

runSmoke().catch((error) => {
  console.error(error);
  process.exit(1);
});
