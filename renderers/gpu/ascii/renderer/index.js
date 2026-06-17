/**
 * ASCII Renderer Factory
 * Picks the best available renderer: WebGPU → WebGL2 → CPU
 * Supports both video and image media sources.
 */

import { WebGPURenderer } from './webgpu/webgpu-renderer.js';
import { WebGL2Renderer } from './webgl2/webgl2-renderer.js';

let capabilities = null;

async function detectCapabilities() {
    if (capabilities) return capabilities;

    capabilities = {
        webgpu: false,
        webgl2: false,
        cpu: true,
        webgpuDevice: null,
        webgpuAdapter: null
    };

    if (navigator.gpu) {
        try {
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (adapter) {
                const device = await adapter.requestDevice();
                if (device) {
                    capabilities.webgpu = true;
                    capabilities.webgpuAdapter = adapter;
                    capabilities.webgpuDevice = device;
                    console.log('[Renderer] WebGPU available');
                }
            }
        } catch (e) {
            console.warn('[Renderer] WebGPU init failed:', e.message);
        }
    }

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { antialias: false });
        if (gl) {
            capabilities.webgl2 = true;
            console.log('[Renderer] WebGL2 available');
        }
    } catch (e) {
        console.warn('[Renderer] WebGL2 init failed:', e.message);
    }

    return capabilities;
}

/**
 * Create the best available renderer
 * @param {Object} options
 * @param {Object} options.source - MediaSource object { type, element, canvas, width, height, isVideo, isImage }
 * @param {HTMLElement} options.targetElement
 * @param {number} options.cols
 * @param {number} options.fps
 * @param {boolean} options.solidMode
 * @param {number} options.saturationBoost
 * @param {number} options.cellWidth
 * @param {number} options.cellHeight
 * @param {string} options.preferredBackend - Force: 'webgpu', 'webgl2', 'cpu'
 */
async function createRenderer(options = {}) {
    const caps = await detectCapabilities();
    const preferred = options.preferredBackend;

    let backend = 'cpu';
    if (preferred === 'webgpu' && caps.webgpu) {
        backend = 'webgpu';
    } else if (preferred === 'webgl2' && caps.webgl2) {
        backend = 'webgl2';
    } else if (preferred === 'cpu') {
        backend = 'cpu';
    } else if (caps.webgpu) {
        backend = 'webgpu';
    } else if (caps.webgl2) {
        backend = 'webgl2';
    }

    console.log(`[Renderer] Using ${backend} backend for ${options.source?.type || 'unknown'} source`);

    try {
        switch (backend) {
            case 'webgpu': {
                const renderer = new WebGPURenderer({
                    ...options,
                    device: caps.webgpuDevice,
                    adapter: caps.webgpuAdapter
                });
                await renderer.init();
                return renderer;
            }
            case 'webgl2': {
                const renderer = new WebGL2Renderer(options);
                renderer.init();
                return renderer;
            }
            case 'cpu':
            default:
                console.warn('[Renderer] CPU fallback not implemented yet');
                throw new Error('CPU renderer not available');
        }
    } catch (e) {
        console.error(`[Renderer] ${backend} creation failed:`, e);

        if (backend === 'webgpu' && caps.webgl2) {
            console.log('[Renderer] Falling back to WebGL2');
            const renderer = new WebGL2Renderer(options);
            renderer.init();
            return renderer;
        }

        throw e;
    }
}

function getCapabilities() {
    return capabilities;
}

export { createRenderer, detectCapabilities, getCapabilities };
