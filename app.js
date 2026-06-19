import { detectMediaType, loadMediaSource } from './renderers/gpu/media-source.js?v=20260618-camera-source';
import { createRenderer, detectCapabilities } from './renderers/gpu/ascii/renderer/index.js?v=20260618-camera-source';

const $ = (id) => document.getElementById(id);

const els = {
    sourceMode: $('source-mode'),
    backend: $('backend'),
    togglePlay: $('toggle-play'),
    backendStatus: $('backend-status'),
    connectionStatus: $('connection-status'),
    activePresetLabel: $('active-preset-label'),
    sourceLabel: $('source-label'),
    fpsMeter: $('fps-meter'),
    bufferMeter: $('buffer-meter'),
    gridMeter: $('grid-meter'),
    container: $('player-container'),
    gpuStage: $('gpu-stage'),
    canvas: $('ascii-canvas'),
    player: $('ascii-player'),
    transitionLayer: $('transition-layer'),
    overlay: $('play-overlay'),
    statsOverlay: $('stats-overlay'),
    audio: $('ascii-audio'),
    presetList: $('preset-list'),
    savePreset: $('save-preset'),
    duplicatePreset: $('duplicate-preset'),
    updatePreset: $('update-preset'),
    deletePreset: $('delete-preset'),
    morePresets: $('more-presets'),
    presetOverflowMenu: $('preset-overflow-menu'),
    exportPresets: $('export-presets'),
    importPresets: $('import-presets'),
    reloadSource: $('reload-source'),
    popoutWindow: $('popout-window'),
    wtfButton: $('wtf-randomize'),
    sourceList: $('source-list'),
    addCustomFile: $('add-custom-file'),
    localMediaFile: $('local-media-file'),
    controls: $('controls')
};

const ASCII_CHARS = " .'`^\":;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const CHAR_LUT = new Array(128);
for (let i = 0; i < 128; i++) CHAR_LUT[i] = String.fromCharCode(i);

const STORAGE_KEY = 'asciline-remix-state-v1';
const PRESET_KEY = 'asciline-remix-user-presets-v1';
const CUSTOM_SOURCE_KEY = 'asciline-remix-custom-source-v1';
const CUSTOM_HANDLE_DB = 'asciline-remix-custom-source-db';
const CUSTOM_HANDLE_STORE = 'handles';
const CUSTOM_HANDLE_ID = 'custom-media';
const CUSTOM_SOURCE_ID = 'custom-file';
const CAMERA_SOURCE_ID = 'camera';
const CAMERA_MEDIA_URL = 'camera://local';
const CUSTOM_MEDIA_PICKER_OPTIONS = {
    multiple: false,
    excludeAcceptAllOption: false,
    types: [{
        description: 'Media files',
        accept: {
            'video/*': ['.mp4', '.webm'],
            'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.tif', '.tiff']
        }
    }]
};

const DEFAULT_PARAMS = {
    sourceMode: 'static',
    backend: 'auto',
    mediaUrl: 'media/point-click-test-30s.mp4',
    mediaType: 'video',
    sourceName: 'Demo Video 1',
    cameraDeviceId: '',
    cameraFacingMode: 'any',
    cameraResolution: 'auto',
    cameraFps: 30,
    cameraMirror: true,
    loop: true,
    muted: true,
    volume: 1,
    cols: 480,
    rows: 0,
    autoRows: true,
    fps: 24,
    fpsCap: 30,
    saturationBoost: 1.4,
    contrastBoost: 1.2,
    brightness: 1,
    gamma: 1,
    bgBlend: 0.3,
    quantizeBits: 0,
    mode: 5,
    pixel: false,
    cellWidth: 2,
    cellHeight: 3,
    aspectCorrection: 1,
    jitterAmount: 0.6,
    jitterSpeed: 1,
    sampleX: 0.5,
    sampleY: 0.5,
    smoothing: true,
    codec: 'adaptive',
    codecQuality: 'lossless',
    codecTolerance: 0,
    bufferSize: 4,
    maxBufferMultiplier: 5,
    lateDropThreshold: 0.1,
    futureWaitThreshold: 0.05,
    glyphMode: true,
    solidMode: false,
    charset: 'point-click',
    fontFamily: 'Courier New',
    minGlyphIntensity: 180,
    statsOverlay: true,
    transitionSeconds: 1.5
};

const SOURCE_PRESETS = [
    { id: 'demo-image', name: 'Demo Image', mediaUrl: 'media/demo.svg', mediaType: 'image' },
    { id: 'demo-video-1', name: 'Demo Video 1', mediaUrl: 'media/point-click-test-30s.mp4', mediaType: 'video' },
    { id: 'demo-video-2', name: 'Demo Video 2', mediaUrl: 'media/point-click-test2.mp4', mediaType: 'video' }
];

const CAMERA_RESOLUTION_OPTIONS = [
    ['auto', 'Auto'],
    ['640x480', '480p'],
    ['1280x720', '720p'],
    ['1920x1080', '1080p'],
    ['3840x2160', '4K']
];

const CODEC_TOLERANCE = {
    lossless: 0,
    high: 4,
    balanced: 8,
    low: 16
};
const VIDEO_PLAY_TIMEOUT_MS = 900;
const GPU_QUEUE_SETTLE_TIMEOUT_MS = 160;

const BUILTIN_PRESETS = [
    {
        id: 'point-click-default',
        name: 'Point & Click Default',
        readonly: true,
        transitionSeconds: 1.5,
        params: {
            cols: 480,
            cellWidth: 2,
            cellHeight: 3,
            saturationBoost: 1.4,
            contrastBoost: 1.2,
            bgBlend: 0.3,
            jitterAmount: 0.6,
            jitterSpeed: 1,
            solidMode: false,
            glyphMode: true,
            mode: 5,
            pixel: false,
            codecQuality: 'lossless'
        }
    },
    {
        id: 'arcade-rain',
        name: 'Arcade Rain',
        readonly: true,
        transitionSeconds: 1.4,
        params: {
            cols: 520,
            cellWidth: 2,
            cellHeight: 3,
            saturationBoost: 1.65,
            contrastBoost: 1.35,
            brightness: 0.95,
            bgBlend: 0.25,
            jitterAmount: 0.45,
            jitterSpeed: 1.1,
            quantizeBits: 0,
            mode: 5,
            pixel: false,
            codecQuality: 'high'
        }
    },
    {
        id: 'posterized-dream',
        name: 'Posterized Dream',
        readonly: true,
        transitionSeconds: 1.2,
        params: {
            cols: 460,
            cellWidth: 3,
            cellHeight: 4,
            saturationBoost: 1.22,
            contrastBoost: 1.72,
            brightness: 1.04,
            bgBlend: 0.16,
            jitterAmount: 0.08,
            jitterSpeed: 0.2,
            quantizeBits: 4,
            mode: 3,
            pixel: false,
            codecQuality: 'high'
        }
    },
    {
        id: 'night-vision-terminal',
        name: 'Night Vision Terminal',
        readonly: true,
        transitionSeconds: 1.8,
        params: {
            cols: 440,
            cellWidth: 2,
            cellHeight: 3,
            saturationBoost: 0.62,
            contrastBoost: 1.55,
            brightness: 0.82,
            bgBlend: 0.34,
            jitterAmount: 0.22,
            jitterSpeed: 0.55,
            quantizeBits: 3,
            mode: 3,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'ditherpunk-ultra',
        name: 'Ditherpunk Ultra',
        readonly: true,
        transitionSeconds: 1,
        params: {
            cols: 720,
            cellWidth: 2,
            cellHeight: 2,
            saturationBoost: 1.82,
            contrastBoost: 1.42,
            brightness: 1,
            bgBlend: 0.12,
            jitterAmount: 0.34,
            jitterSpeed: 1.35,
            quantizeBits: 1,
            mode: 5,
            pixel: false,
            codecQuality: 'high'
        }
    },
    {
        id: 'signal-loss',
        name: 'Signal Loss',
        readonly: true,
        transitionSeconds: 0.9,
        params: {
            cols: 390,
            cellWidth: 3,
            cellHeight: 4,
            saturationBoost: 1.3,
            contrastBoost: 1.08,
            brightness: 0.92,
            bgBlend: 0.52,
            jitterAmount: 0.8,
            jitterSpeed: 2.1,
            quantizeBits: 5,
            mode: 2,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'pixel-mirage',
        name: 'Pixel Mirage',
        readonly: true,
        transitionSeconds: 1.1,
        params: {
            cols: 620,
            cellWidth: 2,
            cellHeight: 2,
            saturationBoost: 1.72,
            contrastBoost: 1.22,
            brightness: 1,
            bgBlend: 0.18,
            jitterAmount: 0.3,
            jitterSpeed: 0.9,
            solidMode: true,
            glyphMode: false,
            mode: 5,
            pixel: true,
            codecQuality: 'high'
        }
    },
    {
        id: 'solar-guillotine',
        name: 'Solar Guillotine',
        readonly: true,
        transitionSeconds: 0.7,
        params: {
            cols: 860,
            cellWidth: 1,
            cellHeight: 2,
            saturationBoost: 2.75,
            contrastBoost: 2.45,
            brightness: 1.18,
            gamma: 0.72,
            bgBlend: 0.04,
            jitterAmount: 0.72,
            jitterSpeed: 2.8,
            quantizeBits: 0,
            mode: 5,
            pixel: false,
            codecQuality: 'high'
        }
    },
    {
        id: 'acid-snowstorm',
        name: 'Acid Snowstorm',
        readonly: true,
        transitionSeconds: 0.8,
        params: {
            cols: 760,
            cellWidth: 1,
            cellHeight: 2,
            saturationBoost: 3,
            contrastBoost: 1.8,
            brightness: 1.35,
            gamma: 0.62,
            bgBlend: 0.08,
            jitterAmount: 1,
            jitterSpeed: 4,
            quantizeBits: 2,
            mode: 5,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'blacklight-crush',
        name: 'Blacklight Crush',
        readonly: true,
        transitionSeconds: 1,
        params: {
            cols: 640,
            cellWidth: 2,
            cellHeight: 2,
            saturationBoost: 2.45,
            contrastBoost: 2.8,
            brightness: 0.68,
            gamma: 1.8,
            bgBlend: 0.06,
            jitterAmount: 0.46,
            jitterSpeed: 1.9,
            quantizeBits: 1,
            mode: 4,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'teletext-reactor',
        name: 'Teletext Reactor',
        readonly: true,
        transitionSeconds: 1.1,
        params: {
            cols: 420,
            cellWidth: 4,
            cellHeight: 4,
            saturationBoost: 2.2,
            contrastBoost: 2.25,
            brightness: 1.08,
            gamma: 0.88,
            bgBlend: 0.18,
            jitterAmount: 0.16,
            jitterSpeed: 0.7,
            quantizeBits: 6,
            solidMode: true,
            glyphMode: false,
            mode: 2,
            pixel: true,
            codecQuality: 'low'
        }
    },
    {
        id: 'static-cathedral',
        name: 'Static Cathedral',
        readonly: true,
        transitionSeconds: 2.6,
        params: {
            cols: 900,
            cellWidth: 1,
            cellHeight: 1,
            saturationBoost: 0.72,
            contrastBoost: 2.95,
            brightness: 0.92,
            gamma: 1.35,
            bgBlend: 0.72,
            jitterAmount: 0.92,
            jitterSpeed: 3.4,
            quantizeBits: 5,
            mode: 3,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'infrared-riot',
        name: 'Infrared Riot',
        readonly: true,
        transitionSeconds: 0.9,
        params: {
            cols: 560,
            cellWidth: 2,
            cellHeight: 3,
            saturationBoost: 2.9,
            contrastBoost: 1.95,
            brightness: 0.9,
            gamma: 1.55,
            bgBlend: 0.38,
            jitterAmount: 0.64,
            jitterSpeed: 2.5,
            quantizeBits: 3,
            mode: 3,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'chrome-wound',
        name: 'Chrome Wound',
        readonly: true,
        transitionSeconds: 1.3,
        params: {
            cols: 700,
            cellWidth: 2,
            cellHeight: 2,
            saturationBoost: 0,
            contrastBoost: 3,
            brightness: 1.15,
            gamma: 0.58,
            bgBlend: 0.12,
            jitterAmount: 0.24,
            jitterSpeed: 1.2,
            quantizeBits: 1,
            mode: 1,
            pixel: false,
            codecQuality: 'high'
        }
    },
    {
        id: 'paper-shredder',
        name: 'Paper Shredder',
        readonly: true,
        transitionSeconds: 1.7,
        params: {
            cols: 240,
            cellWidth: 8,
            cellHeight: 12,
            saturationBoost: 0.05,
            contrastBoost: 2.1,
            brightness: 1.55,
            gamma: 1.05,
            bgBlend: 0.82,
            jitterAmount: 0.18,
            jitterSpeed: 0.45,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 2,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'terminal-collapse',
        name: 'Terminal Collapse',
        readonly: true,
        transitionSeconds: 0.6,
        params: {
            cols: 340,
            cellWidth: 3,
            cellHeight: 5,
            saturationBoost: 0.34,
            contrastBoost: 2.75,
            brightness: 0.78,
            gamma: 1.65,
            bgBlend: 0.62,
            jitterAmount: 1,
            jitterSpeed: 3.7,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 1,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'neon-razorstorm',
        name: 'Neon Razorstorm',
        readonly: true,
        transitionSeconds: 0.85,
        params: {
            cols: 780,
            cellWidth: 1,
            cellHeight: 2,
            saturationBoost: 3,
            contrastBoost: 2.35,
            brightness: 1.08,
            gamma: 0.72,
            bgBlend: 0.08,
            jitterAmount: 0.96,
            jitterSpeed: 3.9,
            quantizeBits: 1,
            mode: 5,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'plasma-bruise',
        name: 'Plasma Bruise',
        readonly: true,
        transitionSeconds: 1.25,
        params: {
            cols: 620,
            cellWidth: 2,
            cellHeight: 3,
            saturationBoost: 2.85,
            contrastBoost: 2.15,
            brightness: 0.92,
            gamma: 1.85,
            bgBlend: 0.18,
            jitterAmount: 0.78,
            jitterSpeed: 2.7,
            quantizeBits: 2,
            mode: 4,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'toxic-halftone',
        name: 'Toxic Halftone',
        readonly: true,
        transitionSeconds: 1.05,
        params: {
            cols: 360,
            cellWidth: 4,
            cellHeight: 6,
            saturationBoost: 2.55,
            contrastBoost: 2.5,
            brightness: 1.12,
            gamma: 0.9,
            bgBlend: 0.16,
            jitterAmount: 0.52,
            jitterSpeed: 1.8,
            quantizeBits: 5,
            solidMode: false,
            glyphMode: true,
            mode: 3,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'magma-telemetry',
        name: 'Magma Telemetry',
        readonly: true,
        transitionSeconds: 1.45,
        params: {
            cols: 680,
            cellWidth: 2,
            cellHeight: 2,
            saturationBoost: 2.7,
            contrastBoost: 2.05,
            brightness: 0.86,
            gamma: 1.2,
            bgBlend: 0.28,
            jitterAmount: 0.88,
            jitterSpeed: 3.2,
            quantizeBits: 3,
            mode: 5,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'laser-rot',
        name: 'Laser Rot',
        readonly: true,
        transitionSeconds: 0.75,
        params: {
            cols: 840,
            cellWidth: 1,
            cellHeight: 2,
            saturationBoost: 2.95,
            contrastBoost: 2.65,
            brightness: 0.74,
            gamma: 1.55,
            bgBlend: 0.2,
            jitterAmount: 1,
            jitterSpeed: 4,
            quantizeBits: 0,
            mode: 5,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'cyberdelic-riot',
        name: 'Cyberdelic Riot',
        readonly: true,
        transitionSeconds: 1.15,
        params: {
            cols: 520,
            cellWidth: 3,
            cellHeight: 3,
            saturationBoost: 3,
            contrastBoost: 1.9,
            brightness: 1.18,
            gamma: 0.68,
            bgBlend: 0.1,
            jitterAmount: 0.72,
            jitterSpeed: 2.9,
            quantizeBits: 2,
            solidMode: true,
            glyphMode: false,
            mode: 5,
            pixel: true,
            codecQuality: 'high'
        }
    },
    {
        id: 'ultraviolet-siren',
        name: 'Ultraviolet Siren',
        readonly: true,
        transitionSeconds: 1.35,
        params: {
            cols: 460,
            cellWidth: 3,
            cellHeight: 5,
            saturationBoost: 2.65,
            contrastBoost: 2.75,
            brightness: 0.82,
            gamma: 2.05,
            bgBlend: 0.24,
            jitterAmount: 0.42,
            jitterSpeed: 1.7,
            quantizeBits: 4,
            mode: 4,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'glitch-orchid',
        name: 'Glitch Orchid',
        readonly: true,
        transitionSeconds: 0.95,
        params: {
            cols: 740,
            cellWidth: 1,
            cellHeight: 3,
            saturationBoost: 2.35,
            contrastBoost: 2.3,
            brightness: 1.02,
            gamma: 0.82,
            bgBlend: 0.12,
            jitterAmount: 0.94,
            jitterSpeed: 3.5,
            quantizeBits: 2,
            mode: 5,
            pixel: false,
            codecQuality: 'low'
        }
    }
];

const CONTROL_GROUPS = [
    {
        title: 'Playback',
        controls: [
            { key: 'transitionSeconds', label: 'Default transition', type: 'range', min: 0, max: 8, step: 0.1, unit: 's' },
            { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.01 },
            { key: 'loop', label: 'Loop static media', type: 'checkbox' },
            { key: 'muted', label: 'Mute static media', type: 'checkbox' },
            { key: 'statsOverlay', label: 'Stats overlay', type: 'checkbox' }
        ]
    },
    {
        title: 'Grid',
        controls: [
            { key: 'cols', label: 'Columns', type: 'range', min: 80, max: 900, step: 1 },
            { key: 'autoRows', label: 'Auto rows', type: 'checkbox' },
            { key: 'rows', label: 'Rows', type: 'range', min: 20, max: 360, step: 1 },
            { key: 'cellWidth', label: 'Cell width', type: 'range', min: 1, max: 12, step: 1, unit: 'px' },
            { key: 'cellHeight', label: 'Cell height', type: 'range', min: 1, max: 16, step: 1, unit: 'px' },
            { key: 'aspectCorrection', label: 'Aspect correction', type: 'range', min: 0.5, max: 1.6, step: 0.01 }
        ]
    },
    {
        title: 'Color',
        controls: [
            { key: 'saturationBoost', label: 'Saturation', type: 'range', min: 0, max: 3, step: 0.01 },
            { key: 'contrastBoost', label: 'Contrast', type: 'range', min: 0, max: 3, step: 0.01 },
            { key: 'brightness', label: 'Brightness', type: 'range', min: 0, max: 2, step: 0.01 },
            { key: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 3, step: 0.01 },
            { key: 'bgBlend', label: 'Background blend', type: 'range', min: 0, max: 1, step: 0.01 },
            { key: 'quantizeBits', label: 'Quantize bits', type: 'range', min: 0, max: 6, step: 1 },
            { key: 'mode', label: 'Stream mode', type: 'select', options: [['1', '1 B&W'], ['2', '2 512c'], ['3', '3 32K'], ['4', '4 262K'], ['5', '5 16M']] },
            { key: 'pixel', label: 'Pixel stream', type: 'checkbox' }
        ]
    },
    {
        title: 'Sampling',
        controls: [
            { key: 'fps', label: 'Target FPS', type: 'range', min: 1, max: 60, step: 1 },
            { key: 'jitterAmount', label: 'Jitter amount', type: 'range', min: 0, max: 1, step: 0.01 },
            { key: 'jitterSpeed', label: 'Jitter speed', type: 'range', min: 0, max: 4, step: 0.01 },
            { key: 'sampleX', label: 'Sample X', type: 'range', min: 0, max: 1, step: 0.01 },
            { key: 'sampleY', label: 'Sample Y', type: 'range', min: 0, max: 1, step: 0.01 },
            { key: 'smoothing', label: 'Texture smoothing', type: 'checkbox' }
        ]
    },
    {
        title: 'Camera',
        controls: [
            { key: 'cameraDeviceId', label: 'Device', type: 'select', options: [['', 'Default camera']] },
            { key: 'cameraFacingMode', label: 'Facing', type: 'select', options: [['any', 'Any'], ['user', 'Front'], ['environment', 'Rear']] },
            { key: 'cameraResolution', label: 'Capture size', type: 'select', options: CAMERA_RESOLUTION_OPTIONS },
            { key: 'cameraFps', label: 'Capture FPS', type: 'range', min: 1, max: 60, step: 1 },
            { key: 'cameraMirror', label: 'Mirror', type: 'checkbox' }
        ]
    },
    {
        title: 'Stream',
        controls: [
            { key: 'codec', label: 'Codec', type: 'select', options: [['adaptive', 'Adaptive'], ['legacy', 'Legacy raw']] },
            { key: 'codecQuality', label: 'Codec quality', type: 'select', options: [['lossless', 'Lossless'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Low']] },
            { key: 'codecTolerance', label: 'Tolerance', type: 'range', min: 0, max: 32, step: 1 },
            { key: 'bufferSize', label: 'Buffer size', type: 'range', min: 1, max: 20, step: 1 },
            { key: 'maxBufferMultiplier', label: 'Max buffer x', type: 'range', min: 1, max: 12, step: 1 },
            { key: 'lateDropThreshold', label: 'Late drop', type: 'range', min: 0, max: 0.5, step: 0.01, unit: 's' },
            { key: 'futureWaitThreshold', label: 'Future wait', type: 'range', min: 0, max: 0.5, step: 0.01, unit: 's' },
            { key: 'fpsCap', label: 'Server FPS cap', type: 'range', min: 1, max: 60, step: 1 }
        ]
    },
    {
        title: 'Glyph / Cell',
        controls: [
            { key: 'glyphMode', label: 'Glyph mode', type: 'checkbox' },
            { key: 'solidMode', label: 'Solid mode', type: 'checkbox' },
            { key: 'charset', label: 'Character set', type: 'select', options: [['point-click', 'Point & Click'], ['asciline', 'ASCILINE'], ['blocks', 'Blocks']] },
            { key: 'fontFamily', label: 'Font family', type: 'select', options: [['Courier New', 'Courier New'], ['monospace', 'Monospace'], ['Menlo', 'Menlo'], ['Consolas', 'Consolas']] },
            { key: 'minGlyphIntensity', label: 'Min glyph intensity', type: 'range', min: 0, max: 255, step: 1 }
        ]
    }
];

const CLIENT_TWEEN_KEYS = new Set([
    'saturationBoost',
    'contrastBoost',
    'brightness',
    'gamma',
    'bgBlend',
    'jitterAmount',
    'jitterSpeed',
    'sampleX',
    'sampleY',
    'volume',
    'lateDropThreshold',
    'futureWaitThreshold',
    'codecTolerance'
]);

const STRUCTURAL_KEYS = new Set([
    'sourceMode',
    'backend',
    'mediaUrl',
    'mediaType',
    'cols',
    'rows',
    'autoRows',
    'cellWidth',
    'cellHeight',
    'aspectCorrection',
    'mode',
    'pixel',
    'solidMode',
    'glyphMode',
    'fontFamily'
]);

const STREAM_REINIT_KEYS = new Set(['cols', 'rows', 'autoRows', 'mode', 'pixel', 'fpsCap']);
const STREAM_CONTROL_KEYS = new Set(['codecQuality', 'codecTolerance', ...STREAM_REINIT_KEYS]);
const STATIC_REBUILD_KEYS = new Set([
    'backend',
    'mediaUrl',
    'mediaType',
    'cameraDeviceId',
    'cameraFacingMode',
    'cameraResolution',
    'cameraFps',
    'cols',
    'rows',
    'autoRows',
    'cellWidth',
    'cellHeight',
    'aspectCorrection',
    'pixel',
    'solidMode',
    'glyphMode',
    'fontFamily'
]);
const STATIC_SOURCE_KEYS = new Set(['sourceMode', 'mediaUrl', 'mediaType', 'cameraDeviceId', 'cameraFacingMode', 'cameraResolution', 'cameraFps']);
const CAMERA_SOURCE_PARAM_KEYS = new Set(['cameraDeviceId', 'cameraFacingMode', 'cameraResolution', 'cameraFps', 'cameraMirror']);
const SOURCE_PARAM_KEYS = new Set(['sourceMode', 'mediaUrl', 'mediaType', 'sourceName', ...CAMERA_SOURCE_PARAM_KEYS]);
const STATIC_GPU_BACKENDS = new Set(['auto', 'webgpu', 'webgl2']);
const STATIC_CANVAS_BACKENDS = new Set(['canvas2d', 'pixel-canvas']);

const CONTROL_APPLIES = {
    transitionSeconds: () => true,
    volume: ({ params }) => params.sourceMode === 'stream' || isLikelyVideo(params),
    loop: ({ params }) => isLikelyVideo(params),
    muted: ({ params }) => isLikelyVideo(params),
    statsOverlay: () => true,

    cols: () => true,
    autoRows: () => true,
    rows: ({ params }) => !params.autoRows,
    cellWidth: ({ params }) => params.sourceMode === 'static' || !params.pixel,
    cellHeight: ({ params }) => params.sourceMode === 'static' || !params.pixel,
    aspectCorrection: ({ params }) => params.sourceMode === 'static',

    saturationBoost: ({ params }) => params.sourceMode === 'static' || params.mode > 1 || params.pixel,
    contrastBoost: ({ params }) => params.sourceMode === 'static' || params.mode > 1 || params.pixel,
    brightness: ({ params }) => params.sourceMode === 'static' || params.mode > 1 || params.pixel,
    gamma: ({ params }) => params.sourceMode === 'static' || params.mode > 1 || params.pixel,
    bgBlend: ({ params }) => params.sourceMode === 'static',
    quantizeBits: ({ params }) => params.sourceMode === 'static' || params.mode > 1 || params.pixel,
    mode: ({ params }) => params.sourceMode === 'stream',
    pixel: ({ params }) => params.sourceMode === 'stream',

    fps: ({ params }) => params.sourceMode === 'static',
    jitterAmount: ({ params, kind }) => params.sourceMode === 'static' && kind === 'gpu',
    jitterSpeed: ({ params, kind }) => params.sourceMode === 'static' && kind === 'gpu',
    sampleX: ({ params, kind }) => params.sourceMode === 'static' && kind === 'gpu',
    sampleY: ({ params, kind }) => params.sourceMode === 'static' && kind === 'gpu',
    smoothing: ({ params }) => params.sourceMode === 'static',

    cameraDeviceId: ({ params }) => isCameraParams(params),
    cameraFacingMode: ({ params }) => isCameraParams(params),
    cameraResolution: ({ params }) => isCameraParams(params),
    cameraFps: ({ params }) => isCameraParams(params),
    cameraMirror: ({ params }) => isCameraParams(params),

    codec: ({ params }) => params.sourceMode === 'stream',
    codecQuality: ({ params }) => params.sourceMode === 'stream' && params.codec === 'adaptive',
    codecTolerance: ({ params }) => params.sourceMode === 'stream' && params.codec === 'adaptive',
    bufferSize: ({ params }) => params.sourceMode === 'stream',
    maxBufferMultiplier: ({ params }) => params.sourceMode === 'stream',
    lateDropThreshold: ({ params }) => params.sourceMode === 'stream',
    futureWaitThreshold: ({ params }) => params.sourceMode === 'stream',
    fpsCap: ({ params }) => params.sourceMode === 'stream',

    glyphMode: ({ params, kind }) => kind !== 'gpu' && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    solidMode: ({ params, kind }) => kind !== 'gpu' && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    charset: ({ params, kind }) => kind !== 'gpu' && params.glyphMode && !params.solidMode && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    fontFamily: ({ params, kind }) => kind !== 'gpu' && params.glyphMode && !params.solidMode && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    minGlyphIntensity: () => false
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function randomInt(min, max) {
    return Math.round(randomBetween(min, max));
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function randomBool(probability = 0.5) {
    return Math.random() < probability;
}

function snapToStep(value, step = 1) {
    const safeStep = Number(step) || 1;
    return Math.round(value / safeStep) * safeStep;
}

function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function crossfadeOut(t) {
    return Math.pow(1 - clamp(t, 0, 1), 1.45);
}

function parseStoredJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function openCustomHandleDb(mode = 'readonly') {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB is unavailable'));
            return;
        }
        const request = indexedDB.open(CUSTOM_HANDLE_DB, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(CUSTOM_HANDLE_STORE);
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
        request.onsuccess = () => {
            const db = request.result;
            resolve({ db, transaction: db.transaction(CUSTOM_HANDLE_STORE, mode) });
        };
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

async function loadCustomFileHandle() {
    try {
        const { db, transaction } = await openCustomHandleDb('readonly');
        const request = transaction.objectStore(CUSTOM_HANDLE_STORE).get(CUSTOM_HANDLE_ID);
        const handle = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        db.close();
        return handle;
    } catch {
        return null;
    }
}

async function saveCustomFileHandle(handle) {
    try {
        const { db, transaction } = await openCustomHandleDb('readwrite');
        transaction.objectStore(CUSTOM_HANDLE_STORE).put(handle, CUSTOM_HANDLE_ID);
        await transactionDone(transaction);
        db.close();
        return true;
    } catch {
        return false;
    }
}

function findSourcePreset(mediaUrl, mediaType) {
    return SOURCE_PRESETS.find((preset) =>
        preset.mediaUrl === mediaUrl && (!mediaType || mediaType === 'auto' || preset.mediaType === mediaType)
    );
}

function isCameraUrl(url) {
    return String(url || '').startsWith('camera://');
}

function isCameraParams(params) {
    return params?.sourceMode === 'static' && params?.mediaType === 'camera';
}

function normalizeParams(params, options = {}) {
    const { preserveBlob = false } = options;
    const out = { ...DEFAULT_PARAMS, ...params };
    let hasRuntimeBlob = String(out.mediaUrl || '').startsWith('blob:');
    if (hasRuntimeBlob && !preserveBlob) {
        out.mediaUrl = DEFAULT_PARAMS.mediaUrl;
        out.mediaType = DEFAULT_PARAMS.mediaType;
        out.sourceName = DEFAULT_PARAMS.sourceName;
        hasRuntimeBlob = false;
    }
    if (isCameraUrl(out.mediaUrl)) {
        out.mediaUrl = CAMERA_MEDIA_URL;
        out.mediaType = 'camera';
        out.sourceName = out.sourceName || 'Camera';
    }
    if (out.mediaUrl === 'media/point-click-test.mp4' && (!out.sourceName || out.sourceName === 'Demo Video 1' || out.sourceName === 'Point and Click Test')) {
        out.mediaUrl = DEFAULT_PARAMS.mediaUrl;
        out.mediaType = DEFAULT_PARAMS.mediaType;
        out.sourceName = DEFAULT_PARAMS.sourceName;
    }
    if (!['auto', 'image', 'video', 'camera'].includes(out.mediaType)) out.mediaType = mediaTypeFromName(out.mediaUrl);
    const matchedSource = hasRuntimeBlob ? null : findSourcePreset(out.mediaUrl, out.mediaType);
    if (matchedSource && out.mediaType === 'auto') out.mediaType = matchedSource.mediaType;
    out.sourceName = isCameraUrl(out.mediaUrl) ? 'Camera' : matchedSource?.name || out.sourceName || sourceNameFromUrl(out.mediaUrl);
    out.mode = Number(out.mode);
    out.cols = Number(out.cols);
    out.rows = Number(out.rows);
    out.cellWidth = Number(out.cellWidth);
    out.cellHeight = Number(out.cellHeight);
    out.cameraDeviceId = String(out.cameraDeviceId || '');
    if (!['any', 'user', 'environment'].includes(out.cameraFacingMode)) out.cameraFacingMode = 'any';
    if (!CAMERA_RESOLUTION_OPTIONS.some(([value]) => value === out.cameraResolution)) out.cameraResolution = 'auto';
    out.cameraFps = clamp(Number(out.cameraFps || DEFAULT_PARAMS.cameraFps), 1, 60);
    out.cameraMirror = Boolean(out.cameraMirror);
    out.codecTolerance = CODEC_TOLERANCE[out.codecQuality] ?? Number(out.codecTolerance || 0);
    return out;
}

function sourceNameFromUrl(url) {
    if (isCameraUrl(url)) return 'Camera';
    const match = findSourcePreset(url);
    if (match) return match.name;
    try {
        const path = new URL(url, location.href).pathname;
        const name = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
        return name || 'Custom media';
    } catch {
        return String(url || '').split('/').pop() || 'Custom media';
    }
}

function mediaTypeFromName(name) {
    if (isCameraUrl(name)) return 'camera';
    return detectMediaType(String(name || ''));
}

function mediaTypeFromFile(file) {
    if (file.type?.startsWith('video/')) return 'video';
    if (file.type?.startsWith('image/')) return 'image';
    return mediaTypeFromName(file.name);
}

function parseCameraResolution(value) {
    const match = String(value || '').match(/^(\d+)x(\d+)$/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function cameraConstraintKey(params) {
    return stableJson({
        deviceId: params.cameraDeviceId || '',
        facingMode: params.cameraFacingMode || 'any',
        resolution: params.cameraResolution || 'auto',
        fps: Math.round(Number(params.cameraFps || DEFAULT_PARAMS.cameraFps))
    });
}

function cameraConstraintsFromParams(params) {
    const video = {};
    if (params.cameraDeviceId) {
        video.deviceId = { exact: params.cameraDeviceId };
    } else if (params.cameraFacingMode && params.cameraFacingMode !== 'any') {
        video.facingMode = { ideal: params.cameraFacingMode };
    }

    const resolution = parseCameraResolution(params.cameraResolution);
    if (resolution) {
        video.width = { ideal: resolution.width };
        video.height = { ideal: resolution.height };
    }

    const frameRate = clamp(Math.round(Number(params.cameraFps || DEFAULT_PARAMS.cameraFps)), 1, 60);
    video.frameRate = { ideal: frameRate, max: frameRate };
    return { audio: false, video: Object.keys(video).length ? video : true };
}

function cameraErrorStatus(error) {
    if (!navigator.mediaDevices?.getUserMedia) return { status: 'unsupported', message: 'Camera unsupported' };
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return { status: 'denied', message: 'Camera denied' };
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return { status: 'missing', message: 'No camera found' };
    return { status: 'error', message: error?.message || 'Camera failed' };
}

function fileSizeLabel(size) {
    if (!Number.isFinite(size) || size <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const digits = value >= 10 || unit === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unit]}`;
}

function customSourceMetaFromFile(file) {
    return {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type || '',
        mediaType: mediaTypeFromFile(file)
    };
}

function persistedParams(params) {
    if (!String(params.mediaUrl || '').startsWith('blob:') && !isCameraParams(params)) return params;
    return {
        ...params,
        mediaUrl: DEFAULT_PARAMS.mediaUrl,
        mediaType: DEFAULT_PARAMS.mediaType,
        sourceName: DEFAULT_PARAMS.sourceName,
        cameraDeviceId: DEFAULT_PARAMS.cameraDeviceId,
        cameraFacingMode: DEFAULT_PARAMS.cameraFacingMode,
        cameraResolution: DEFAULT_PARAMS.cameraResolution,
        cameraFps: DEFAULT_PARAMS.cameraFps
    };
}

function stripSourceParams(params) {
    const out = clone(params || {});
    for (const key of SOURCE_PARAM_KEYS) delete out[key];
    return out;
}

function renderPresetParams(params) {
    return stripSourceParams(persistedParams(params));
}

function forcedMediaType(params) {
    if (params.mediaType === 'camera') return 'camera';
    return params.mediaType === 'auto' ? undefined : params.mediaType;
}

function isLikelyVideo(params) {
    if (params.sourceMode !== 'static') return false;
    if (params.mediaType === 'camera') return false;
    if (params.mediaType === 'video') return true;
    if (params.mediaType === 'image') return false;
    return detectMediaType(params.mediaUrl) === 'video';
}

function backendKind(params) {
    if (params.sourceMode === 'stream') return 'stream';
    if (STATIC_CANVAS_BACKENDS.has(params.backend)) return 'canvas';
    if (STATIC_GPU_BACKENDS.has(params.backend)) return 'gpu';
    return 'gpu';
}

function usesPixelCanvas(params) {
    return Boolean(params?.pixel || params?.backend === 'pixel-canvas');
}

function videoElementFromSource(source) {
    const element = source?.element;
    return source?.isVideo && element?.tagName === 'VIDEO' ? element : null;
}

function captureVideoPlaybackState(source, params, nextParams = params) {
    if (params.sourceMode !== 'static' || nextParams.sourceMode !== 'static') return null;
    if (params.mediaType === 'camera' || nextParams.mediaType === 'camera') return null;
    if (params.mediaUrl !== nextParams.mediaUrl || params.mediaType !== nextParams.mediaType) return null;
    const video = videoElementFromSource(source);
    if (!video) return null;
    return {
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType,
        currentTime: video.currentTime || 0,
        paused: video.paused,
        ended: video.ended,
        playbackRate: video.playbackRate || 1,
        muted: video.muted,
        loop: video.loop,
        volume: video.volume,
        capturedAt: performance.now()
    };
}

function seekVideo(video, currentTime) {
    if (!Number.isFinite(currentTime)) return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            video.removeEventListener('seeked', finish);
            resolve();
        };
        const timeout = setTimeout(finish, 1200);
        video.addEventListener('seeked', finish, { once: true });
        try {
            video.currentTime = Math.max(0, currentTime);
            if (!video.seeking && Math.abs(video.currentTime - currentTime) < 0.05) finish();
        } catch {
            finish();
        }
    });
}

async function playVideoWithMutedFallback(video, params, allowMutedFallback = true) {
    if (!video || !params) return { started: false, mutedFallback: false };
    if (!video.paused && !video.ended) return { started: true, mutedFallback: false };

    const playback = await tryPlayVideo(video);
    if (playback.started) return { started: true, mutedFallback: false, timedOut: playback.timedOut };
    if (playback.timedOut || !allowMutedFallback || video.muted) {
        return { started: false, mutedFallback: false, timedOut: playback.timedOut, error: playback.error };
    }

    video.muted = true;
    params.muted = true;
    const mutedPlayback = await tryPlayVideo(video);
    return {
        started: mutedPlayback.started,
        mutedFallback: true,
        timedOut: mutedPlayback.timedOut,
        error: mutedPlayback.error
    };
}

function tryPlayVideo(video, timeoutMs = VIDEO_PLAY_TIMEOUT_MS) {
    let playPromise;
    try {
        playPromise = video.play();
    } catch (error) {
        return Promise.resolve({ started: false, timedOut: false, error });
    }

    if (!playPromise || typeof playPromise.then !== 'function') {
        return Promise.resolve({ started: !video.paused && !video.ended, timedOut: false });
    }

    let timeoutId = 0;
    return Promise.race([
        playPromise.then(
            () => ({ started: true, timedOut: false }),
            (error) => ({ started: false, timedOut: false, error })
        ),
        new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                resolve({ started: !video.paused && !video.ended, timedOut: true });
            }, timeoutMs);
        })
    ]).finally(() => clearTimeout(timeoutId));
}

function settleWithTimeout(promise, timeoutMs) {
    let timeoutId = 0;
    const guarded = Promise.resolve(promise).catch(() => undefined);
    return Promise.race([
        guarded,
        new Promise((resolve) => {
            timeoutId = setTimeout(resolve, timeoutMs);
        })
    ]).finally(() => clearTimeout(timeoutId));
}

async function restoreVideoPlaybackState(source, params, state) {
    const video = videoElementFromSource(source);
    if (!video) return { mutedFallback: false };

    video.volume = params.volume;
    video.muted = params.muted;
    video.loop = params.loop;

    if (!state || state.mediaUrl !== params.mediaUrl || state.mediaType !== params.mediaType) {
        return playVideoWithMutedFallback(video, params);
    }

    video.playbackRate = state.playbackRate;
    const elapsed = state.paused || state.ended ? 0 : (performance.now() - state.capturedAt) / 1000;
    let targetTime = state.currentTime + elapsed;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0) {
        targetTime = video.loop ? targetTime % duration : Math.min(targetTime, Math.max(0, duration - 0.05));
    }
    await seekVideo(video, targetTime);

    if (state.paused || state.ended) {
        video.pause();
        return { mutedFallback: false };
    } else {
        return playVideoWithMutedFallback(video, params);
    }
}

function computeRows(params, sourceW = 16, sourceH = 9, pixelMode = false) {
    if (!params.autoRows && params.rows > 0) return Math.max(1, Math.round(params.rows));
    const ratio = sourceW / Math.max(sourceH, 1);
    if (pixelMode || params.solidMode) return Math.max(1, Math.round(params.cols / ratio * params.aspectCorrection));
    return Math.max(1, Math.round(params.cols / ratio * (params.cellWidth / params.cellHeight) * params.aspectCorrection));
}

function processColor(r, g, b, params) {
    let rr = r / 255;
    let gg = g / 255;
    let bb = b / 255;
    const avg = (rr + gg + bb) / 3;
    rr = clamp(avg + (rr - avg) * params.saturationBoost, 0, 1);
    gg = clamp(avg + (gg - avg) * params.saturationBoost, 0, 1);
    bb = clamp(avg + (bb - avg) * params.saturationBoost, 0, 1);
    rr = clamp((rr - 0.5) * params.contrastBoost + 0.5, 0, 1);
    gg = clamp((gg - 0.5) * params.contrastBoost + 0.5, 0, 1);
    bb = clamp((bb - 0.5) * params.contrastBoost + 0.5, 0, 1);
    rr = clamp(Math.pow(rr * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);
    gg = clamp(Math.pow(gg * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);
    bb = clamp(Math.pow(bb * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);
    if (params.quantizeBits > 0) {
        const mask = 255 << params.quantizeBits & 255;
        return [
            (Math.round(rr * 255) & mask),
            (Math.round(gg * 255) & mask),
            (Math.round(bb * 255) & mask)
        ];
    }
    return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)];
}

function shaderHash(x, y) {
    let p3x = fract(x * 0.1031);
    let p3y = fract(y * 0.1031);
    let p3z = fract(x * 0.1031);
    const dot = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += dot;
    p3y += dot;
    p3z += dot;
    return fract((p3x + p3y) * p3z);
}

function fract(value) {
    return value - Math.floor(value);
}

function processGpuCellColor(r, g, b, params) {
    let rr = r / 255;
    let gg = g / 255;
    let bb = b / 255;
    const avg = (rr + gg + bb) / 3;
    rr = clamp(avg + (rr - avg) * params.saturationBoost, 0, 1);
    gg = clamp(avg + (gg - avg) * params.saturationBoost, 0, 1);
    bb = clamp(avg + (bb - avg) * params.saturationBoost, 0, 1);
    rr = clamp((rr - 0.5) * params.contrastBoost + 0.5, 0, 1);
    gg = clamp((gg - 0.5) * params.contrastBoost + 0.5, 0, 1);
    bb = clamp((bb - 0.5) * params.contrastBoost + 0.5, 0, 1);
    rr = clamp(Math.pow(rr * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);
    gg = clamp(Math.pow(gg * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);
    bb = clamp(Math.pow(bb * params.brightness, 1 / Math.max(0.01, params.gamma)), 0, 1);

    const quantizeBits = Math.max(0, Math.round(params.quantizeBits || 0));
    if (quantizeBits > 0) {
        const quantum = Math.pow(2, quantizeBits);
        rr = Math.floor(rr * 255 / quantum) * quantum / 255;
        gg = Math.floor(gg * 255 / quantum) * quantum / 255;
        bb = Math.floor(bb * 255 / quantum) * quantum / 255;
    }

    const bgBlend = clamp(params.bgBlend || 0, 0, 1);
    rr = rr * (1 - bgBlend) + (3 / 255) * bgBlend;
    gg = gg * (1 - bgBlend) + (4 / 255) * bgBlend;
    bb = bb * (1 - bgBlend) + (5 / 255) * bgBlend;
    return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)];
}

function renderSoftwareCellSnapshot(source, params, targetWidth, targetHeight, frameCount = 0, options = {}) {
    const sourceElement = source?.canvas || source?.element || source;
    const sourceWidth = sourceElement?.videoWidth || sourceElement?.naturalWidth || sourceElement?.width || source?.width || 0;
    const sourceHeight = sourceElement?.videoHeight || sourceElement?.naturalHeight || sourceElement?.height || source?.height || 0;
    if (!sourceElement || sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return null;

    let cols = Math.max(1, Math.round(params.cols || DEFAULT_PARAMS.cols));
    let rows = computeRows(params, sourceWidth, sourceHeight, usesPixelCanvas(params));
    const maxCells = options.maxCells || Infinity;
    if (Number.isFinite(maxCells) && cols * rows > maxCells) {
        const scale = Math.sqrt(maxCells / (cols * rows));
        cols = Math.max(1, Math.round(cols * scale));
        rows = Math.max(1, Math.round(rows * scale));
    }
    const sampleLimit = options.sampleLimit || 1600;
    const sampleScale = Math.min(1, sampleLimit / Math.max(sourceWidth, sourceHeight));
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleCtx.drawImage(sourceElement, 0, 0, sampleWidth, sampleHeight);
    const sourcePixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;

    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = cols;
    gridCanvas.height = rows;
    const gridCtx = gridCanvas.getContext('2d');
    const gridImage = gridCtx.createImageData(cols, rows);
    const gridPixels = gridImage.data;
    const time = frameCount / Math.max(1, params.fps || DEFAULT_PARAMS.fps);
    const sourceCellWidth = sourceWidth / cols;
    const sourceCellHeight = sourceHeight / rows;
    const jitterAmount = params.jitterAmount || 0;
    const jitterSpeed = params.jitterSpeed || 0;
    const sampleXOffset = params.sampleX ?? 0.5;
    const sampleYOffset = params.sampleY ?? 0.5;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const seedX = col + time * jitterSpeed * 7.13;
            const seedY = row + time * jitterSpeed * 11.71;
            const jitterX = (shaderHash(seedX, seedY) - 0.5) * sourceCellWidth * jitterAmount;
            const jitterY = (shaderHash(seedX + 37, seedY + 91) - 0.5) * sourceCellHeight * jitterAmount;
            let sourceX = clamp(Math.trunc((col + sampleXOffset) * sourceWidth / cols + jitterX), 0, sourceWidth - 1);
            if (params.mediaType === 'camera' && params.cameraMirror) sourceX = sourceWidth - 1 - sourceX;
            const sourceY = clamp(Math.trunc((row + sampleYOffset) * sourceHeight / rows + jitterY), 0, sourceHeight - 1);
            const sx = clamp(Math.trunc(sourceX * sampleWidth / sourceWidth), 0, sampleWidth - 1);
            const sy = clamp(Math.trunc(sourceY * sampleHeight / sourceHeight), 0, sampleHeight - 1);
            const srcIndex = (sy * sampleWidth + sx) * 4;
            const [r, g, b] = processGpuCellColor(sourcePixels[srcIndex], sourcePixels[srcIndex + 1], sourcePixels[srcIndex + 2], params);
            const dstIndex = (row * cols + col) * 4;
            gridPixels[dstIndex] = r;
            gridPixels[dstIndex + 1] = g;
            gridPixels[dstIndex + 2] = b;
            gridPixels[dstIndex + 3] = 255;
        }
    }
    gridCtx.putImageData(gridImage, 0, 0);

    const renderWidth = Math.max(1, cols * Math.max(1, Math.round(params.cellWidth || DEFAULT_PARAMS.cellWidth)));
    const renderHeight = Math.max(1, rows * Math.max(1, Math.round(params.cellHeight || DEFAULT_PARAMS.cellHeight)));
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = renderWidth;
    renderCanvas.height = renderHeight;
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    renderCtx.fillStyle = '#030405';
    renderCtx.fillRect(0, 0, renderWidth, renderHeight);
    renderCtx.imageSmoothingEnabled = false;
    renderCtx.drawImage(gridCanvas, 0, 0, renderWidth, renderHeight);

    const snapshot = document.createElement('canvas');
    snapshot.width = targetWidth;
    snapshot.height = targetHeight;
    const snapshotCtx = snapshot.getContext('2d', { alpha: true });
    const scale = Math.min(targetWidth / renderWidth, targetHeight / renderHeight);
    const drawWidth = Math.max(1, Math.floor(renderWidth * scale));
    const drawHeight = Math.max(1, Math.floor(renderHeight * scale));
    const dx = Math.floor((targetWidth - drawWidth) / 2);
    const dy = Math.floor((targetHeight - drawHeight) / 2);
    snapshotCtx.fillStyle = '#030405';
    snapshotCtx.fillRect(0, 0, targetWidth, targetHeight);
    snapshotCtx.imageSmoothingEnabled = Boolean(params.smoothing);
    snapshotCtx.drawImage(renderCanvas, dx, dy, drawWidth, drawHeight);
    return snapshot;
}

function charsetChars(params) {
    if (params.charset === 'blocks') return ' ░▒▓█';
    if (params.charset === 'asciline') return ' .:-=+*#%@';
    return ASCII_CHARS;
}

function glyphForLuma(luma, params) {
    const chars = charsetChars(params);
    const idx = Math.min(chars.length - 1, Math.floor(luma / 256 * chars.length));
    return chars[idx] || ' ';
}

function cssFilter(params) {
    return `brightness(${params.brightness}) contrast(${params.contrastBoost}) saturate(${params.saturationBoost})`;
}

function canvasHasVisibleSignal(canvas) {
    if (!canvas?.width || !canvas?.height) return false;
    const sample = document.createElement('canvas');
    sample.width = Math.min(120, canvas.width);
    sample.height = Math.min(90, canvas.height);
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    try {
        ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
        const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
        let maxLuma = 0;
        let sumLuma = 0;
        let visiblePixels = 0;
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            maxLuma = Math.max(maxLuma, luma);
            sumLuma += luma;
            if (luma > 10) visiblePixels++;
        }
        const totalPixels = data.length / 4;
        const avgLuma = sumLuma / Math.max(1, totalPixels);
        const visibleRatio = visiblePixels / Math.max(1, totalPixels);
        return maxLuma > 28 && (avgLuma > 1.5 || visibleRatio > 0.0025);
    } catch {
        return false;
    }
}

function canvasHasSafeVisualSignal(canvas) {
    if (!canvas?.width || !canvas?.height) return false;
    const sample = document.createElement('canvas');
    sample.width = Math.min(120, canvas.width);
    sample.height = Math.min(90, canvas.height);
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    try {
        ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
        const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
        let minLuma = 255;
        let maxLuma = 0;
        let sumLuma = 0;
        let sumLumaSquared = 0;
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            minLuma = Math.min(minLuma, luma);
            maxLuma = Math.max(maxLuma, luma);
            sumLuma += luma;
            sumLumaSquared += luma * luma;
        }
        const total = Math.max(1, data.length / 4);
        const avg = sumLuma / total;
        const variance = Math.max(0, sumLumaSquared / total - avg * avg);
        return maxLuma > 28 && avg > 3 && avg < 248 && (maxLuma - minLuma > 14 || variance > 24);
    } catch {
        return false;
    }
}

class CanvasStaticRenderer {
    constructor(targetElement) {
        this.targetElement = targetElement;
        this.document = targetElement.ownerDocument || document;
        this.window = this.document.defaultView || window;
        this.canvas = null;
        this.ctx = null;
        this.offscreen = this.document.createElement('canvas');
        this.offctx = this.offscreen.getContext('2d', { willReadFrequently: true });
        this.source = null;
        this.params = null;
        this.running = false;
        this.raf = null;
        this.lastFrame = 0;
        this.rows = 0;
        this.frameCount = 0;
        this.fpsFrameCount = 0;
        this.lastFpsUpdate = 0;
        this.currentFps = 0;
        this.ownsSource = true;
    }

    async start(params, options = {}) {
        this.params = { ...params };
        this.ownsSource = options.ownsSource !== false;
        this.source = options.source || await loadMediaSource(params.mediaUrl, {
            type: forcedMediaType(params),
            loop: params.loop,
            muted: params.muted
        });
        this.canvas = this.document.createElement('canvas');
        this.canvas.className = 'ascii-canvas';
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.targetElement.innerHTML = '';
        this.targetElement.appendChild(this.canvas);
        this._configureCanvas();
        if (this.source.isVideo) {
            const playback = await restoreVideoPlaybackState(this.source, params, options.mediaState);
            if (playback?.mutedFallback) this.params.muted = true;
        }
        this.running = true;
        this._loop = this._loop.bind(this);
        this.raf = this.window.requestAnimationFrame(this._loop);
    }

    updateParams(params) {
        const needsResize = params.cols !== this.params.cols ||
            params.rows !== this.params.rows ||
            params.autoRows !== this.params.autoRows ||
            params.backend !== this.params.backend ||
            params.cellWidth !== this.params.cellWidth ||
            params.cellHeight !== this.params.cellHeight ||
            params.pixel !== this.params.pixel ||
            params.solidMode !== this.params.solidMode;
        this.params = { ...params };
        if (this.source?.element) {
            this.source.element.volume = params.volume;
            this.source.element.muted = params.muted;
            this.source.element.loop = params.loop;
        }
        if (needsResize) this._configureCanvas();
    }

    _configureCanvas() {
        const sw = this.source?.width || 640;
        const sh = this.source?.height || 360;
        this.rows = computeRows(this.params, sw, sh, usesPixelCanvas(this.params));
        this.canvas.width = this.params.cols * this.params.cellWidth;
        this.canvas.height = this.rows * this.params.cellHeight;
        this.canvas.style.aspectRatio = `${sw} / ${sh}`;
        this.canvas.style.filter = 'none';
        this.canvas.style.imageRendering = this.params.smoothing ? 'auto' : 'pixelated';
        this.offscreen.width = this.params.cols;
        this.offscreen.height = this.rows;
    }

    _loop(ts) {
        if (!this.running) return;
        const interval = 1000 / Math.max(1, this.params.fps);
        if (ts - this.lastFrame >= interval) {
            const beforeFrame = this.frameCount;
            this.renderFrame();
            if (this.frameCount !== beforeFrame) this._recordFrame(ts);
            this.lastFrame = ts;
        }
        this.raf = this.window.requestAnimationFrame(this._loop);
    }

    _recordFrame(ts) {
        this.fpsFrameCount++;
        if (!this.lastFpsUpdate) {
            this.lastFpsUpdate = ts;
            return;
        }
        const elapsed = ts - this.lastFpsUpdate;
        if (elapsed >= 1000) {
            this.currentFps = this.fpsFrameCount * 1000 / elapsed;
            this.fpsFrameCount = 0;
            this.lastFpsUpdate = ts;
        }
    }

    renderFrame() {
        const sourceEl = this.source.canvas || this.source.element;
        if (!sourceEl) return;
        try {
            if (this.params.mediaType === 'camera' && this.params.cameraMirror) {
                this.offctx.save();
                this.offctx.translate(this.params.cols, 0);
                this.offctx.scale(-1, 1);
                this.offctx.drawImage(sourceEl, 0, 0, this.params.cols, this.rows);
                this.offctx.restore();
            } else {
                this.offctx.drawImage(sourceEl, 0, 0, this.params.cols, this.rows);
            }
        } catch {
            return;
        }
        const img = this.offctx.getImageData(0, 0, this.params.cols, this.rows);
        const data = img.data;
        const ctx = this.ctx;
        ctx.fillStyle = '#030405';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.textBaseline = 'top';
        ctx.font = `bold ${Math.max(1, this.params.cellHeight)}px ${this.params.fontFamily}, monospace`;
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.params.cols; x++) {
                const i = (y * this.params.cols + x) * 4;
                const [r, g, b] = processColor(data[i], data[i + 1], data[i + 2], this.params);
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                if (usesPixelCanvas(this.params) || this.params.solidMode || !this.params.glyphMode) {
                    ctx.fillRect(x * this.params.cellWidth, y * this.params.cellHeight, this.params.cellWidth, this.params.cellHeight);
                } else {
                    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    ctx.fillText(glyphForLuma(luma, this.params), x * this.params.cellWidth, y * this.params.cellHeight);
                }
            }
        }
        this.frameCount++;
    }

    getStats() {
        return {
            backend: usesPixelCanvas(this.params) || this.params.solidMode ? 'pixel-canvas' : 'canvas2d',
            sourceType: this.source?.type || 'static',
            cols: this.params.cols,
            rows: this.rows,
            fps: this.params.fps,
            currentFps: this.currentFps,
            canvasSize: this.canvas ? `${this.canvas.width}x${this.canvas.height}` : '-'
        };
    }

    destroy() {
        this.running = false;
        if (this.raf) this.window.cancelAnimationFrame(this.raf);
        if (this.ownsSource) this.source?.destroy?.();
        this.targetElement.innerHTML = '';
    }
}

class StaticRuntime {
    constructor(app) {
        this.app = app;
        this.renderer = null;
        this.source = null;
        this.usingCanvasFallback = false;
        this.mediaUrl = null;
        this.mediaType = null;
    }

    _makeRendererLayer(className = 'renderer-buffer-current') {
        const layer = document.createElement('div');
        layer.className = `renderer-buffer-layer ${className}`;
        els.gpuStage.appendChild(layer);
        return layer;
    }

    _ensureCurrentRendererLayer() {
        const canvas = this.renderer?.canvas || els.gpuStage.querySelector('canvas');
        const parent = canvas?.parentElement;
        if (parent?.classList.contains('renderer-buffer-layer')) return parent;

        const layer = this._makeRendererLayer('renderer-buffer-current');
        while (els.gpuStage.firstChild && els.gpuStage.firstChild !== layer) {
            layer.appendChild(els.gpuStage.firstChild);
        }
        return layer;
    }

    _rendererOptions(params, targetElement) {
        const preferredBackend = params.backend === 'auto' ? undefined : params.backend;
        return {
            source: this.source,
            targetElement,
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
            mirrorX: params.mediaType === 'camera' && params.cameraMirror,
            preserveDrawingBuffer: true,
            preferredBackend
        };
    }

    _applyRendererParams(renderer, params) {
        if (!renderer) return;
        if (renderer instanceof CanvasStaticRenderer) {
            renderer.updateParams(params);
            return;
        }
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
        renderer.frameInterval = 1000 / Math.max(1, params.fps);
        renderer.smoothing = params.smoothing;
        renderer.cellWidth = params.cellWidth;
        renderer.cellHeight = params.cellHeight;
        renderer.mirrorX = params.mediaType === 'camera' && params.cameraMirror;
        if (renderer._applySourceSmoothing) renderer._applySourceSmoothing();
        if (renderer.canvas) {
            renderer.canvas.style.filter = 'none';
            renderer.canvas.style.imageRendering = params.smoothing ? 'auto' : 'pixelated';
        }
        if (this.source?.element) {
            this.source.element.volume = params.volume;
            this.source.element.muted = params.muted;
            this.source.element.loop = params.loop;
        }
    }

    async start(params, options = {}) {
        this.destroy();
        els.gpuStage.classList.add('active');
        els.canvas.style.display = 'none';
        els.player.style.display = 'none';
        this.usingCanvasFallback = params.backend === 'canvas2d' || params.backend === 'pixel-canvas';
        const layer = this._makeRendererLayer('renderer-buffer-current');

        if (this.usingCanvasFallback) {
            const source = await this.app.loadStaticSource(params, options);
            const renderer = new CanvasStaticRenderer(layer);
            this.renderer = renderer;
            await renderer.start(params, { ...options, source, ownsSource: true });
            this.mediaUrl = params.mediaUrl;
            this.mediaType = params.mediaType;
            return renderer.getStats();
        }

        try {
            this.source = await this.app.loadStaticSource(params, options);
            this.mediaUrl = params.mediaUrl;
            this.mediaType = params.mediaType;
            const renderer = await createRenderer(this._rendererOptions(params, layer));
            this.renderer = renderer;
            if (this.source.isVideo) await restoreVideoPlaybackState(this.source, params, options.mediaState);
            renderer.start();
            this.updateParams(params);
            return renderer.getStats();
        } catch (error) {
            console.warn('[StaticRuntime] GPU renderer failed, falling back to canvas:', error);
            this.usingCanvasFallback = true;
            layer.innerHTML = '';
            const renderer = new CanvasStaticRenderer(layer);
            this.renderer = renderer;
            const source = this.source || await this.app.loadStaticSource(params, options);
            this.source = null;
            await renderer.start({ ...params, backend: 'canvas2d' }, { ...options, source, ownsSource: true });
            this.mediaUrl = params.mediaUrl;
            this.mediaType = params.mediaType;
            return renderer.getStats();
        }
    }

    canReuseSource(params) {
        return Boolean(
            params.sourceMode === 'static' &&
            this.source &&
            !this.usingCanvasFallback &&
            !(this.renderer instanceof CanvasStaticRenderer) &&
            this.mediaUrl === params.mediaUrl &&
            this.mediaType === params.mediaType &&
            params.backend !== 'canvas2d' &&
            params.backend !== 'pixel-canvas'
        );
    }

    async rebuildRenderer(params) {
        if (!this.canReuseSource(params)) {
            return this.start(params);
        }

        const oldLayer = this.renderer?.canvas?.parentElement;
        this.renderer?.stop?.();
        this.renderer?.destroy?.();
        oldLayer?.remove?.();

        const layer = this._makeRendererLayer('renderer-buffer-current');
        this.renderer = await createRenderer(this._rendererOptions(params, layer));
        this.renderer.start();
        this.updateParams(params);
        return this.renderer.getStats();
    }

    async prepareCrossfadeRenderer(params) {
        if (!this.canReuseSource(params)) return null;

        const oldRenderer = this.renderer;
        const oldLayer = this._ensureCurrentRendererLayer();
        oldLayer.classList.remove('renderer-buffer-current');
        oldLayer.classList.add('renderer-buffer-outgoing');
        oldLayer.style.zIndex = '2';
        oldLayer.style.opacity = '1';

        const nextLayer = this._makeRendererLayer('renderer-buffer-incoming');
        nextLayer.style.zIndex = '1';
        nextLayer.style.opacity = '1';
        els.gpuStage.insertBefore(nextLayer, oldLayer);

        const nextRenderer = await createRenderer(this._rendererOptions(params, nextLayer));
        nextRenderer.start();
        this._applyRendererParams(nextRenderer, params);
        this.renderer = nextRenderer;
        this.mediaUrl = params.mediaUrl;
        this.mediaType = params.mediaType;
        this.usingCanvasFallback = false;

        return {
            oldRenderer,
            oldLayer,
            nextRenderer,
            nextLayer,
            stats: nextRenderer.getStats?.() || null
        };
    }

    finishCrossfadeRenderer(prepared) {
        if (!prepared) return;
        prepared.oldRenderer?.stop?.();
        prepared.oldRenderer?.destroy?.();
        prepared.oldLayer?.remove?.();
        prepared.nextLayer?.classList.remove('renderer-buffer-incoming');
        prepared.nextLayer?.classList.add('renderer-buffer-current');
        if (prepared.nextLayer) {
            prepared.nextLayer.style.zIndex = '';
            prepared.nextLayer.style.opacity = '';
        }
    }

    cancelCrossfadeRenderer(prepared) {
        if (!prepared) return;
        prepared.nextRenderer?.stop?.();
        prepared.nextRenderer?.destroy?.();
        prepared.nextLayer?.remove?.();
        this.renderer = prepared.oldRenderer;
        prepared.oldLayer?.classList.remove('renderer-buffer-outgoing');
        prepared.oldLayer?.classList.add('renderer-buffer-current');
        if (prepared.oldLayer) {
            prepared.oldLayer.style.zIndex = '';
            prepared.oldLayer.style.opacity = '';
        }
    }

    updateParams(params) {
        if (!this.renderer) return;
        this._applyRendererParams(this.renderer, params);
    }

    getStats() {
        return this.renderer?.getStats?.() || null;
    }

    destroy() {
        this.renderer?.stop?.();
        this.renderer?.destroy?.();
        this.source?.destroy?.();
        this.renderer = null;
        this.source = null;
        this.mediaUrl = null;
        this.mediaType = null;
        els.gpuStage.innerHTML = '';
        els.gpuStage.classList.remove('active');
    }
}

class StreamRuntime {
    constructor(app) {
        this.app = app;
        this.ws = null;
        this.codecDecoder = null;
        this.frameBuffer = [];
        this.state = 'idle';
        this.ready = false;
        this.renderMode = 1;
        this.pixelMode = false;
        this.targetFps = 24;
        this.gridCols = 0;
        this.gridRows = 0;
        this.charWidth = 0;
        this.charHeight = 0;
        this.xPos = null;
        this.yPos = null;
        this.dotImageData = null;
        this.selectionBuffer = null;
        this.textDecoder = new TextDecoder();
        this.streamStartTime = 0;
        this.frameCount = 0;
        this.currentFps = 0;
        this.lastFpsUpdate = 0;
        this.raf = null;
        this.ctx = els.canvas.getContext('2d', { alpha: false });
        this.renderFrame = this.renderFrame.bind(this);
    }

    start(params, options = {}) {
        this.stop();
        els.gpuStage.classList.remove('active');
        els.gpuStage.innerHTML = '';
        els.canvas.style.display = 'block';
        this.state = 'connecting';
        this.frameBuffer.length = 0;
        this.frameCount = 0;
        this.currentFps = 0;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const codec = params.codec === 'adaptive' ? 'adaptive' : 'legacy';
        let autoFallbackStarted = false;
        const fallbackToStatic = () => {
            if (!options.autoStart || autoFallbackStarted) return false;
            autoFallbackStarted = true;
            this.app._fallbackToDefaultStatic();
            return true;
        };
        this.ws = new WebSocket(`${protocol}//${location.host}/ws?codec=${codec}`);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = () => {
            this.app.setConnection('Buffering');
            this.sendControl(params, 'all');
        };
        this.ws.onmessage = (event) => this._handleMessage(event, params);
        this.ws.onclose = () => {
            if (this.state !== 'idle') {
                if (fallbackToStatic()) return;
                this.app.setConnection('Stream ended');
                this.stop(false);
            }
        };
        this.ws.onerror = () => {
            this.app.setConnection('Connection error');
            fallbackToStatic();
        };
    }

    _handleMessage(event, params) {
        if (typeof event.data === 'string') {
            if (event.data.startsWith('Error:')) {
                this.app.setConnection(event.data);
                return;
            }
            if (event.data.startsWith('INIT:')) {
                const p = event.data.split(':');
                this.frameBuffer.length = 0;
                this.codecDecoder = null;
                this.dotImageData = null;
                this.selectionBuffer = null;
                els.player.textContent = '';
                this.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
                this.targetFps = parseFloat(p[1]);
                this.renderMode = parseInt(p[2], 10);
                this.pixelMode = p.length > 5 && parseInt(p[5], 10) === 1;
                const queueIndex = p.length > 6 ? parseInt(p[6], 10) : null;
                this._buildCanvas(parseInt(p[3], 10), parseInt(p[4], 10), this.pixelMode);
                if (this.app.params.codec === 'adaptive' && window.AscilineCodec && this.renderMode > 1) {
                    this.codecDecoder = window.AscilineCodec.makeDecoder(this.pixelMode ? 3 : 4);
                } else {
                    this.codecDecoder = null;
                }
                this.ready = false;
                this.state = 'playing';
                this._startAudioGate(queueIndex, params);
                return;
            }
            const newlineIdx = event.data.indexOf('\n');
            const frameIndex = parseInt(event.data.substring(0, newlineIdx), 10);
            const frameTime = frameIndex / this.targetFps;
            const frameData = event.data.substring(newlineIdx + 1);
            this.frameBuffer.push({ data: frameData, time: frameTime });
            this._trimBuffer();
            return;
        }

        if (this.codecDecoder) {
            this.codecDecoder.decode(event.data).then(({ frameIndex, frame }) => {
                this.frameBuffer.push({ data: frame, time: frameIndex / this.targetFps });
                this._trimBuffer();
            }).catch((error) => {
                console.warn('[StreamRuntime] decode failed', error);
            });
        } else {
            const view = new DataView(event.data);
            const frameIndex = view.getUint32(0, false);
            const frameData = new Uint8Array(event.data, 4);
            this.frameBuffer.push({ data: frameData, time: frameIndex / this.targetFps });
            this._trimBuffer();
        }
    }

    _trimBuffer() {
        const max = Math.max(1, this.app.params.bufferSize * this.app.params.maxBufferMultiplier);
        while (this.frameBuffer.length > max) this.frameBuffer.shift();
    }

    _startAudioGate(queueIndex, params) {
        const begin = () => {
            if (this.ready) return;
            this.ready = true;
            this.streamStartTime = performance.now();
            this.lastFpsUpdate = this.streamStartTime;
            this.app.setConnection('Playing');
            if (!this.raf) this.raf = requestAnimationFrame(this.renderFrame);
        };

        if (!els.audio) {
            begin();
            return;
        }
        els.audio.pause();
        const qs = queueIndex !== null ? `?v=${queueIndex}&` : '?';
        els.audio.src = `/audio${qs}t=${Date.now()}`;
        els.audio.volume = params.volume;
        els.audio.load();
        els.audio.play().catch(() => {});
        if (els.audio.readyState >= 3) {
            begin();
        } else {
            els.audio.addEventListener('playing', begin, { once: true });
            setTimeout(begin, 500);
        }
    }

    _buildCanvas(cols, rows, pixelMode) {
        this.gridCols = cols;
        this.gridRows = rows;
        const canvas = els.canvas;
        const player = els.player;
        const ctx = this.ctx;
        canvas.style.filter = 'none';
        canvas.style.imageRendering = this.app.params.smoothing ? 'auto' : 'pixelated';
        canvas.style.display = 'block';
        player.style.display = 'none';

        if (pixelMode) {
            canvas.width = cols;
            canvas.height = rows;
            this.dotImageData = ctx.createImageData(cols, rows);
            for (let i = 3; i < this.dotImageData.data.length; i += 4) {
                this.dotImageData.data[i] = 255;
            }
        } else {
            this.dotImageData = null;
            ctx.font = `bold ${Math.max(1, this.app.params.cellHeight * 3)}px ${this.app.params.fontFamily}, monospace`;
            this.charWidth = Math.max(1, ctx.measureText('M').width);
            this.charHeight = Math.max(1, this.app.params.cellHeight * 3);
            canvas.width = Math.round(cols * this.charWidth);
            canvas.height = Math.round(rows * this.charHeight);
            this.selectionBuffer = new Uint8Array((cols + 1) * rows);
            for (let r = 0; r < rows; r++) this.selectionBuffer[r * (cols + 1) + cols] = 10;
            this.xPos = new Float32Array(cols);
            this.yPos = new Float32Array(rows);
            for (let c = 0; c < cols; c++) this.xPos[c] = c * this.charWidth;
            for (let r = 0; r < rows; r++) this.yPos[r] = r * this.charHeight;
            player.style.fontSize = `${this.charHeight}px`;
            player.style.lineHeight = `${this.charHeight}px`;
        }

        this.app.updateMeters();
    }

    renderFrame(now) {
        this.raf = null;
        if (this.state !== 'playing' || !this.ready) return;
        this.raf = requestAnimationFrame(this.renderFrame);
        const params = this.app.params;
        let masterClock;
        if (els.audio && els.audio.readyState >= 1 && !els.audio.paused) {
            masterClock = els.audio.currentTime;
        } else {
            masterClock = (now - this.streamStartTime) / 1000;
        }

        if (this.frameBuffer.length === 0) return;
        while (this.frameBuffer.length > 1 && this.frameBuffer[0].time < masterClock - params.lateDropThreshold) {
            this.frameBuffer.shift();
        }
        if (this.frameBuffer[0].time > masterClock + params.futureWaitThreshold) return;

        const frame = this.frameBuffer.shift().data;
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this.app.updateMeters();
        }

        if (this.renderMode === 1) {
            els.player.style.display = 'block';
            els.player.style.color = '#fff';
            els.player.textContent = frame;
            return;
        }

        if (this.pixelMode) {
            this._renderPixelFrame(frame);
        } else {
            this._renderAsciiFrame(frame);
        }
    }

    _renderPixelFrame(frame) {
        if (!this.dotImageData || !frame) return;
        const data = this.dotImageData.data;
        for (let src = 0, dst = 0; src < frame.length; src += 3, dst += 4) {
            const [r, g, b] = processColor(frame[src + 2], frame[src + 1], frame[src], this.app.params);
            data[dst] = r;
            data[dst + 1] = g;
            data[dst + 2] = b;
        }
        this.ctx.putImageData(this.dotImageData, 0, 0);
    }

    _renderAsciiFrame(frame) {
        const ctx = this.ctx;
        const params = this.app.params;
        ctx.fillStyle = '#030405';
        ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.font = `bold ${this.charHeight}px ${params.fontFamily}, monospace`;
        ctx.textBaseline = 'top';

        let col = 0;
        let row = 0;
        let prevPacked = -1;
        for (let idx = 0; idx < frame.length; idx += 4) {
            const [r, g, b] = processColor(frame[idx + 1], frame[idx + 2], frame[idx + 3], params);
            const packed = (r << 16) | (g << 8) | b;
            if (packed !== prevPacked) {
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                prevPacked = packed;
            }
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const glyph = params.solidMode || !params.glyphMode ? '' : glyphForLuma(luma, params);
            if (glyph) {
                ctx.fillText(glyph, this.xPos[col], this.yPos[row]);
                this.selectionBuffer[row * (this.gridCols + 1) + col] = glyph.charCodeAt(0);
            } else {
                ctx.fillRect(this.xPos[col], this.yPos[row], this.charWidth, this.charHeight);
                this.selectionBuffer[row * (this.gridCols + 1) + col] = 32;
            }
            col++;
            if (col >= this.gridCols) {
                col = 0;
                row++;
            }
        }
        els.player.style.display = 'block';
        els.player.style.color = 'transparent';
        els.player.textContent = this.textDecoder.decode(this.selectionBuffer);
    }

    _controlPayload(params, key = 'all') {
        const payload = {};
        if (key === 'all' || key === 'cols' || key === 'rows' || key === 'autoRows') {
            payload.cols = params.cols;
            payload.rows = params.autoRows ? 0 : params.rows;
        }
        if (key === 'all' || key === 'mode') payload.mode = params.mode;
        if (key === 'all' || key === 'pixel') payload.pixel = params.pixel;
        if (key === 'all' || key === 'codecQuality') {
            payload.codecQuality = params.codecQuality;
            payload.codecTolerance = params.codecTolerance;
        }
        if (key === 'all' || key === 'codecTolerance') payload.codecTolerance = params.codecTolerance;
        if (key === 'all' || key === 'fpsCap') payload.fpsCap = params.fpsCap;
        return payload;
    }

    sendControl(params, key = 'all') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const paramsPayload = this._controlPayload(params, key);
        if (Object.keys(paramsPayload).length === 0) return;
        const payload = {
            type: 'params',
            params: paramsPayload
        };
        this.ws.send(JSON.stringify(payload));
    }

    updateParams(params, key) {
        els.canvas.style.filter = 'none';
        if (els.audio) els.audio.volume = params.volume;
        if (STREAM_CONTROL_KEYS.has(key)) this.sendControl(params, key);
    }

    getStats() {
        return {
            backend: this.pixelMode ? 'pixel-canvas-stream' : 'canvas2d-stream',
            sourceType: 'stream',
            cols: this.gridCols,
            rows: this.gridRows,
            fps: this.targetFps,
            buffer: this.frameBuffer.length,
            currentFps: this.currentFps
        };
    }

    stop(resetUi = true) {
        this.state = 'idle';
        this.ready = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (els.audio) {
            els.audio.pause();
            els.audio.src = '';
        }
        this.frameBuffer.length = 0;
        this.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        els.player.textContent = '';
        els.player.style.display = 'none';
        if (resetUi) this.app.setConnection('Disconnected');
    }
}

class RendererLabApp {
    constructor() {
        this.params = normalizeParams(parseStoredJson(STORAGE_KEY, DEFAULT_PARAMS));
        this.userPresets = parseStoredJson(PRESET_KEY, []);
        this.activePresetId = 'point-click-default';
        this.staticRuntime = new StaticRuntime(this);
        this.streamRuntime = new StreamRuntime(this);
        this.running = false;
        this.starting = false;
        this.startToken = 0;
        this.rebuildTimer = null;
        this.controlInputs = new Map();
        this.transitioning = false;
        this.transitionFadeCanvas = null;
        this.popout = null;
        this.popoutStage = null;
        this.popoutCanvas = null;
        this.popoutCtx = null;
        this.popoutRaf = null;
        this.popoutRenderer = null;
        this.meterTimer = null;
        this.localObjectUrl = null;
        this.customFile = null;
        this.customFileHandle = null;
        this.customSourceMeta = parseStoredJson(CUSTOM_SOURCE_KEY, null);
        this.customSourceStatus = this.customSourceMeta ? 'missing' : 'empty';
        this.cameraDevices = [];
        this.cameraStream = null;
        this.cameraConstraintKey = null;
        this.cameraStatus = navigator.mediaDevices?.getUserMedia ? 'needs-access' : 'unsupported';
        this.cameraError = '';
        this.wtfActive = false;
        this.wtfToken = 0;
    }

    async init() {
        await this._detectBackends();
        await this._restoreCustomSource();
        this._buildControls();
        this._bindEvents();
        await this._refreshCameraDevices();
        this._renderSourceList();
        this._renderPresets();
        this._syncInputs();
        this._applyVisualState();
        this.updateMeters();
        this._startMeterTimer();
        this.setConnection('Disconnected');
        this._autoStart();
    }

    async _detectBackends() {
        const caps = await detectCapabilities().catch(() => null);
        const parts = [];
        if (caps?.webgpu) parts.push('WebGPU');
        if (caps?.webgl2) parts.push('WebGL2');
        parts.push('Canvas');
        els.backendStatus.textContent = `Backend: ${parts.join(' / ')}`;
    }

    async _restoreCustomSource() {
        const handle = await loadCustomFileHandle();
        if (!handle) return;

        this.customFileHandle = handle;
        const permission = typeof handle.queryPermission === 'function'
            ? await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt')
            : 'granted';
        if (permission === 'granted') {
            await this._loadCustomFileFromHandle(handle);
        } else {
            this.customSourceStatus = permission === 'prompt' ? 'needs-access' : 'missing';
        }
    }

    async _loadCustomFileFromHandle(handle) {
        try {
            const file = await handle.getFile();
            this.customFileHandle = handle;
            this._setCustomFile(file);
            return true;
        } catch (error) {
            console.warn('[Source] Custom file handle is not readable:', error);
            this.customFile = null;
            this.customSourceStatus = 'missing';
            this._clearLocalObjectUrl();
            return false;
        }
    }

    _setCustomFile(file) {
        this.customFile = file;
        this.customSourceMeta = customSourceMetaFromFile(file);
        this.customSourceStatus = 'present';
        saveJson(CUSTOM_SOURCE_KEY, this.customSourceMeta);
        this._renderSourceList();
    }

    async _refreshCameraDevices(options = {}) {
        if (!navigator.mediaDevices?.enumerateDevices) {
            this.cameraDevices = [];
            this.cameraStatus = 'unsupported';
            this.cameraError = 'Camera unsupported';
            this._syncCameraDeviceOptions();
            if (options.render !== false) this._renderSourceList();
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameraDevices = devices.filter((device) => device.kind === 'videoinput');
            if (this.cameraStream && this._cameraStreamActive()) this.cameraStatus = 'ready';
            else if (this.cameraDevices.length === 0 && this.cameraStatus !== 'needs-access') this.cameraStatus = 'missing';
            this.cameraError = '';
        } catch (error) {
            const status = cameraErrorStatus(error);
            this.cameraDevices = [];
            this.cameraStatus = status.status;
            this.cameraError = status.message;
        }

        this._syncCameraDeviceOptions();
        if (options.render !== false) this._renderSourceList();
    }

    _syncCameraDeviceOptions() {
        const entry = this.controlInputs.get('cameraDeviceId');
        if (!entry) return;

        const input = entry.input;
        const selected = this.params.cameraDeviceId || '';
        const options = [['', 'Default camera']];
        this.cameraDevices.forEach((device, index) => {
            options.push([device.deviceId, device.label || `Camera ${index + 1}`]);
        });
        if (selected && !options.some(([value]) => value === selected)) {
            options.push([selected, 'Selected camera']);
        }

        input.innerHTML = '';
        for (const [value, label] of options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            input.appendChild(option);
        }
        input.value = selected;
        this._syncControlValue('cameraDeviceId');
    }

    _cameraDeviceLabel(deviceId = this.params.cameraDeviceId) {
        if (!deviceId) return 'Default camera';
        const index = this.cameraDevices.findIndex((device) => device.deviceId === deviceId);
        if (index >= 0) return this.cameraDevices[index].label || `Camera ${index + 1}`;
        return 'Selected camera';
    }

    _cameraStreamActive() {
        return Boolean(this.cameraStream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
    }

    _stopCameraStream() {
        if (!this.cameraStream) return;
        this.cameraStream.getTracks?.().forEach((track) => track.stop());
        this.cameraStream = null;
        this.cameraConstraintKey = null;
        if (this.cameraStatus === 'ready' || this.cameraStatus === 'requesting') this.cameraStatus = 'needs-access';
        this._renderSourceList();
    }

    async _ensureCameraStream(params = this.params) {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.cameraStatus = 'unsupported';
            this.cameraError = 'Camera unsupported';
            this._renderSourceList();
            throw new Error(this.cameraError);
        }

        const key = cameraConstraintKey(params);
        if (this._cameraStreamActive() && this.cameraConstraintKey === key) return this.cameraStream;

        this._stopCameraStream();
        this.cameraStatus = 'requesting';
        this.cameraError = '';
        this._renderSourceList();
        this.setConnection('Requesting camera');

        try {
            const stream = await navigator.mediaDevices.getUserMedia(cameraConstraintsFromParams(params));
            this.cameraStream = stream;
            this.cameraConstraintKey = key;
            this.cameraStatus = 'ready';
            this.cameraError = '';
            stream.getVideoTracks?.().forEach((track) => {
                track.addEventListener('ended', () => {
                    if (this.cameraStream === stream) {
                        this.cameraStream = null;
                        this.cameraConstraintKey = null;
                        this.cameraStatus = 'missing';
                        this.cameraError = 'Camera disconnected';
                        this._renderSourceList();
                    }
                }, { once: true });
            });
            await this._refreshCameraDevices({ render: false });
            this._renderSourceList();
            return stream;
        } catch (error) {
            const status = cameraErrorStatus(error);
            this.cameraStatus = status.status;
            this.cameraError = status.message;
            this._renderSourceList();
            throw new Error(status.message);
        }
    }

    async loadStaticSource(params, options = {}) {
        if (isCameraParams(params)) {
            const stream = await this._ensureCameraStream(params);
            return loadMediaSource(CAMERA_MEDIA_URL, {
                type: 'camera',
                stream,
                stopTracks: false,
                readyTimeoutMs: options.readyTimeoutMs
            });
        }

        this._stopCameraStream();
        return loadMediaSource(params.mediaUrl, {
            type: forcedMediaType(params),
            loop: params.loop,
            muted: params.muted
        });
    }

    _cameraSourceEntry() {
        const activeTrack = this.cameraStream?.getVideoTracks?.()[0] || null;
        const settings = activeTrack?.getSettings?.() || {};
        const label = this._cameraDeviceLabel(settings.deviceId || this.params.cameraDeviceId);
        const detailParts = ['Local camera'];
        if (this.cameraStatus === 'ready' && settings.width && settings.height) {
            detailParts.push(`${settings.width}x${settings.height}`);
        } else if (this.cameraDevices.length > 1) {
            detailParts.push(`${this.cameraDevices.length} devices`);
        } else if (label && label !== 'Default camera') {
            detailParts.push(label);
        }

        const statusMap = {
            ready: ['Ready', 'ready'],
            requesting: ['Requesting', 'needs-access'],
            denied: ['Denied', 'missing'],
            missing: ['No camera', 'missing'],
            unsupported: ['Unsupported', 'missing'],
            error: ['Error', 'missing'],
            'needs-access': ['Allow', 'needs-access']
        };
        const [status, statusType] = statusMap[this.cameraStatus] || statusMap['needs-access'];
        return {
            id: CAMERA_SOURCE_ID,
            name: 'Camera',
            detail: detailParts.join(' · '),
            status,
            statusType
        };
    }

    _sourceEntries() {
        const builtIns = SOURCE_PRESETS.map((preset) => ({
            id: preset.id,
            name: preset.name,
            detail: preset.mediaType === 'video' ? 'Built-in video' : 'Built-in image',
            status: 'Ready',
            statusType: 'ready'
        }));
        const cameraEntry = this._cameraSourceEntry();

        if (!this.customSourceMeta && !this.customFile) return [...builtIns, cameraEntry];

        const meta = this.customSourceMeta || customSourceMetaFromFile(this.customFile);
        const status = this.customSourceStatus === 'present' ? 'Present' :
            this.customSourceStatus === 'needs-access' ? 'Needs access' :
            'Missing';
        const detailParts = [meta.mediaType === 'image' ? 'Custom image' : 'Custom video', fileSizeLabel(meta.size)].filter(Boolean);
        return [
            ...builtIns,
            cameraEntry,
            {
                id: CUSTOM_SOURCE_ID,
                name: meta.name || 'Custom file',
                detail: detailParts.join(' · '),
                status,
                statusType: this.customSourceStatus
            }
        ];
    }

    _activeSourceId() {
        if (isCameraParams(this.params)) return CAMERA_SOURCE_ID;
        const matched = findSourcePreset(this.params.mediaUrl, this.params.mediaType);
        if (matched) return matched.id;
        if (String(this.params.mediaUrl || '').startsWith('blob:') && this.customFile) return CUSTOM_SOURCE_ID;
        return SOURCE_PRESETS[0]?.id || '';
    }

    _renderSourceList() {
        els.sourceList.innerHTML = '';
        const activeId = this._activeSourceId();
        for (const entry of this._sourceEntries()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'source-option';
            item.dataset.sourceId = entry.id;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', entry.id === activeId ? 'true' : 'false');
            if (entry.id === activeId) item.classList.add('active');
            if (entry.statusType) item.classList.add(`source-${entry.statusType}`);

            const copy = document.createElement('span');
            copy.className = 'source-option-copy';

            const name = document.createElement('span');
            name.className = 'source-option-name';
            name.textContent = entry.name;

            const detail = document.createElement('span');
            detail.className = 'source-option-detail';
            detail.textContent = entry.detail;

            const status = document.createElement('span');
            status.className = 'source-option-status';
            status.textContent = entry.status;

            copy.append(name, detail);
            item.append(copy, status);
            item.addEventListener('click', () => this._selectSource(entry.id));
            els.sourceList.appendChild(item);
        }
    }

    _buildControls() {
        els.controls.innerHTML = '';
        for (const group of CONTROL_GROUPS) {
            const section = document.createElement('section');
            section.className = 'control-group';
            section.dataset.group = group.title;
            const heading = document.createElement('h2');
            heading.textContent = group.title;
            section.appendChild(heading);
            for (const config of group.controls) {
                const row = document.createElement('div');
                row.className = 'control-row';
                row.dataset.controlKey = config.key;
                const label = document.createElement('label');
                label.className = 'control-label';
                label.htmlFor = `control-${config.key}`;
                label.innerHTML = `<span>${config.label}</span><small>${config.key}</small>`;
                const input = this._makeControl(config);
                const value = document.createElement('output');
                value.className = 'control-value';
                value.id = `value-${config.key}`;
                row.append(label, input, value);
                section.appendChild(row);
                this.controlInputs.set(config.key, { input, value, config, row, section });
            }
            els.controls.appendChild(section);
        }
    }

    _makeControl(config) {
        let input;
        if (config.type === 'select') {
            input = document.createElement('select');
            for (const [value, label] of config.options) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                input.appendChild(option);
            }
        } else {
            input = document.createElement('input');
            input.type = config.type;
            if (config.type === 'range') {
                input.min = config.min;
                input.max = config.max;
                input.step = config.step;
            }
        }
        input.id = `control-${config.key}`;
        input.addEventListener('input', () => this._handleControlInput(config.key));
        input.addEventListener('change', () => this._handleControlInput(config.key, true));
        return input;
    }

    _bindEvents() {
        els.sourceMode.addEventListener('change', () => {
            this.params.sourceMode = els.sourceMode.value;
            this._paramChanged('sourceMode', true);
        });
        els.backend.addEventListener('change', () => {
            this.params.backend = els.backend.value;
            this._paramChanged('backend', true);
        });
        els.addCustomFile.addEventListener('click', () => this._openCustomFilePicker());
        els.localMediaFile.addEventListener('change', () => this._selectLocalMediaFile());
        els.togglePlay.addEventListener('click', () => this.toggle());
        els.overlay.addEventListener('click', () => this.start());
        els.reloadSource.addEventListener('click', () => this._reloadSource());
        els.savePreset.addEventListener('click', () => this._saveCurrentPreset());
        els.duplicatePreset.addEventListener('click', () => this._duplicatePreset());
        els.updatePreset.addEventListener('click', () => this._updatePreset());
        els.deletePreset.addEventListener('click', () => this._deletePreset());
        els.morePresets.addEventListener('click', (event) => {
            event.stopPropagation();
            this._togglePresetOverflow();
        });
        els.presetOverflowMenu.addEventListener('click', (event) => event.stopPropagation());
        els.exportPresets.addEventListener('click', () => {
            this._closePresetOverflow();
            this._exportPresets();
        });
        els.importPresets.addEventListener('click', () => {
            this._closePresetOverflow();
            this._importPresets();
        });
        els.popoutWindow.addEventListener('click', () => this.openPopout());
        els.wtfButton.addEventListener('click', () => this.toggleWtf());
        navigator.mediaDevices?.addEventListener?.('devicechange', () => {
            this._refreshCameraDevices().catch((error) => console.warn('[Camera] Device refresh failed:', error));
        });
        document.addEventListener('click', () => this._closePresetOverflow());
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this._closePresetOverflow();
        });
        window.addEventListener('resize', () => this._applyVisualState());
        window.addEventListener('beforeunload', () => {
            if (this.meterTimer) window.clearInterval(this.meterTimer);
            this._stopWtf();
            this._clearLocalObjectUrl();
            this._stopCameraStream();
            this._closePopout();
        });
    }

    _startMeterTimer() {
        if (this.meterTimer) window.clearInterval(this.meterTimer);
        this.meterTimer = window.setInterval(() => this.updateMeters(), 500);
    }

    _autoStart() {
        let attempts = 0;
        const tryStart = () => {
            if (this.running || this.starting) return;
            attempts++;
            this.start({ autoStart: true }).then(() => {
                if (!this.running && attempts < 3) setTimeout(tryStart, attempts * 500);
            });
        };
        requestAnimationFrame(tryStart);
        if (document.readyState !== 'complete') {
            window.addEventListener('load', () => {
                if (!this.running && !this.starting) tryStart();
            }, { once: true });
        }
    }

    _clearLocalObjectUrl() {
        const oldUrl = this.localObjectUrl;
        this.localObjectUrl = null;
        if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
    }

    _ensureCustomObjectUrl() {
        if (!this.customFile) return null;
        if (!this.localObjectUrl) this.localObjectUrl = URL.createObjectURL(this.customFile);
        return this.localObjectUrl;
    }

    async _openCustomFilePicker() {
        if (window.showOpenFilePicker) {
            try {
                const [handle] = await window.showOpenFilePicker(CUSTOM_MEDIA_PICKER_OPTIONS);
                if (!handle) return;
                await saveCustomFileHandle(handle);
                const loaded = await this._loadCustomFileFromHandle(handle);
                if (loaded) await this._activateCustomSource();
            } catch (error) {
                if (error?.name !== 'AbortError') console.warn('[Source] Custom file picker failed:', error);
            }
            this._renderSourceList();
            return;
        }

        els.localMediaFile.value = '';
        els.localMediaFile.click();
    }

    _selectLocalMediaFile() {
        const file = els.localMediaFile.files?.[0];
        if (!file) return;
        this.customFileHandle = null;
        this._clearLocalObjectUrl();
        this._setCustomFile(file);
        this._activateCustomSource();
    }

    async _selectSource(id) {
        const preset = SOURCE_PRESETS.find((item) => item.id === id);
        if (preset) {
            const leavingCamera = isCameraParams(this.params);
            this._clearLocalObjectUrl();
            this.params.sourceMode = 'static';
            this.params.mediaUrl = preset.mediaUrl;
            this.params.mediaType = preset.mediaType;
            this.params.sourceName = preset.name;
            this._syncInputs();
            this._paramChanged('mediaUrl', true);
            if (!this.running && leavingCamera) this._stopCameraStream();
            return;
        }

        if (id === CAMERA_SOURCE_ID) {
            await this._activateCameraSource();
            return;
        }

        if (id === CUSTOM_SOURCE_ID) await this._activateCustomSource();
    }

    async _activateCameraSource() {
        this._clearLocalObjectUrl();
        this.params.sourceMode = 'static';
        this.params.mediaUrl = CAMERA_MEDIA_URL;
        this.params.mediaType = 'camera';
        this.params.sourceName = 'Camera';
        this.params.muted = true;
        this._syncInputs();
        this._paramChanged('mediaUrl', true);
    }

    async _activateCustomSource() {
        if (!this.customFile && this.customFileHandle) {
            const permission = typeof this.customFileHandle.requestPermission === 'function'
                ? await this.customFileHandle.requestPermission({ mode: 'read' }).catch(() => 'denied')
                : 'granted';
            if (permission === 'granted') await this._loadCustomFileFromHandle(this.customFileHandle);
            else this.customSourceStatus = permission === 'prompt' ? 'needs-access' : 'missing';
        }

        if (!this.customFile) {
            if (!this.customFileHandle) await this._openCustomFilePicker();
            this._renderSourceList();
            return;
        }

        const objectUrl = this._ensureCustomObjectUrl();
        if (!objectUrl) return;
        const meta = this.customSourceMeta || customSourceMetaFromFile(this.customFile);
        this.customSourceStatus = 'present';
        this.params.sourceMode = 'static';
        this.params.mediaUrl = objectUrl;
        this.params.mediaType = meta.mediaType;
        this.params.sourceName = meta.name;
        this._syncInputs();
        this._paramChanged('mediaUrl', true);
        if (!this.running) this._stopCameraStream();
    }

    _reloadSource() {
        if (isCameraParams(this.params)) this._stopCameraStream();
        this.restart();
    }

    _handleControlInput(key) {
        const entry = this.controlInputs.get(key);
        if (!entry) return;
        const { input, config } = entry;
        if (config.type === 'checkbox') {
            this.params[key] = input.checked;
        } else if (config.type === 'select') {
            this.params[key] = key === 'mode' ? Number(input.value) : input.value;
        } else {
            const numeric = Number(input.value);
            this.params[key] = Number.isInteger(config.step) ? Math.round(numeric) : numeric;
        }
        if (key === 'codecQuality') {
            this.params.codecTolerance = CODEC_TOLERANCE[this.params.codecQuality] ?? this.params.codecTolerance;
        }
        this._syncControlValue(key);
        this._paramChanged(key, STRUCTURAL_KEYS.has(key));
    }

    _paramChanged(key, structural = false) {
        this._persist();
        this._applyVisualState();
        this._syncPresetToolbar();
        if (!this.running) return;

        if (key === 'sourceMode') {
            this.restart();
            return;
        }

        if (this.params.sourceMode === 'stream') {
            if (key === 'codec') {
                this.restart();
                return;
            }
            this.streamRuntime.updateParams(this.params, key);
            return;
        }

        if (STATIC_REBUILD_KEYS.has(key) || structural) {
            clearTimeout(this.rebuildTimer);
            const preserveStaticMedia = !STATIC_SOURCE_KEYS.has(key);
            this.rebuildTimer = setTimeout(() => this.restart({ preserveStaticMedia }), 250);
            return;
        }
        this.staticRuntime.updateParams(this.params);
        this._updatePopoutRendererParams();
    }

    async _ensureStaticVideoPlayback() {
        if (!this.running || this.params.sourceMode !== 'static') return;
        const source = this._staticMediaSource();
        const video = videoElementFromSource(source);
        if (!video) return;

        const mutedBefore = Boolean(this.params.muted);
        video.volume = this.params.volume;
        video.loop = this.params.loop;
        video.muted = this.params.muted;

        const playback = await playVideoWithMutedFallback(video, this.params);
        const mutedInput = this.controlInputs.get('muted')?.input;
        if (playback.mutedFallback || mutedBefore !== Boolean(this.params.muted) || mutedInput?.checked !== Boolean(this.params.muted)) {
            this._syncInputs();
            this._persist();
        }
    }

    async start(options = {}) {
        if (this.running || this.starting) return;
        this.starting = true;
        const token = ++this.startToken;
        els.overlay.classList.add('hidden');
        els.togglePlay.textContent = 'Stop';
        try {
            if (this.params.sourceMode === 'static') {
                const stats = await this.staticRuntime.start(this.params, options);
                if (token !== this.startToken) return;
                this.running = true;
                await this._ensureStaticVideoPlayback();
                this.setConnection(this._staticConnectionLabel());
                this.setBackend(stats?.backend || 'static');
            } else {
                this.staticRuntime.destroy();
                this.streamRuntime.start(this.params, options);
                if (token !== this.startToken) return;
                this.running = true;
                this.setBackend(this.params.backend === 'auto' ? 'stream canvas' : this.params.backend);
            }
        } catch (error) {
            console.error(error);
            this.setConnection(error.message || 'Start failed');
            this.running = false;
            els.overlay.classList.remove('hidden');
            els.togglePlay.textContent = 'Start';
        } finally {
            if (token === this.startToken) this.starting = false;
        }
        this.updateMeters();
        if (this.popout && !this.popout.closed) {
            this._restartPopoutOutput().catch((error) => console.warn('[Popout] Restart failed:', error));
        }
    }

    stop() {
        this.startToken++;
        this.starting = false;
        this.running = false;
        this._stopPopoutOutput();
        this.staticRuntime.destroy();
        this.streamRuntime.stop();
        if (isCameraParams(this.params)) this._stopCameraStream();
        els.togglePlay.textContent = 'Start';
        els.overlay.classList.remove('hidden');
        this.updateMeters();
    }

    async restart(options = {}) {
        if (!this.running) return;
        const mediaState = options.mediaState || (options.preserveStaticMedia ? this._captureStaticMediaState() : null);
        const canReuseStaticSource = this.params.sourceMode === 'static' &&
            (options.reuseStaticMedia || options.preserveStaticMedia || mediaState) &&
            this.staticRuntime.canReuseSource(this.params);

        if (canReuseStaticSource) {
            const stats = await this.staticRuntime.rebuildRenderer(this.params);
            await this._ensureStaticVideoPlayback();
            this.setConnection(this._staticConnectionLabel());
            this.setBackend(stats?.backend || 'static');
            this.updateMeters();
            if (this.popout && !this.popout.closed) {
                this._restartPopoutOutput().catch((error) => console.warn('[Popout] Restart failed:', error));
            }
            return;
        }

        this._stopPopoutOutput();
        this.staticRuntime.destroy();
        this.streamRuntime.stop(false);
        this.running = false;
        await this.start({ ...options, mediaState });
    }

    toggle() {
        if (this.running) this.stop();
        else this.start();
    }

    _fallbackToDefaultStatic() {
        if (this.params.sourceMode !== 'stream') return;
        this.streamRuntime.stop(false);
        this.staticRuntime.destroy();
        this.running = false;
        this.params = normalizeParams({
            ...this.params,
            sourceMode: 'static',
            mediaUrl: DEFAULT_PARAMS.mediaUrl,
            mediaType: DEFAULT_PARAMS.mediaType,
            sourceName: DEFAULT_PARAMS.sourceName
        });
        this._syncInputs();
        this._applyVisualState();
        this.start({ autoStart: true });
    }

    _staticConnectionLabel() {
        return isCameraParams(this.params) ? 'Camera' : 'Static media';
    }

    async openPopout() {
        if (this.popout && !this.popout.closed) {
            this.popout.focus();
            return;
        }

        const win = window.open('', 'asciline-remix-popout', 'popup=yes,width=1280,height=720');
        if (!win) {
            alert('Pop-out was blocked by the browser.');
            return;
        }

        this.popout = win;
        win.document.open();
        win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ASCILINE Remix Output</title>
<style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#030405;color:#e6edf3;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#mirror-stage,#mirror-canvas{position:fixed;inset:0;width:100vw;height:100vh;background:#030405}
#mirror-stage{display:grid;place-items:center;overflow:hidden;padding:1vmin;box-sizing:border-box}
#mirror-stage canvas{display:block;width:auto!important;height:auto!important;max-width:98vw!important;max-height:98vh!important;object-fit:contain;image-rendering:pixelated}
body.is-fullscreen #mirror-stage{padding:0}
body.is-fullscreen #mirror-stage canvas{width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;object-fit:cover}
#mirror-canvas{display:none}
.popout-bar{position:fixed;top:10px;right:10px;display:flex;gap:8px;opacity:.28;transition:opacity .15s ease}
.popout-bar:hover{opacity:1}
button{min-height:30px;border:1px solid #2a3440;border-radius:6px;background:#18202a;color:#e6edf3;padding:0 10px;font:12px/1 inherit;cursor:pointer}
button:hover{background:#202a35}
</style>
</head>
<body>
<div id="mirror-stage"></div>
<canvas id="mirror-canvas"></canvas>
<div class="popout-bar">
<button id="fullscreen-output" type="button">Fullscreen</button>
<button id="close-output" type="button">Close</button>
</div>
</body>
</html>`);
        win.document.close();

        this.popoutStage = win.document.getElementById('mirror-stage');
        this.popoutCanvas = win.document.getElementById('mirror-canvas');
        this.popoutCtx = this.popoutCanvas.getContext('2d', { alpha: false });
        win.document.getElementById('fullscreen-output').addEventListener('click', () => {
            win.document.documentElement.requestFullscreen?.().catch(() => {});
        });
        win.document.addEventListener('fullscreenchange', () => {
            win.document.body.classList.toggle('is-fullscreen', Boolean(win.document.fullscreenElement));
        });
        win.document.getElementById('close-output').addEventListener('click', () => this._closePopout());
        win.addEventListener('beforeunload', () => this._closePopout(false), { once: true });

        this._updatePopoutButton();
        this._restartPopoutOutput().catch((error) => console.warn('[Popout] Start failed:', error));
        this._placePopoutOnExternalScreen(win);
    }

    async _placePopoutOnExternalScreen(win) {
        if (!('getScreenDetails' in window)) return;
        try {
            const details = await window.getScreenDetails();
            const target = details.screens.find((screen) => !screen.isPrimary) || details.currentScreen || details.screens[0];
            if (!target || win.closed) return;
            win.moveTo(target.availLeft, target.availTop);
            win.resizeTo(target.availWidth, target.availHeight);
        } catch (error) {
            console.info('[Popout] Screen placement unavailable:', error);
        }
    }

    async _restartPopoutOutput() {
        if (!this.popout || this.popout.closed) return;
        this._stopPopoutOutput({ clear: true, keepWindow: true });
        if (this.params.sourceMode === 'static' && await this._startPopoutRenderer()) return;
        this._startPopoutMirror();
    }

    _stopPopoutOutput(options = {}) {
        const { clear = false } = options;
        const win = this.popout;
        if (this.popoutRaf && win && !win.closed) {
            win.cancelAnimationFrame(this.popoutRaf);
        }
        this.popoutRaf = null;
        this.popoutRenderer?.stop?.();
        this.popoutRenderer?.destroy?.();
        this.popoutRenderer = null;
        if (clear) {
            if (this.popoutStage) this.popoutStage.innerHTML = '';
            if (this.popoutCanvas && this.popoutCtx) {
                this.popoutCtx.fillStyle = '#030405';
                this.popoutCtx.fillRect(0, 0, this.popoutCanvas.width || 1, this.popoutCanvas.height || 1);
            }
        }
    }

    async _startPopoutRenderer() {
        const source = this._staticMediaSource();
        if (!source || !this.popoutStage || !this.popoutCanvas) return false;

        this.popoutStage.style.display = 'grid';
        this.popoutCanvas.style.display = 'none';
        this.popoutStage.innerHTML = '';

        try {
            if (this.params.backend === 'canvas2d' || this.params.backend === 'pixel-canvas') {
                const renderer = new CanvasStaticRenderer(this.popoutStage);
                await renderer.start(this.params, {
                    mediaState: this._captureStaticMediaState(),
                    source,
                    ownsSource: false
                });
                this.popoutRenderer = renderer;
                return true;
            }

            // WebGL2 is the safer popout default in Chromium-derived browsers; explicit WebGPU still wins.
            const preferredBackend = this.params.backend === 'auto' ? 'webgl2' : this.params.backend;
            this.popoutRenderer = await createRenderer({
                source,
                targetElement: this.popoutStage,
                cols: this.params.cols,
                rows: this.params.autoRows ? 0 : this.params.rows,
                autoRows: this.params.autoRows,
                aspectCorrection: this.params.aspectCorrection,
                fps: this.params.fps,
                saturationBoost: this.params.saturationBoost,
                contrastBoost: this.params.contrastBoost,
                brightness: this.params.brightness,
                gamma: this.params.gamma,
                bgBlend: this.params.bgBlend,
                quantizeBits: this.params.quantizeBits,
                jitterAmount: this.params.jitterAmount,
                jitterSpeed: this.params.jitterSpeed,
                sampleX: this.params.sampleX,
                sampleY: this.params.sampleY,
                smoothing: this.params.smoothing,
                cellWidth: this.params.cellWidth,
                cellHeight: this.params.cellHeight,
                solidMode: this.params.solidMode,
                glyphMode: this.params.glyphMode,
                mirrorX: this.params.mediaType === 'camera' && this.params.cameraMirror,
                preserveDrawingBuffer: true,
                preferredBackend
            });
            this.popoutRenderer.start();
            this._updatePopoutRendererParams();
            return true;
        } catch (error) {
            console.warn('[Popout] Native renderer failed, falling back to mirror:', error);
            this.popoutRenderer?.stop?.();
            this.popoutRenderer?.destroy?.();
            this.popoutRenderer = null;
            this.popoutStage.innerHTML = '';
            return false;
        }
    }

    _updatePopoutRendererParams() {
        if (!this.popoutRenderer) return;
        if (this.popoutRenderer instanceof CanvasStaticRenderer) {
            this.popoutRenderer.updateParams(this.params);
            return;
        }
        this.popoutRenderer.saturationBoost = this.params.saturationBoost;
        this.popoutRenderer.contrastBoost = this.params.contrastBoost;
        this.popoutRenderer.brightness = this.params.brightness;
        this.popoutRenderer.gamma = this.params.gamma;
        this.popoutRenderer.bgBlend = this.params.bgBlend;
        this.popoutRenderer.quantizeBits = this.params.quantizeBits;
        this.popoutRenderer.jitterAmount = this.params.jitterAmount;
        this.popoutRenderer.jitterSpeed = this.params.jitterSpeed;
        this.popoutRenderer.sampleX = this.params.sampleX;
        this.popoutRenderer.sampleY = this.params.sampleY;
        this.popoutRenderer.fps = this.params.fps;
        this.popoutRenderer.frameInterval = 1000 / Math.max(1, this.params.fps);
        this.popoutRenderer.smoothing = this.params.smoothing;
        this.popoutRenderer.cellWidth = this.params.cellWidth;
        this.popoutRenderer.cellHeight = this.params.cellHeight;
        this.popoutRenderer.mirrorX = this.params.mediaType === 'camera' && this.params.cameraMirror;
        if (this.popoutRenderer._applySourceSmoothing) this.popoutRenderer._applySourceSmoothing();
        if (this.popoutRenderer.canvas) {
            this.popoutRenderer.canvas.style.filter = 'none';
            this.popoutRenderer.canvas.style.imageRendering = this.params.smoothing ? 'auto' : 'pixelated';
        }
    }

    _startPopoutMirror() {
        const win = this.popout;
        if (!win || win.closed || !this.popoutCanvas || !this.popoutCtx) return;
        if (this.popoutRaf) win.cancelAnimationFrame(this.popoutRaf);
        if (this.popoutStage) this.popoutStage.style.display = 'none';
        this.popoutCanvas.style.display = 'block';

        const draw = () => {
            if (!this.popout || this.popout.closed) {
                this._closePopout(false);
                return;
            }

            const source = this._activeRenderSurface();
            const dpr = Math.max(1, this.popout.devicePixelRatio || 1);
            const width = Math.max(1, Math.floor(this.popout.innerWidth * dpr));
            const height = Math.max(1, Math.floor(this.popout.innerHeight * dpr));
            if (this.popoutCanvas.width !== width || this.popoutCanvas.height !== height) {
                this.popoutCanvas.width = width;
                this.popoutCanvas.height = height;
            }

            const ctx = this.popoutCtx;
            ctx.fillStyle = '#030405';
            ctx.fillRect(0, 0, width, height);

            const sourceWidth = source?.videoWidth || source?.naturalWidth || source?.width || 0;
            const sourceHeight = source?.videoHeight || source?.naturalHeight || source?.height || 0;
            if (source && sourceWidth > 0 && sourceHeight > 0) {
                const scale = Math.min(width / sourceWidth, height / sourceHeight);
                const drawWidth = Math.max(1, Math.floor(sourceWidth * scale));
                const drawHeight = Math.max(1, Math.floor(sourceHeight * scale));
                const dx = Math.floor((width - drawWidth) / 2);
                const dy = Math.floor((height - drawHeight) / 2);
                ctx.imageSmoothingEnabled = Boolean(this.params.smoothing);
                try {
                    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
                } catch (error) {
                    console.info('[Popout] Active surface could not be mirrored:', error);
                }
            }

            this.popoutRaf = this.popout.requestAnimationFrame(draw);
        };

        this.popoutRaf = win.requestAnimationFrame(draw);
    }

    _activeRenderSurface() {
        if (this.params.sourceMode === 'stream') {
            if (els.canvas.width > 0 && els.canvas.height > 0 && els.canvas.style.display !== 'none') return els.canvas;
            return null;
        }

        const renderer = this.staticRuntime.renderer;
        if (renderer?.canvas) return renderer.canvas;
        const stageCanvas = els.gpuStage.querySelector('canvas');
        if (stageCanvas) return stageCanvas;
        const source = this.staticRuntime.source;
        return source?.canvas || source?.element || null;
    }

    _staticMediaSource() {
        return this.staticRuntime.source || this.staticRuntime.renderer?.source || null;
    }

    _captureStaticMediaState(nextParams = this.params) {
        return captureVideoPlaybackState(this._staticMediaSource(), this.params, nextParams);
    }

    _closePopout(closeWindow = true) {
        const win = this.popout;
        this._stopPopoutOutput();
        if (closeWindow && win && !win.closed) win.close();
        this.popout = null;
        this.popoutStage = null;
        this.popoutCanvas = null;
        this.popoutCtx = null;
        this._updatePopoutButton();
    }

    _updatePopoutButton() {
        els.popoutWindow.textContent = this.popout && !this.popout.closed ? 'Show Pop-Out' : 'Pop Out';
    }

    setConnection(text) {
        els.connectionStatus.textContent = text;
    }

    setBackend(text) {
        els.backendStatus.textContent = `Backend: ${text}`;
    }

    _syncSourceControls() {
        els.sourceMode.value = this.params.sourceMode;
        els.backend.value = this.params.backend;
        els.backend.disabled = this.params.sourceMode === 'stream';
        const matched = findSourcePreset(this.params.mediaUrl, this.params.mediaType);
        const sourceName = isCameraParams(this.params) ? 'Camera' : matched?.name || this.params.sourceName || sourceNameFromUrl(this.params.mediaUrl);
        els.sourceLabel.textContent = this.params.sourceMode === 'static' ? sourceName : 'stream source';
        this._renderSourceList();
    }

    _applyVisualState() {
        this._syncSourceControls();
        this._updateControlVisibility();
        els.statsOverlay.classList.toggle('hidden', !this.params.statsOverlay);
        els.container.style.backgroundColor = `rgba(3, 4, 5, ${clamp(1 - this.params.bgBlend * 0.35, 0.65, 1)})`;
        this.updateMeters();
    }

    _controlContext() {
        return {
            params: this.params,
            kind: backendKind(this.params),
            isVideo: isLikelyVideo(this.params)
        };
    }

    _controlApplies(key) {
        const predicate = CONTROL_APPLIES[key];
        return predicate ? predicate(this._controlContext()) : true;
    }

    _updateControlVisibility() {
        els.sourceList.closest('.source-panel')?.classList.toggle('control-hidden', this.params.sourceMode !== 'static');
        const sections = new Set();
        for (const [key, entry] of this.controlInputs.entries()) {
            const visible = this._controlApplies(key);
            entry.row.classList.toggle('control-hidden', !visible);
            entry.input.disabled = !visible;
            sections.add(entry.section);
        }
        for (const section of sections) {
            const visibleRows = [...section.querySelectorAll('.control-row')].some((row) => !row.classList.contains('control-hidden'));
            section.classList.toggle('control-hidden', !visibleRows);
        }
    }

    updateMeters() {
        const streamStats = this.streamRuntime.getStats();
        const staticStats = this.staticRuntime.getStats();
        const stats = this.params.sourceMode === 'stream' ? streamStats : staticStats;
        const fps = stats?.currentFps ?? 0;
        const target = stats?.fps ?? this.params.fps;
        els.fpsMeter.textContent = `FPS ${Math.round(fps)}/${Math.round(target)}`;
        els.bufferMeter.textContent = this.params.sourceMode === 'stream'
            ? `BUF ${stats?.buffer ?? this.streamRuntime.frameBuffer.length ?? 0}`
            : 'BUF n/a';
        const rows = stats?.rows || (this.params.autoRows ? 'auto' : this.params.rows);
        els.gridMeter.textContent = `${stats?.cols || this.params.cols} x ${rows}`;
        const overlay = [
            `source=${this.params.sourceMode}`,
            `backend=${stats?.backend || this.params.backend}`,
            `grid=${stats?.cols || this.params.cols}x${rows}`,
            `fps=${Math.round(fps)}/${Math.round(target)}`,
            `codec=${this.params.codec}:${this.params.codecQuality}`,
            `transition=${this.params.transitionSeconds.toFixed(1)}s`
        ];
        els.statsOverlay.textContent = overlay.join('\n');
    }

    _syncInputs() {
        this._syncSourceControls();
        this._syncCameraDeviceOptions();
        for (const key of this.controlInputs.keys()) {
            const entry = this.controlInputs.get(key);
            if (!entry) continue;
            const { input, config } = entry;
            if (config.type === 'checkbox') input.checked = Boolean(this.params[key]);
            else input.value = String(this.params[key]);
            this._syncControlValue(key);
        }
    }

    _syncControlValue(key) {
        const entry = this.controlInputs.get(key);
        if (!entry) return;
        const { value, config } = entry;
        const current = this.params[key];
        if (config.type === 'checkbox') {
            value.textContent = current ? 'on' : 'off';
        } else if (key === 'cameraDeviceId') {
            value.textContent = this._cameraDeviceLabel(current);
        } else if (typeof current === 'number') {
            value.textContent = `${Number.isInteger(current) ? current : current.toFixed(2)}${config.unit || ''}`;
        } else {
            value.textContent = String(current);
        }
    }

    _allPresets() {
        return [...BUILTIN_PRESETS, ...this.userPresets];
    }

    _renderPresets() {
        els.presetList.innerHTML = '';
        for (const preset of this._allPresets()) {
            const transitionSeconds = Number(preset.transitionSeconds ?? this.params.transitionSeconds);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'preset-item';
            if (preset.id === this.activePresetId) button.classList.add('active');
            if (preset.readonly) button.classList.add('readonly');
            button.title = `${preset.name} - ${transitionSeconds.toFixed(1)}s transition${preset.readonly ? ' - built-in' : ''}`;

            const name = document.createElement('span');
            name.className = 'preset-name';
            name.textContent = preset.name;

            const meta = document.createElement('span');
            meta.className = 'preset-meta';
            meta.textContent = `${transitionSeconds.toFixed(1)}s`;

            button.append(name, meta);
            button.addEventListener('click', () => this.applyPreset(preset.id));
            els.presetList.appendChild(button);
        }
        const active = this._allPresets().find((p) => p.id === this.activePresetId);
        els.activePresetLabel.textContent = active?.name || 'Custom';
        this._syncPresetToolbar();
    }

    _syncPresetToolbar() {
        const active = this._allPresets().find((p) => p.id === this.activePresetId);
        const selectedUserPreset = this._selectedUserPreset();
        const selectedUserPresetDirty = selectedUserPreset ? this._isUserPresetDirty(selectedUserPreset) : false;
        els.duplicatePreset.disabled = !active;
        els.updatePreset.disabled = !selectedUserPresetDirty;
        els.deletePreset.disabled = !selectedUserPreset;
        els.exportPresets.disabled = this.userPresets.length === 0;
    }

    _togglePresetOverflow() {
        if (els.presetOverflowMenu.hidden) this._openPresetOverflow();
        else this._closePresetOverflow();
    }

    _openPresetOverflow() {
        els.presetOverflowMenu.hidden = false;
        els.morePresets.setAttribute('aria-expanded', 'true');
    }

    _closePresetOverflow() {
        if (!els.presetOverflowMenu || els.presetOverflowMenu.hidden) return;
        els.presetOverflowMenu.hidden = true;
        els.morePresets.setAttribute('aria-expanded', 'false');
    }

    _savedUserPresetParams(preset) {
        const params = normalizeParams({
            ...DEFAULT_PARAMS,
            ...(preset?.params || {})
        });
        params.transitionSeconds = Number(
            preset?.transitionSeconds ??
            preset?.params?.transitionSeconds ??
            params.transitionSeconds
        );
        return renderPresetParams(params);
    }

    _isUserPresetDirty(preset = this._selectedUserPreset()) {
        if (!preset) return false;
        return stableJson(renderPresetParams(this.params)) !== stableJson(this._savedUserPresetParams(preset));
    }

    _currentSourceParams() {
        const source = {};
        for (const key of SOURCE_PARAM_KEYS) source[key] = this.params[key];
        return source;
    }

    _baseForPreset(preset) {
        if (!preset?.readonly) return this.params;
        return {
            ...DEFAULT_PARAMS,
            ...this._currentSourceParams()
        };
    }

    toggleWtf() {
        if (this.wtfActive) this._stopWtf();
        else this._startWtf();
    }

    _syncWtfButton() {
        els.wtfButton.classList.toggle('active', this.wtfActive);
        els.wtfButton.setAttribute('aria-pressed', this.wtfActive ? 'true' : 'false');
    }

    _startWtf() {
        if (this.wtfActive) return;
        this.wtfActive = true;
        this.wtfToken++;
        this.activePresetId = null;
        this._syncWtfButton();
        this._renderPresets();
        els.activePresetLabel.textContent = 'WTF';
        this._runWtfLoop(this.wtfToken);
    }

    _stopWtf() {
        if (!this.wtfActive) return;
        this.wtfActive = false;
        this.wtfToken++;
        this._syncWtfButton();
        this._renderPresets();
    }

    async _runWtfLoop(token) {
        while (this.wtfActive && token === this.wtfToken) {
            if (!this.running) {
                await this.start({ autoStart: true }).catch((error) => console.warn('[WTF] Start failed:', error));
                if (this.starting) {
                    await this._waitForStartIdle();
                }
            }
            if (this.transitioning) {
                await new Promise((resolve) => setTimeout(resolve, 120));
                continue;
            }

            const seconds = randomBetween(1, 5);
            const target = this._makeWtfTarget(seconds);
            try {
                await this._transitionTo(target, seconds);
                this.activePresetId = null;
                els.activePresetLabel.textContent = this.wtfActive ? 'WTF' : 'Custom';
            } catch (error) {
                console.warn('[WTF] Transition failed:', error);
            }

            if (this.wtfActive && token === this.wtfToken) {
                await new Promise((resolve) => setTimeout(resolve, 80));
            }
        }
        if (token === this.wtfToken) {
            this.wtfActive = false;
            this._syncWtfButton();
        }
    }

    _makeWtfTarget(seconds) {
        for (let attempt = 0; attempt < 16; attempt++) {
            const target = this._randomWtfTarget(seconds);
            if (this._isSafeWtfTarget(target)) return target;
        }
        return normalizeParams({
            ...this.params,
            transitionSeconds: seconds,
            saturationBoost: randomBetween(0.8, 1.8),
            contrastBoost: randomBetween(0.8, 1.8),
            brightness: randomBetween(0.75, 1.25),
            gamma: randomBetween(0.75, 1.45),
            bgBlend: randomBetween(0.1, 0.45),
            quantizeBits: randomInt(0, 3),
            cols: randomInt(180, 560),
            autoRows: true
        }, { preserveBlob: true });
    }

    _randomWtfTarget(seconds) {
        const target = { ...this.params, transitionSeconds: seconds };
        const staticMode = target.sourceMode === 'static';

        if (staticMode) {
            target.backend = 'auto';
        }

        target.volume = snapToStep(randomBetween(0, 1), 0.01);
        target.loop = true;
        target.muted = randomBool(0.72);
        target.statsOverlay = randomBool(0.85);

        target.cols = randomInt(260, 760);
        target.autoRows = true;
        target.rows = 0;
        const cellScale = randomInt(1, 5);
        target.cellWidth = cellScale;
        target.cellHeight = Math.max(2, Math.round(cellScale * 1.5));
        target.aspectCorrection = 1;

        target.saturationBoost = snapToStep(randomBetween(0.18, 2.75), 0.01);
        target.contrastBoost = snapToStep(randomBetween(0.55, 2.45), 0.01);
        target.brightness = snapToStep(randomBetween(0.48, 1.62), 0.01);
        target.gamma = snapToStep(randomBetween(0.55, 2.35), 0.01);
        target.bgBlend = snapToStep(randomBetween(0, 0.72), 0.01);
        target.quantizeBits = randomInt(0, 5);

        if (target.sourceMode === 'stream') {
            target.mode = randomInt(1, 5);
            target.pixel = randomBool(0.4);
        } else {
            target.pixel = false;
        }

        target.fps = randomInt(8, 48);
        target.jitterAmount = snapToStep(randomBetween(0, 1), 0.01);
        target.jitterSpeed = snapToStep(randomBetween(0, 4), 0.01);
        target.sampleX = snapToStep(randomBetween(0.08, 0.92), 0.01);
        target.sampleY = snapToStep(randomBetween(0.08, 0.92), 0.01);
        target.smoothing = randomBool(0.5);

        target.codec = randomChoice(['adaptive', 'legacy']);
        target.codecQuality = randomChoice(['lossless', 'high', 'balanced', 'low']);
        target.codecTolerance = target.codec === 'adaptive'
            ? randomInt(0, 24)
            : this.params.codecTolerance;
        target.bufferSize = randomInt(1, 12);
        target.maxBufferMultiplier = randomInt(2, 10);
        target.lateDropThreshold = snapToStep(randomBetween(0.02, 0.35), 0.01);
        target.futureWaitThreshold = snapToStep(randomBetween(0.01, 0.32), 0.01);
        target.fpsCap = randomInt(12, 60);

        const canvasBackend = backendKind(target) === 'canvas';
        target.solidMode = canvasBackend ? randomBool(0.28) : randomBool(0.12);
        target.glyphMode = target.solidMode ? false : randomBool(0.66);
        target.charset = randomChoice(['point-click', 'asciline', 'blocks']);
        target.fontFamily = randomChoice(['Courier New', 'monospace', 'Menlo', 'Consolas']);
        target.minGlyphIntensity = randomInt(70, 230);

        return normalizeParams(target, { preserveBlob: true });
    }

    _isSafeWtfTarget(target) {
        if (target.brightness < 0.42) return false;
        if (target.brightness > 1.75 && target.contrastBoost > 2.25 && target.gamma < 0.65) return false;
        if (target.bgBlend > 0.78 && target.brightness < 0.8) return false;
        if (target.solidMode && target.brightness < 0.62 && target.bgBlend > 0.58) return false;

        if (target.sourceMode !== 'static') return true;
        const rect = els.container.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        const snapshot = this._makeSoftwareTransitionSnapshot(target, width, height, {
            maxCells: 18000,
            sampleLimit: 420
        });
        return snapshot ? canvasHasSafeVisualSignal(snapshot) : true;
    }

    _waitForTransitionIdle(timeoutMs = 6000) {
        if (!this.transitioning) return Promise.resolve(true);
        const start = performance.now();
        return new Promise((resolve) => {
            const check = () => {
                if (!this.transitioning) {
                    resolve(true);
                    return;
                }
                if (performance.now() - start >= timeoutMs) {
                    resolve(false);
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
    }

    _waitForStartIdle(timeoutMs = 6000) {
        if (!this.starting) return Promise.resolve(true);
        const start = performance.now();
        return new Promise((resolve) => {
            const check = () => {
                if (!this.starting) {
                    resolve(true);
                    return;
                }
                if (performance.now() - start >= timeoutMs) {
                    resolve(false);
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
    }

    async applyPreset(id) {
        const preset = this._allPresets().find((p) => p.id === id);
        if (this.wtfActive) this._stopWtf();
        if (!preset) return;
        if (this.transitioning) {
            const ready = await this._waitForTransitionIdle();
            if (!ready) return;
        }
        const previousPresetId = this.activePresetId;
        const presetParams = stripSourceParams(preset.params);
        const target = normalizeParams(
            { ...this._baseForPreset(preset), ...presetParams },
            { preserveBlob: true }
        );
        const transitionSeconds = preset.transitionSeconds ?? this.params.transitionSeconds;
        target.transitionSeconds = this.params.transitionSeconds;
        const targetChanged = Object.keys(target).some((key) => target[key] !== this.params[key]);
        if (preset.id === this.activePresetId && !targetChanged) {
            this._renderPresets();
            return;
        }
        try {
            await this._transitionTo(target, transitionSeconds);
            if (!preset.readonly) {
                preset.params = presetParams;
                this._persistPresets();
            }
            this.activePresetId = preset.id;
        } catch (error) {
            this.activePresetId = previousPresetId;
            console.error(error);
        }
        this._renderPresets();
    }

    async _transitionTo(target, seconds) {
        const before = { ...this.params };
        const changed = Object.keys(target).filter((key) => target[key] !== before[key]);
        const needsRebuild = changed.some((key) => STRUCTURAL_KEYS.has(key));
        if (seconds <= 0) {
            const mediaState = this._captureStaticMediaState(target);
            this.params = target;
            this._syncInputs();
            this._persist();
            if (this.running) await this.restart({ mediaState });
            else this._applyVisualState();
            return;
        }
        if (needsRebuild) {
            await this._crossfadeRebuild(target, seconds);
            return;
        }
        await this._tweenParams(before, target, seconds);
    }

    _tweenParams(from, to, seconds, options = {}) {
        this.transitioning = true;
        return new Promise((resolve) => {
            const start = performance.now();
            const duration = Math.max(1, seconds * 1000);
            const step = (now) => {
                const t = clamp((now - start) / duration, 0, 1);
                const eased = easeInOut(t);
                for (const key of Object.keys(to)) {
                    if (CLIENT_TWEEN_KEYS.has(key) && typeof from[key] === 'number' && typeof to[key] === 'number') {
                        this.params[key] = from[key] + (to[key] - from[key]) * eased;
                    } else if (t >= 0.5) {
                        this.params[key] = to[key];
                    }
                }
                this._syncInputs();
                this._applyVisualState();
                if (this.running) {
                    if (this.params.sourceMode === 'static') this.staticRuntime.updateParams(this.params);
                    else this.streamRuntime.updateParams(this.params);
                }
                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    this.params = to;
                    this._syncInputs();
                    this._persist();
                    if (!options.keepTransitioning) this.transitioning = false;
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    _captureTransitionFrame() {
        const rect = els.container.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        const activeSurface = this._activeRenderSurface();
        let oldSnapshot = null;

        if (activeSurface) {
            const source = activeSurface;
            const sourceWidth = source?.videoWidth || source?.naturalWidth || source?.width || 0;
            const sourceHeight = source?.videoHeight || source?.naturalHeight || source?.height || 0;
            if (sourceWidth > 0 && sourceHeight > 0) {
                const snapshot = document.createElement('canvas');
                snapshot.width = width;
                snapshot.height = height;
                const ctx = snapshot.getContext('2d', { alpha: true });
                const scale = Math.min(width / sourceWidth, height / sourceHeight);
                const drawWidth = Math.max(1, Math.floor(sourceWidth * scale));
                const drawHeight = Math.max(1, Math.floor(sourceHeight * scale));
                const dx = Math.floor((width - drawWidth) / 2);
                const dy = Math.floor((height - drawHeight) / 2);

                try {
                    ctx.clearRect(0, 0, width, height);
                    ctx.fillStyle = '#030405';
                    ctx.fillRect(0, 0, width, height);
                    ctx.imageSmoothingEnabled = Boolean(this.params.smoothing);
                    ctx.filter = 'none';
                    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
                    if (canvasHasVisibleSignal(snapshot)) oldSnapshot = snapshot;
                    else console.debug('[Transition] Render surface capture was blank; using software preset snapshot.');
                } catch (error) {
                    console.info('[Transition] Surface could not be captured:', error);
                }
            }
        }

        oldSnapshot ||= this._makeSoftwareTransitionSnapshot(this.params, width, height);
        if (!oldSnapshot) return false;
        return this._showTransitionSnapshot(oldSnapshot);
    }

    _styleTransitionCanvas(canvas) {
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.objectFit = 'contain';
        canvas.style.imageRendering = 'pixelated';
    }

    _showTransitionSnapshot(snapshot) {
        els.transitionLayer.innerHTML = '';
        els.transitionLayer.style.opacity = '1';
        this.transitionFadeCanvas = snapshot;
        this._styleTransitionCanvas(snapshot);
        els.transitionLayer.appendChild(snapshot);
        els.transitionLayer.style.display = 'block';
        return true;
    }

    _insertTransitionUnderlay(snapshot) {
        if (!snapshot || !this.transitionFadeCanvas || !els.transitionLayer.contains(this.transitionFadeCanvas)) return false;
        this._styleTransitionCanvas(snapshot);
        els.transitionLayer.insertBefore(snapshot, this.transitionFadeCanvas);
        return true;
    }

    _makeSoftwareTransitionSnapshot(params, width, height, options = {}) {
        if (params.sourceMode !== 'static') return false;
        const source = this._staticMediaSource();
        const frameCount = Number(this.staticRuntime.renderer?.frameCount ?? 0);
        try {
            const snapshot = renderSoftwareCellSnapshot(source, params, width, height, frameCount, {
                maxCells: options.maxCells ?? 35000,
                sampleLimit: options.sampleLimit ?? 700
            });
            return snapshot && canvasHasVisibleSignal(snapshot) ? snapshot : null;
        } catch (error) {
            console.info('[Transition] Software preset snapshot failed:', error);
            return null;
        }
    }

    _hideTransitionLayer() {
        els.transitionLayer.style.display = 'none';
        els.transitionLayer.style.opacity = '0';
        els.transitionLayer.innerHTML = '';
        this.transitionFadeCanvas = null;
    }

    async _paintCurrentFrame(frameCount = 5, minPaintedFrames = 2) {
        const renderer = this.staticRuntime.renderer;
        const startFrame = Number(renderer?.frameCount ?? 0);
        let advanced = !renderer || !Number.isFinite(startFrame);
        for (let i = 0; i < frameCount; i++) {
            if (renderer?.renderFrame) {
                renderer.renderFrame();
            } else if (renderer?._renderFrame) {
                renderer._renderFrame();
            }
            if (renderer?.device?.queue?.onSubmittedWorkDone) {
                await settleWithTimeout(renderer.device.queue.onSubmittedWorkDone(), GPU_QUEUE_SETTLE_TIMEOUT_MS);
            }
            if (Number(renderer?.frameCount ?? startFrame) > startFrame) advanced = true;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (advanced && i + 1 >= minPaintedFrames) break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return advanced;
    }

    _crossfadeLiveRenderer(target, seconds) {
        this.transitioning = true;
        return new Promise((resolve, reject) => {
            const duration = Math.max(80, seconds * 1000);
            let prepared = null;
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                this.staticRuntime.finishCrossfadeRenderer(prepared);
                this.transitioning = false;
                resolve();
            };

            const run = async () => {
                this.params = target;
                this._syncInputs();
                this._persist();
                this._applyVisualState();

                prepared = await this.staticRuntime.prepareCrossfadeRenderer(target);
                if (!prepared) {
                    await this.restart({ mediaState: this._captureStaticMediaState(target) });
                    finish();
                    return;
                }

                await this._ensureStaticVideoPlayback();
                this.setConnection(this._staticConnectionLabel());
                this.setBackend(prepared.stats?.backend || 'static');
                this.updateMeters();
                if (this.popout && !this.popout.closed) {
                    this._restartPopoutOutput().catch((error) => console.warn('[Popout] Restart failed:', error));
                }

                await this._paintCurrentFrame(3, 1);

                const start = performance.now();
                const step = (now) => {
                    const t = clamp((now - start) / duration, 0, 1);
                    if (prepared?.oldLayer) prepared.oldLayer.style.opacity = String(crossfadeOut(t));
                    if (t < 1) requestAnimationFrame(step);
                    else finish();
                };
                requestAnimationFrame(step);
            };

            run().catch((error) => {
                this.staticRuntime.cancelCrossfadeRenderer(prepared);
                this.transitioning = false;
                reject(error);
            });
        });
    }

    _crossfadeRebuild(target, seconds) {
        if (
            this.running &&
            this.params.sourceMode === 'static' &&
            target.sourceMode === 'static' &&
            this.staticRuntime.canReuseSource(target)
        ) {
            return this._crossfadeLiveRenderer(target, seconds);
        }

        this.transitioning = true;
        return new Promise((resolve) => {
            const duration = Math.max(80, seconds * 1000);
            const captured = this.running ? this._captureTransitionFrame() : false;
            const mediaState = this._captureStaticMediaState(target);
            let fadeDone = !captured;
            let rebuildDone = false;
            let finished = false;
            let fadeStarted = false;

            const finish = () => {
                if (finished || !fadeDone || !rebuildDone) return;
                finished = true;
                this._hideTransitionLayer();
                this.transitioning = false;
                resolve();
            };

            const startFade = () => {
                if (!captured || fadeStarted) return;
                fadeStarted = true;
                const start = performance.now();
                const step = (now) => {
                    const t = clamp((now - start) / duration, 0, 1);
                    const opacity = String(crossfadeOut(t));
                    if (this.transitionFadeCanvas) this.transitionFadeCanvas.style.opacity = opacity;
                    else els.transitionLayer.style.opacity = opacity;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        fadeDone = true;
                        finish();
                    }
                };
                requestAnimationFrame(step);
            };

            const prepareUnderlayThenFade = () => {
                if (!captured) return;
                const width = this.transitionFadeCanvas?.width || 0;
                const height = this.transitionFadeCanvas?.height || 0;
                const fallbackTimer = window.setTimeout(startFade, 90);
                requestAnimationFrame(() => {
                    window.setTimeout(() => {
                        try {
                            const underlay = this._makeSoftwareTransitionSnapshot(target, width, height, { maxCells: 30000, sampleLimit: 700 });
                            if (underlay) this._insertTransitionUnderlay(underlay);
                        } finally {
                            window.clearTimeout(fallbackTimer);
                            startFade();
                        }
                    }, 0);
                });
            };

            const rebuild = async () => {
                this.params = target;
                this._syncInputs();
                this._persist();
                if (this.running) {
                    await this.restart({ mediaState });
                    if (this.params.sourceMode === 'static') {
                        const painted = await this._paintCurrentFrame();
                        if (!painted) await new Promise((resolve) => setTimeout(resolve, 120));
                    }
                } else {
                    this._applyVisualState();
                }
                rebuildDone = true;
                finish();
            };

            prepareUnderlayThenFade();
            rebuild().catch((error) => {
                console.error(error);
                rebuildDone = true;
                fadeDone = true;
                finish();
            });
        });
    }

    _saveCurrentPreset() {
        const name = prompt('Preset name', 'Custom Remix');
        if (!name) return;
        const preset = {
            id: `user-${Date.now()}`,
            name,
            transitionSeconds: this.params.transitionSeconds,
            readonly: false,
            params: renderPresetParams(this.params)
        };
        this.userPresets.push(preset);
        this.activePresetId = preset.id;
        this._persistPresets();
        this._renderPresets();
    }

    _selectedUserPreset() {
        return this.userPresets.find((p) => p.id === this.activePresetId);
    }

    _duplicatePreset() {
        const source = this._allPresets().find((p) => p.id === this.activePresetId);
        if (!source) return;
        const name = prompt('Duplicate preset name', `${source.name} Copy`);
        if (!name) return;
        const preset = {
            ...clone(source),
            id: `user-${Date.now()}`,
            name,
            readonly: false,
            params: stripSourceParams(source.params)
        };
        this.userPresets.push(preset);
        this.activePresetId = preset.id;
        this._persistPresets();
        this._renderPresets();
    }

    _updatePreset() {
        const preset = this._selectedUserPreset();
        if (!preset || !this._isUserPresetDirty(preset)) return;
        preset.params = renderPresetParams(this.params);
        preset.transitionSeconds = this.params.transitionSeconds;
        this._persistPresets();
        this._renderPresets();
    }

    async _deletePreset() {
        const preset = this._selectedUserPreset();
        if (!preset) return;
        if (!confirm(`Delete preset "${preset.name}"?`)) return;
        this.userPresets = this.userPresets.filter((p) => p.id !== preset.id);
        this.activePresetId = 'point-click-default';
        this._persistPresets();
        const fallback = BUILTIN_PRESETS.find((item) => item.id === this.activePresetId);
        if (fallback) {
            const fallbackParams = stripSourceParams(fallback.params);
            const target = normalizeParams(
                { ...this._baseForPreset(fallback), ...fallbackParams },
                { preserveBlob: true }
            );
            target.transitionSeconds = this.params.transitionSeconds;
            try {
                await this._transitionTo(target, fallback.transitionSeconds ?? this.params.transitionSeconds);
            } catch (error) {
                console.error(error);
            }
        }
        this._renderPresets();
    }

    _sanitizedUserPresets() {
        return (Array.isArray(this.userPresets) ? this.userPresets : []).map((preset, idx) => {
            const clean = preset && typeof preset === 'object' ? clone(preset) : {};
            clean.id = clean.id || `user-${Date.now()}-${idx}`;
            clean.name = clean.name || `Preset ${idx + 1}`;
            clean.readonly = false;
            clean.transitionSeconds = Number(clean.transitionSeconds ?? this.params.transitionSeconds);
            clean.params = stripSourceParams(clean.params);
            return clean;
        });
    }

    async _exportPresets() {
        const payload = JSON.stringify({ presets: this._sanitizedUserPresets() }, null, 2);
        try {
            await navigator.clipboard.writeText(payload);
            alert('User presets copied to clipboard.');
        } catch {
            prompt('Copy preset JSON', payload);
        }
    }

    _importPresets() {
        const raw = prompt('Paste preset JSON');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const incoming = Array.isArray(parsed) ? parsed : parsed.presets;
            if (!Array.isArray(incoming)) throw new Error('Missing presets array');
            this.userPresets = incoming.map((preset, idx) => ({
                id: preset.id || `user-import-${Date.now()}-${idx}`,
                name: preset.name || `Imported ${idx + 1}`,
                readonly: false,
                transitionSeconds: Number(preset.transitionSeconds ?? this.params.transitionSeconds),
                params: stripSourceParams(normalizeParams(preset.params || {}))
            }));
            if (!this._allPresets().some((preset) => preset.id === this.activePresetId)) {
                this.activePresetId = 'point-click-default';
            }
            this._persistPresets();
            this._renderPresets();
        } catch (error) {
            alert(`Import failed: ${error.message}`);
        }
    }

    _persist() {
        saveJson(STORAGE_KEY, persistedParams(this.params));
    }

    _persistPresets() {
        this.userPresets = this._sanitizedUserPresets();
        saveJson(PRESET_KEY, this.userPresets);
    }
}

const app = new RendererLabApp();
app.init();
window.ascilineRemix = app;
