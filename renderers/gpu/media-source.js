/**
 * Media Source - Unified abstraction for video and image sources
 * Normalizes different media types for the ASCII rendering pipeline.
 */

const MEDIA_EXTENSIONS = {
    video: ['.mp4', '.webm', '.mkv'],
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

function shouldUseAnonymousCrossOrigin(url) {
    const value = String(url || '');
    return /^https?:\/\//i.test(value) && !/^https?:\/\/asset\.localhost(?::\d+)?\//i.test(value);
}

/**
 * Load a media source (video or image) and return a normalized interface
 * @param {string} url - URL of the media file
 * @param {Object} options - Options
 * @param {string} options.type - Force media type ('video', 'image', 'camera', or 'camera-mix'), auto-detected if omitted
 * @param {boolean} options.loop - Loop video (default: true)
 * @param {boolean} options.muted - Mute video (default: true)
 * @returns {Promise<MediaSource>} Resolved media source
 */
async function loadMediaSource(url, options = {}) {
    const type = options.type || detectMediaType(url);

    if (type === 'camera' || type === 'camera-mix') {
        return loadCameraSource(options.stream, { ...options, sourceType: type });
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

    const sourceType = options.sourceType || 'camera';

    return {
        type: sourceType,
        element: video,
        canvas: null,
        width,
        height,
        ready: true,
        isVideo: true,
        isImage: false,
        isCamera: true,
        isCameraMix: sourceType === 'camera-mix',
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
    if (shouldUseAnonymousCrossOrigin(url)) video.crossOrigin = 'anonymous';
    video.src = url;
    video.loop = options.loop !== false;
    video.muted = options.muted !== false;
    video.playsInline = true;
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
    // TIFF files need a vendored decoder for local-only browser/Tauri builds.
    if (isTiff(url)) {
        return loadTiffSource(url);
    }

    const img = new Image();
    if (shouldUseAnonymousCrossOrigin(url)) img.crossOrigin = 'anonymous';

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

async function loadTiffSource(url) {
    throw new Error(`TIFF decoding is disabled until a local decoder is vendored: ${url}`);
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
