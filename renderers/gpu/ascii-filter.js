/**
 * ASCII Filter - Top-level API for rendering media as ASCII
 * Wraps MediaSource + Renderer factory into a simple renderMedia() call.
 *
 * Usage:
 *   import { renderMedia } from './ascii-filter.js';
 *   const cleanup = await renderMedia('scene.mp4', targetEl, { cols: 120 });
 *   // later: cleanup();
 */

import { loadMediaSource } from './media-source.js';
import { createRenderer, detectCapabilities } from './ascii/renderer/index.js';

/**
 * Render a media file (video or image) as ASCII into a target element
 * @param {string} url - URL of the media file (.mp4, .webm, .jpg, .png, .tif, .gif)
 * @param {HTMLElement} targetElement - DOM element to render into
 * @param {Object} options - Rendering options
 * @returns {Promise<Function>} Cleanup function
 */
async function renderMedia(url, targetElement, options = {}) {
    // Load media source
    const source = await loadMediaSource(url, {
        type: options.mediaType,
        loop: options.loop,
        muted: options.muted
    });

    const rendererOptions = {
        source: source,
        targetElement: targetElement,
        cols: options.cols || 480,
        fps: options.fps || 24,
        saturationBoost: options.saturationBoost || 1.4,
        contrastBoost: options.contrastBoost || 1.2,
        cellWidth: options.cellWidth || 2,
        cellHeight: options.cellHeight || 3,
        solidMode: options.solidMode || false,
        glyphMode: options.glyphMode !== false,
        bgBlend: options.bgBlend || 0.3,
        preferredBackend: options.preferredBackend
    };

    // Create renderer
    const renderer = await createRenderer(rendererOptions);

    // Start playback
    if (source.isVideo) {
        source.play().catch(e => console.warn('[ASCIIFilter] Autoplay blocked:', e));
    }
    renderer.start();

    // Return cleanup function
    return function cleanup() {
        renderer.stop();
        if (renderer.destroy) renderer.destroy();
        source.destroy();
    };
}

export { renderMedia, loadMediaSource, detectCapabilities };
