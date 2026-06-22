import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadMediaSource } from './renderers/gpu/media-source.js?v=20260619-camera-mixer';
import { createRenderer } from './renderers/gpu/ascii/renderer/index.js?v=20260618-camera-source';

const stage = document.getElementById('output-stage');
const status = document.getElementById('output-status');
const fullscreenButton = document.getElementById('fullscreen-output');
const closeButton = document.getElementById('close-output');
const OUTPUT_FULLSCREEN_KEY = 'asciline-remix-output-fullscreen-v1';
const MIRROR_SOURCE_KEY = '__native_mirror__';

let currentSourceKey = '';
let source = null;
let renderer = null;
let latestPayload = null;
let mirrorCanvas = null;
let mirrorCtx = null;
let mirrorImage = null;
let mirrorFrameToken = 0;
let mirrorFrameSeq = 0;

function storedBoolean(key, fallback = false) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? Boolean(JSON.parse(raw)) : fallback;
    } catch {
        return fallback;
    }
}

function storeBoolean(key, value) {
    localStorage.setItem(key, JSON.stringify(Boolean(value)));
}

function setStatus(message) {
    status.textContent = message || '';
}

function isRuntimeBlob(url) {
    return String(url || '').startsWith('blob:');
}

function supportedPayload(payload) {
    const params = payload?.params || {};
    if (params.sourceMode !== 'static') return false;
    if (params.mediaType === 'camera') return false;
    if (isRuntimeBlob(params.mediaUrl)) return false;
    return Boolean(params.mediaUrl);
}

function sourceKey(payload) {
    const params = payload?.params || {};
    return `${params.mediaUrl || ''}|${params.mediaType || ''}`;
}

function ensureMirrorCanvas() {
    if (mirrorCanvas && mirrorCtx) return true;
    stage.innerHTML = '';
    mirrorCanvas = document.createElement('canvas');
    mirrorCanvas.className = 'output-mirror-canvas';
    mirrorCtx = mirrorCanvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!mirrorCtx) {
        mirrorCanvas = null;
        return false;
    }
    stage.appendChild(mirrorCanvas);
    return true;
}

function enterMirrorMode(payload = {}) {
    if (currentSourceKey !== MIRROR_SOURCE_KEY) {
        destroyRenderer();
        currentSourceKey = MIRROR_SOURCE_KEY;
    }
    document.body.classList.remove('has-frame');
    if (ensureMirrorCanvas()) {
        setStatus(payload.label || 'Mirroring live output');
    } else {
        setStatus('Mirror output unavailable');
    }
}

function applyMirrorFrame(frame) {
    if (!frame?.dataUrl) return;
    const seq = Number(frame.seq || 0);
    if (seq > 0 && seq < mirrorFrameSeq) return;
    if (seq > 0) mirrorFrameSeq = seq;
    if (currentSourceKey !== MIRROR_SOURCE_KEY) enterMirrorMode(frame);
    if (!mirrorCanvas || !mirrorCtx) return;

    const width = Math.max(1, Math.floor(Number(frame.width) || 1));
    const height = Math.max(1, Math.floor(Number(frame.height) || 1));
    if (mirrorCanvas.width !== width || mirrorCanvas.height !== height) {
        mirrorCanvas.width = width;
        mirrorCanvas.height = height;
    }

    const token = ++mirrorFrameToken;
    const image = mirrorImage || new Image();
    mirrorImage = image;
    image.onload = () => {
        if (token !== mirrorFrameToken || !mirrorCtx || !mirrorCanvas) return;
        mirrorCtx.imageSmoothingEnabled = Boolean(frame.smoothing);
        mirrorCtx.fillStyle = '#030405';
        mirrorCtx.fillRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
        mirrorCtx.drawImage(image, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
        document.body.classList.add('has-frame');
        setStatus(frame.label || 'Mirroring live output');
    };
    image.src = frame.dataUrl;
}

function applyRendererParams(params) {
    if (!renderer) return;
    renderer.saturationBoost = params.saturationBoost;
    renderer.contrastBoost = params.contrastBoost;
    renderer.brightness = params.brightness;
    renderer.gamma = params.gamma;
    renderer.bgBlend = params.bgBlend;
    renderer.quantizeBits = params.quantizeBits;
    renderer.jitterAmount = params.jitterAmount;
    renderer.jitterSpeed = params.jitterSpeed;
    renderer.sampleX = params.sampleX;
    renderer.sampleY = params.sampleY;
    renderer.fps = params.fps;
    renderer.frameInterval = 1000 / Math.max(1, params.fps || 24);
    renderer.smoothing = params.smoothing;
    renderer.cellWidth = params.cellWidth;
    renderer.cellHeight = params.cellHeight;
    if (renderer._applySourceSmoothing) renderer._applySourceSmoothing();
    if (renderer.canvas) renderer.canvas.style.imageRendering = params.smoothing ? 'auto' : 'pixelated';
}

function syncPlayback(mediaState) {
    if (!source?.isVideo || !source.element || !mediaState) return;
    const video = source.element;
    const targetTime = Number(mediaState.currentTime || 0);
    if (Number.isFinite(targetTime) && Math.abs((video.currentTime || 0) - targetTime) > 0.45) {
        try {
            video.currentTime = targetTime;
        } catch {
            // Some platforms reject seeks before enough video data is buffered.
        }
    }

    if (mediaState.paused) {
        video.pause();
    } else {
        video.play().catch(() => {});
    }
}

function destroyRenderer() {
    renderer?.stop?.();
    renderer?.destroy?.();
    renderer = null;
    source?.destroy?.();
    source = null;
    currentSourceKey = '';
    mirrorCanvas = null;
    mirrorCtx = null;
    mirrorImage = null;
    document.body.classList.remove('has-frame');
    stage.innerHTML = '';
}

async function applyState(payload) {
    latestPayload = payload;
    if (payload?.outputMode === 'mirror') {
        enterMirrorMode(payload);
        return;
    }

    if (!supportedPayload(payload)) {
        destroyRenderer();
        setStatus('Native output supports static video/image sources');
        return;
    }

    const params = payload.params;
    const nextSourceKey = sourceKey(payload);

    if (renderer && nextSourceKey === currentSourceKey) {
        applyRendererParams(params);
        syncPlayback(payload.mediaState);
        setStatus(payload.label || params.sourceName || 'Output');
        return;
    }

    destroyRenderer();
    setStatus('Loading output source');

    source = await loadMediaSource(params.mediaUrl, {
        type: params.mediaType,
        loop: params.loop,
        muted: params.muted,
        readyTimeoutMs: 8000
    });
    currentSourceKey = nextSourceKey;
    syncPlayback(payload.mediaState);

    const preferredBackend = params.backend === 'webgpu' ? 'webgpu' :
        params.backend === 'webgl2' ? 'webgl2' :
            'webgl2';

    renderer = await createRenderer({
        source,
        targetElement: stage,
        cols: params.cols,
        rows: params.autoRows ? 0 : params.rows,
        autoRows: params.autoRows,
        aspectCorrection: params.aspectCorrection,
        fps: params.fps,
        saturationBoost: params.saturationBoost,
        contrastBoost: params.contrastBoost,
        brightness: params.brightness,
        gamma: params.gamma,
        bgBlend: params.bgBlend,
        quantizeBits: params.quantizeBits,
        jitterAmount: params.jitterAmount,
        jitterSpeed: params.jitterSpeed,
        sampleX: params.sampleX,
        sampleY: params.sampleY,
        smoothing: params.smoothing,
        cellWidth: params.cellWidth,
        cellHeight: params.cellHeight,
        solidMode: params.solidMode,
        glyphMode: params.glyphMode,
        preserveDrawingBuffer: false,
        opaqueCanvas: true,
        desynchronized: true,
        preferredBackend
    });
    renderer.start();
    applyRendererParams(params);
    document.body.classList.add('has-frame');
    setStatus(payload.label || params.sourceName || 'Output');
}

async function toggleFullscreen() {
    if (isTauri()) {
        const win = getCurrentWindow();
        const isFullscreen = await win.isFullscreen().catch(() => false);
        const next = !isFullscreen;
        const applied = await win.setFullscreen(next).then(() => true).catch(() => false);
        if (applied) storeBoolean(OUTPUT_FULLSCREEN_KEY, next);
        return;
    }
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    } else {
        document.documentElement.requestFullscreen?.();
    }
}

async function restoreFullscreen() {
    if (!isTauri()) return;
    const shouldFullscreen = storedBoolean(OUTPUT_FULLSCREEN_KEY, false);
    if (!shouldFullscreen) return;
    const win = getCurrentWindow();
    const isFullscreen = await win.isFullscreen().catch(() => false);
    if (!isFullscreen) await win.setFullscreen(true).catch(() => {});
}

fullscreenButton.addEventListener('click', () => toggleFullscreen());
closeButton.addEventListener('click', () => {
    if (isTauri()) {
        getCurrentWindow().close().catch(() => {});
    } else {
        window.close();
    }
});

if (isTauri()) {
    Promise.resolve().then(async () => {
        await restoreFullscreen().catch((error) => {
            console.info('[Output] Fullscreen restore unavailable:', error);
        });
        await listen('asciline-output-state', (event) => {
            applyState(event.payload).catch((error) => {
                console.error('[Output] State failed:', error);
                setStatus(error?.message || 'Output failed');
            });
        });
        await listen('asciline-output-frame', (event) => {
            applyMirrorFrame(event.payload);
        });
    }).catch((error) => {
        console.error('[Output] Listen failed:', error);
        setStatus('Output event channel unavailable');
    });
}

window.ascilineOutput = {
    applyState,
    applyMirrorFrame,
    latestPayload: () => latestPayload
};
