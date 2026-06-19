/**
 * Media Source - Unified abstraction for video and image sources
 * Normalizes different media types for the ASCII rendering pipeline.
 *
 * Supports TIFF decoding via UTIF.js (loaded from CDN on demand).
 */

const MEDIA_EXTENSIONS = {
    video: ['.mp4', '.webm'],
    image: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.gif', '.svg']
};

const TIFF_EXTENSIONS = ['.tif', '.tiff'];

function detectMediaType(url) {
    const lower = url.toLowerCase();
    if (lower.startsWith('camera://')) return 'camera';
    for (const ext of MEDIA_EXTENSIONS.video) {
        if (lower.endsWith(ext)) return 'video';
    }
    for (const ext of MEDIA_EXTENSIONS.image) {
        if (lower.endsWith(ext)) return 'image';
    }
    console.warn('[MediaSource] Unknown extension, defaulting to video:', url);
    return 'video';
}

function isTiff(url) {
    const lower = url.toLowerCase();
    return TIFF_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Load UTIF.js from CDN on demand (only when a TIFF is encountered)
 */
let utifPromise = null;
function loadUTIF() {
    if (utifPromise) return utifPromise;
    utifPromise = new Promise((resolve, reject) => {
        if (window.UTIF) { resolve(window.UTIF); return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';
        script.onload = () => {
            if (window.UTIF) {
                console.log('[MediaSource] UTIF.js loaded for TIFF decoding');
                resolve(window.UTIF);
            } else {
                reject(new Error('UTIF.js loaded but UTIF global not found'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load UTIF.js from CDN'));
        document.head.appendChild(script);
    });
    return utifPromise;
}

/**
 * Load a media source (video or image) and return a normalized interface
 * @param {string} url - URL of the media file
 * @param {Object} options - Options
 * @param {string} options.type - Force media type ('video', 'image', or 'camera'), auto-detected if omitted
 * @param {boolean} options.loop - Loop video (default: true)
 * @param {boolean} options.muted - Mute video (default: true)
 * @returns {Promise<MediaSource>} Resolved media source
 */
async function loadMediaSource(url, options = {}) {
    const type = options.type || detectMediaType(url);

    if (type === 'camera') {
        return loadCameraSource(options.stream, options);
    } else if (type === 'video') {
        return loadVideoSource(url, options);
    } else {
        return loadImageSource(url, options);
    }
}

async function loadCameraSource(stream, options = {}) {
    if (!stream) throw new Error('Camera stream is not available');

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    video.style.display = 'none';
    document.body.appendChild(video);

    const track = stream.getVideoTracks?.()[0] || null;
    const settings = track?.getSettings?.() || {};

    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                settled = true;
                cleanup();
                resolve();
            }
        };
        const timeout = setTimeout(() => {
            if (settled) return;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                settled = true;
                cleanup();
                resolve();
                return;
            }
            if (settings.width && settings.height) {
                settled = true;
                cleanup();
                resolve();
                return;
            }
            settled = true;
            cleanup();
            reject(new Error('Camera did not produce video dimensions'));
        }, options.readyTimeoutMs || 3500);
        const fail = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Camera video element failed'));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener('loadedmetadata', finish);
            video.removeEventListener('loadeddata', finish);
            video.removeEventListener('canplay', finish);
            video.removeEventListener('error', fail);
        };
        video.addEventListener('loadedmetadata', finish);
        video.addEventListener('loadeddata', finish);
        video.addEventListener('canplay', finish);
        video.addEventListener('error', fail, { once: true });
        video.play().then(finish).catch(() => finish());
    });

    const width = video.videoWidth || settings.width || 640;
    const height = video.videoHeight || settings.height || 480;

    return {
        type: 'camera',
        element: video,
        canvas: null,
        width,
        height,
        ready: true,
        isVideo: true,
        isImage: false,
        isCamera: true,
        stream,

        play() { return video.play(); },
        pause() { video.pause(); },
        destroy() {
            video.pause();
            video.srcObject = null;
            video.remove();
            if (options.stopTracks !== false) {
                stream.getTracks?.().forEach((streamTrack) => streamTrack.stop());
            }
        }
    };
}

async function loadVideoSource(url, options = {}) {
    const video = document.createElement('video');
    video.src = url;
    video.loop = options.loop !== false;
    video.muted = options.muted !== false;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);

    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                settled = true;
                cleanup();
                resolve();
            }
        };
        const timeout = setTimeout(() => {
            if (settled) return;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                settled = true;
                cleanup();
                resolve();
                return;
            }
            settled = true;
            cleanup();
            reject(new Error(`Video load timed out: ${url}`));
        }, options.readyTimeoutMs || 5000);
        const fail = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(`Video load failed: ${url}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener('loadedmetadata', finish);
            video.removeEventListener('loadeddata', finish);
            video.removeEventListener('canplay', finish);
            video.removeEventListener('canplaythrough', finish);
            video.removeEventListener('error', fail);
        };
        video.addEventListener('loadedmetadata', finish);
        video.addEventListener('loadeddata', finish);
        video.addEventListener('canplay', finish);
        video.addEventListener('canplaythrough', finish);
        video.addEventListener('error', fail, { once: true });
        video.load();
    });

    return {
        type: 'video',
        element: video,
        canvas: null,
        width: video.videoWidth,
        height: video.videoHeight,
        ready: true,
        isVideo: true,
        isImage: false,

        play() { return video.play(); },
        pause() { video.pause(); },
        destroy() {
            video.pause();
            video.remove();
        }
    };
}

async function loadImageSource(url, options = {}) {
    // TIFF files need special decoding — browsers can't load them via <img>
    if (isTiff(url)) {
        return loadTiffSource(url);
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`Image load failed: ${url}`));
        img.src = url;
    });

    // Draw image to canvas for GPU texture upload
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    return makeImageResult(img, canvas, img.naturalWidth, img.naturalHeight);
}

/**
 * Load a TIFF file by fetching raw bytes and decoding with UTIF.js
 */
async function loadTiffSource(url) {
    const [UTIF, response] = await Promise.all([
        loadUTIF(),
        fetch(url)
    ]);

    const buffer = await response.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) throw new Error(`TIFF decode failed: no images in ${url}`);

    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const width = ifds[0].width;
    const height = ifds[0].height;

    // Draw decoded pixels to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    ctx.putImageData(imageData, 0, 0);

    console.log(`[MediaSource] TIFF decoded: ${width}x${height} from ${url}`);

    return makeImageResult(null, canvas, width, height);
}

function makeImageResult(img, canvas, width, height) {
    return {
        type: 'image',
        element: img || canvas,
        canvas: canvas,
        width: width,
        height: height,
        ready: true,
        isVideo: false,
        isImage: true,

        play() { /* no-op for images */ },
        pause() { /* no-op for images */ },
        destroy() { /* nothing to clean up */ }
    };
}

export { loadMediaSource, detectMediaType, MEDIA_EXTENSIONS };
