import { detectMediaType, loadMediaSource } from './renderers/gpu/media-source.js?v=20260620-startup-permissions';
import { createRenderer, detectCapabilities } from './renderers/gpu/ascii/renderer/index.js?v=20260618-camera-source';
import {
    glyphForLuma,
    processCanvasColorLegacy as processColor,
    processGpuCellColor,
    shaderHash
} from './renderers/shared/render-math.js?v=20260625-render-math';
import {
    clearTauriBrowsingData,
    captureTauriCrashReport,
    checkTauriUpdate,
    discardTauriCrashReports,
    getTauriCrashReportState,
    installTauriUpdate,
    isTauriRuntime,
    listenTauriEvent,
    listTauriOutputDisplays,
    openTauriMediaFile,
    openTauriOutputWindow,
    probeTauriMediaFile,
    readTauriInputAudioFeatures,
    readTauriMediaSessionFrames,
    readTauriRawVideoFrames,
    readTauriSystemAudioFeatures,
    recordTauriMediaDiagnostic,
    requestTauriMediaPermission,
    sendTauriOutputFrame,
    sendTauriOutputPixels,
    sendTauriOutputState,
    setTauriCrashReportHandler,
    setTauriCrashReportPreference,
    startTauriMediaSession,
    startTauriRawVideoSession,
    startTauriInputAudioCapture,
    startTauriSystemAudioCapture,
    stopTauriInputAudioCapture,
    stopTauriSystemAudioCapture,
    stopTauriMediaSession,
    stopTauriRawVideoSession,
    submitTauriCrashReports
} from './renderers/desktop/tauri-adapter.js';
import {
    browserScreenPlacement,
    selectBrowserScreen
} from './renderers/desktop/output-display.js';

const $ = (id) => document.getElementById(id);

function redirectUnsafeLoopbackAlias() {
    if (location.protocol === 'http:' && location.hostname === '0.0.0.0') {
        location.replace(`http://127.0.0.1:${location.port}${location.pathname}${location.search}${location.hash}`);
    }
}

redirectUnsafeLoopbackAlias();

const els = {
    sourceMode: $('source-mode'),
    backend: $('backend'),
    togglePlay: $('toggle-play'),
    backendStatus: $('backend-status'),
    connectionStatus: $('connection-status'),
    checkUpdate: $('check-update'),
    crashReportStatus: $('crash-report-status'),
    updateStatus: $('update-status'),
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
    outputDisplay: $('output-display'),
    wtfButton: $('wtf-randomize'),
    sourceList: $('source-list'),
    addCustomFile: $('add-custom-file'),
    localMediaFile: $('local-media-file'),
    cameraControlsSlot: $('camera-controls-slot'),
    audioReactiveSource: $('audio-reactive-source'),
    audioReactivePreset: $('audio-reactive-preset'),
    audioReactiveInput: $('audio-reactive-input'),
    audioReactiveToggle: $('audio-reactive-toggle'),
    audioReactiveFile: $('audio-reactive-file'),
    audioReactivePickFile: $('audio-reactive-pick-file'),
    audioReactiveStatus: $('audio-reactive-status'),
    audioReactiveControls: $('audio-reactive-controls'),
    audioReactiveMeters: $('audio-reactive-meters'),
    controls: $('controls'),
    crashReportDialog: $('crash-report-dialog'),
    crashReportClose: $('crash-report-close'),
    crashReportPreview: $('crash-report-preview'),
    crashReportPreference: $('crash-report-preference'),
    crashReportDiscard: $('crash-report-discard'),
    crashReportSend: $('crash-report-send')
};

const STORAGE_KEY = 'asciline-remix-state-v1';
const PRESET_KEY = 'asciline-remix-user-presets-v1';
const CUSTOM_SOURCE_KEY = 'asciline-remix-custom-source-v1';
const OUTPUT_DISPLAY_KEY = 'asciline-remix-output-display-v1';
const FPS_DEFAULT_MIGRATION_KEY = 'asciline-remix-fps-default-migrated-v1';
const DEFAULT_SOURCE_MIGRATION_KEY = 'asciline-remix-demo-image-default-migrated-v1';
const CUSTOM_HANDLE_DB = 'asciline-remix-custom-source-db';
const CUSTOM_HANDLE_STORE = 'handles';
const CUSTOM_HANDLE_ID = 'custom-media';
const CUSTOM_SOURCE_ID = 'custom-file';
const CAMERA_SOURCE_ID = 'camera';
const CAMERA_MEDIA_URL = 'camera://local';
const CAMERA_MIX_MEDIA_URL = 'camera://mix';
const CUSTOM_MEDIA_PICKER_OPTIONS = {
    multiple: false,
    excludeAcceptAllOption: false,
    types: [{
        description: 'Media files',
        accept: {
            'video/*': ['.mp4', '.webm', '.mkv'],
            'video/x-matroska': ['.mkv'],
            'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.svg']
        }
    }]
};

const DEFAULT_PARAMS = {
    sourceMode: 'static',
    backend: 'auto',
    mediaUrl: 'media/demo.svg',
    mediaType: 'image',
    sourceName: 'Demo Image',
    cameraDeviceId: '',
    cameraSelectedDeviceIds: [],
    cameraFacingMode: 'any',
    cameraResolution: 'auto',
    cameraFps: 30,
    cameraMirror: true,
    cameraLayout: 'grid',
    cameraFit: 'cover',
    loop: true,
    muted: true,
    volume: 1,
    cols: 480,
    rows: 0,
    autoRows: true,
    fps: 60,
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

const RESPONSIVE_FRAME_MS = 1000 / 60;
const AUDIO_REACTIVE_FRAME_MS = 1000 / 60;
const NATIVE_OUTPUT_REACTIVE_SYNC_MS = 1000 / 60;
const WTF_MIN_SMOOTH_FPS = 24;
const WTF_MAX_SMOOTH_FPS = 60;
const TAURI_RAW_VIDEO_MAX_DIMENSION = 960;
const TAURI_RAW_VIDEO_MAX_PIXELS = 640 * 360;
const TAURI_RAW_VIDEO_BATCH_SIZE = 2;

const CHARACTER_SET_OPTIONS = Object.freeze([
    ['point-click', 'Point & Click'],
    ['classic-camera', 'Classic Camera'],
    ['asciline', 'ASCILINE'],
    ['blocks', 'Blocks']
]);
const CHARACTER_SET_IDS = Object.freeze(CHARACTER_SET_OPTIONS.map(([id]) => id));
const FONT_FAMILY_OPTIONS = Object.freeze([
    ['Courier New', 'Courier New'],
    ['monospace', 'Monospace'],
    ['Menlo', 'Menlo'],
    ['Consolas', 'Consolas']
]);
const FONT_FAMILY_IDS = Object.freeze(FONT_FAMILY_OPTIONS.map(([id]) => id));

const SOURCE_PRESETS = [
    { id: 'demo-image', name: 'Demo Image', mediaUrl: 'media/demo.svg', mediaType: 'image' },
    { id: 'demo-video', name: 'Demo Video', mediaUrl: 'media/demo-video-2.mp4', mediaType: 'video' }
];

const CAMERA_RESOLUTION_OPTIONS = [
    ['auto', 'Auto'],
    ['640x480', '480p'],
    ['1280x720', '720p'],
    ['1920x1080', '1080p'],
    ['3840x2160', '4K']
];

const CAMERA_LAYOUT_OPTIONS = [
    ['grid', 'Grid'],
    ['horizontal', 'Split row'],
    ['vertical', 'Stack'],
    ['pip', 'PiP']
];

const CAMERA_FIT_OPTIONS = [
    ['cover', 'Fill'],
    ['contain', 'Fit']
];

const AUDIO_REACTIVE_DEFAULTS = {
    enabled: true,
    source: 'input',
    inputDeviceId: '',
    preset: 'pulse-reactor',
    sensitivity: 7.5,
    smoothing: 0.45,
    beatAmount: 1.68,
    bassAmount: 1.25,
    midAmount: 1.14,
    trebleAmount: 1.16
};

const AUDIO_REACTIVE_SOURCE_OPTIONS = [
    ['file', 'Audio file'],
    ['input', 'Mic / input'],
    ['display', isTauriRuntime() ? 'System audio' : 'Display audio']
];

const AUDIO_REACTIVE_PRESETS = [
    {
        id: 'pulse-reactor',
        name: 'Pulse Reactor',
        routes: [
            ['brightness', 'beatPulse', 0.24],
            ['contrastBoost', 'beatPulse', 0.42],
            ['bgBlend', 'bass', 0.16],
            ['jitterAmount', 'flux', 0.28],
            ['jitterSpeed', 'treble', 0.85],
            ['saturationBoost', 'mid', 0.36],
            ['gamma', 'beatPulse', -0.12]
        ],
        sway: 0.055
    },
    {
        id: 'bass-tremor',
        name: 'Bass Tremor',
        routes: [
            ['bgBlend', 'bass', 0.32],
            ['brightness', 'bass', 0.18],
            ['contrastBoost', 'bass', 0.34],
            ['jitterAmount', 'bass', 0.38],
            ['jitterSpeed', 'beatPulse', 0.55],
            ['gamma', 'bass', -0.18]
        ],
        sway: 0.035
    },
    {
        id: 'snare-shatter',
        name: 'Snare Shatter',
        routes: [
            ['jitterAmount', 'flux', 0.58],
            ['jitterSpeed', 'flux', 1.3],
            ['contrastBoost', 'beatPulse', 0.26],
            ['brightness', 'treble', 0.12],
            ['saturationBoost', 'treble', 0.25]
        ],
        sway: 0.09
    },
    {
        id: 'spectral-bloom',
        name: 'Spectral Bloom',
        routes: [
            ['saturationBoost', 'treble', 0.72],
            ['brightness', 'mid', 0.18],
            ['contrastBoost', 'rms', 0.24],
            ['bgBlend', 'rms', -0.12],
            ['gamma', 'treble', -0.16]
        ],
        sway: 0.045
    },
    {
        id: 'chromatic-surge',
        name: 'Chromatic Surge',
        routes: [
            ['saturationBoost', 'beatPulse', 0.95],
            ['contrastBoost', 'bass', 0.3],
            ['brightness', 'beatPulse', 0.18],
            ['gamma', 'mid', -0.22],
            ['jitterAmount', 'treble', 0.22],
            ['jitterSpeed', 'beatPulse', 1.1]
        ],
        sway: 0.07
    }
];

const AUDIO_REACTIVE_CONTROLS = [
    { key: 'sensitivity', label: 'Sensitivity', min: 0, max: 8, step: 0.05 },
    { key: 'smoothing', label: 'Smoothing', min: 0, max: 0.95, step: 0.01 },
    { key: 'beatAmount', label: 'Beat', min: 0, max: 2, step: 0.01 },
    { key: 'bassAmount', label: 'Bass', min: 0, max: 2, step: 0.01 },
    { key: 'midAmount', label: 'Mid', min: 0, max: 2, step: 0.01 },
    { key: 'trebleAmount', label: 'Treble', min: 0, max: 2, step: 0.01 }
];

const AUDIO_REACTIVE_SAFE_LIMITS = {
    saturationBoost: [0, 3],
    contrastBoost: [0.45, 2.85],
    brightness: [0.55, 1.85],
    gamma: [0.55, 2.65],
    bgBlend: [0, 0.72],
    jitterAmount: [0, 1],
    jitterSpeed: [0, 4],
    sampleX: [0.04, 0.96],
    sampleY: [0.04, 0.96]
};

const AUDIO_REACTIVE_TRANSIENT_FFT_SIZE = 256;
const AUDIO_REACTIVE_SPECTRAL_FFT_SIZE = 1024;
const AUDIO_REACTIVE_BEAT_HISTORY = 18;
const AUDIO_REACTIVE_SILENCE_THRESHOLD = 0.008;
const AUDIO_REACTIVE_SILENCE_NOTICE_MS = 2200;

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
        id: 'classic-camera-ascii',
        name: 'Classic Camera ASCII',
        readonly: true,
        transitionSeconds: 1.1,
        params: {
            backend: 'canvas2d',
            cols: 170,
            autoRows: true,
            cellWidth: 6,
            cellHeight: 9,
            saturationBoost: 0,
            contrastBoost: 1.75,
            brightness: 1.08,
            gamma: 1,
            bgBlend: 0.04,
            quantizeBits: 0,
            jitterAmount: 0,
            jitterSpeed: 0,
            sampleX: 0.5,
            sampleY: 0.5,
            smoothing: false,
            solidMode: false,
            glyphMode: true,
            charset: 'classic-camera',
            fontFamily: 'Courier New',
            mode: 1,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'ansi-newsprint',
        name: 'ANSI Newsprint',
        readonly: true,
        transitionSeconds: 1.35,
        params: {
            backend: 'canvas2d',
            cols: 210,
            autoRows: true,
            cellWidth: 5,
            cellHeight: 8,
            saturationBoost: 0.08,
            contrastBoost: 2.15,
            brightness: 1.18,
            gamma: 0.92,
            bgBlend: 0.1,
            quantizeBits: 1,
            jitterAmount: 0,
            jitterSpeed: 0,
            sampleX: 0.5,
            sampleY: 0.5,
            smoothing: false,
            solidMode: false,
            glyphMode: true,
            charset: 'asciline',
            fontFamily: 'Courier New',
            mode: 1,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'terminal-mono',
        name: 'Terminal Mono',
        readonly: true,
        transitionSeconds: 1.2,
        params: {
            backend: 'canvas2d',
            cols: 140,
            autoRows: true,
            cellWidth: 7,
            cellHeight: 11,
            saturationBoost: 0,
            contrastBoost: 2.55,
            brightness: 0.9,
            gamma: 1.35,
            bgBlend: 0.28,
            quantizeBits: 2,
            jitterAmount: 0,
            jitterSpeed: 0,
            sampleX: 0.5,
            sampleY: 0.5,
            smoothing: false,
            solidMode: false,
            glyphMode: true,
            charset: 'classic-camera',
            fontFamily: 'Menlo',
            mode: 1,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'dense-typewriter',
        name: 'Dense Typewriter',
        readonly: true,
        transitionSeconds: 1.4,
        params: {
            backend: 'canvas2d',
            cols: 260,
            autoRows: true,
            cellWidth: 4,
            cellHeight: 7,
            saturationBoost: 0.18,
            contrastBoost: 1.95,
            brightness: 1.05,
            gamma: 0.86,
            bgBlend: 0.08,
            quantizeBits: 0,
            jitterAmount: 0,
            jitterSpeed: 0,
            sampleX: 0.5,
            sampleY: 0.5,
            smoothing: false,
            solidMode: false,
            glyphMode: true,
            charset: 'point-click',
            fontFamily: 'Courier New',
            mode: 2,
            pixel: false,
            codecQuality: 'balanced'
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
    },
    {
        id: 'gamma-sinkhole',
        name: 'Gamma Sinkhole',
        readonly: true,
        transitionSeconds: 1.05,
        params: {
            cols: 132,
            cellWidth: 8,
            cellHeight: 12,
            saturationBoost: 0.1,
            contrastBoost: 2.85,
            brightness: 1.55,
            gamma: 0.28,
            bgBlend: 0.03,
            jitterAmount: 0.9,
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
        id: 'candy-fragmenter',
        name: 'Candy Fragmenter',
        readonly: true,
        transitionSeconds: 0.8,
        params: {
            cols: 116,
            cellWidth: 9,
            cellHeight: 13,
            saturationBoost: 3,
            contrastBoost: 2.55,
            brightness: 1.05,
            gamma: 0.58,
            bgBlend: 0.05,
            jitterAmount: 1,
            jitterSpeed: 4,
            quantizeBits: 6,
            solidMode: true,
            glyphMode: false,
            mode: 5,
            pixel: true,
            codecQuality: 'low'
        }
    },
    {
        id: 'white-hot-decoder',
        name: 'White-Hot Decoder',
        readonly: true,
        transitionSeconds: 1.2,
        params: {
            cols: 180,
            cellWidth: 6,
            cellHeight: 9,
            saturationBoost: 0.04,
            contrastBoost: 3,
            brightness: 0.9,
            gamma: 2.75,
            bgBlend: 0.02,
            jitterAmount: 0.72,
            jitterSpeed: 3.25,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 1,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'chromatic-meltdown',
        name: 'Chromatic Meltdown',
        readonly: true,
        transitionSeconds: 0.7,
        params: {
            cols: 96,
            cellWidth: 10,
            cellHeight: 15,
            saturationBoost: 3,
            contrastBoost: 3,
            brightness: 0.84,
            gamma: 2.35,
            bgBlend: 0.04,
            jitterAmount: 1,
            jitterSpeed: 3.95,
            quantizeBits: 6,
            solidMode: true,
            glyphMode: false,
            mode: 5,
            pixel: true,
            codecQuality: 'low'
        }
    },
    {
        id: 'dead-channel-confetti',
        name: 'Dead Channel Confetti',
        readonly: true,
        transitionSeconds: 1.35,
        params: {
            cols: 150,
            cellWidth: 7,
            cellHeight: 11,
            saturationBoost: 0,
            contrastBoost: 2.35,
            brightness: 1.22,
            gamma: 0.42,
            bgBlend: 0.06,
            jitterAmount: 1,
            jitterSpeed: 4,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 2,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'sugar-voltage',
        name: 'Sugar Voltage',
        readonly: true,
        transitionSeconds: 0.9,
        params: {
            cols: 210,
            cellWidth: 5,
            cellHeight: 8,
            saturationBoost: 3,
            contrastBoost: 1.85,
            brightness: 0.88,
            gamma: 3,
            bgBlend: 0.01,
            jitterAmount: 0.94,
            jitterSpeed: 3.8,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 5,
            pixel: false,
            codecQuality: 'balanced'
        }
    },
    {
        id: 'bitcrush-sunburn',
        name: 'Bitcrush Sunburn',
        readonly: true,
        transitionSeconds: 1,
        params: {
            cols: 88,
            cellWidth: 11,
            cellHeight: 16,
            saturationBoost: 2.7,
            contrastBoost: 2.95,
            brightness: 1.18,
            gamma: 0.5,
            bgBlend: 0.02,
            jitterAmount: 0.86,
            jitterSpeed: 3.55,
            quantizeBits: 6,
            solidMode: false,
            glyphMode: true,
            mode: 4,
            pixel: false,
            codecQuality: 'low'
        }
    },
    {
        id: 'neon-sledgehammer',
        name: 'Neon Sledgehammer',
        readonly: true,
        transitionSeconds: 0.65,
        params: {
            cols: 80,
            cellWidth: 12,
            cellHeight: 16,
            saturationBoost: 3,
            contrastBoost: 2.7,
            brightness: 0.96,
            gamma: 2.6,
            bgBlend: 0,
            jitterAmount: 1,
            jitterSpeed: 4,
            quantizeBits: 6,
            solidMode: true,
            glyphMode: false,
            mode: 5,
            pixel: true,
            codecQuality: 'low'
        }
    }
];

const BUILTIN_PRESET_DISPLAY_ORDER = [
    'point-click-default',
    'classic-camera-ascii',
    'ansi-newsprint',
    'terminal-mono',
    'dense-typewriter',
    'neon-sledgehammer',
    'arcade-rain',
    'gamma-sinkhole',
    'chrome-wound',
    'candy-fragmenter',
    'posterized-dream',
    'dead-channel-confetti',
    'solar-guillotine',
    'paper-shredder',
    'cyberdelic-riot',
    'night-vision-terminal',
    'white-hot-decoder',
    'acid-snowstorm',
    'pixel-mirage',
    'chromatic-meltdown',
    'blacklight-crush',
    'signal-loss',
    'sugar-voltage',
    'teletext-reactor',
    'bitcrush-sunburn',
    'ditherpunk-ultra',
    'terminal-collapse',
    'infrared-riot',
    'laser-rot',
    'static-cathedral',
    'toxic-halftone',
    'plasma-bruise',
    'magma-telemetry',
    'glitch-orchid',
    'ultraviolet-siren',
    'neon-razorstorm'
];

const EXTREME_WTF_PRESET_IDS = [
    'neon-sledgehammer',
    'gamma-sinkhole',
    'candy-fragmenter',
    'white-hot-decoder',
    'chromatic-meltdown',
    'dead-channel-confetti',
    'sugar-voltage',
    'bitcrush-sunburn',
    'terminal-collapse',
    'chrome-wound',
    'paper-shredder',
    'laser-rot'
];
const ASCII_WTF_PRESET_IDS = [
    'classic-camera-ascii',
    'ansi-newsprint',
    'terminal-mono',
    'dense-typewriter'
];
const WTF_ANCHOR_PRESET_IDS = [
    ...EXTREME_WTF_PRESET_IDS,
    ...ASCII_WTF_PRESET_IDS
];
const ASCII_WTF_PRESET_ID_SET = new Set(ASCII_WTF_PRESET_IDS);

const BUILTIN_PRESET_BY_ID = new Map(BUILTIN_PRESETS.map((preset) => [preset.id, preset]));
const BUILTIN_PRESETS_DISPLAY = [
    ...BUILTIN_PRESET_DISPLAY_ORDER.map((id) => BUILTIN_PRESET_BY_ID.get(id)).filter(Boolean),
    ...BUILTIN_PRESETS.filter((preset) => !BUILTIN_PRESET_DISPLAY_ORDER.includes(preset.id))
];
const WTF_ANCHOR_PRESETS = WTF_ANCHOR_PRESET_IDS.map((id) => BUILTIN_PRESET_BY_ID.get(id)).filter(Boolean);

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
            { key: 'cameraSelectedDeviceIds', label: 'Devices', type: 'device-list' },
            { key: 'cameraFacingMode', label: 'Facing', type: 'select', options: [['any', 'Any'], ['user', 'Front'], ['environment', 'Rear']] },
            { key: 'cameraResolution', label: 'Capture size', type: 'select', options: CAMERA_RESOLUTION_OPTIONS },
            { key: 'cameraFps', label: 'Capture FPS', type: 'range', min: 1, max: 60, step: 1 },
            { key: 'cameraLayout', label: 'Layout', type: 'select', options: CAMERA_LAYOUT_OPTIONS },
            { key: 'cameraFit', label: 'Framing', type: 'select', options: CAMERA_FIT_OPTIONS },
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
            { key: 'charset', label: 'Character set', type: 'select', compactSelect: true, options: CHARACTER_SET_OPTIONS },
            { key: 'fontFamily', label: 'Font family', type: 'select', compactSelect: true, options: FONT_FAMILY_OPTIONS },
            { key: 'minGlyphIntensity', label: 'Min glyph intensity', type: 'range', min: 0, max: 255, step: 1 }
        ]
    }
];

const CONTROL_CONFIG_BY_KEY = new Map(
    CONTROL_GROUPS.flatMap((group) => group.controls.map((control) => [control.key, control]))
);

const AUDIO_REACTIVE_PRESET_MAP = new Map(AUDIO_REACTIVE_PRESETS.map((preset) => [preset.id, preset]));

function clampParamValue(key, value) {
    const config = CONTROL_CONFIG_BY_KEY.get(key);
    if (!config || typeof value !== 'number') return value;
    let next = value;
    if (Number.isFinite(config.min)) next = Math.max(config.min, next);
    if (Number.isFinite(config.max)) next = Math.min(config.max, next);
    if (Number.isFinite(config.step) && Number.isInteger(config.step)) next = Math.round(next);
    return next;
}

function clampAudioReactiveVisualSafety(params, baseParams = {}) {
    for (const [key, [min, max]] of Object.entries(AUDIO_REACTIVE_SAFE_LIMITS)) {
        if (typeof params[key] !== 'number') continue;
        const base = Number(baseParams[key]);
        const safeMin = Number.isFinite(base) ? Math.min(min, base) : min;
        const safeMax = Number.isFinite(base) ? Math.max(max, base) : max;
        params[key] = clamp(params[key], safeMin, safeMax);
    }

    const baseBrightness = Number(baseParams.brightness);
    const brightnessFloor = Number.isFinite(baseBrightness)
        ? Math.min(1, Math.max(0.72, baseBrightness))
        : 0.72;
    if (params.bgBlend > 0.62 && params.brightness < brightnessFloor) {
        params.brightness = brightnessFloor;
    }
    if (params.gamma < 0.7 && params.brightness < Math.max(brightnessFloor, 0.82)) {
        params.brightness = Math.max(brightnessFloor, 0.82);
    }
    return params;
}

function featureAmount(feature, audioSettings) {
    if (feature === 'beatPulse') return audioSettings.beatAmount;
    if (feature === 'bass') return audioSettings.bassAmount;
    if (feature === 'mid' || feature === 'rms' || feature === 'flux') return audioSettings.midAmount;
    if (feature === 'treble') return audioSettings.trebleAmount;
    return 1;
}

function applyAudioReactiveModulation(baseParams, features, audioSettings) {
    const preset = AUDIO_REACTIVE_PRESET_MAP.get(audioSettings.preset) || AUDIO_REACTIVE_PRESETS[0];
    const out = { ...baseParams };
    const sensitivity = Number(audioSettings.sensitivity || 0);

    for (const [key, feature, scale] of preset.routes) {
        const raw = Number(features[feature] || 0);
        const amount = raw * sensitivity * featureAmount(feature, audioSettings);
        out[key] = clampParamValue(key, Number(baseParams[key] || 0) + amount * scale);
    }

    const swayAmount = sensitivity * (preset.sway || 0);
    if (swayAmount > 0) {
        const motion = Math.max(features.flux || 0, features.beatPulse || 0, features.treble * 0.65 || 0);
        const phase = Number(features.phase || 0);
        out.sampleX = clampParamValue('sampleX', Number(baseParams.sampleX || 0.5) + Math.sin(phase) * motion * swayAmount);
        out.sampleY = clampParamValue('sampleY', Number(baseParams.sampleY || 0.5) + Math.cos(phase * 0.73) * motion * swayAmount);
    }

    return clampAudioReactiveVisualSafety(out, baseParams);
}

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
    'cameraSelectedDeviceIds',
    'cameraFacingMode',
    'cameraResolution',
    'cameraFps',
    'cameraMirror',
    'cameraLayout',
    'cameraFit',
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
const STATIC_SOURCE_KEYS = new Set(['sourceMode', 'mediaUrl', 'mediaType', 'cameraDeviceId', 'cameraSelectedDeviceIds', 'cameraFacingMode', 'cameraResolution', 'cameraFps', 'cameraMirror', 'cameraLayout', 'cameraFit']);
const CAMERA_SOURCE_PARAM_KEYS = new Set(['cameraDeviceId', 'cameraSelectedDeviceIds', 'cameraFacingMode', 'cameraResolution', 'cameraFps', 'cameraMirror', 'cameraLayout', 'cameraFit']);
const SOURCE_PARAM_KEYS = new Set(['sourceMode', 'mediaUrl', 'mediaType', 'sourceName', ...CAMERA_SOURCE_PARAM_KEYS]);
const PRESET_EXCLUDED_PARAM_KEYS = new Set([...SOURCE_PARAM_KEYS, 'statsOverlay']);
const MAX_USER_PRESETS = 128;
const MAX_PRESET_NAME_LENGTH = 80;
const MAX_PRESET_ID_LENGTH = 96;
const USER_PRESET_KEYS = new Set(['id', 'name', 'readonly', 'transitionSeconds', 'params']);
const PRESET_PARAM_KEYS = new Set(
    Object.keys(DEFAULT_PARAMS).filter((key) => !PRESET_EXCLUDED_PARAM_KEYS.has(key))
);
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

    cameraSelectedDeviceIds: ({ params }) => isCameraParams(params),
    cameraDeviceId: ({ params }) => isCameraParams(params),
    cameraFacingMode: ({ app, params }) => app?._cameraFacingModeApplies(params) ?? isCameraParams(params),
    cameraResolution: ({ params }) => isCameraParams(params),
    cameraFps: ({ params }) => isCameraParams(params),
    cameraLayout: ({ params }) => isCameraParams(params),
    cameraFit: ({ params }) => isCameraParams(params),
    cameraMirror: ({ params }) => isCameraParams(params),

    codec: ({ params }) => params.sourceMode === 'stream',
    codecQuality: ({ params }) => params.sourceMode === 'stream' && params.codec === 'adaptive',
    codecTolerance: ({ params }) => params.sourceMode === 'stream' && params.codec === 'adaptive',
    bufferSize: ({ params }) => params.sourceMode === 'stream',
    maxBufferMultiplier: ({ params }) => params.sourceMode === 'stream',
    lateDropThreshold: ({ params }) => params.sourceMode === 'stream',
    futureWaitThreshold: ({ params }) => params.sourceMode === 'stream',
    fpsCap: ({ params }) => params.sourceMode === 'stream',

    glyphMode: ({ params }) => !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    solidMode: ({ params }) => !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    charset: ({ params }) => params.glyphMode && !params.solidMode && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
    fontFamily: ({ params }) => params.glyphMode && !params.solidMode && !usesPixelCanvas(params) && (params.sourceMode === 'static' || params.mode > 1),
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

function scheduleResponsiveFrame(callback, delayMs = RESPONSIVE_FRAME_MS) {
    let finished = false;
    let raf = 0;
    let timer = 0;
    const fire = (timestamp = performance.now()) => {
        if (finished) return;
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        if (timer) window.clearTimeout(timer);
        callback(Number.isFinite(timestamp) ? timestamp : performance.now());
    };
    if (typeof requestAnimationFrame === 'function') {
        raf = requestAnimationFrame(fire);
    }
    timer = window.setTimeout(() => fire(performance.now()), Math.max(1, Number(delayMs) || RESPONSIVE_FRAME_MS));
    return () => {
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        if (timer) window.clearTimeout(timer);
    };
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

function isCustomRuntimeMediaUrl(url) {
    const value = String(url || '');
    return value.startsWith('blob:') || value.startsWith('asset:') || value.startsWith('http://asset.localhost') || value.startsWith('https://asset.localhost');
}

function isCameraParams(params) {
    return params?.sourceMode === 'static' && params?.mediaType === 'camera';
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function selectedCameraDeviceIds(params) {
    const selected = normalizeStringArray(params?.cameraSelectedDeviceIds);
    if (selected.length) return selected;
    const legacyDeviceId = String(params?.cameraDeviceId || '').trim();
    return legacyDeviceId ? [legacyDeviceId] : [''];
}

function selectedCameraCount(params) {
    const selected = selectedCameraDeviceIds(params);
    return selected.length === 1 && selected[0] === '' ? 1 : selected.length;
}

function cameraSourceName(params) {
    return selectedCameraCount(params) > 1 ? 'Camera Mix' : 'Camera';
}

function shouldRendererMirrorCamera() {
    return false;
}

function normalizeParams(params, options = {}) {
    const { preserveBlob = false } = options;
    const out = { ...DEFAULT_PARAMS, ...params };
    let hasRuntimeCustomMedia = isCustomRuntimeMediaUrl(out.mediaUrl);
    if (hasRuntimeCustomMedia && !preserveBlob) {
        out.mediaUrl = DEFAULT_PARAMS.mediaUrl;
        out.mediaType = DEFAULT_PARAMS.mediaType;
        out.sourceName = DEFAULT_PARAMS.sourceName;
        hasRuntimeCustomMedia = false;
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
    const matchedSource = hasRuntimeCustomMedia ? null : findSourcePreset(out.mediaUrl, out.mediaType);
    if (matchedSource && out.mediaType === 'auto') out.mediaType = matchedSource.mediaType;
    out.sourceName = isCameraUrl(out.mediaUrl) ? 'Camera' : matchedSource?.name || out.sourceName || sourceNameFromUrl(out.mediaUrl);
    out.mode = Number(out.mode);
    out.cols = Number(out.cols);
    out.rows = Number(out.rows);
    out.fps = clamp(Number(out.fps || DEFAULT_PARAMS.fps), 1, 60);
    out.cellWidth = Number(out.cellWidth);
    out.cellHeight = Number(out.cellHeight);
    out.cameraDeviceId = String(out.cameraDeviceId || '');
    out.cameraSelectedDeviceIds = normalizeStringArray(out.cameraSelectedDeviceIds);
    if (!out.cameraSelectedDeviceIds.length && out.cameraDeviceId) out.cameraSelectedDeviceIds = [out.cameraDeviceId];
    if (out.cameraSelectedDeviceIds.length) out.cameraDeviceId = out.cameraSelectedDeviceIds[0];
    if (!['any', 'user', 'environment'].includes(out.cameraFacingMode)) out.cameraFacingMode = 'any';
    if (!CAMERA_RESOLUTION_OPTIONS.some(([value]) => value === out.cameraResolution)) out.cameraResolution = 'auto';
    out.cameraFps = clamp(Number(out.cameraFps || DEFAULT_PARAMS.cameraFps), 1, 60);
    out.cameraMirror = Boolean(out.cameraMirror);
    if (!CAMERA_LAYOUT_OPTIONS.some(([value]) => value === out.cameraLayout)) out.cameraLayout = 'grid';
    if (!CAMERA_FIT_OPTIONS.some(([value]) => value === out.cameraFit)) out.cameraFit = 'cover';
    if (isCameraUrl(out.mediaUrl)) out.sourceName = cameraSourceName(out);
    out.codecTolerance = CODEC_TOLERANCE[out.codecQuality] ?? Number(out.codecTolerance || 0);
    for (const [key, config] of CONTROL_CONFIG_BY_KEY) {
        if (!(key in out)) continue;
        if (key === 'rows' && out.autoRows) continue;
        if (config.type === 'range') {
            const numeric = Number(out[key]);
            out[key] = clampParamValue(
                key,
                Number.isFinite(numeric) ? numeric : Number(DEFAULT_PARAMS[key] ?? config.min ?? 0)
            );
        } else if (config.type === 'checkbox') {
            out[key] = Boolean(out[key]);
        } else if (config.type === 'select' && Array.isArray(config.options)) {
            const allowedValues = config.options.map(([value]) => String(value));
            const current = String(out[key] ?? '');
            const next = allowedValues.includes(current) ? current : String(DEFAULT_PARAMS[key] ?? allowedValues[0] ?? '');
            out[key] = typeof DEFAULT_PARAMS[key] === 'number' ? Number(next) : next;
        }
    }
    return out;
}

function migrateStoredParams(params) {
    const out = { ...(params || {}) };
    if (localStorage.getItem(DEFAULT_SOURCE_MIGRATION_KEY) !== '1') {
        const oldDefaultSource = (
            out.mediaUrl === 'media/point-click-test-30s.mp4' ||
            out.mediaUrl === 'media/point-click-test.mp4' ||
            out.sourceName === 'Demo Video 1' ||
            out.sourceName === 'Point and Click Test'
        );
        if ((out.sourceMode || DEFAULT_PARAMS.sourceMode) === 'static' && oldDefaultSource) {
            out.mediaUrl = DEFAULT_PARAMS.mediaUrl;
            out.mediaType = DEFAULT_PARAMS.mediaType;
            out.sourceName = DEFAULT_PARAMS.sourceName;
        }
        localStorage.setItem(DEFAULT_SOURCE_MIGRATION_KEY, '1');
    }

    if (localStorage.getItem(FPS_DEFAULT_MIGRATION_KEY) !== '1') {
        const isOldStaticDefaultFps = (out.sourceMode || DEFAULT_PARAMS.sourceMode) === 'static' &&
            (out.fps === undefined || Number(out.fps) === 24);
        if (isOldStaticDefaultFps) out.fps = DEFAULT_PARAMS.fps;
        localStorage.setItem(FPS_DEFAULT_MIGRATION_KEY, '1');
    }
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

function extensionFromName(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
    return match ? match[1] : '';
}

function isMkvName(name) {
    return extensionFromName(name) === 'mkv';
}

function parseCameraResolution(value) {
    const match = String(value || '').match(/^(\d+)x(\d+)$/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function cameraConstraintKey(params) {
    return stableJson({
        deviceIds: selectedCameraDeviceIds(params),
        facingMode: params.cameraFacingMode || 'any',
        resolution: params.cameraResolution || 'auto',
        fps: Math.round(Number(params.cameraFps || DEFAULT_PARAMS.cameraFps))
    });
}

function cameraConstraintsFromParams(params, deviceId = '') {
    const video = {};
    if (deviceId) {
        video.deviceId = { exact: deviceId };
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

function simpleCameraConstraints(deviceId = '') {
    return { audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true };
}

function isPermissionOrMissingDeviceError(error) {
    return error?.name === 'NotAllowedError' ||
        error?.name === 'SecurityError' ||
        error?.name === 'NotFoundError' ||
        isPermissionBlockedError(error);
}

function cameraErrorStatus(error) {
    if (!navigator.mediaDevices?.getUserMedia) return { status: 'unsupported', message: 'Camera unsupported' };
    if (!window.isSecureContext && !isTauriRuntime()) return { status: 'denied', message: 'Use http://127.0.0.1 or localhost' };
    if (error?.nativePermissionFailure) return { status: 'error', message: error.message };
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError' || isPermissionBlockedError(error)) {
        return { status: 'denied', message: 'Camera permission blocked' };
    }
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return { status: 'missing', message: 'No camera found' };
    return { status: 'error', message: error?.message || 'Camera failed' };
}

function defaultStaticSourceParams() {
    return {
        sourceMode: 'static',
        mediaUrl: DEFAULT_PARAMS.mediaUrl,
        mediaType: DEFAULT_PARAMS.mediaType,
        sourceName: DEFAULT_PARAMS.sourceName,
        cameraDeviceId: DEFAULT_PARAMS.cameraDeviceId,
        cameraSelectedDeviceIds: DEFAULT_PARAMS.cameraSelectedDeviceIds,
        cameraFacingMode: DEFAULT_PARAMS.cameraFacingMode,
        cameraResolution: DEFAULT_PARAMS.cameraResolution,
        cameraFps: DEFAULT_PARAMS.cameraFps,
        cameraMirror: DEFAULT_PARAMS.cameraMirror,
        cameraLayout: DEFAULT_PARAMS.cameraLayout,
        cameraFit: DEFAULT_PARAMS.cameraFit
    };
}

function startupSafeParams(params) {
    const normalized = normalizeParams(params);
    if (normalized.sourceMode === 'stream' || isCameraParams(normalized) || isCustomRuntimeMediaUrl(normalized.mediaUrl)) {
        return normalizeParams({ ...normalized, ...defaultStaticSourceParams() });
    }
    return normalized;
}

function audioSourceNeedsUserActivation(source) {
    return source === 'display';
}

function audioStartPromptStatus(source) {
    if (source === 'display') return isTauriRuntime() ? 'Click Start to allow system audio' : 'Click Start to choose display audio';
    if (source === 'input') return 'Click Start to allow audio input';
    return 'Click Start';
}

function isPermissionBlockedError(error) {
    const raw = `${error?.name || ''} ${error?.message || error || ''}`.toLowerCase();
    return raw.includes('notallowed') ||
        raw.includes('not allowed') ||
        raw.includes('denied') ||
        raw.includes('permission') ||
        raw.includes('user agent') ||
        raw.includes('platform in the current context');
}

function mediaPermissionError(kind, status) {
    const error = new Error(`${kind} permission ${status || 'blocked'}`);
    error.name = 'NotAllowedError';
    error.mediaPermissionStatus = status || 'blocked';
    return error;
}

function diagnosticErrorLabel(error) {
    return `${error?.name || 'Error'}: ${error?.message || String(error || '')}`;
}

function mediaDiagnosticContext(kind) {
    return `${kind} href=${location.href} origin=${location.origin} secure=${window.isSecureContext} tauri=${isTauriRuntime()} mediaDevices=${Boolean(navigator.mediaDevices)} getUserMedia=${Boolean(navigator.mediaDevices?.getUserMedia)}`;
}

function logMediaDiagnostic(message) {
    recordTauriMediaDiagnostic(message).catch(() => {});
}

function errorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || error.name || 'Error';
    return error.message || error.reason?.message || String(error);
}

function errorStack(error) {
    if (!error) return '';
    if (error instanceof Error) return error.stack || '';
    if (error.reason instanceof Error) return error.reason.stack || '';
    return error.stack || '';
}

function errorCrashContext(error) {
    const source = error?.reason instanceof Error ? error.reason : error;
    if (!source || typeof source !== 'object') return {};
    const out = {};
    if (source.name) out.name = String(source.name);
    const code = source.errorCode ?? source.code;
    if (code !== undefined && code !== null && code !== '') out.code = String(code);
    const statusCode = source.statusCode ?? source.status;
    if (statusCode !== undefined && statusCode !== null && statusCode !== '') out.statusCode = String(statusCode);
    return out;
}

function crashReportPreview(state) {
    const reports = Array.isArray(state?.reports) ? state.reports : [];
    if (!reports.length) return 'No pending crash reports.';
    return reports.map((report, index) => {
        const context = report.context ? JSON.stringify(report.context, null, 2) : '{}';
        return [
            `#${index + 1} ${report.kind || 'crash'} / ${report.surface || 'unknown'}`,
            `Captured: ${report.capturedAt || 'unknown'}`,
            '',
            report.message || 'Crash report',
            '',
            'Context:',
            context,
            '',
            'Stack:',
            report.stack || 'No stack captured.'
        ].join('\n');
    }).join('\n\n---\n\n');
}

function snapshotAppStorage() {
    const keys = [STORAGE_KEY, PRESET_KEY, CUSTOM_SOURCE_KEY, OUTPUT_DISPLAY_KEY];
    return keys.map((key) => [key, localStorage.getItem(key)]);
}

function restoreAppStorage(snapshot) {
    for (const [key, value] of snapshot || []) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }
}

function nativePermissionCommandError(kind, error) {
    const message = error?.message || String(error || 'unknown error');
    const out = new Error(`Native ${kind} permission request failed: ${message}`);
    out.name = 'NativePermissionError';
    out.nativePermissionFailure = true;
    return out;
}

async function requestNativeCapturePermission(kind) {
    if (!isTauriRuntime()) return null;
    let result = null;
    try {
        logMediaDiagnostic(`native-request start ${mediaDiagnosticContext(kind)}`);
        result = await requestTauriMediaPermission(kind);
        logMediaDiagnostic(`native-request result ${kind} ${JSON.stringify(result)}`);
    } catch (error) {
        logMediaDiagnostic(`native-request error ${kind} ${diagnosticErrorLabel(error)}`);
        console.warn(`[Permissions] Native ${kind} permission request failed:`, error);
        throw nativePermissionCommandError(kind, error);
    }
    if (!result?.available) return result;
    if (result.status !== 'granted') throw mediaPermissionError(kind, result.status);
    return result;
}

async function recoverTauriMediaCapturePermission(kind, error) {
    if (!isTauriRuntime() || !isPermissionBlockedError(error)) return false;
    logMediaDiagnostic(`webview-denied ${kind} ${diagnosticErrorLabel(error)} ${mediaDiagnosticContext(kind)}`);
    console.info(`[Permissions] Clearing WebView media permission state after ${kind} denial.`);
    const storageSnapshot = snapshotAppStorage();
    try {
        const cleared = await clearTauriBrowsingData();
        logMediaDiagnostic(`clear-browsing-data ${kind} cleared=${cleared}`);
        restoreAppStorage(storageSnapshot);
        if (!cleared) return false;
        await requestNativeCapturePermission(kind);
        return true;
    } catch (recoveryError) {
        restoreAppStorage(storageSnapshot);
        logMediaDiagnostic(`recovery-error ${kind} ${diagnosticErrorLabel(recoveryError)}`);
        console.warn(`[Permissions] WebView ${kind} permission recovery failed:`, recoveryError);
        return false;
    }
}

async function getUserMediaWithTauriRecovery(kind, constraints) {
    const pendingTimer = setTimeout(() => {
        logMediaDiagnostic(`getUserMedia pending ${kind} after=5000ms ${mediaDiagnosticContext(kind)}`);
    }, 5000);
    try {
        logMediaDiagnostic(`getUserMedia start ${kind} ${JSON.stringify(constraints)}`);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        clearTimeout(pendingTimer);
        logMediaDiagnostic(`getUserMedia success ${kind} tracks=${stream.getTracks?.().map((track) => `${track.kind}:${track.label || 'unlabeled'}:${track.readyState}`).join(',') || 'none'}`);
        return stream;
    } catch (error) {
        clearTimeout(pendingTimer);
        logMediaDiagnostic(`getUserMedia error ${kind} ${diagnosticErrorLabel(error)}`);
        if (await recoverTauriMediaCapturePermission(kind, error)) {
            const retryPendingTimer = setTimeout(() => {
                logMediaDiagnostic(`getUserMedia retry pending ${kind} after=5000ms ${mediaDiagnosticContext(kind)}`);
            }, 5000);
            logMediaDiagnostic(`getUserMedia retry ${kind}`);
            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                clearTimeout(retryPendingTimer);
                logMediaDiagnostic(`getUserMedia retry success ${kind} tracks=${stream.getTracks?.().map((track) => `${track.kind}:${track.label || 'unlabeled'}:${track.readyState}`).join(',') || 'none'}`);
                return stream;
            } catch (retryError) {
                clearTimeout(retryPendingTimer);
                logMediaDiagnostic(`getUserMedia retry error ${kind} ${diagnosticErrorLabel(retryError)}`);
                throw retryError;
            }
        }
        throw error;
    }
}

function friendlyAudioErrorMessage(error, source) {
    if (source === 'file') return error?.message || 'Choose audio file';
    if (error?.nativePermissionFailure) return error.message;
    if (error?.nativeSystemAudioFailure) return error?.message || 'Native system audio failed';
    if (error?.displayCaptureNoAudio) return error.message;
    if (!window.isSecureContext && !isTauriRuntime()) return 'Audio input requires http://127.0.0.1 or http://localhost';
    if (!navigator.mediaDevices?.getUserMedia && source === 'input') return 'Audio input unavailable';
    if (!navigator.mediaDevices?.getDisplayMedia && source === 'display') return 'Display audio unavailable';
    if (isPermissionBlockedError(error)) {
        if (source === 'display') return 'Display audio needs a Start click and a source with audio enabled.';
        if (source === 'input') return 'Microphone permission blocked. Allow mic access for this app/browser, then press Start.';
    }
    return error?.message || 'Audio failed';
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
        provider: 'browser',
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type || '',
        mediaType: mediaTypeFromFile(file)
    };
}

function customSourceMetaFromTauriFile(file) {
    return {
        provider: 'tauri',
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type || '',
        mediaType: file.mediaType || mediaTypeFromName(file.name)
    };
}

function persistedParams(params) {
    if (!isCustomRuntimeMediaUrl(params.mediaUrl) && !isCameraParams(params)) return params;
    return {
        ...params,
        ...defaultStaticSourceParams()
    };
}

function stripPresetExcludedParams(params) {
    const out = clone(params || {});
    for (const key of PRESET_EXCLUDED_PARAM_KEYS) delete out[key];
    return out;
}

function sanitizePresetText(value, fallback, maxLength) {
    const cleaned = String(value ?? fallback ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, maxLength);
    return cleaned || fallback;
}

function sanitizePresetId(value, fallback) {
    const cleaned = String(value ?? fallback ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[^A-Za-z0-9._:-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, MAX_PRESET_ID_LENGTH);
    return cleaned || fallback;
}

function uniquePresetId(id, usedIds) {
    let next = id;
    let suffix = 2;
    while (usedIds.has(next)) {
        const suffixText = `-${suffix}`;
        next = `${id.slice(0, Math.max(1, MAX_PRESET_ID_LENGTH - suffixText.length))}${suffixText}`;
        suffix += 1;
    }
    usedIds.add(next);
    return next;
}

function validateImportedPresetShape(preset, idx) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
        throw new Error(`Preset ${idx + 1} must be an object`);
    }
    for (const key of Object.keys(preset)) {
        if (!USER_PRESET_KEYS.has(key)) throw new Error(`Preset ${idx + 1} has unsupported field "${key}"`);
    }
    if (preset.params !== undefined && (!preset.params || typeof preset.params !== 'object' || Array.isArray(preset.params))) {
        throw new Error(`Preset ${idx + 1} params must be an object`);
    }
    for (const key of Object.keys(preset.params || {})) {
        if (!PRESET_PARAM_KEYS.has(key)) throw new Error(`Preset ${idx + 1} has unsupported parameter "${key}"`);
    }
}

function sanitizePresetParams(params) {
    const allowed = {};
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        for (const [key, value] of Object.entries(params)) {
            if (PRESET_PARAM_KEYS.has(key)) allowed[key] = value;
        }
    }
    return stripPresetExcludedParams(normalizeParams(allowed));
}

function sanitizeUserPreset(preset, idx, fallbackTransitionSeconds, options = {}) {
    const strict = Boolean(options.strict);
    const usedIds = options.usedIds || new Set();
    if (strict) validateImportedPresetShape(preset, idx);
    const source = preset && typeof preset === 'object' && !Array.isArray(preset) ? preset : {};
    const fallbackId = `user-${Date.now()}-${idx}`;
    const fallbackName = `Preset ${idx + 1}`;
    const transitionSeconds = Number(source.transitionSeconds ?? fallbackTransitionSeconds);
    return {
        id: uniquePresetId(sanitizePresetId(source.id, fallbackId), usedIds),
        name: sanitizePresetText(source.name, fallbackName, MAX_PRESET_NAME_LENGTH),
        readonly: false,
        transitionSeconds: clamp(
            Number.isFinite(transitionSeconds) ? transitionSeconds : DEFAULT_PARAMS.transitionSeconds,
            CONTROL_CONFIG_BY_KEY.get('transitionSeconds')?.min ?? 0,
            CONTROL_CONFIG_BY_KEY.get('transitionSeconds')?.max ?? 8
        ),
        params: sanitizePresetParams(source.params || {})
    };
}

function renderPresetParams(params) {
    return stripPresetExcludedParams(persistedParams(params));
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
            if (shouldRendererMirrorCamera(params)) sourceX = sourceWidth - 1 - sourceX;
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

class AudioReactiveRuntime {
    constructor(app) {
        this.app = app;
        this.active = false;
        this.audioContext = null;
        this.analyser = null;
        this.transientAnalyser = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.mediaElement = null;
        this.stream = null;
        this.file = null;
        this.fileUrl = null;
        this.nativeInputAudio = false;
        this.nativeDisplayAudio = false;
        this.nativeFeaturePending = false;
        this.raf = null;
        this.frequencyData = null;
        this.timeData = null;
        this.transientFrequencyData = null;
        this.previousTransientFrequencyData = null;
        this.energyHistory = [];
        this.smoothed = this._emptyFeatures();
        this.analysisPrimed = false;
        this.beatPulse = 0;
        this.beatCooldownUntil = 0;
        this.silenceStartedAt = 0;
        this.silenceNoticeShown = false;
        this.status = 'Idle';
        this.sourceLabel = '';
        this._loop = this._loop.bind(this);
    }

    _emptyFeatures() {
        return {
            rms: 0,
            bass: 0,
            mid: 0,
            treble: 0,
            flux: 0,
            beatPulse: 0,
            phase: 0
        };
    }

    async start() {
        this.stop({ keepStatus: true });
        this.active = true;
        this.status = 'Starting';
        this.app._syncAudioReactiveUi();

        try {
            const source = this.app.audioReactive.source;
            let pendingStream = null;
            let pendingLabel = '';

            if (source === 'input') {
                if (await this._startNativeInputAudio()) {
                    pendingLabel = this.sourceLabel || 'Microphone';
                } else {
                    pendingStream = await this._requestInputStream();
                    pendingLabel = this.app._audioInputStreamLabel?.(pendingStream) || 'Mic / input';
                }
            } else if (source === 'display') {
                if (await this._startNativeDisplayAudio()) {
                    pendingLabel = this.sourceLabel || 'System audio';
                } else {
                    pendingStream = await this._requestDisplayStream();
                    pendingLabel = 'Display audio';
                }
            } else if (source !== 'file') {
                throw new Error(`Unsupported audio source: ${source}`);
            }

            if (!this.nativeDisplayAudio) {
                if (this.nativeInputAudio) {
                    this.status = `Listening: ${this.sourceLabel || source}`;
                    this._emitCurrentFrame(performance.now());
                    this.raf = scheduleResponsiveFrame(this._loop, AUDIO_REACTIVE_FRAME_MS);
                    this.app._syncNativeOutputWindow(this.app.renderParams());
                    this.app._syncAudioReactiveUi();
                    return;
                }
                await this._ensureContext();
                if (source === 'file') await this._startFileSource();
                else this._startStreamSource(pendingStream, pendingLabel);

                this._configureAnalyser();
            }
            this.status = `Listening: ${this.sourceLabel || source}`;
            this._emitCurrentFrame(performance.now());
            this.raf = scheduleResponsiveFrame(this._loop, AUDIO_REACTIVE_FRAME_MS);
            this.app._syncNativeOutputWindow(this.app.renderParams());
            this.app._syncAudioReactiveUi();
        } catch (error) {
            this.stop({ keepStatus: true });
            this.status = friendlyAudioErrorMessage(error, this.app.audioReactive.source);
            this.app._syncAudioReactiveUi();
            throw error;
        }
    }

    async _ensureContext() {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) throw new Error('Web Audio is unavailable');
        if (!this.audioContext || this.audioContext.state === 'closed') {
            try {
                this.audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
            } catch {
                this.audioContext = new AudioContextCtor();
            }
        }
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    }

    _analyserSmoothing() {
        return clamp(Number(this.app.audioReactive.smoothing || 0) * 0.28, 0, 0.3);
    }

    _transientAnalyserSmoothing() {
        return clamp(Number(this.app.audioReactive.smoothing || 0) * 0.08, 0, 0.1);
    }

    _connectAnalyserNodes() {
        this.analyser = this.audioContext.createAnalyser();
        this.transientAnalyser = this.audioContext.createAnalyser();
        this.sourceNode.connect(this.analyser);
        this.sourceNode.connect(this.transientAnalyser);
    }

    _configureAnalyser() {
        this.analyser.fftSize = AUDIO_REACTIVE_SPECTRAL_FFT_SIZE;
        this.analyser.minDecibels = -90;
        this.analyser.maxDecibels = -15;
        this.analyser.smoothingTimeConstant = this._analyserSmoothing();
        this.transientAnalyser.fftSize = AUDIO_REACTIVE_TRANSIENT_FFT_SIZE;
        this.transientAnalyser.minDecibels = -90;
        this.transientAnalyser.maxDecibels = -15;
        this.transientAnalyser.smoothingTimeConstant = this._transientAnalyserSmoothing();
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeData = new Float32Array(this.transientAnalyser.fftSize);
        this.transientFrequencyData = new Uint8Array(this.transientAnalyser.frequencyBinCount);
        this.previousTransientFrequencyData = new Uint8Array(this.transientAnalyser.frequencyBinCount);
        this.energyHistory = [];
        this.smoothed = this._emptyFeatures();
        this.analysisPrimed = false;
        this.beatPulse = 0;
        this.silenceStartedAt = 0;
        this.silenceNoticeShown = false;
    }

    async _startFileSource() {
        if (!this.file) {
            this.active = false;
            this.status = 'Choose audio file';
            this.app._syncAudioReactiveUi();
            throw new Error('Choose an audio file');
        }

        this.fileUrl = URL.createObjectURL(this.file);
        this.mediaElement = new Audio();
        this.mediaElement.src = this.fileUrl;
        this.mediaElement.loop = true;
        this.mediaElement.volume = 1;
        this.mediaElement.preload = 'auto';
        this.sourceNode = this.audioContext.createMediaElementSource(this.mediaElement);
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;
        this._connectAnalyserNodes();
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        this.sourceLabel = this.file.name || 'Audio file';
        await this.mediaElement.play();
    }

    async _requestInputStream() {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Audio input unavailable');
        await requestNativeCapturePermission('microphone');
        const inputDeviceId = String(this.app.audioReactive.inputDeviceId || '').trim();
        const audio = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            latency: { ideal: 0.01 }
        };
        if (inputDeviceId) audio.deviceId = { exact: inputDeviceId };
        const preferredConstraints = {
            audio,
            video: false
        };
        try {
            return await getUserMediaWithTauriRecovery('microphone', preferredConstraints);
        } catch (error) {
            if (isPermissionOrMissingDeviceError(error)) throw error;
            console.warn('[AudioReactive] Preferred mic constraints failed; retrying simple mic capture:', error);
            return getUserMediaWithTauriRecovery('microphone', {
                audio: inputDeviceId ? { deviceId: { exact: inputDeviceId } } : true,
                video: false
            });
        }
    }

    _startStreamSource(stream, label) {
        if (!stream) throw new Error('Audio stream unavailable');
        this.stream = stream;
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
        this._connectAnalyserNodes();
        this.sourceLabel = label;
    }

    async _startNativeInputAudio() {
        if (!isTauriRuntime()) return false;
        try {
            await requestNativeCapturePermission('microphone');
            const deviceLabel = this.app._audioInputDeviceLabel?.() || '';
            logMediaDiagnostic(`native-input-audio start input ${deviceLabel || 'default'}`);
            const response = await startTauriInputAudioCapture(deviceLabel);
            logMediaDiagnostic(`native-input-audio result input ${JSON.stringify(response)}`);
            if (!response?.available) return false;
            if (!response.active) throw new Error(response.message || 'Native microphone audio did not start');
            this.nativeInputAudio = true;
            this.nativeFeaturePending = false;
            this.sourceLabel = response.sourceLabel || deviceLabel || 'Microphone';
            return true;
        } catch (error) {
            logMediaDiagnostic(`native-input-audio error input ${diagnosticErrorLabel(error)}`);
            error.nativeInputAudioFailure = true;
            throw error;
        }
    }

    async _startNativeDisplayAudio() {
        if (!isTauriRuntime()) return false;
        try {
            logMediaDiagnostic('native-system-audio start display');
            const response = await startTauriSystemAudioCapture();
            logMediaDiagnostic(`native-system-audio result display ${JSON.stringify(response)}`);
            if (!response?.available) return false;
            if (!response.active) throw new Error(response.message || 'Native system audio did not start');
            this.nativeDisplayAudio = true;
            this.nativeFeaturePending = false;
            this.sourceLabel = response.sourceLabel || 'System audio';
            return true;
        } catch (error) {
            logMediaDiagnostic(`native-system-audio error display ${diagnosticErrorLabel(error)}`);
            error.nativeSystemAudioFailure = true;
            throw error;
        }
    }

    async _requestDisplayStream() {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Display audio unavailable');
        const constraints = {
            video: true,
            audio: {
                suppressLocalAudioPlayback: false,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            },
            systemAudio: 'include',
            windowAudio: 'system'
        };
        logMediaDiagnostic(`getDisplayMedia start display ${JSON.stringify(constraints)}`);
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        const audioTracks = stream.getAudioTracks?.() || [];
        const videoTracks = stream.getVideoTracks?.() || [];
        logMediaDiagnostic(`getDisplayMedia success display audioTracks=${audioTracks.length} videoTracks=${videoTracks.length} tracks=${stream.getTracks?.().map((track) => `${track.kind}:${track.label || 'unlabeled'}:${track.readyState}`).join(',') || 'none'}`);
        if (!stream.getAudioTracks?.().length) {
            stream.getTracks?.().forEach((track) => track.stop());
            const error = new Error('Selected display source has no audio track. On macOS, app/window audio usually needs native system-audio capture.');
            error.name = 'NoAudioTrackError';
            error.displayCaptureNoAudio = true;
            throw error;
        }
        return stream;
    }

    setFile(file) {
        this.file = file;
        this.status = file ? `Loaded: ${file.name}` : 'Idle';
        this.app._syncAudioReactiveUi();
    }

    updateSettings() {
        if (this.analyser) {
            this.analyser.smoothingTimeConstant = this._analyserSmoothing();
        }
        if (this.transientAnalyser) {
            this.transientAnalyser.smoothingTimeConstant = this._transientAnalyserSmoothing();
        }
        if (this.active) this._emitCurrentFrame();
        if (this.active) this.app._syncNativeOutputWindow(this.app.renderParams());
    }

    _loop(now) {
        if (!this.active) return;
        this._emitCurrentFrame(now);
        this.raf = scheduleResponsiveFrame(this._loop, AUDIO_REACTIVE_FRAME_MS);
    }

    _emitCurrentFrame(now = performance.now()) {
        if (this.nativeDisplayAudio || this.nativeInputAudio) {
            this._emitNativeFrame(now);
            return;
        }
        if (!this.analyser || !this.transientAnalyser || !this.frequencyData || !this.timeData || !this.transientFrequencyData) return;
        const features = this._analyze(now);
        this._monitorSignal(features, now);
        const effectiveParams = applyAudioReactiveModulation(this.app.params, features, this.app.audioReactive);
        this.app.applyAudioReactiveFrame(effectiveParams, features);
    }

    async _emitNativeFrame(now = performance.now()) {
        const source = this.nativeDisplayAudio ? 'display' : this.nativeInputAudio ? 'input' : '';
        if (this.nativeFeaturePending || !this.active || !source) return;
        this.nativeFeaturePending = true;
        try {
            const raw = source === 'display'
                ? await readTauriSystemAudioFeatures()
                : await readTauriInputAudioFeatures();
            if (!this.active || (source === 'display' && !this.nativeDisplayAudio) || (source === 'input' && !this.nativeInputAudio)) return;
            if (!raw?.available || !raw.active) {
                this.status = raw?.lastError || 'Native system audio stopped';
                this.app._syncAudioReactiveUi();
                return;
            }
            const features = this._smoothExternalFeatures(raw, now);
            this._monitorSignal(features, now);
            const effectiveParams = applyAudioReactiveModulation(this.app.params, features, this.app.audioReactive);
            this.app.applyAudioReactiveFrame(effectiveParams, features);
        } catch (error) {
            if (this.active && (this.nativeDisplayAudio || this.nativeInputAudio)) {
                this.status = error?.message || 'Native system audio failed';
                this.app._syncAudioReactiveUi();
            }
        } finally {
            this.nativeFeaturePending = false;
        }
    }

    _smoothExternalFeatures(raw, now = performance.now()) {
        const source = {
            rms: clamp(Number(raw.rms || 0), 0, 1),
            bass: clamp(Number(raw.bass || 0), 0, 1),
            mid: clamp(Number(raw.mid || 0), 0, 1),
            treble: clamp(Number(raw.treble || 0), 0, 1),
            flux: clamp(Number(raw.flux || 0), 0, 1),
            beatPulse: clamp(Number(raw.beatPulse || 0), 0, 1),
            phase: Number.isFinite(Number(raw.phase)) ? Number(raw.phase) : now * 0.012
        };
        const smoothAmount = clamp(Number(this.app.audioReactive.smoothing || 0), 0, 0.95);
        const attackAlpha = clamp(0.92 - smoothAmount * 0.28, 0.58, 0.94);
        const releaseAlpha = clamp(0.34 - smoothAmount * 0.28, 0.04, 0.34);
        for (const key of ['rms', 'bass', 'mid', 'treble', 'flux', 'beatPulse']) {
            if (!this.analysisPrimed) {
                this.smoothed[key] = source[key];
            } else {
                const alpha = source[key] >= this.smoothed[key] ? attackAlpha : releaseAlpha;
                this.smoothed[key] += (source[key] - this.smoothed[key]) * alpha;
            }
        }
        this.analysisPrimed = true;
        this.smoothed.phase = source.phase;
        return { ...this.smoothed };
    }

    _analyze(now) {
        this.analyser.getByteFrequencyData(this.frequencyData);
        this.transientAnalyser.getFloatTimeDomainData(this.timeData);
        this.transientAnalyser.getByteFrequencyData(this.transientFrequencyData);

        let sumSquares = 0;
        for (let i = 0; i < this.timeData.length; i++) sumSquares += this.timeData[i] * this.timeData[i];
        const rms = clamp(Math.sqrt(sumSquares / Math.max(1, this.timeData.length)) * 2.4, 0, 1);

        const sampleRate = this.audioContext?.sampleRate || 48000;
        const bass = this._bandAverage(20, 160, sampleRate);
        const mid = this._bandAverage(250, 2200, sampleRate);
        const treble = this._bandAverage(2400, 9000, sampleRate);
        const flux = this._spectralFlux();

        const beatPulse = this._detectBeat(rms, flux, now);
        const raw = {
            rms,
            bass,
            mid,
            treble,
            flux,
            beatPulse,
            phase: now * 0.012
        };

        const smoothAmount = clamp(Number(this.app.audioReactive.smoothing || 0), 0, 0.95);
        const attackAlpha = clamp(0.92 - smoothAmount * 0.28, 0.58, 0.94);
        const releaseAlpha = clamp(0.34 - smoothAmount * 0.28, 0.04, 0.34);
        for (const key of ['rms', 'bass', 'mid', 'treble', 'flux', 'beatPulse']) {
            if (!this.analysisPrimed) {
                this.smoothed[key] = raw[key];
            } else {
                const alpha = raw[key] >= this.smoothed[key] ? attackAlpha : releaseAlpha;
                this.smoothed[key] += (raw[key] - this.smoothed[key]) * alpha;
            }
        }
        this.analysisPrimed = true;
        this.smoothed.phase = raw.phase;
        this.previousTransientFrequencyData.set(this.transientFrequencyData);
        return { ...this.smoothed };
    }

    _monitorSignal(features, now) {
        if (this.app.audioReactive.source !== 'display') return;

        const audible = Math.max(
            features.rms || 0,
            features.bass || 0,
            features.mid || 0,
            features.treble || 0
        ) > AUDIO_REACTIVE_SILENCE_THRESHOLD;

        if (audible) {
            this.silenceStartedAt = 0;
            if (this.silenceNoticeShown) {
                this.silenceNoticeShown = false;
                this.status = `Listening: ${this.sourceLabel || 'Display audio'}`;
                this.app._syncAudioReactiveUi();
            }
            return;
        }

        if (!this.silenceStartedAt) this.silenceStartedAt = now;
        if (!this.silenceNoticeShown && now - this.silenceStartedAt >= AUDIO_REACTIVE_SILENCE_NOTICE_MS) {
            this.silenceNoticeShown = true;
            this.status = 'No display audio detected from the selected source.';
            this.app._syncAudioReactiveUi();
        }
    }

    _bandAverage(minHz, maxHz, sampleRate) {
        const nyquist = sampleRate / 2;
        const start = Math.max(0, Math.floor(minHz / nyquist * this.frequencyData.length));
        const end = Math.min(this.frequencyData.length - 1, Math.ceil(maxHz / nyquist * this.frequencyData.length));
        if (end <= start) return 0;
        let sum = 0;
        for (let i = start; i <= end; i++) sum += this.frequencyData[i] / 255;
        return clamp(sum / Math.max(1, end - start + 1), 0, 1);
    }

    _spectralFlux() {
        if (!this.previousTransientFrequencyData) return 0;
        let positive = 0;
        for (let i = 0; i < this.transientFrequencyData.length; i++) {
            const diff = this.transientFrequencyData[i] - this.previousTransientFrequencyData[i];
            if (diff > 0) positive += diff;
        }
        return clamp(positive / (255 * this.transientFrequencyData.length * 0.18), 0, 1);
    }

    _detectBeat(rms, flux, now) {
        this.energyHistory.push(rms);
        if (this.energyHistory.length > AUDIO_REACTIVE_BEAT_HISTORY) this.energyHistory.shift();
        const avg = this.energyHistory.reduce((sum, value) => sum + value, 0) / Math.max(1, this.energyHistory.length);
        const threshold = Math.max(0.035, avg * 1.22);
        const beat = now > this.beatCooldownUntil && rms > threshold && (flux > 0.08 || rms > avg * 1.55);
        if (beat) {
            this.beatPulse = 1;
            this.beatCooldownUntil = now + 135;
        } else {
            this.beatPulse *= 0.82;
        }
        return clamp(this.beatPulse, 0, 1);
    }

    stop(options = {}) {
        const { keepStatus = false } = options;
        this.active = false;
        const hadNativeInputAudio = this.nativeInputAudio;
        const hadNativeDisplayAudio = this.nativeDisplayAudio;
        this.nativeInputAudio = false;
        this.nativeDisplayAudio = false;
        this.nativeFeaturePending = false;
        if (this.raf) {
            if (typeof this.raf === 'function') this.raf();
            else cancelAnimationFrame(this.raf);
        }
        this.raf = null;
        this.sourceNode?.disconnect?.();
        this.gainNode?.disconnect?.();
        this.analyser?.disconnect?.();
        this.transientAnalyser?.disconnect?.();
        this.sourceNode = null;
        this.gainNode = null;
        this.analyser = null;
        this.transientAnalyser = null;
        if (this.mediaElement) {
            this.mediaElement.pause();
            this.mediaElement.src = '';
            this.mediaElement = null;
        }
        if (this.stream) {
            this.stream.getTracks?.().forEach((track) => track.stop());
            this.stream = null;
        }
        if (this.fileUrl) {
            URL.revokeObjectURL(this.fileUrl);
            this.fileUrl = null;
        }
        if (hadNativeDisplayAudio) {
            stopTauriSystemAudioCapture().catch((error) => console.warn('[AudioReactive] Native system audio stop failed:', error));
        }
        if (hadNativeInputAudio) {
            stopTauriInputAudioCapture().catch((error) => console.warn('[AudioReactive] Native microphone stop failed:', error));
        }
        this.frequencyData = null;
        this.timeData = null;
        this.transientFrequencyData = null;
        this.previousTransientFrequencyData = null;
        this.energyHistory = [];
        this.smoothed = this._emptyFeatures();
        this.analysisPrimed = false;
        this.beatPulse = 0;
        this.silenceStartedAt = 0;
        this.silenceNoticeShown = false;
        if (!keepStatus) this.status = 'Idle';
        this.app.clearAudioReactiveFrame();
        this.app._syncNativeOutputWindow(this.app.renderParams());
        this.app._syncAudioReactiveUi();
    }
}

class CameraMixer {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.slots = new Map();
        this.activeSlots = [];
        this.params = { ...DEFAULT_PARAMS };
        this.outputStream = null;
        this.raf = null;
        this.running = false;
        this.lastFrame = 0;
        this.lastRafAt = 0;
        this.frameCount = 0;
        this.frameTimer = null;
        this.width = 640;
        this.height = 480;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    async configure(cameraSpecs, params) {
        this.params = { ...params };
        const nextIds = new Set(cameraSpecs.map((spec) => spec.id));
        for (const [id, slot] of this.slots.entries()) {
            if (!nextIds.has(id)) {
                this._destroySlot(slot);
                this.slots.delete(id);
            }
        }

        const activeSlots = [];
        for (const spec of cameraSpecs) {
            activeSlots.push(await this._ensureSlot(spec));
        }
        this.activeSlots = activeSlots;
        this._configureCanvas();
        this.start();
        return this;
    }

    async _ensureSlot(spec) {
        const existing = this.slots.get(spec.id);
        if (existing && existing.stream === spec.stream) {
            existing.label = spec.label;
            return existing;
        }
        if (existing) this._destroySlot(existing);

        const video = document.createElement('video');
        video.srcObject = spec.stream;
        video.autoplay = true;
        video.loop = false;
        video.muted = true;
        video.playsInline = true;
        video.style.display = 'none';
        document.body.appendChild(video);

        const slot = {
            id: spec.id,
            label: spec.label,
            stream: spec.stream,
            video,
            width: 640,
            height: 480
        };
        await this._waitForVideo(slot);
        this.slots.set(spec.id, slot);
        return slot;
    }

    _waitForVideo(slot) {
        const video = slot.video;
        const track = slot.stream.getVideoTracks?.()[0] || null;
        const settings = track?.getSettings?.() || {};
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    settled = true;
                    cleanup();
                    slot.width = video.videoWidth;
                    slot.height = video.videoHeight;
                    resolve();
                }
            };
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                slot.width = video.videoWidth || settings.width || 640;
                slot.height = video.videoHeight || settings.height || 480;
                resolve();
            }, 3500);
            const cleanup = () => {
                clearTimeout(timeout);
                video.removeEventListener('loadedmetadata', finish);
                video.removeEventListener('loadeddata', finish);
                video.removeEventListener('canplay', finish);
            };
            video.addEventListener('loadedmetadata', finish);
            video.addEventListener('loadeddata', finish);
            video.addEventListener('canplay', finish);
            video.play().then(finish).catch(() => finish());
        });
    }

    _configureCanvas() {
        const slots = this.activeSlots;
        if (slots.length <= 1) {
            this.width = slots[0]?.width || 640;
            this.height = slots[0]?.height || 480;
        } else if (this.params.cameraLayout === 'vertical') {
            this.width = 720;
            this.height = 1280;
        } else {
            this.width = 1280;
            this.height = 720;
        }
        if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    }

    start() {
        if (this.running) return;
        if (!this.outputStream) {
            if (!this.canvas.captureStream) throw new Error('Canvas captureStream is unavailable');
            this.outputStream = this.canvas.captureStream(Math.max(1, Math.round(this.params.cameraFps || DEFAULT_PARAMS.cameraFps)));
        }
        this.running = true;
        this.lastRafAt = performance.now();
        this._draw = this._draw.bind(this);
        this.raf = requestAnimationFrame(this._draw);
        const fallbackInterval = Math.max(8, Math.min(50, 1000 / Math.max(1, this.params.cameraFps || DEFAULT_PARAMS.cameraFps)));
        this.frameTimer = setInterval(() => {
            if (!this.running) return;
            const now = performance.now();
            const staleMs = Math.max(80, 2000 / Math.max(1, this.params.cameraFps || DEFAULT_PARAMS.cameraFps));
            if (now - this.lastRafAt >= staleMs) this._draw(now, true);
        }, fallbackInterval);
    }

    _draw(ts, fromTimer = false) {
        if (!this.running) return;
        if (!fromTimer) this.lastRafAt = performance.now();
        const interval = 1000 / Math.max(1, this.params.cameraFps || DEFAULT_PARAMS.cameraFps);
        if (!this.lastFrame || ts - this.lastFrame >= interval) {
            this._renderFrame();
            this.lastFrame = ts;
        }
        if (this.running && !fromTimer) this.raf = requestAnimationFrame(this._draw);
    }

    _renderFrame() {
        const ctx = this.ctx;
        ctx.fillStyle = '#030405';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const slots = this.activeSlots.filter((slot) => slot.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
        if (!slots.length) {
            this.frameCount++;
            return;
        }

        const rects = this._layoutRects(slots.length);
        slots.forEach((slot, index) => this._drawSlot(slot, rects[index]));
        this.frameCount++;
    }

    _layoutRects(count) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (count <= 1) return [{ x: 0, y: 0, w, h }];
        if (this.params.cameraLayout === 'horizontal') {
            return Array.from({ length: count }, (_, index) => {
                const cellW = w / count;
                return { x: Math.round(index * cellW), y: 0, w: Math.ceil(cellW), h };
            });
        }
        if (this.params.cameraLayout === 'vertical') {
            return Array.from({ length: count }, (_, index) => {
                const cellH = h / count;
                return { x: 0, y: Math.round(index * cellH), w, h: Math.ceil(cellH) };
            });
        }
        if (this.params.cameraLayout === 'pip') {
            const insetW = Math.round(w * 0.28);
            const insetH = Math.round(h * 0.28);
            const gap = Math.round(Math.min(w, h) * 0.025);
            return Array.from({ length: count }, (_, index) => {
                if (index === 0) return { x: 0, y: 0, w, h };
                const slot = index - 1;
                return {
                    x: w - insetW - gap,
                    y: gap + slot * (insetH + gap),
                    w: insetW,
                    h: insetH
                };
            });
        }

        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        return Array.from({ length: count }, (_, index) => ({
            x: Math.round((index % cols) * cellW),
            y: Math.round(Math.floor(index / cols) * cellH),
            w: Math.ceil(cellW),
            h: Math.ceil(cellH)
        }));
    }

    _drawSlot(slot, rect) {
        if (!rect) return;
        const video = slot.video;
        const sourceW = video.videoWidth || slot.width || 640;
        const sourceH = video.videoHeight || slot.height || 480;
        const sourceRatio = sourceW / Math.max(1, sourceH);
        const targetRatio = rect.w / Math.max(1, rect.h);
        const contain = this.params.cameraFit === 'contain';
        let sx = 0;
        let sy = 0;
        let sw = sourceW;
        let sh = sourceH;
        let dx = rect.x;
        let dy = rect.y;
        let dw = rect.w;
        let dh = rect.h;

        if (contain) {
            if (sourceRatio > targetRatio) {
                dh = rect.w / sourceRatio;
                dy = rect.y + (rect.h - dh) / 2;
            } else {
                dw = rect.h * sourceRatio;
                dx = rect.x + (rect.w - dw) / 2;
            }
        } else if (sourceRatio > targetRatio) {
            sw = sourceH * targetRatio;
            sx = (sourceW - sw) / 2;
        } else {
            sh = sourceW / targetRatio;
            sy = (sourceH - sh) / 2;
        }

        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        if (this.params.cameraMirror) {
            ctx.translate(dx + dw, dy);
            ctx.scale(-1, 1);
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
        } else {
            ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
        }
        ctx.restore();
    }

    getSourceStream() {
        if (!this.outputStream) this.start();
        return this.outputStream;
    }

    _destroySlot(slot) {
        slot.video.pause();
        slot.video.srcObject = null;
        slot.video.remove();
    }

    destroy() {
        this.running = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        if (this.frameTimer) clearInterval(this.frameTimer);
        this.frameTimer = null;
        for (const slot of this.slots.values()) this._destroySlot(slot);
        this.slots.clear();
        this.activeSlots = [];
        if (this.outputStream) {
            this.outputStream.getTracks?.().forEach((track) => track.stop());
            this.outputStream = null;
        }
    }
}

function tauriRawVideoDecodeSize(probe) {
    const sourceWidth = Math.max(1, Number(probe?.width) || 640);
    const sourceHeight = Math.max(1, Number(probe?.height) || 360);
    const scale = Math.min(
        1,
        TAURI_RAW_VIDEO_MAX_DIMENSION / sourceWidth,
        TAURI_RAW_VIDEO_MAX_DIMENSION / sourceHeight,
        Math.sqrt(TAURI_RAW_VIDEO_MAX_PIXELS / Math.max(1, sourceWidth * sourceHeight))
    );
    return {
        width: Math.max(2, Math.round(sourceWidth * scale)),
        height: Math.max(2, Math.round(sourceHeight * scale))
    };
}

function decodeBase64Bytes(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

class TauriRawVideoSource {
    constructor(file, params, options = {}) {
        this.file = file;
        this.params = { ...params };
        this.options = { ...options };
        this.type = 'video';
        this.element = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.width = 640;
        this.height = 360;
        this.ready = false;
        this.isVideo = true;
        this.isImage = false;
        this.isTauriRawVideo = true;
        this.sessionId = null;
        this.probe = null;
        this.fps = Math.max(1, Math.min(60, Number(params.fps) || 30));
        this.loop = params.loop !== false;
        this.paused = false;
        this.ended = false;
        this.frameQueue = [];
        this.reading = false;
        this.raf = 0;
        this.lastDrawAt = 0;
        this.imageData = null;
        this.rgba = null;
    }

    async start() {
        this.probe = await probeTauriMediaFile(this.file);
        const size = tauriRawVideoDecodeSize(this.probe);
        this.width = size.width;
        this.height = size.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.element = this.canvas;
        await this._startSession(0);
        await this._readFrames(1);
        const firstFrame = this.frameQueue.shift();
        if (!firstFrame) throw new Error('FFmpeg did not produce an initial video frame');
        this._drawFrame(firstFrame);
        this.ready = true;
        this.play();
        return this;
    }

    updateParams(params) {
        this.params = { ...params };
        this.loop = params.loop !== false;
        const fps = Number(params.fps);
        if (Number.isFinite(fps) && fps > 0) this.fps = Math.min(60, Math.max(1, fps));
    }

    play() {
        this.paused = false;
        this.ended = false;
        this._schedule();
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }

    destroy() {
        this.paused = true;
        this.ended = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.frameQueue.length = 0;
        const sessionId = this.sessionId;
        this.sessionId = null;
        if (sessionId) stopTauriRawVideoSession(sessionId).catch(() => {});
    }

    async _startSession(startSeconds = 0) {
        if (this.sessionId) {
            await stopTauriRawVideoSession(this.sessionId).catch(() => false);
            this.sessionId = null;
        }
        const durationSeconds = Number(this.probe?.durationSeconds) || 0;
        const maxFrames = durationSeconds > 0
            ? Math.min(1000000, Math.max(1, Math.ceil(durationSeconds * this.fps) + 2))
            : 1000000;
        const init = await startTauriRawVideoSession(this.file, {
            width: this.width,
            height: this.height,
            maxFrames,
            fps: this.fps,
            startSeconds
        });
        if (!init?.sessionId) throw new Error('FFmpeg raw video session did not start');
        this.sessionId = init.sessionId;
        this.fps = Math.max(1, Math.min(60, Number(init.fps) || this.fps || 30));
    }

    async _readFrames(maxFrames = TAURI_RAW_VIDEO_BATCH_SIZE) {
        if (this.reading || !this.sessionId || this.ended) return;
        this.reading = true;
        try {
            const batch = await readTauriRawVideoFrames(this.sessionId, maxFrames);
            const frames = Array.isArray(batch?.frames) ? batch.frames : [];
            this.frameQueue.push(...frames);
            if (batch?.ended) {
                this.sessionId = null;
                if (this.loop && !this.paused) {
                    await this._startSession(0);
                } else {
                    this.ended = true;
                    this.paused = true;
                }
            }
        } finally {
            this.reading = false;
        }
    }

    _schedule() {
        if (this.raf || this.paused || this.ended) return;
        this.raf = requestAnimationFrame((now) => {
            this.raf = 0;
            this._tick(now).catch((error) => {
                console.warn('[TauriRawVideoSource] Playback failed:', error);
                this.pause();
            });
        });
    }

    async _tick(now) {
        if (this.paused || this.ended) return;
        if (this.frameQueue.length < TAURI_RAW_VIDEO_BATCH_SIZE) {
            this._readFrames(TAURI_RAW_VIDEO_BATCH_SIZE).catch((error) => {
                console.warn('[TauriRawVideoSource] Frame read failed:', error);
                this.pause();
            });
        }

        const interval = 1000 / Math.max(1, this.fps);
        if (!this.lastDrawAt || now - this.lastDrawAt >= interval) {
            const frame = this.frameQueue.shift();
            if (frame) {
                this._drawFrame(frame);
                this.lastDrawAt = now;
            }
        }
        this._schedule();
    }

    _drawFrame(frame) {
        const rgb = decodeBase64Bytes(frame.rgbBase64);
        const pixelCount = this.width * this.height;
        if (!this.imageData || this.imageData.width !== this.width || this.imageData.height !== this.height) {
            this.imageData = this.ctx.createImageData(this.width, this.height);
            this.rgba = this.imageData.data;
        }
        for (let src = 0, dst = 0; src < pixelCount * 3; src += 3, dst += 4) {
            this.rgba[dst] = rgb[src] || 0;
            this.rgba[dst + 1] = rgb[src + 1] || 0;
            this.rgba[dst + 2] = rgb[src + 2] || 0;
            this.rgba[dst + 3] = 255;
        }
        this.ctx.putImageData(this.imageData, 0, 0);
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
        this.frameTimer = null;
        this.lastFrame = 0;
        this.lastRafAt = 0;
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
        this.lastRafAt = this.window.performance?.now?.() ?? performance.now();
        this._loop = this._loop.bind(this);
        this.raf = this.window.requestAnimationFrame(this._loop);
        const fallbackInterval = Math.max(8, Math.min(50, 1000 / Math.max(1, this.params.fps)));
        this.frameTimer = this.window.setInterval(() => {
            if (!this.running) return;
            const now = this.window.performance?.now?.() ?? performance.now();
            const staleMs = Math.max(80, 2000 / Math.max(1, this.params.fps));
            if (now - this.lastRafAt >= staleMs) this._loop(now, true);
        }, fallbackInterval);
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
        this.source?.updateParams?.(params);
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

    _loop(ts, fromTimer = false) {
        if (!this.running) return;
        if (!fromTimer) this.lastRafAt = this.window.performance?.now?.() ?? performance.now();
        const interval = 1000 / Math.max(1, this.params.fps);
        if (ts - this.lastFrame >= interval) {
            const beforeFrame = this.frameCount;
            this.renderFrame();
            if (this.frameCount !== beforeFrame) this._recordFrame(ts);
            this.lastFrame = ts;
        }
        if (!fromTimer) this.raf = this.window.requestAnimationFrame(this._loop);
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
            if (shouldRendererMirrorCamera(this.params)) {
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
        if (this.frameTimer) this.window.clearInterval(this.frameTimer);
        if (this.ownsSource) this.source?.destroy?.();
        this.raf = null;
        this.frameTimer = null;
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
            mirrorX: shouldRendererMirrorCamera(params),
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
        renderer.mirrorX = shouldRendererMirrorCamera(params);
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
        this.source?.updateParams?.(params);
    }

    async start(params, options = {}) {
        this.destroy({ clearStage: options.preserveStage !== true });
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

    destroy(options = {}) {
        const { clearStage = true } = options;
        const layer = this.renderer?.canvas?.parentElement;
        this.renderer?.stop?.();
        this.renderer?.destroy?.();
        this.source?.destroy?.();
        this.renderer = null;
        this.source = null;
        this.mediaUrl = null;
        this.mediaType = null;
        if (clearStage) {
            els.gpuStage.innerHTML = '';
            els.gpuStage.classList.remove('active');
        } else {
            layer?.remove?.();
        }
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
        this.transport = 'websocket';
        this.nativeSessionId = null;
        this.nativeSourceFile = null;
        this.nativeReadInFlight = false;
        this.nativePumpTimer = 0;
        this.nativeReinitTimer = 0;
        this.nativeRestarting = false;
        this.nativeBatchSize = 4;
        this.pendingQueueIndex = null;
        this.ctx = els.canvas.getContext('2d', { alpha: false });
        this.renderFrame = this.renderFrame.bind(this);
    }

    async start(params, options = {}) {
        this.stop();
        els.gpuStage.classList.remove('active');
        els.gpuStage.innerHTML = '';
        els.canvas.style.display = 'block';
        this.state = 'connecting';
        this.frameBuffer.length = 0;
        this.frameCount = 0;
        this.currentFps = 0;
        this.transport = 'websocket';
        let autoFallbackStarted = false;
        const fallbackToStatic = () => {
            if (!options.autoStart || autoFallbackStarted) return false;
            autoFallbackStarted = true;
            this.app._fallbackToDefaultStatic();
            return true;
        };

        const nativeFile = this._nativeStreamFileForParams(params);
        if (nativeFile) {
            try {
                await this._startNative(nativeFile, params, fallbackToStatic);
                return;
            } catch (error) {
                console.warn('[StreamRuntime] Native stream failed, falling back to WebSocket:', error);
                this._resetNativeSession();
                this.app.setConnection('Native stream unavailable');
                if (fallbackToStatic()) return;
            }
        }

        this._startWebSocket(params, fallbackToStatic);
    }

    _nativeStreamFileForParams(params) {
        if (!isTauriRuntime() || params.codec !== 'adaptive') return null;
        if (params.mode <= 1 && !params.pixel) return null;
        const file = this.app.customTauriFile;
        if (!file?.id || this.app.customSourceStatus !== 'present') return null;
        if (params.mediaUrl && file.url && params.mediaUrl !== file.url && !isCustomRuntimeMediaUrl(params.mediaUrl)) return null;
        return file;
    }

    _startWebSocket(params, fallbackToStatic) {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const codec = params.codec === 'adaptive' ? 'adaptive' : 'legacy';
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

    async _startNative(file, params, fallbackToStatic) {
        this.transport = 'native';
        this.nativeSourceFile = file;
        this.app.setConnection('Opening native stream');
        const probe = await probeTauriMediaFile(file);
        if (this.state === 'idle') return;

        const sourceWidth = probe?.width || 16;
        const sourceHeight = probe?.height || 9;
        const cols = Math.max(1, Math.round(params.cols));
        const rows = computeRows(params, sourceWidth, sourceHeight, params.pixel);
        const sourceFps = Number.isFinite(probe?.fps) && probe.fps > 0 ? probe.fps : Math.max(1, Math.round(params.fpsCap || params.fps || 24));
        const durationFrames = Number.isFinite(probe?.durationSeconds) && probe.durationSeconds > 0
            ? Math.ceil(probe.durationSeconds * sourceFps) + 2
            : 100000;
        const maxFrames = Math.round(clamp(durationFrames, 1, 100000));
        const init = await startTauriMediaSession(file, {
            width: cols,
            height: rows,
            maxFrames,
            mode: params.mode,
            pixel: params.pixel,
            codecTolerance: params.codecTolerance,
            verifyDecode: false
        });
        if (this.state === 'idle') {
            if (init?.sessionId) stopTauriMediaSession(init.sessionId).catch(() => {});
            return;
        }
        if (!init?.sessionId) throw new Error('Native media session did not start');

        this.nativeSessionId = init.sessionId;
        this._handleInit({
            fps: init.fps || sourceFps,
            mode: init.mode,
            cols: init.cols,
            rows: init.rows,
            pixel: init.pixel,
            queueIndex: null,
            native: true
        }, params);
        this._startNativeGate(file.name || 'Native stream');
        this._scheduleNativePump(0);
    }

    _handleMessage(event, params) {
        if (typeof event.data === 'string') {
            if (event.data.startsWith('Error:')) {
                this.app.setConnection(event.data);
                return;
            }
            if (event.data.startsWith('INIT:')) {
                const p = event.data.split(':');
                this._handleInit({
                    fps: parseFloat(p[1]),
                    mode: parseInt(p[2], 10),
                    cols: parseInt(p[3], 10),
                    rows: parseInt(p[4], 10),
                    pixel: p.length > 5 && parseInt(p[5], 10) === 1,
                    queueIndex: p.length > 6 ? parseInt(p[6], 10) : null,
                    native: false
                }, params);
                this._startAudioGate(this.pendingQueueIndex, params);
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

        this._pushBinaryFrame(event.data).catch((error) => {
            console.warn('[StreamRuntime] decode failed', error);
        });
    }

    _handleInit(init, params) {
        this.frameBuffer.length = 0;
        this.codecDecoder = null;
        this.dotImageData = null;
        this.selectionBuffer = null;
        els.player.textContent = '';
        this.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        this.targetFps = Number(init.fps) || 24;
        this.renderMode = Number(init.mode) || 1;
        this.pixelMode = Boolean(init.pixel);
        this.pendingQueueIndex = init.queueIndex ?? null;
        this._buildCanvas(Math.max(1, Math.round(init.cols)), Math.max(1, Math.round(init.rows)), this.pixelMode);
        if (this.app.params.codec === 'adaptive' && window.AscilineCodec && this.renderMode > 1) {
            this.codecDecoder = window.AscilineCodec.makeDecoder(this.pixelMode ? 3 : 4);
        } else {
            this.codecDecoder = null;
        }
        this.ready = false;
        this.state = 'playing';
    }

    async _pushBinaryFrame(message) {
        const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
        if (this.codecDecoder) {
            const { frameIndex, frame } = await this.codecDecoder.decode(bytes);
            if (this.state !== 'playing') return;
            this.frameBuffer.push({ data: frame, time: frameIndex / this.targetFps });
            this._trimBuffer();
            return;
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const frameIndex = view.getUint32(0, false);
        const frameData = bytes.subarray(4);
        this.frameBuffer.push({ data: frameData, time: frameIndex / this.targetFps });
        this._trimBuffer();
    }

    _startNativeGate(sourceName) {
        this.ready = true;
        this.streamStartTime = performance.now();
        this.lastFpsUpdate = this.streamStartTime;
        this.app.setConnection(`Native stream: ${sourceName}`);
        if (!this.raf) this.raf = requestAnimationFrame(this.renderFrame);
    }

    _scheduleNativePump(delay = 0) {
        if (this.transport !== 'native' || !this.nativeSessionId || this.nativePumpTimer) return;
        this.nativePumpTimer = setTimeout(() => {
            this.nativePumpTimer = 0;
            this._pumpNativeFrames().catch((error) => {
                console.warn('[StreamRuntime] Native frame pump failed:', error);
                if (this.state !== 'idle') {
                    this.app.setConnection(error?.message || 'Native stream failed');
                    this.stop(false);
                }
            });
        }, delay);
    }

    async _pumpNativeFrames() {
        if (this.transport !== 'native' || !this.nativeSessionId || this.state !== 'playing' || this.nativeReadInFlight) return;
        const max = Math.max(1, this.app.params.bufferSize * this.app.params.maxBufferMultiplier);
        if (this.frameBuffer.length >= max) {
            this._scheduleNativePump(8);
            return;
        }

        this.nativeReadInFlight = true;
        try {
            const sessionId = this.nativeSessionId;
            const headroom = Math.max(1, max - this.frameBuffer.length);
            const batchSize = clamp(Math.min(headroom, this.nativeBatchSize), 1, this.nativeBatchSize);
            const batch = await readTauriMediaSessionFrames(sessionId, Math.round(batchSize));
            if (this.transport !== 'native' || this.nativeSessionId !== sessionId || this.state !== 'playing') return;
            const frames = Array.isArray(batch?.frames) ? batch.frames : [];
            if (batch?.ended && frames.length === 0) {
                this.nativeSessionId = null;
                if (this.app.params.loop && this.nativeSourceFile && !this.nativeRestarting) {
                    await this._restartNativeLoop();
                } else {
                    this.app.setConnection('Native stream ended');
                    this.stop(false);
                }
                return;
            }

            for (const frame of frames) {
                await this._pushBinaryFrame(new Uint8Array(frame.message));
                if (this.transport !== 'native' || this.nativeSessionId !== sessionId || this.state !== 'playing') return;
            }

            if (batch?.ended) {
                this.nativeSessionId = null;
                if (this.app.params.loop && this.nativeSourceFile && !this.nativeRestarting) {
                    await this._restartNativeLoop();
                } else {
                    this.app.setConnection('Native stream ended');
                    this.stop(false);
                }
                return;
            }
        } finally {
            this.nativeReadInFlight = false;
        }

        if (this.transport === 'native' && this.nativeSessionId && this.state === 'playing') {
            this._scheduleNativePump(this.frameBuffer.length < max ? 0 : 8);
        }
    }

    async _restartNativeLoop() {
        const file = this.nativeSourceFile;
        if (!file || this.state === 'idle') return;
        this.nativeRestarting = true;
        try {
            this.frameBuffer.length = 0;
            this.frameCount = 0;
            this.currentFps = 0;
            await this._startNative(file, this.app.params);
        } finally {
            this.nativeRestarting = false;
        }
    }

    _resetNativeSession() {
        if (this.nativePumpTimer) {
            clearTimeout(this.nativePumpTimer);
            this.nativePumpTimer = 0;
        }
        if (this.nativeReinitTimer) {
            clearTimeout(this.nativeReinitTimer);
            this.nativeReinitTimer = 0;
        }
        const sessionId = this.nativeSessionId;
        this.nativeSessionId = null;
        this.nativeSourceFile = null;
        this.nativeReadInFlight = false;
        this.nativeRestarting = false;
        if (sessionId) stopTauriMediaSession(sessionId).catch(() => {});
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
        const params = this.app.renderParams();
        const data = this.dotImageData.data;
        for (let src = 0, dst = 0; src < frame.length; src += 3, dst += 4) {
            const [r, g, b] = processColor(frame[src + 2], frame[src + 1], frame[src], params);
            data[dst] = r;
            data[dst + 1] = g;
            data[dst + 2] = b;
        }
        this.ctx.putImageData(this.dotImageData, 0, 0);
    }

    _renderAsciiFrame(frame) {
        const ctx = this.ctx;
        const params = this.app.renderParams();
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
        if (this.transport !== 'websocket') return;
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
        if (this.transport === 'native') {
            if (STREAM_REINIT_KEYS.has(key) || key === 'codecQuality' || key === 'codecTolerance') {
                clearTimeout(this.nativeReinitTimer);
                this.nativeReinitTimer = setTimeout(() => {
                    this.nativeReinitTimer = 0;
                    this.app.restart().catch((error) => console.warn('[StreamRuntime] Native stream restart failed:', error));
                }, 160);
            }
            return;
        }
        if (STREAM_CONTROL_KEYS.has(key)) this.sendControl(params, key);
    }

    getStats() {
        return {
            backend: this.transport === 'native'
                ? (this.pixelMode ? 'native pixel stream' : 'native canvas stream')
                : (this.pixelMode ? 'pixel-canvas-stream' : 'canvas2d-stream'),
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
        this._resetNativeSession();
        this.transport = 'websocket';
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
        this.params = startupSafeParams(migrateStoredParams(parseStoredJson(STORAGE_KEY, DEFAULT_PARAMS)));
        this.effectiveParams = null;
        this.audioReactive = { ...AUDIO_REACTIVE_DEFAULTS };
        this.audioReactiveInputs = new Map();
        this.audioInputDevices = [];
        this.audioInputDeviceSignature = '';
        this.audioReactiveFeatures = null;
        this.audioReactiveLastUi = 0;
        this.audioReactiveRuntime = new AudioReactiveRuntime(this);
        this.userPresets = parseStoredJson(PRESET_KEY, []);
        this.activePresetId = 'point-click-default';
        this.transitionToken = 0;
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
        this.popoutVideo = null;
        this.popoutStream = null;
        this.popoutRaf = null;
        this.popoutRenderer = null;
        this.nativeOutputActive = false;
        this.nativeOutputLastSync = 0;
        this.nativeOutputSyncInFlight = false;
        this.nativeOutputPendingPayload = null;
        this.nativeOutputPendingMinInterval = 0;
        this.nativeOutputSyncTimer = null;
        this.nativeOutputMirrorRaf = null;
        this.nativeOutputMirrorBusy = false;
        this.nativeOutputMirrorCanvas = null;
        this.nativeOutputMirrorSendPending = false;
        this.nativeOutputMirrorLastSendStart = 0;
        this.nativeOutputMirrorSeq = 0;
        this.nativeOutputPrewarmed = false;
        this.nativeOutputPrewarmPending = false;
        this.nativeOutputSyncAttemptCount = 0;
        this.nativeOutputSyncOkCount = 0;
        this.nativeOutputSyncFailedCount = 0;
        this.nativeOutputLastSyncElapsedMs = 0;
        this.uiPerfSmokeActive = false;
        this.outputDisplay = parseStoredJson(OUTPUT_DISPLAY_KEY, 'auto');
        this.outputDisplays = [];
        this.meterTimer = null;
        this.localObjectUrl = null;
        this.customFile = null;
        this.customTauriFile = null;
        this.customFileHandle = null;
        this.customSourceMeta = parseStoredJson(CUSTOM_SOURCE_KEY, null);
        this.customSourceStatus = this.customSourceMeta?.provider === 'tauri' ? 'needs-access' : this.customSourceMeta ? 'missing' : 'empty';
        this.cameraDevices = [];
        this.cameraStream = null;
        this.cameraStreams = new Map();
        this.cameraCapabilities = new Map();
        this.cameraConstraintKey = null;
        this.cameraMixer = null;
        this.cameraStatus = navigator.mediaDevices?.getUserMedia ? 'needs-access' : 'unsupported';
        this.cameraError = '';
        this.wtfActive = false;
        this.wtfToken = 0;
        this.desktopUpdate = null;
        this.desktopUpdateBusy = false;
        this.desktopUpdateStatus = '';
        this.crashReportState = null;
        this.crashReportBusy = false;
        this.warmMediaElements = [];
    }

    async init() {
        this._startWebViewKeepalive();
        await this._initCrashReporter();
        await this._detectBackends();
        await this._restoreCustomSource();
        this._buildControls();
        this._buildAudioReactiveControls();
        this._bindEvents();
        await this._bindTauriSmokeEvents();
        await this._refreshOutputDisplays();
        await this._refreshCameraDevices();
        await this._refreshAudioInputDevices();
        this._renderSourceList();
        this._renderPresets();
        this._syncInputs();
        this._applyVisualState();
        this.updateMeters();
        this._startMeterTimer();
        this.setConnection('Disconnected');
        this._syncDesktopUpdateUi();
        this._autoStart();
        this._autoStartAudioReactive();
        this._warmBuiltInMedia();
    }

    _startWebViewKeepalive() {
        if (!navigator.locks?.request) return;
        navigator.locks.request('asciline-remix-render-keepalive', { mode: 'shared' }, () => new Promise(() => {}))
            .catch((error) => console.info('[Renderer] WebView keepalive lock unavailable:', error));
    }

    async _initCrashReporter() {
        if (!isTauriRuntime()) return;
        setTauriCrashReportHandler((report) => {
            this._captureCrashReport(report).catch((error) => {
                console.warn('[CrashReporter] Capture failed:', error);
            });
        });
        window.addEventListener('error', (event) => {
            this._captureCrashReport({
                kind: 'frontend-error',
                surface: 'frontend',
                message: event.message || errorMessage(event.error),
                stack: errorStack(event.error),
                context: {
                    filename: event.filename || '',
                    lineno: event.lineno || 0,
                    colno: event.colno || 0,
                    backend: this.params.backend,
                    sourceMode: this.params.sourceMode,
                    nativeOutputActive: this.nativeOutputActive,
                    ...errorCrashContext(event.error)
                }
            }).catch((error) => console.warn('[CrashReporter] Window error capture failed:', error));
        });
        window.addEventListener('unhandledrejection', (event) => {
            this._captureCrashReport({
                kind: 'unhandled-rejection',
                surface: 'frontend',
                message: errorMessage(event.reason),
                stack: errorStack(event.reason),
                context: {
                    backend: this.params.backend,
                    sourceMode: this.params.sourceMode,
                    nativeOutputActive: this.nativeOutputActive,
                    ...errorCrashContext(event.reason)
                }
            }).catch((error) => console.warn('[CrashReporter] Rejection capture failed:', error));
        });
        await this._refreshCrashReportState();
        if (this.crashReportState?.preference === 'always' && this.crashReportState?.pendingCount > 0) {
            await this._sendCrashReports({ automatic: true });
        }
    }

    async _captureCrashReport(report) {
        if (!isTauriRuntime()) return;
        const state = await captureTauriCrashReport({
            ...report,
            context: {
                backend: this.params.backend,
                sourceMode: this.params.sourceMode,
                mediaType: this.params.mediaType,
                nativeOutputActive: this.nativeOutputActive,
                ...(report.context || {})
            }
        });
        this._setCrashReportState(state);
        if (state?.preference === 'always' && state?.pendingCount > 0) {
            await this._sendCrashReports({ automatic: true });
        }
    }

    async _refreshCrashReportState() {
        if (!isTauriRuntime()) return;
        try {
            this._setCrashReportState(await getTauriCrashReportState());
        } catch (error) {
            console.warn('[CrashReporter] State unavailable:', error);
        }
    }

    _setCrashReportState(state) {
        this.crashReportState = state || null;
        this._syncCrashReportUi();
    }

    _syncCrashReportUi() {
        const pendingCount = Number(this.crashReportState?.pendingCount || 0);
        if (els.crashReportStatus) {
            els.crashReportStatus.hidden = !isTauriRuntime() || pendingCount <= 0;
            els.crashReportStatus.classList.toggle('pending', pendingCount > 0);
            els.crashReportStatus.textContent = pendingCount > 1 ? `Crash ${pendingCount}` : 'Crash';
            els.crashReportStatus.title = pendingCount > 0 ? `${pendingCount} pending crash report${pendingCount === 1 ? '' : 's'}` : '';
        }
        if (els.crashReportPreference && this.crashReportState?.preference) {
            els.crashReportPreference.value = this.crashReportState.preference;
        }
        if (els.crashReportPreview && !els.crashReportDialog?.hidden) {
            els.crashReportPreview.value = crashReportPreview(this.crashReportState);
        }
        if (els.crashReportSend) {
            els.crashReportSend.disabled = this.crashReportBusy || pendingCount <= 0 || this.crashReportState?.preference === 'off';
        }
        if (els.crashReportDiscard) {
            els.crashReportDiscard.disabled = this.crashReportBusy || pendingCount <= 0;
        }
    }

    _openCrashReportDialog() {
        if (!els.crashReportDialog) return;
        els.crashReportPreview.value = crashReportPreview(this.crashReportState);
        els.crashReportDialog.hidden = false;
        els.crashReportClose?.focus();
        this._syncCrashReportUi();
    }

    _closeCrashReportDialog() {
        if (els.crashReportDialog) els.crashReportDialog.hidden = true;
    }

    async _setCrashReportPreference(value) {
        if (!isTauriRuntime()) return;
        try {
            this._setCrashReportState(await setTauriCrashReportPreference(value));
            if (value === 'always' && this.crashReportState?.pendingCount > 0) {
                await this._sendCrashReports({ automatic: true });
            }
        } catch (error) {
            console.warn('[CrashReporter] Preference update failed:', error);
        }
    }

    async _sendCrashReports(options = {}) {
        if (!isTauriRuntime() || this.crashReportBusy) return;
        if (this.crashReportState?.preference === 'off') return;
        this.crashReportBusy = true;
        this._syncCrashReportUi();
        try {
            const state = await submitTauriCrashReports();
            this._setCrashReportState(state);
            if (!options.automatic && state?.lastResult?.failed > 0) {
                alert('Crash report submission failed. The report remains queued.');
            }
        } catch (error) {
            console.warn('[CrashReporter] Submission failed:', error);
            if (!options.automatic) alert('Crash report submission failed. The report remains queued.');
        } finally {
            this.crashReportBusy = false;
            this._syncCrashReportUi();
        }
    }

    async _discardCrashReports() {
        if (!isTauriRuntime() || this.crashReportBusy) return;
        this.crashReportBusy = true;
        this._syncCrashReportUi();
        try {
            this._setCrashReportState(await discardTauriCrashReports());
            this._closeCrashReportDialog();
        } catch (error) {
            console.warn('[CrashReporter] Discard failed:', error);
        } finally {
            this.crashReportBusy = false;
            this._syncCrashReportUi();
        }
    }

    async _detectBackends() {
        const caps = await detectCapabilities().catch(() => null);
        const parts = [];
        if (caps?.webgpu) parts.push('WebGPU');
        if (caps?.webgl2) parts.push('WebGL2');
        parts.push('Canvas');
        els.backendStatus.textContent = `Backend: ${parts.join(' / ')}`;
    }

    async _refreshOutputDisplays() {
        if (!els.outputDisplay) return;

        let displays = [];
        if (isTauriRuntime()) {
            try {
                displays = await listTauriOutputDisplays();
            } catch (error) {
                console.info('[TauriOutput] Display list unavailable:', error);
            }
        }

        this.outputDisplays = Array.isArray(displays) ? displays : [];
        const previousValue = this.outputDisplay || 'auto';
        const options = [
            {
                value: 'auto',
                label: this.outputDisplays.length > 1 ? 'Auto external' : 'Auto'
            },
            ...this.outputDisplays.map((display) => ({
                value: display.id,
                label: display.label || `Display ${display.index + 1}`
            }))
        ];

        els.outputDisplay.innerHTML = '';
        for (const option of options) {
            const element = document.createElement('option');
            element.value = option.value;
            element.textContent = option.label;
            els.outputDisplay.appendChild(element);
        }

        this.outputDisplay = options.some((option) => option.value === previousValue)
            ? previousValue
            : 'auto';
        els.outputDisplay.value = this.outputDisplay;
        els.outputDisplay.disabled = options.length <= 1 && !('getScreenDetails' in window);
        els.outputDisplay.closest('.output-display-field')?.classList.toggle('is-disabled', els.outputDisplay.disabled);
    }

    async _restoreCustomSource() {
        if (this.customSourceMeta?.provider === 'tauri') {
            this.customSourceStatus = 'needs-access';
            return;
        }

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
            this.customTauriFile = null;
            this._setCustomFile(file);
            return true;
        } catch (error) {
            console.warn('[Source] Custom file handle is not readable:', error);
            this.customFile = null;
            this.customTauriFile = null;
            this.customSourceStatus = 'missing';
            this._clearLocalObjectUrl();
            return false;
        }
    }

    _setCustomFile(file) {
        this.customTauriFile = null;
        this.customFile = file;
        this.customSourceMeta = customSourceMetaFromFile(file);
        this.customSourceStatus = 'present';
        saveJson(CUSTOM_SOURCE_KEY, this.customSourceMeta);
        this._renderSourceList();
    }

    _setCustomTauriFile(file) {
        this.customFile = null;
        this.customFileHandle = null;
        this.customTauriFile = file;
        this.customSourceMeta = customSourceMetaFromTauriFile(file);
        this.customSourceStatus = 'present';
        this._clearLocalObjectUrl();
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

    async _refreshAudioInputDevices(options = {}) {
        if (!navigator.mediaDevices?.enumerateDevices) {
            this.audioInputDevices = [];
            this.audioInputDeviceSignature = '';
            this._syncAudioInputOptions();
            return;
        }

        const previousSignature = this.audioInputDeviceSignature;
        const previousSelected = this.audioReactive.inputDeviceId || '';
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.audioInputDevices = devices.filter((device) => device.kind === 'audioinput');
        } catch (error) {
            console.warn('[AudioReactive] Audio input device refresh failed:', error);
            this.audioInputDevices = [];
        }

        this.audioInputDeviceSignature = this.audioInputDevices
            .map((device) => `${device.deviceId || ''}:${device.groupId || ''}`)
            .join('|');
        this._syncAudioInputOptions();

        const deviceSetChanged = Boolean(previousSignature) &&
            this.audioInputDeviceSignature !== previousSignature;
        const selectedChanged = (this.audioReactive.inputDeviceId || '') !== previousSelected;
        if (
            options.restart === true &&
            (deviceSetChanged || selectedChanged) &&
            this.audioReactive.source === 'input' &&
            (this.audioReactive.enabled || this.audioReactiveRuntime.active)
        ) {
            this.audioReactive.enabled = true;
            this.audioReactiveRuntime.status = 'Audio input changed';
            this._syncAudioReactiveUi(true);
            this._restartAudioReactive().catch((error) => console.warn('[AudioReactive] Device-change restart failed:', error));
        }
    }

    _audioInputOptions() {
        const concrete = this.audioInputDevices.filter((device) =>
            device.deviceId &&
            device.deviceId !== 'default' &&
            device.deviceId !== 'communications'
        );
        const devices = concrete.length ? concrete : this.audioInputDevices;
        return devices.map((device, index) => [
            device.deviceId,
            device.label || `Input ${index + 1}`
        ]);
    }

    _syncAudioInputOptions() {
        const input = els.audioReactiveInput;
        if (!input) return;

        const options = this._audioInputOptions();
        const selectedExists = options.some(([value]) => value === this.audioReactive.inputDeviceId);
        if (options.length && !selectedExists) {
            this.audioReactive.inputDeviceId = String(options[0][0] || '');
        }

        input.innerHTML = '';
        if (!options.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'System input';
            input.appendChild(option);
            this.audioReactive.inputDeviceId = '';
        } else {
            for (const [value, label] of options) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                input.appendChild(option);
            }
        }
        input.value = this.audioReactive.inputDeviceId || '';
        input.closest('.field')?.toggleAttribute('hidden', this.audioReactive.source !== 'input');
    }

    _audioInputDeviceLabel(deviceId = this.audioReactive.inputDeviceId) {
        if (!deviceId) return this.audioInputDevices[0]?.label || 'Mic / input';
        const index = this.audioInputDevices.findIndex((device) => device.deviceId === deviceId);
        if (index >= 0) return this.audioInputDevices[index].label || `Input ${index + 1}`;
        return 'Selected input';
    }

    _audioInputStreamLabel(stream) {
        const track = stream?.getAudioTracks?.()[0] || null;
        const settings = track?.getSettings?.() || {};
        if (settings.deviceId) this.audioReactive.inputDeviceId = settings.deviceId;
        this._refreshAudioInputDevices({ render: false }).catch((error) => console.warn('[AudioReactive] Input label refresh failed:', error));
        return track?.label || this._audioInputDeviceLabel(settings.deviceId || this.audioReactive.inputDeviceId);
    }

    _syncCameraDeviceOptions() {
        const legacyEntry = this.controlInputs.get('cameraDeviceId');
        const listEntry = this.controlInputs.get('cameraSelectedDeviceIds');
        if (!legacyEntry && !listEntry) return;

        let selected = normalizeStringArray(this.params.cameraSelectedDeviceIds);
        const legacySelected = this.params.cameraDeviceId || '';
        if (!selected.length && legacySelected) selected = [legacySelected];
        const options = this.cameraDevices.map((device, index) => [
            device.deviceId,
            device.label || `Camera ${index + 1}`
        ]);
        if (isCameraParams(this.params) && !selected.length && options.length) {
            const defaultDeviceId = String(options[0][0] || '');
            if (defaultDeviceId) {
                selected = [defaultDeviceId];
                this.params.cameraSelectedDeviceIds = selected;
                this.params.cameraDeviceId = defaultDeviceId;
                this.params.sourceName = cameraSourceName(this.params);
            }
        }
        const selectedSet = new Set(selected);
        for (const id of selected) {
            if (id && !options.some(([value]) => value === id)) options.push([id, 'Selected camera']);
        }
        if (legacySelected && !options.some(([value]) => value === legacySelected)) {
            options.push([legacySelected, 'Selected camera']);
        }

        if (legacyEntry) {
            const input = legacyEntry.input;
            input.innerHTML = '';
            for (const [value, label] of options) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                input.appendChild(option);
            }
            input.value = legacySelected;
            this._syncControlValue('cameraDeviceId');
        }

        if (listEntry) {
            const input = listEntry.input;
            const disabled = listEntry.row.classList.contains('control-hidden');
            input.innerHTML = '';
            input.setAttribute('role', 'group');
            input.setAttribute('aria-label', 'Camera devices');

            if (!options.length) {
                const empty = document.createElement('div');
                empty.className = 'camera-device-empty';
                empty.textContent = 'No cameras';
                input.appendChild(empty);
                this._syncControlValue('cameraSelectedDeviceIds');
                return;
            }

            for (const [value, label] of options) {
                const item = document.createElement('label');
                item.className = 'camera-device-item';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = value;
                checkbox.checked = selected.length ? selectedSet.has(value) : options[0][0] === value;
                checkbox.disabled = disabled;

                const name = document.createElement('span');
                name.textContent = label;

                item.append(checkbox, name);
                input.appendChild(item);
            }
            this._syncControlValue('cameraSelectedDeviceIds');
        }
    }

    _cameraDeviceLabel(deviceId = this.params.cameraDeviceId) {
        if (!deviceId) return this.cameraDevices[0]?.label || 'Camera 1';
        const index = this.cameraDevices.findIndex((device) => device.deviceId === deviceId);
        if (index >= 0) return this.cameraDevices[index].label || `Camera ${index + 1}`;
        return 'Selected camera';
    }

    _cameraSelectionLabel(params = this.params) {
        const selected = normalizeStringArray(params.cameraSelectedDeviceIds);
        if (!selected.length) return this.cameraDevices.length ? '1 cam' : 'No cams';
        if (selected.length === 1) return '1 cam';
        return `${selected.length} cams`;
    }

    _cameraFacingModeApplies(params = this.params) {
        if (!isCameraParams(params)) return false;
        const explicitSelection = normalizeStringArray(params.cameraSelectedDeviceIds).length > 0 ||
            Boolean(String(params.cameraDeviceId || '').trim());
        if (explicitSelection) return false;

        const capabilities = this.cameraCapabilities.get('');
        if (!capabilities) return true;
        const facingModes = normalizeStringArray(capabilities.facingMode);
        return facingModes.length > 1;
    }

    _firstCameraStream() {
        for (const stream of this.cameraStreams.values()) {
            if (stream?.getVideoTracks?.().some((track) => track.readyState === 'live')) return stream;
        }
        return null;
    }

    _cameraStreamActive() {
        return Boolean(this._firstCameraStream());
    }

    _stopCameraStream(options = {}) {
        const { render = true } = options;
        const streams = new Set(this.cameraStreams.values());
        if (this.cameraStream) streams.add(this.cameraStream);
        const hadCamera = streams.size > 0 || this.cameraMixer;

        this.cameraMixer?.destroy?.();
        this.cameraMixer = null;
        streams.forEach((stream) => stream.getTracks?.().forEach((track) => track.stop()));
        this.cameraStreams.clear();
        this.cameraCapabilities.clear();
        this.cameraStream = null;
        this.cameraConstraintKey = null;
        if (hadCamera && (this.cameraStatus === 'ready' || this.cameraStatus === 'requesting')) this.cameraStatus = 'needs-access';
        if (hadCamera && render) this._renderSourceList();
    }

    _cameraSpecsFromStreams(params = this.params) {
        return selectedCameraDeviceIds(params).map((requestedId, index) => {
            const stream = this.cameraStreams.get(requestedId);
            if (!stream?.getVideoTracks?.().some((track) => track.readyState === 'live')) return null;
            const track = stream.getVideoTracks()[0];
            const settings = track?.getSettings?.() || {};
            const id = requestedId || settings.deviceId || `default-${index}`;
            const label = requestedId
                ? this._cameraDeviceLabel(requestedId)
                : this._cameraDeviceLabel(settings.deviceId || '');
            return { id, label, stream };
        }).filter(Boolean);
    }

    _watchCameraStream(streamKey, stream) {
        stream.getVideoTracks?.().forEach((track) => {
            track.addEventListener('ended', () => {
                if (this.cameraStreams.get(streamKey) === stream) this.cameraStreams.delete(streamKey);
                this.cameraCapabilities.delete(streamKey);
                if (this.cameraStream === stream) this.cameraStream = this._firstCameraStream();
                if (this._cameraStreamActive()) {
                    this.cameraStatus = 'ready';
                    this.cameraError = '';
                    this.cameraMixer?.configure(this._cameraSpecsFromStreams(this.params), this.params)
                        .catch((error) => console.warn('[Camera] Mixer reconfigure failed:', error));
                } else {
                    this.cameraMixer?.destroy?.();
                    this.cameraMixer = null;
                    this.cameraConstraintKey = null;
                    this.cameraStatus = 'missing';
                    this.cameraError = 'Camera disconnected';
                }
                this._updateControlVisibility();
                this._renderSourceList();
            }, { once: true });
        });
    }

    async _ensureCameraMixer(params = this.params) {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.cameraStatus = 'unsupported';
            this.cameraError = 'Camera unsupported';
            this._renderSourceList();
            throw new Error(this.cameraError);
        }

        const key = cameraConstraintKey(params);
        if (this._cameraStreamActive() && this.cameraMixer && this.cameraConstraintKey === key) {
            await this.cameraMixer.configure(this._cameraSpecsFromStreams(params), params);
            this.cameraStream = this._firstCameraStream();
            this.cameraStatus = 'ready';
            this.cameraError = '';
            this._renderSourceList();
            return this.cameraMixer;
        }

        this._stopCameraStream({ render: false });
        this.cameraStatus = 'requesting';
        this.cameraError = '';
        this._renderSourceList();
        this.setConnection('Requesting camera');

        try {
            await requestNativeCapturePermission('camera');
        } catch (error) {
            const status = cameraErrorStatus(error);
            this._stopCameraStream({ render: false });
            this.cameraStatus = status.status;
            this.cameraError = status.message;
            this._renderSourceList();
            throw new Error(status.message);
        }

        const requestedIds = selectedCameraDeviceIds(params);
        const opened = [];
        let firstError = null;

        for (const requestedId of requestedIds) {
            try {
                let stream;
                try {
                    stream = await getUserMediaWithTauriRecovery('camera', cameraConstraintsFromParams(params, requestedId));
                } catch (error) {
                    if (isPermissionOrMissingDeviceError(error)) throw error;
                    console.warn('[Camera] Preferred constraints failed; retrying simple camera capture:', requestedId || 'default', error);
                    stream = await getUserMediaWithTauriRecovery('camera', simpleCameraConstraints(requestedId));
                }
                this.cameraStreams.set(requestedId, stream);
                const track = stream.getVideoTracks?.()[0] || null;
                this.cameraCapabilities.set(requestedId, track?.getCapabilities?.() || {});
                this._watchCameraStream(requestedId, stream);
                opened.push({ requestedId, stream });
            } catch (error) {
                firstError ||= error;
                console.warn('[Camera] Device request failed:', requestedId || 'default', error);
            }
        }

        try {
            if (!opened.length) throw firstError || new Error('No camera stream opened');

            this.cameraStream = this._firstCameraStream();
            this.cameraConstraintKey = key;
            this.cameraStatus = 'ready';
            await this._refreshCameraDevices({ render: false });
            this.cameraError = opened.length < requestedIds.length ? `${opened.length} of ${requestedIds.length} cameras active` : '';
            this.cameraMixer = new CameraMixer();
            await this.cameraMixer.configure(this._cameraSpecsFromStreams(params), params);
            this._updateControlVisibility();
            this._renderSourceList();
            return this.cameraMixer;
        } catch (error) {
            const status = cameraErrorStatus(error);
            this._stopCameraStream({ render: false });
            this.cameraStatus = status.status;
            this.cameraError = status.message;
            this._renderSourceList();
            throw new Error(status.message);
        }
    }

    _shouldUseTauriRawVideoSource(params) {
        if (!isTauriRuntime() || params.mediaType !== 'video') return false;
        if (!this.customTauriFile?.id || params.mediaUrl !== this.customTauriFile.url) return false;
        return isMkvName(this.customTauriFile.name || params.mediaUrl);
    }

    async loadStaticSource(params, options = {}) {
        if (isCameraParams(params)) {
            const mixer = await this._ensureCameraMixer(params);
            return loadMediaSource(CAMERA_MIX_MEDIA_URL, {
                type: 'camera-mix',
                stream: mixer.getSourceStream(),
                stopTracks: false,
                readyTimeoutMs: options.readyTimeoutMs
            });
        }

        this._stopCameraStream();
        if (this._shouldUseTauriRawVideoSource(params)) {
            const source = new TauriRawVideoSource(this.customTauriFile, params, options);
            return source.start();
        }
        return loadMediaSource(params.mediaUrl, {
            type: forcedMediaType(params),
            loop: params.loop,
            muted: params.muted
        });
    }

    _cameraSourceEntry() {
        const streams = [...this.cameraStreams.values()];
        const activeTracks = streams.flatMap((stream) => stream.getVideoTracks?.() || [])
            .filter((track) => track.readyState === 'live');
        const firstSettings = activeTracks[0]?.getSettings?.() || {};
        const selectedCount = selectedCameraCount(this.params);
        const detailParts = [selectedCount > 1 ? 'Local camera mix' : 'Local camera'];
        if (this.cameraStatus === 'ready' && activeTracks.length > 1) {
            detailParts.push(`${activeTracks.length} cameras`);
            detailParts.push(this.params.cameraLayout);
        } else if (this.cameraStatus === 'ready' && firstSettings.width && firstSettings.height) {
            detailParts.push(`${firstSettings.width}x${firstSettings.height}`);
        } else if (this.cameraDevices.length > 1) {
            detailParts.push(`${this.cameraDevices.length} devices`);
        } else {
            const label = this._cameraSelectionLabel(this.params);
            if (label && label !== 'Default') detailParts.push(label);
        }
        if (this.cameraError) detailParts.push(this.cameraError);

        const statusMap = {
            ready: ['Ready', 'ready'],
            requesting: ['Requesting', 'requesting'],
            denied: ['Denied', 'missing'],
            missing: ['No camera', 'missing'],
            unsupported: ['Unsupported', 'missing'],
            error: ['Error', 'missing'],
            'needs-access': ['Allow', 'needs-access']
        };
        const [status, statusType] = statusMap[this.cameraStatus] || statusMap['needs-access'];
        return {
            id: CAMERA_SOURCE_ID,
            name: cameraSourceName(this.params),
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

        if (!this.customSourceMeta && !this.customFile && !this.customTauriFile) return [...builtIns, cameraEntry];

        const meta = this.customSourceMeta || (this.customTauriFile ? customSourceMetaFromTauriFile(this.customTauriFile) : customSourceMetaFromFile(this.customFile));
        const status = this.customSourceStatus === 'present' ? 'Present' :
            this.customSourceStatus === 'needs-access' ? 'Needs access' :
            'Missing';
        const sourceKind = meta.provider === 'tauri' ? 'Desktop file' : meta.mediaType === 'image' ? 'Custom image' : 'Custom video';
        const detailParts = [sourceKind, fileSizeLabel(meta.size)].filter(Boolean);
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
        if (isCustomRuntimeMediaUrl(this.params.mediaUrl) && (this.customFile || this.customTauriFile || this.customSourceMeta)) return CUSTOM_SOURCE_ID;
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
            item.addEventListener('click', () => {
                this._selectSource(entry.id).catch((error) => {
                    console.warn('[Source] Selection failed:', error);
                    this.setConnection(error?.message || 'Source failed');
                });
            });
            els.sourceList.appendChild(item);
        }
    }

    _buildControls() {
        els.controls.innerHTML = '';
        if (els.cameraControlsSlot) els.cameraControlsSlot.innerHTML = '';
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
                if (config.compactSelect) row.classList.add('compact-select');
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
            const target = group.title === 'Camera' && els.cameraControlsSlot
                ? els.cameraControlsSlot
                : els.controls;
            target.appendChild(section);
        }
    }

    _buildAudioReactiveControls() {
        if (!els.audioReactiveControls || !els.audioReactiveSource || !els.audioReactivePreset) return;
        els.audioReactiveControls.innerHTML = '';
        els.audioReactiveSource.innerHTML = '';
        els.audioReactivePreset.innerHTML = '';
        this.audioReactiveInputs.clear();

        for (const [value, label] of AUDIO_REACTIVE_SOURCE_OPTIONS) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            els.audioReactiveSource.appendChild(option);
        }
        for (const preset of AUDIO_REACTIVE_PRESETS) {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            els.audioReactivePreset.appendChild(option);
        }

        for (const config of AUDIO_REACTIVE_CONTROLS) {
            const row = document.createElement('label');
            row.className = 'audio-control-row';
            row.htmlFor = `audio-reactive-${config.key}`;

            const name = document.createElement('span');
            name.textContent = config.label;

            const input = document.createElement('input');
            input.id = `audio-reactive-${config.key}`;
            input.type = 'range';
            input.min = config.min;
            input.max = config.max;
            input.step = config.step;
            input.value = String(this.audioReactive[config.key]);

            const output = document.createElement('output');
            output.textContent = Number(this.audioReactive[config.key]).toFixed(2);

            row.append(name, input, output);
            els.audioReactiveControls.appendChild(row);
            this.audioReactiveInputs.set(config.key, { input, output, config });
        }
        this._syncAudioReactiveUi(true);
    }

    _makeControl(config) {
        let input;
        if (config.type === 'device-list') {
            input = document.createElement('div');
            input.className = 'camera-device-list';
        } else if (config.type === 'select') {
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
        els.checkUpdate?.addEventListener('click', () => this._checkOrInstallDesktopUpdate());
        els.crashReportStatus?.addEventListener('click', () => this._openCrashReportDialog());
        els.crashReportClose?.addEventListener('click', () => this._closeCrashReportDialog());
        els.crashReportSend?.addEventListener('click', () => this._sendCrashReports());
        els.crashReportDiscard?.addEventListener('click', () => this._discardCrashReports());
        els.crashReportPreference?.addEventListener('change', () => this._setCrashReportPreference(els.crashReportPreference.value));
        els.crashReportDialog?.addEventListener('click', (event) => {
            if (event.target === els.crashReportDialog) this._closeCrashReportDialog();
        });
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
        els.outputDisplay?.addEventListener('change', () => {
            this.outputDisplay = els.outputDisplay.value || 'auto';
            saveJson(OUTPUT_DISPLAY_KEY, this.outputDisplay);
            if (this.nativeOutputActive) {
                this._openNativeOutputWindow().catch((error) => console.warn('[TauriOutput] Reposition failed:', error));
            }
        });
        els.wtfButton.addEventListener('click', () => this.toggleWtf());
        els.audioReactiveSource?.addEventListener('change', () => {
            this._setAudioReactiveSource(els.audioReactiveSource.value)
                .catch((error) => console.warn('[AudioReactive] Source switch failed:', error));
        });
        els.audioReactiveInput?.addEventListener('change', () => {
            this.audioReactive.inputDeviceId = els.audioReactiveInput.value || '';
            this._syncAudioReactiveUi(true);
            if (this.audioReactive.source !== 'input') return;
            this.audioReactive.enabled = true;
            this.audioReactiveRuntime.status = 'Switching audio input';
            this._restartAudioReactive()
                .catch((error) => console.warn('[AudioReactive] Input switch failed:', error));
        });
        els.audioReactivePreset?.addEventListener('change', () => {
            this.audioReactive.preset = els.audioReactivePreset.value;
            this.audioReactiveRuntime.updateSettings();
            if (this.audioReactive.enabled && !this.audioReactiveRuntime.active) {
                this._restartAudioReactive().catch((error) => console.warn('[AudioReactive] Preset restart failed:', error));
            }
            this._syncAudioReactiveUi();
        });
        els.audioReactiveToggle?.addEventListener('click', () => this._toggleAudioReactive());
        els.audioReactivePickFile?.addEventListener('click', () => els.audioReactiveFile?.click());
        els.audioReactiveFile?.addEventListener('change', () => {
            const file = els.audioReactiveFile.files?.[0] || null;
            this.audioReactiveRuntime.setFile(file);
            if (file) {
                this.audioReactive.enabled = true;
                this.audioReactive.source = 'file';
                this._restartAudioReactive().catch((error) => console.warn('[AudioReactive] Start failed:', error));
            }
        });
        for (const [key, entry] of this.audioReactiveInputs.entries()) {
            entry.input.addEventListener('input', () => {
                const numeric = Number(entry.input.value);
                this.audioReactive[key] = Number.isFinite(numeric) ? numeric : AUDIO_REACTIVE_DEFAULTS[key];
                this.audioReactiveRuntime.updateSettings();
                this._syncAudioReactiveUi();
            });
        }
        navigator.mediaDevices?.addEventListener?.('devicechange', () => {
            this._refreshCameraDevices().catch((error) => console.warn('[Camera] Device refresh failed:', error));
            this._refreshAudioInputDevices({ restart: true }).catch((error) => console.warn('[AudioReactive] Device refresh failed:', error));
        });
        document.addEventListener('click', () => this._closePresetOverflow());
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this._closePresetOverflow();
                this._closeCrashReportDialog();
            }
        });
        window.addEventListener('resize', () => this._applyVisualState());
        window.addEventListener('beforeunload', () => {
            if (this.meterTimer) window.clearInterval(this.meterTimer);
            this._stopWtf();
            this.audioReactiveRuntime.stop();
            this._clearLocalObjectUrl();
            this._stopCameraStream();
            this._stopNativeOutputMirror();
            this._closePopout();
        });
    }

    async _bindTauriSmokeEvents() {
        if (!isTauriRuntime()) return;
        try {
            await listenTauriEvent('asciline-ui-perf-smoke', (event) => {
                this._runUiPerfSmoke(event?.payload || {})
                    .catch((error) => logMediaDiagnostic(`[ASCILINE_UI_PERF_ERROR] ${diagnosticErrorLabel(error)}`));
            });
        } catch (error) {
            console.warn('[Smoke] UI perf smoke listener failed:', error);
        }
    }

    async _runUiPerfSmoke(payload = {}) {
        if (this.uiPerfSmokeActive) return;
        this.uiPerfSmokeActive = true;
        const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const durationMs = Math.max(3000, Number(payload.durationMs) || 9000);
        const sampleMs = Math.max(120, Number(payload.sampleMs) || 500);
        const mediaUrl = String(payload.mediaUrl || DEFAULT_PARAMS.mediaUrl);
        const backend = STATIC_GPU_BACKENDS.has(payload.backend) || STATIC_CANVAS_BACKENDS.has(payload.backend)
            ? payload.backend
            : 'auto';
        const sourceName = sourceNameFromUrl(mediaUrl) || 'UI Perf Demo';
        const startedAt = performance.now();
        const syncStart = {
            attempts: this.nativeOutputSyncAttemptCount,
            ok: this.nativeOutputSyncOkCount,
            failed: this.nativeOutputSyncFailedCount
        };

        const sample = () => {
            const renderer = this.staticRuntime.renderer;
            const stats = this.staticRuntime.getStats();
            return {
                t: performance.now() - startedAt,
                frameCount: Number(renderer?.frameCount || 0),
                reportedFps: Number(stats?.currentFps || 0),
                targetFps: Number(stats?.fps || this.params.fps || 0),
                backend: stats?.backend || this.params.backend,
                sourceType: stats?.sourceType || 'unknown',
                rendererRunning: Boolean(renderer?.running),
                rendererAnimationId: Number(renderer?.animationId || renderer?.raf || 0),
                videoReadyState: Number(this.staticRuntime.source?.element?.readyState ?? -1),
                videoPaused: Boolean(this.staticRuntime.source?.element?.paused),
                nativeAttempts: this.nativeOutputSyncAttemptCount - syncStart.attempts,
                nativeOk: this.nativeOutputSyncOkCount - syncStart.ok,
                nativeFailed: this.nativeOutputSyncFailedCount - syncStart.failed,
                nativeLastSyncMs: this.nativeOutputLastSyncElapsedMs
            };
        };

        const report = {
            ok: false,
            mediaUrl,
            durationMs,
            sampleMs,
            backend,
            samples: [],
            phases: {},
            mainAvgFps: 0,
            mainMinFps: 0,
            nativeSyncHz: 0,
            nativeOkHz: 0,
            nativeFailed: 0,
            outputDisplayCount: 0,
            error: null
        };

        const collectPhase = async (phase, phaseDurationMs) => {
            let previous = sample();
            const deadline = performance.now() + Math.max(sampleMs, phaseDurationMs);
            while (performance.now() < deadline) {
                await wait(sampleMs);
                const current = sample();
                const dt = Math.max(1, current.t - previous.t);
                const frameReset = current.frameCount < previous.frameCount;
                const frameDelta = frameReset ? 0 : Math.max(0, current.frameCount - previous.frameCount);
                const syncDelta = Math.max(0, current.nativeAttempts - previous.nativeAttempts);
                const okDelta = Math.max(0, current.nativeOk - previous.nativeOk);
                report.samples.push({
                    phase,
                    ...current,
                    frameReset,
                    measuredFps: frameReset ? null : frameDelta * 1000 / dt,
                    nativeSyncHz: syncDelta * 1000 / dt,
                    nativeOkHz: okDelta * 1000 / dt
                });
                previous = current;
            }
        };

        const summarizeSamples = (samples) => {
            const fpsValues = samples.map((item) => item.measuredFps).filter(Number.isFinite);
            const syncValues = samples.map((item) => item.nativeSyncHz).filter(Number.isFinite);
            const okValues = samples.map((item) => item.nativeOkHz).filter(Number.isFinite);
            return {
                count: samples.length,
                mainAvgFps: fpsValues.length ? fpsValues.reduce((sum, value) => sum + value, 0) / fpsValues.length : 0,
                mainMinFps: fpsValues.length ? Math.min(...fpsValues) : 0,
                nativeSyncHz: syncValues.length ? syncValues.reduce((sum, value) => sum + value, 0) / syncValues.length : 0,
                nativeOkHz: okValues.length ? okValues.reduce((sum, value) => sum + value, 0) / okValues.length : 0
            };
        };

        try {
            await this._refreshOutputDisplays();
            report.outputDisplayCount = this.outputDisplays.length;
            const hasSecondaryOutput = report.outputDisplayCount > 1;

            this._stopWtf();
            this.params = normalizeParams({
                ...this.params,
                sourceMode: 'static',
                backend,
                mediaUrl,
                mediaType: 'video',
                sourceName,
                loop: true,
                muted: true,
                fps: DEFAULT_PARAMS.fps,
                statsOverlay: true
            }, { preserveBlob: true });
            this._syncInputs();
            this._persist();
            this._applyVisualState();
            this._renderSourceList();

            if (this.running) {
                await this.restart({ mediaState: null });
            } else {
                await this.start({ autoStart: true });
            }
            const readyDeadline = performance.now() + 4500;
            while (performance.now() < readyDeadline) {
                const current = sample();
                if (current.rendererRunning && current.sourceType === 'video' && current.videoReadyState >= 2) {
                    break;
                }
                await wait(120);
            }
            await wait(500);

            const phaseDurationMs = Math.max(1500, Math.floor(durationMs / 3));
            await collectPhase('main', phaseDurationMs);

            await this.openPopout();
            await wait(1000);
            await collectPhase('popout', phaseDurationMs);

            if (!this.wtfActive) this.toggleWtf();
            await collectPhase('wtf', phaseDurationMs);

            const usable = report.samples.filter((item) => item.t > 1500);
            report.phases = ['main', 'popout', 'wtf'].reduce((phases, phase) => {
                phases[phase] = summarizeSamples(usable.filter((item) => item.phase === phase));
                return phases;
            }, {});
            const overall = summarizeSamples(usable);
            report.mainAvgFps = overall.mainAvgFps;
            report.mainMinFps = overall.mainMinFps;
            report.nativeSyncHz = overall.nativeSyncHz;
            report.nativeOkHz = overall.nativeOkHz;
            report.nativeFailed = Math.max(0, this.nativeOutputSyncFailedCount - syncStart.failed);
            report.ok = (
                report.phases.main.mainAvgFps >= 30 &&
                report.phases.popout.mainAvgFps >= 24 &&
                report.phases.wtf.mainAvgFps >= 24 &&
                (!hasSecondaryOutput || report.phases.wtf.nativeOkHz >= 30) &&
                report.nativeFailed === 0
            );
        } catch (error) {
            report.error = diagnosticErrorLabel(error);
        } finally {
            this._stopWtf();
            this.uiPerfSmokeActive = false;
            const { samples, ...summary } = report;
            await recordTauriMediaDiagnostic(`[ASCILINE_UI_PERF_REPORT] ${JSON.stringify({
                ...summary,
                sampleCount: samples.length
            })}`).catch(() => {});
        }
    }

    _startMeterTimer() {
        if (this.meterTimer) window.clearInterval(this.meterTimer);
        this.meterTimer = window.setInterval(() => this.updateMeters(), 500);
    }

    renderParams() {
        if (this.audioReactiveRuntime?.active && this.audioReactiveFeatures) {
            this.effectiveParams = applyAudioReactiveModulation(this.params, this.audioReactiveFeatures, this.audioReactive);
            return this.effectiveParams;
        }
        this.effectiveParams = null;
        return this.params;
    }

    _mainPreviewRenderParams(params = this.renderParams()) {
        return params;
    }

    _applyMainPreviewRendererParams(params = this.renderParams(), key = 'preview') {
        if (!this.running) return;
        const previewParams = this._mainPreviewRenderParams(params);
        if (this.params.sourceMode === 'static') {
            this.staticRuntime.updateParams(previewParams);
        } else {
            this.streamRuntime.updateParams(previewParams, key);
        }
    }

    _applyEffectiveRendererParams(params = this.renderParams(), key = 'live') {
        if (!this.running) return;
        this._applyMainPreviewRendererParams(params, key);
        this._updatePopoutRendererParams(params);
        this._syncNativeOutputWindow(params, key === 'audioReactive' ? NATIVE_OUTPUT_REACTIVE_SYNC_MS : 0);
    }

    applyAudioReactiveFrame(effectiveParams, features) {
        this.audioReactiveFeatures = features;
        this.effectiveParams = effectiveParams;
        this._applyEffectiveRendererParams(effectiveParams, 'audioReactive');

        const now = performance.now();
        if (now - this.audioReactiveLastUi >= 80) {
            this.audioReactiveLastUi = now;
            this._syncAudioReactiveUi();
        }
    }

    clearAudioReactiveFrame() {
        const hadEffectiveParams = Boolean(this.effectiveParams || this.audioReactiveFeatures);
        this.effectiveParams = null;
        this.audioReactiveFeatures = null;
        if (hadEffectiveParams) this._applyEffectiveRendererParams(this.params, 'audioReactive');
        this._syncAudioReactiveUi(true);
    }

    async _setAudioReactiveSource(source) {
        this.audioReactive.source = source;
        this.audioReactiveRuntime.stop({ keepStatus: true });
        this.clearAudioReactiveFrame();
        this._syncAudioReactiveUi(true);

        if (source === 'file') {
            if (!this.audioReactiveRuntime.file) {
                this.audioReactive.enabled = false;
                this.audioReactiveRuntime.status = 'Choose audio file';
                this._syncAudioReactiveUi(true);
                return;
            }
            this.audioReactive.enabled = true;
            this.audioReactiveRuntime.status = 'Starting audio file';
            this._syncAudioReactiveUi(true);
            await this._restartAudioReactive();
            return;
        }

        this.audioReactive.enabled = true;
        this.audioReactiveRuntime.status = source === 'display'
            ? (isTauriRuntime() ? 'Starting system audio' : 'Choose display audio source')
            : 'Requesting audio input';
        this._syncAudioReactiveUi(true);
        await this._restartAudioReactive();
    }

    _autoStartAudioReactive() {
        if (!this.audioReactive.enabled) {
            this._syncAudioReactiveUi();
            return;
        }
        if (audioSourceNeedsUserActivation(this.audioReactive.source)) {
            this.audioReactive.enabled = false;
            this.audioReactiveRuntime.status = audioStartPromptStatus(this.audioReactive.source);
            this._syncAudioReactiveUi(true);
            return;
        }
        this.audioReactiveRuntime.status = 'Requesting audio input';
        this._syncAudioReactiveUi(true);
        requestAnimationFrame(() => {
            this._restartAudioReactive().catch((error) => {
                console.warn('[AudioReactive] Auto-start failed:', error);
            });
        });
    }

    async _restartAudioReactive(options = {}) {
        const { promptForFile = false } = options;
        if (!this.audioReactive.enabled) {
            this.audioReactiveRuntime.stop();
            return;
        }

        if (this.audioReactive.source === 'file' && !this.audioReactiveRuntime.file) {
            this.audioReactive.enabled = false;
            this.audioReactiveRuntime.stop({ keepStatus: true });
            this.audioReactiveRuntime.status = 'Choose audio file';
            this._syncAudioReactiveUi();
            if (promptForFile) els.audioReactiveFile?.click();
            return;
        }

        try {
            await this.audioReactiveRuntime.start();
        } catch (error) {
            this._handleAudioReactiveStartFailure(error);
            throw error;
        }
    }

    _handleAudioReactiveStartFailure(error) {
        const source = this.audioReactive.source;
        this.audioReactive.enabled = false;
        this.audioReactiveRuntime.stop({ keepStatus: true });
        this.audioReactiveRuntime.status = friendlyAudioErrorMessage(error, source);
        this._syncAudioReactiveUi(true);
    }

    async _toggleAudioReactive() {
        if (this.audioReactive.enabled || this.audioReactiveRuntime.active) {
            this.audioReactive.enabled = false;
            this.audioReactiveRuntime.stop();
            this._syncAudioReactiveUi();
            return;
        }
        this.audioReactive.enabled = true;
        try {
            await this._restartAudioReactive({ promptForFile: true });
        } catch (error) {
            console.warn('[AudioReactive] Start failed:', error);
        }
    }

    _syncAudioReactiveUi(force = false) {
        if (!els.audioReactiveControls) return;

        if (els.audioReactiveSource) els.audioReactiveSource.value = this.audioReactive.source;
        if (els.audioReactivePreset) els.audioReactivePreset.value = this.audioReactive.preset;
        if (els.audioReactiveInput) {
            els.audioReactiveInput.value = this.audioReactive.inputDeviceId || '';
            els.audioReactiveInput.disabled = this.audioReactive.source !== 'input';
            els.audioReactiveInput.closest('.field')?.toggleAttribute('hidden', this.audioReactive.source !== 'input');
        }

        const enabled = Boolean(this.audioReactive.enabled);
        const active = Boolean(this.audioReactiveRuntime.active);
        if (els.audioReactiveToggle) {
            els.audioReactiveToggle.textContent = enabled ? 'Stop' : 'Start';
            els.audioReactiveToggle.classList.toggle('active', enabled);
            els.audioReactiveToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        }
        if (els.audioReactivePickFile) {
            const isFileSource = this.audioReactive.source === 'file';
            els.audioReactivePickFile.disabled = !isFileSource;
            els.audioReactivePickFile.textContent = this.audioReactiveRuntime.file ? 'Change File' : 'Audio File';
        }
        if (els.audioReactiveStatus) {
            const loadedFile = this.audioReactiveRuntime.file?.name;
            const status = active
                ? this.audioReactiveRuntime.status
                : enabled && this.audioReactiveRuntime.status && this.audioReactiveRuntime.status !== 'Idle'
                    ? this.audioReactiveRuntime.status
                : loadedFile
                    ? `Loaded: ${loadedFile}`
                    : this.audioReactiveRuntime.status || 'Idle';
            els.audioReactiveStatus.textContent = status;
            els.audioReactiveStatus.title = status;
        }

        for (const [key, entry] of this.audioReactiveInputs.entries()) {
            const value = Number(this.audioReactive[key]);
            if (force || document.activeElement !== entry.input) entry.input.value = String(value);
            entry.output.textContent = Number.isFinite(value) ? value.toFixed(2) : '0.00';
        }

        const features = this.audioReactiveFeatures || {};
        const labels = { rms: 'RMS', bass: 'Bass', mid: 'Mid', treble: 'Treble' };
        els.audioReactiveMeters?.querySelectorAll('[data-meter]').forEach((meter) => {
            const key = meter.dataset.meter;
            const level = clamp(Number(features[key] || 0), 0, 1);
            meter.style.setProperty('--level', `${Math.round(level * 100)}%`);
            meter.textContent = `${labels[key] || key} ${Math.round(level * 100)}`;
        });
    }

    _autoStart() {
        let attempts = 0;
        const tryStart = () => {
            if (this.running || this.starting) return;
            attempts++;
            this.start({ autoStart: true }).catch((error) => {
                console.warn('[Renderer] Auto-start failed:', error);
            }).then(() => {
                if (this.running) return;
                if (attempts < 3) {
                    setTimeout(tryStart, attempts * 500);
                    return;
                }
                this._startDefaultStaticFallback().catch((error) => console.warn('[Renderer] Default fallback failed:', error));
            });
        };
        requestAnimationFrame(tryStart);
        if (document.readyState !== 'complete') {
            window.addEventListener('load', () => {
                if (!this.running && !this.starting) tryStart();
            }, { once: true });
        }
    }

    _warmBuiltInMedia() {
        for (const preset of SOURCE_PRESETS) {
            if (preset.mediaType !== 'video') continue;
            const video = document.createElement('video');
            video.src = preset.mediaUrl;
            video.preload = 'auto';
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.style.display = 'none';
            video.addEventListener('loadeddata', () => {
                if (!video.paused) video.pause();
            }, { once: true });
            document.body.appendChild(video);
            video.load();
            this.warmMediaElements.push(video);
        }
    }

    _clearLocalObjectUrl() {
        const oldUrl = this.localObjectUrl;
        this.localObjectUrl = null;
        if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
    }

    async _startDefaultStaticFallback() {
        if (this.running || this.starting) return;
        this.params = normalizeParams({
            ...this.params,
            ...defaultStaticSourceParams()
        });
        this._syncInputs();
        this._applyVisualState();
        this._persist();
        await this.start({ autoStart: true });
    }

    _ensureCustomObjectUrl() {
        if (!this.customFile) return null;
        if (!this.localObjectUrl) this.localObjectUrl = URL.createObjectURL(this.customFile);
        return this.localObjectUrl;
    }

    async _openCustomFilePicker() {
        if (isTauriRuntime()) {
            try {
                const result = await openTauriMediaFile();
                if (result.available) {
                    if (result.file) {
                        this._setCustomTauriFile(result.file);
                        await this._activateCustomSource();
                    }
                    this._renderSourceList();
                    return;
                }
            } catch (error) {
                console.warn('[Source] Tauri custom file picker failed:', error);
                this.customSourceStatus = this.customSourceMeta ? 'needs-access' : 'empty';
            }
        }

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
        this.customTauriFile = null;
        this._clearLocalObjectUrl();
        this._setCustomFile(file);
        this._activateCustomSource();
    }

    async _selectSource(id) {
        const preset = SOURCE_PRESETS.find((item) => item.id === id);
        if (preset) {
            this._clearLocalObjectUrl();
            await this._switchStaticSource({
                sourceMode: 'static',
                mediaUrl: preset.mediaUrl,
                mediaType: preset.mediaType,
                sourceName: preset.name
            });
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
        const nextParams = normalizeParams({
            ...this.params,
            sourceMode: 'static',
            mediaUrl: CAMERA_MEDIA_URL,
            mediaType: 'camera',
            sourceName: cameraSourceName(this.params),
            muted: true
        });
        await this._ensureCameraMixer(nextParams);
        await this._switchStaticSource(nextParams);
    }

    async _activateCustomSource() {
        if (this.customTauriFile) {
            const meta = this.customSourceMeta || customSourceMetaFromTauriFile(this.customTauriFile);
            this.customSourceStatus = 'present';
            await this._switchStaticSource({
                sourceMode: 'static',
                mediaUrl: this.customTauriFile.url,
                mediaType: meta.mediaType,
                sourceName: meta.name
            }, { preserveBlob: true });
            return;
        }

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
        await this._switchStaticSource({
            sourceMode: 'static',
            mediaUrl: objectUrl,
            mediaType: meta.mediaType,
            sourceName: meta.name
        }, { preserveBlob: true });
    }

    async _switchStaticSource(sourceParams, options = {}) {
        clearTimeout(this.rebuildTimer);
        const resumeWtf = options.interruptTransition !== false
            ? await this._prepareForSourceSwitch()
            : false;
        const previousSourceMode = this.params.sourceMode;
        const previousWasCamera = isCameraParams(this.params);
        const nextParams = normalizeParams({
            ...this.params,
            ...sourceParams,
            sourceMode: 'static'
        }, { preserveBlob: options.preserveBlob !== false });
        const nextIsCamera = isCameraParams(nextParams);
        const sourceChanged = this.params.sourceMode !== nextParams.sourceMode ||
            this.params.mediaUrl !== nextParams.mediaUrl ||
            this.params.mediaType !== nextParams.mediaType;

        this.params = nextParams;
        this._syncInputs();
        this._persist();
        this._applyVisualState();
        this._syncPresetToolbar();
        this._renderSourceList();

        if (previousWasCamera && !nextIsCamera) this._stopCameraStream({ render: false });
        if (!sourceChanged && this.running) {
            if (resumeWtf) this._resumeWtfAfterSourceSwitch();
            return;
        }

        if (this.starting) {
            this.startToken++;
            this.starting = false;
            this.running = false;
            this.staticRuntime.destroy();
            this.streamRuntime.stop(false);
        }

        if (this.running && previousSourceMode === 'static') await this._restartStaticSourceFast({ mediaState: null });
        else if (this.running) await this.restart({ mediaState: null });
        else await this.start({ autoStart: true });
        if (resumeWtf) this._resumeWtfAfterSourceSwitch();
    }

    async _prepareForSourceSwitch() {
        const resumeWtf = this.wtfActive;
        if (resumeWtf) this._stopWtf();
        if (!this.transitioning) return resumeWtf;
        this._cancelActiveTransition();
        await new Promise((resolve) => scheduleResponsiveFrame(resolve));
        return resumeWtf;
    }

    _cancelActiveTransition() {
        this.transitionToken++;
        this.transitioning = false;
        this._hideTransitionLayer();
    }

    _resumeWtfAfterSourceSwitch() {
        if (this.wtfActive) return;
        requestAnimationFrame(() => {
            if (!this.wtfActive) this._startWtf();
        });
    }

    _reloadSource() {
        this._prepareForSourceSwitch()
            .catch((error) => console.warn('[Source] Transition interrupt failed:', error))
            .then((resumeWtf) => {
                if (isCameraParams(this.params)) this._stopCameraStream();
                return this.restart().then(() => resumeWtf);
            })
            .then((resumeWtf) => {
                if (resumeWtf) this._resumeWtfAfterSourceSwitch();
            })
            .catch((error) => {
                console.warn('[Source] Reload failed:', error);
            });
    }

    _handleControlInput(key) {
        const entry = this.controlInputs.get(key);
        if (!entry) return;
        const { input, config } = entry;
        if (config.type === 'checkbox') {
            this.params[key] = input.checked;
        } else if (config.type === 'device-list') {
            const checked = [...input.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
            const selected = checked.filter(Boolean);
            this.params[key] = selected;
            this.params.cameraDeviceId = selected[0] || '';
            if (isCameraParams(this.params)) this.params.sourceName = cameraSourceName(this.params);
            this._syncCameraDeviceOptions();
        } else if (config.type === 'select') {
            this.params[key] = key === 'mode' ? Number(input.value) : input.value;
            if (key === 'cameraDeviceId') {
                this.params.cameraSelectedDeviceIds = input.value ? [input.value] : [];
                if (isCameraParams(this.params)) this.params.sourceName = cameraSourceName(this.params);
                this._syncCameraDeviceOptions();
            }
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
            this._prepareForSourceSwitch()
                .then((resumeWtf) => this.restart().then(() => resumeWtf))
                .then((resumeWtf) => {
                    if (resumeWtf) this._resumeWtfAfterSourceSwitch();
                })
                .catch((error) => console.warn('[Renderer] Source mode switch failed:', error));
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
            if (STATIC_SOURCE_KEYS.has(key)) {
                this._prepareForSourceSwitch()
                    .then((resumeWtf) => this.restart({ mediaState: null }).then(() => resumeWtf))
                    .then((resumeWtf) => {
                        if (resumeWtf) this._resumeWtfAfterSourceSwitch();
                    })
                    .catch((error) => console.warn('[Renderer] Source restart failed:', error));
                return;
            }
            const preserveStaticMedia = !STATIC_SOURCE_KEYS.has(key);
            this.rebuildTimer = setTimeout(() => this.restart({ preserveStaticMedia }), 250);
            return;
        }
        this._applyEffectiveRendererParams(this.renderParams(), key);
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

    _scheduleStaticVideoPlaybackEnsure(reason = 'staticVideoPlayback') {
        if (!this.running || this.params.sourceMode !== 'static') return;
        const run = () => {
            const video = videoElementFromSource(this._staticMediaSource());
            if (!video || (!video.paused && !video.ended)) return;
            this._ensureStaticVideoPlayback().catch((error) => {
                console.info(`[Renderer] Static video playback ensure failed (${reason}):`, error);
            });
        };
        run();
        [80, 250, 750, 1500].forEach((delay) => window.setTimeout(run, delay));
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
                await this.streamRuntime.start(this.params, options);
                if (token !== this.startToken) return;
                this.running = true;
                const stats = this.streamRuntime.getStats();
                this.setBackend(stats?.backend || (this.params.backend === 'auto' ? 'stream canvas' : this.params.backend));
            }
            this._applyEffectiveRendererParams(this.renderParams());
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
        this._stopNativeOutputMirror();
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
            this._applyEffectiveRendererParams(this.renderParams());
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

    async _restartStaticSourceFast(options = {}) {
        if (!this.running || this.params.sourceMode !== 'static') {
            await this.restart(options);
            return;
        }

        const previousRuntime = this.staticRuntime;
        const previousLayer = previousRuntime.renderer?.canvas?.parentElement || null;
        if (previousLayer) previousLayer.style.zIndex = '2';

        const nextRuntime = new StaticRuntime(this);
        try {
            const stats = await nextRuntime.start(this.params, { ...options, preserveStage: true });
            this.staticRuntime = nextRuntime;
            previousRuntime.destroy({ clearStage: false });
            const nextLayer = nextRuntime.renderer?.canvas?.parentElement || null;
            if (nextLayer) nextLayer.style.zIndex = '';
            await this._ensureStaticVideoPlayback();
            this.setConnection(this._staticConnectionLabel());
            this.setBackend(stats?.backend || 'static');
            this._applyEffectiveRendererParams(this.renderParams());
            this.updateMeters();
            if (this.popout && !this.popout.closed) {
                this._restartPopoutOutput().catch((error) => console.warn('[Popout] Restart failed:', error));
            }
        } catch (error) {
            nextRuntime.destroy({ clearStage: false });
            if (previousLayer) previousLayer.style.zIndex = '';
            throw error;
        }
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
            ...defaultStaticSourceParams()
        });
        this._syncInputs();
        this._applyVisualState();
        this.start({ autoStart: true });
    }

    _staticConnectionLabel() {
        return isCameraParams(this.params) ? cameraSourceName(this.params) : 'Static media';
    }

    async openPopout() {
        await this._refreshOutputDisplays();

        if (this.popout && !this.popout.closed) {
            this.popout.focus();
            return;
        }

        if (this.nativeOutputActive) {
            await this._openNativeOutputWindow();
            return;
        }

        if (this._canUseNativeRenderOutputWindow() && await this._openNativeOutputWindow()) return;
        if (!isTauriRuntime() && this._openBrowserMirrorPopout()) return;
        if (await this._openNativeOutputWindow()) return;
        if (this._openBrowserMirrorPopout()) return;
        alert('Pop-out was blocked by the browser.');
    }

    _openBrowserMirrorPopout() {
        const win = window.open('', 'asciline-remix-popout', 'popup=yes,width=1280,height=720');
        if (!win) return false;

        this.popout = win;
        try { win.opener = null; } catch {}
        try {
            win.document.open();
            win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ASCII VJ Remix Output</title>
<style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#030405;color:#e6edf3;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#mirror-stage,#mirror-canvas,#mirror-video{position:fixed;inset:0;width:100vw;height:100vh;background:#030405}
#mirror-stage{display:grid;place-items:center;overflow:hidden;padding:1vmin;box-sizing:border-box}
#mirror-stage canvas{display:block;width:auto!important;height:auto!important;max-width:98vw!important;max-height:98vh!important;object-fit:contain;image-rendering:pixelated}
#mirror-video{display:none;object-fit:cover}
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
<video id="mirror-video" muted autoplay playsinline></video>
<canvas id="mirror-canvas"></canvas>
<div class="popout-bar">
<button id="fullscreen-output" type="button">Fullscreen</button>
<button id="close-output" type="button">Close</button>
</div>
</body>
</html>`);
            win.document.close();
        } catch (error) {
            console.info('[Popout] Browser mirror window unavailable:', error);
            this.popout = null;
            try {
                win.close();
            } catch {}
            return false;
        }

        this.popoutStage = win.document.getElementById('mirror-stage');
        this.popoutVideo = win.document.getElementById('mirror-video');
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
        return true;
    }

    _canUseNativeOutputWindow() {
        return isTauriRuntime();
    }

    _canUseNativeRenderOutputWindow(params = this.params) {
        if (!this._canUseNativeOutputWindow()) return false;
        if (params?.sourceMode !== 'static') return false;
        if (isCameraParams(params)) return false;
        if (String(params?.mediaUrl || '').startsWith('blob:')) return false;
        return Boolean(params?.mediaUrl);
    }

    _canUseNativeCameraOutputWindow(params = this.params) {
        if (!this._canUseNativeOutputWindow()) return false;
        if (!isCameraParams(params)) return false;
        return selectedCameraCount(params) === 1;
    }

    _nativeCameraOutputMeta(params = this.params) {
        if (!this._canUseNativeCameraOutputWindow(params)) return null;
        const selectedIds = selectedCameraDeviceIds(params);
        const selectedLabels = selectedIds
            .filter((id) => String(id || '').trim())
            .map((id) => this._cameraDeviceLabel(id))
            .filter((label) => label && label !== 'Selected camera' && label !== 'Camera 1');
        const stream = selectedIds[0] ? this.cameraStreams.get(selectedIds[0]) : this._firstCameraStream();
        const settings = stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
        return {
            deviceLabel: selectedLabels[0] || '',
            selectedLabels,
            captureWidth: Number(settings.width || 0) || null,
            captureHeight: Number(settings.height || 0) || null
        };
    }

    _nativeOutputPayload(params = this.renderParams()) {
        const cameraMeta = this._nativeCameraOutputMeta(this.params);
        const outputMode = cameraMeta
            ? 'native-camera'
            : this._canUseNativeRenderOutputWindow(this.params)
                ? 'static'
                : 'mirror';
        return {
            outputMode,
            label: this.params.sourceName || sourceNameFromUrl(this.params.mediaUrl),
            nativeSourceId: this._nativeOutputSourceId(),
            params: {
                ...params,
                sourceMode: this.params.sourceMode,
                mediaUrl: this.params.mediaUrl,
                mediaType: this.params.mediaType,
                sourceName: this.params.sourceName,
                loop: this.params.loop,
                muted: this.params.muted,
                volume: this.params.volume,
                cameraDeviceLabel: cameraMeta?.deviceLabel || '',
                cameraSelectedDeviceLabels: cameraMeta?.selectedLabels || [],
                cameraResolution: this.params.cameraResolution,
                cameraCaptureWidth: cameraMeta?.captureWidth || null,
                cameraCaptureHeight: cameraMeta?.captureHeight || null,
                cameraFps: this.params.cameraFps,
                cameraMirror: cameraMeta ? this.params.cameraMirror : null,
                mirrorX: cameraMeta ? Boolean(this.params.cameraMirror) : Boolean(params.mirrorX),
                nativeWtfActive: Boolean(this.wtfActive),
                audioReactiveActive: Boolean(this.audioReactiveRuntime?.active),
                audioReactiveSource: this.audioReactive.source,
                audioReactivePreset: this.audioReactive.preset,
                audioReactiveSensitivity: this.audioReactive.sensitivity,
                audioReactiveBeatAmount: this.audioReactive.beatAmount,
                audioReactiveBassAmount: this.audioReactive.bassAmount,
                audioReactiveMidAmount: this.audioReactive.midAmount,
                audioReactiveTrebleAmount: this.audioReactive.trebleAmount
            },
            mediaState: outputMode === 'static' ? this._captureStaticMediaState() : null
        };
    }

    _nativeOutputSourceId() {
        if (this.customTauriFile?.id && this.params.mediaUrl === this.customTauriFile.url) {
            return this.customTauriFile.id;
        }
        return null;
    }

    async _openNativeOutputWindow() {
        if (!this._canUseNativeOutputWindow()) return false;
        try {
            const payload = this._nativeOutputPayload();
            const opened = await openTauriOutputWindow(payload, {
                outputDisplay: this.outputDisplay,
                onClosed: () => {
                    this.nativeOutputActive = false;
                    this._resetNativeOutputSyncState();
                    this._stopNativeOutputMirror();
                    this._applyMainPreviewRendererParams(this.renderParams(), 'nativeOutputClosed');
                    this._updatePopoutButton();
                }
            });
            this.nativeOutputActive = Boolean(opened);
            this.nativeOutputLastSync = performance.now();
            this._updatePopoutButton();
            if (opened) {
                this._applyMainPreviewRendererParams(this.renderParams(), 'nativeOutputOpen');
                this._scheduleStaticVideoPlaybackEnsure('nativeOutputOpen');
                this._syncNativeOutputMode(payload.outputMode);
                return true;
            }
        } catch (error) {
            console.warn('[TauriOutput] Native output failed, falling back to browser pop-out:', error);
            this.nativeOutputActive = false;
            this._resetNativeOutputSyncState();
            this._stopNativeOutputMirror();
            this._applyMainPreviewRendererParams(this.renderParams(), 'nativeOutputFailed');
            this._updatePopoutButton();
        }
        return false;
    }

    async _prewarmNativeOutputWindow() {
        return false;
    }

    _syncNativeOutputWindow(params = this.renderParams(), minIntervalMs = 0) {
        if (!this.nativeOutputActive || !this._canUseNativeOutputWindow()) return;
        const payload = this._nativeOutputPayload(params);
        this.nativeOutputPendingPayload = payload;
        this.nativeOutputPendingMinInterval = Math.max(0, Number(minIntervalMs) || 0);
        this._flushNativeOutputWindowSync();
    }

    _flushNativeOutputWindowSync() {
        if (!this.nativeOutputActive || !this._canUseNativeOutputWindow()) {
            this._resetNativeOutputSyncState();
            return;
        }
        if (this.nativeOutputSyncInFlight || !this.nativeOutputPendingPayload) return;
        const now = performance.now();
        const minIntervalMs = this.nativeOutputPendingMinInterval;
        if (minIntervalMs > 0 && now - this.nativeOutputLastSync < minIntervalMs) {
            if (!this.nativeOutputSyncTimer) {
                const delay = Math.max(0, minIntervalMs - (now - this.nativeOutputLastSync));
                this.nativeOutputSyncTimer = window.setTimeout(() => {
                    this.nativeOutputSyncTimer = null;
                    this._flushNativeOutputWindowSync();
                }, delay);
            }
            return;
        }
        const payload = this.nativeOutputPendingPayload;
        this.nativeOutputPendingPayload = null;
        this.nativeOutputPendingMinInterval = 0;
        this.nativeOutputLastSync = now;
        this.nativeOutputSyncInFlight = true;
        const syncStartedAt = performance.now();
        this.nativeOutputSyncAttemptCount++;
        sendTauriOutputState(payload).then((ok) => {
            if (!ok) {
                this.nativeOutputSyncFailedCount++;
                this.nativeOutputActive = false;
                this._resetNativeOutputSyncState();
                this._stopNativeOutputMirror();
                this._applyMainPreviewRendererParams(this.renderParams(), 'nativeOutputLost');
            } else {
                this.nativeOutputSyncOkCount++;
                this.nativeOutputLastSyncElapsedMs = performance.now() - syncStartedAt;
                const video = videoElementFromSource(this._staticMediaSource());
                if (video?.paused && !video.ended) this._scheduleStaticVideoPlaybackEnsure('nativeOutputSync');
                this._syncNativeOutputMode(payload.outputMode);
            }
            this._updatePopoutButton();
        }).finally(() => {
            this.nativeOutputSyncInFlight = false;
            if (this.nativeOutputPendingPayload) {
                this._flushNativeOutputWindowSync();
            }
        });
    }

    _resetNativeOutputSyncState() {
        if (this.nativeOutputSyncTimer) {
            window.clearTimeout(this.nativeOutputSyncTimer);
            this.nativeOutputSyncTimer = null;
        }
        this.nativeOutputPendingPayload = null;
        this.nativeOutputPendingMinInterval = 0;
        this.nativeOutputSyncInFlight = false;
    }

    _syncNativeOutputMode(outputMode = this._nativeOutputPayload().outputMode) {
        if (!this.nativeOutputActive) return;
        if (outputMode === 'mirror') {
            this._startNativeOutputMirror();
        } else {
            this._stopNativeOutputMirror();
        }
    }

    _startNativeOutputMirror() {
        if (!this.nativeOutputActive) {
            this._stopNativeOutputMirror();
            return;
        }
        if (this.nativeOutputMirrorRaf) return;

        const canvas = this.nativeOutputMirrorCanvas || document.createElement('canvas');
        const ctx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
            willReadFrequently: true
        });
        if (!ctx) return;
        this.nativeOutputMirrorCanvas = canvas;

        let lastFrameAt = 0;
        this._pushNativeOutputMirrorFrame(ctx, canvas, performance.now(), { force: true }).catch((error) => {
            console.info('[TauriOutput] Initial mirror frame failed:', error);
        });

        const draw = async (now) => {
            this.nativeOutputMirrorRaf = requestAnimationFrame(draw);
            if (!this.nativeOutputActive) {
                this._stopNativeOutputMirror();
                return;
            }

            const params = this.renderParams();
            const fps = Math.min(15, Math.max(6, Number(params.fps) || 12));
            if (now - lastFrameAt < 1000 / fps || this.nativeOutputMirrorBusy) return;
            lastFrameAt = now;
            await this._pushNativeOutputMirrorFrame(ctx, canvas, now);
        };

        this.nativeOutputMirrorRaf = requestAnimationFrame(draw);
    }

    _canvasToDataUrlAsync(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            if (!canvas.toBlob) {
                try {
                    resolve(canvas.toDataURL(type, quality));
                } catch (error) {
                    reject(error);
                }
                return;
            }
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Mirror frame encoding failed'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('Mirror frame read failed'));
                reader.readAsDataURL(blob);
            }, type, quality);
        });
    }

    async _pushNativeOutputMirrorFrame(ctx, canvas, now = performance.now(), options = {}) {
        if (this.nativeOutputMirrorBusy && !options.force) return false;
        if (this.nativeOutputMirrorSendPending && now - this.nativeOutputMirrorLastSendStart < 450 && !options.force) return false;
        const params = this.renderParams();
        const source = this._activeRenderSurface();
        const sourceWidth = source?.videoWidth || source?.naturalWidth || source?.width || 0;
        const sourceHeight = source?.videoHeight || source?.naturalHeight || source?.height || 0;
        if (!source || sourceWidth <= 0 || sourceHeight <= 0) return false;

        const maxWidth = options.force ? 960 : 800;
        const maxHeight = options.force ? 540 : 480;
        const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
        const width = Math.max(1, Math.floor(sourceWidth * scale));
        const height = Math.max(1, Math.floor(sourceHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        this.nativeOutputMirrorBusy = true;
        try {
            ctx.imageSmoothingEnabled = Boolean(params.smoothing);
            ctx.fillStyle = '#030405';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(source, 0, 0, width, height);
            this.nativeOutputMirrorBusy = false;
            const seq = ++this.nativeOutputMirrorSeq;
            this.nativeOutputMirrorSendPending = true;
            this.nativeOutputMirrorLastSendStart = performance.now();
            const label = this.params.sourceName || sourceNameFromUrl(this.params.mediaUrl) || 'Live output';
            let ok = null;
            try {
                const pixels = ctx.getImageData(0, 0, width, height);
                ok = await sendTauriOutputPixels({
                    seq,
                    width,
                    height,
                    rgba: new Uint8Array(pixels.data.buffer),
                    smoothing: Boolean(params.smoothing),
                    label
                });
            } catch (error) {
                console.info('[TauriOutput] Raw mirror pixels unavailable:', error);
            }
            if (ok === null) {
                let dataUrl = await this._canvasToDataUrlAsync(canvas, 'image/webp', options.force ? 0.72 : 0.58);
                if (!String(dataUrl).startsWith('data:image/webp')) {
                    dataUrl = await this._canvasToDataUrlAsync(canvas, 'image/jpeg', options.force ? 0.72 : 0.58);
                }
                ok = await sendTauriOutputFrame({
                    seq,
                    dataUrl,
                    width,
                    height,
                    smoothing: Boolean(params.smoothing),
                    label
                });
            }
            if (seq === this.nativeOutputMirrorSeq) this.nativeOutputMirrorSendPending = false;
            if (!ok) {
                this.nativeOutputActive = false;
                this._stopNativeOutputMirror();
                this._updatePopoutButton();
            }
            return Boolean(ok);
        } catch (error) {
            console.info('[TauriOutput] Mirror frame failed:', error);
            return false;
        } finally {
            this.nativeOutputMirrorBusy = false;
            if (performance.now() - this.nativeOutputMirrorLastSendStart > 1200) {
                this.nativeOutputMirrorSendPending = false;
            }
        }
    }

    _stopNativeOutputMirror() {
        if (this.nativeOutputMirrorRaf) cancelAnimationFrame(this.nativeOutputMirrorRaf);
        this.nativeOutputMirrorRaf = null;
        this.nativeOutputMirrorBusy = false;
        this.nativeOutputMirrorSendPending = false;
    }

    async _placePopoutOnExternalScreen(win) {
        if (!('getScreenDetails' in window)) return;
        try {
            const details = await window.getScreenDetails();
            const target = selectBrowserScreen(details.screens, details.currentScreen, this.outputDisplay);
            if (!target || win.closed) return;
            const placement = browserScreenPlacement(target);
            if (!placement) return;
            win.moveTo(placement.x, placement.y);
            win.resizeTo(placement.width, placement.height);
        } catch (error) {
            console.info('[Popout] Screen placement unavailable:', error);
        }
    }

    async _restartPopoutOutput() {
        if (!this.popout || this.popout.closed) return;
        this._stopPopoutOutput({ clear: true, keepWindow: true });
        if (this._startPopoutStreamMirror()) return;
        this._startPopoutMirror();
    }

    _stopPopoutOutput(options = {}) {
        const { clear = false } = options;
        const win = this.popout;
        if (this.popoutRaf && win && !win.closed) {
            win.cancelAnimationFrame(this.popoutRaf);
        }
        this.popoutRaf = null;
        this.popoutStream?.getTracks?.().forEach((track) => track.stop());
        this.popoutStream = null;
        if (this.popoutVideo) {
            this.popoutVideo.pause?.();
            this.popoutVideo.srcObject = null;
            this.popoutVideo.style.display = 'none';
        }
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

    _startPopoutStreamMirror() {
        const win = this.popout;
        if (!win || win.closed || !this.popoutVideo) return false;
        const source = this._activeRenderSurface();
        if (!source || typeof source.captureStream !== 'function') return false;

        try {
            const params = this.renderParams();
            const fps = Math.min(30, Math.max(12, Number(params.fps) || 24));
            const stream = source.captureStream(fps);
            if (!stream?.getVideoTracks?.().length) return false;

            this.popoutStream = stream;
            if (this.popoutStage) this.popoutStage.style.display = 'none';
            if (this.popoutCanvas) this.popoutCanvas.style.display = 'none';
            this.popoutVideo.srcObject = stream;
            this.popoutVideo.style.display = 'block';
            this.popoutVideo.play?.().catch((error) => {
                console.info('[Popout] Captured stream playback delayed:', error);
            });
            return true;
        } catch (error) {
            console.info('[Popout] Captured stream mirror unavailable:', error);
            this.popoutStream?.getTracks?.().forEach((track) => track.stop());
            this.popoutStream = null;
            if (this.popoutVideo) {
                this.popoutVideo.srcObject = null;
                this.popoutVideo.style.display = 'none';
            }
            return false;
        }
    }

    async _startPopoutRenderer() {
        const source = this._staticMediaSource();
        if (!source || !this.popoutStage || !this.popoutCanvas) return false;
        const params = this.renderParams();

        this.popoutStage.style.display = 'grid';
        this.popoutCanvas.style.display = 'none';
        this.popoutStage.innerHTML = '';

        try {
            if (this.params.backend === 'canvas2d' || this.params.backend === 'pixel-canvas') {
                const renderer = new CanvasStaticRenderer(this.popoutStage);
                await renderer.start(params, {
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
                mirrorX: shouldRendererMirrorCamera(this.params),
                preserveDrawingBuffer: true,
                preferredBackend
            });
            this.popoutRenderer.start();
            this._updatePopoutRendererParams(params);
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

    _updatePopoutRendererParams(params = this.renderParams()) {
        if (!this.popoutRenderer) return;
        if (this.popoutRenderer instanceof CanvasStaticRenderer) {
            this.popoutRenderer.updateParams(params);
            return;
        }
        this.popoutRenderer.saturationBoost = params.saturationBoost;
        this.popoutRenderer.contrastBoost = params.contrastBoost;
        this.popoutRenderer.brightness = params.brightness;
        this.popoutRenderer.gamma = params.gamma;
        this.popoutRenderer.bgBlend = params.bgBlend;
        this.popoutRenderer.quantizeBits = params.quantizeBits;
        this.popoutRenderer.jitterAmount = params.jitterAmount;
        this.popoutRenderer.jitterSpeed = params.jitterSpeed;
        this.popoutRenderer.sampleX = params.sampleX;
        this.popoutRenderer.sampleY = params.sampleY;
        this.popoutRenderer.fps = params.fps;
        this.popoutRenderer.frameInterval = 1000 / Math.max(1, params.fps);
        this.popoutRenderer.smoothing = params.smoothing;
        this.popoutRenderer.cellWidth = params.cellWidth;
        this.popoutRenderer.cellHeight = params.cellHeight;
        this.popoutRenderer.mirrorX = shouldRendererMirrorCamera(this.params);
        if (this.popoutRenderer._applySourceSmoothing) this.popoutRenderer._applySourceSmoothing();
        if (this.popoutRenderer.canvas) {
            this.popoutRenderer.canvas.style.filter = 'none';
            this.popoutRenderer.canvas.style.imageRendering = params.smoothing ? 'auto' : 'pixelated';
        }
    }

    _startPopoutMirror() {
        const win = this.popout;
        if (!win || win.closed || !this.popoutCanvas || !this.popoutCtx) return;
        if (this.popoutRaf) win.cancelAnimationFrame(this.popoutRaf);
        if (this.popoutStage) this.popoutStage.style.display = 'none';
        if (this.popoutVideo) this.popoutVideo.style.display = 'none';
        this.popoutCanvas.style.display = 'block';
        let lastDrawAt = 0;

        const draw = (now = 0) => {
            if (!this.popout || this.popout.closed) {
                this._closePopout(false);
                return;
            }
            const params = this.renderParams();
            const fps = Math.min(30, Math.max(12, Number(params.fps) || 24));
            if (now - lastDrawAt < 1000 / fps) {
                this.popoutRaf = this.popout.requestAnimationFrame(draw);
                return;
            }
            lastDrawAt = now;

            const source = this._activeRenderSurface();
            const dpr = Math.max(1, this.popout.devicePixelRatio || 1);
            const width = Math.max(1, Math.min(1920, Math.floor(this.popout.innerWidth * dpr)));
            const height = Math.max(1, Math.min(1080, Math.floor(this.popout.innerHeight * dpr)));
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
                ctx.imageSmoothingEnabled = Boolean(params.smoothing);
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
        this.popoutVideo = null;
        this.popoutCanvas = null;
        this.popoutCtx = null;
        this._updatePopoutButton();
    }

    _updatePopoutButton() {
        if (this.nativeOutputActive) {
            els.popoutWindow.textContent = 'Show Output';
            return;
        }
        els.popoutWindow.textContent = this.popout && !this.popout.closed ? 'Show Pop-Out' : 'Pop Out';
    }

    setConnection(text) {
        els.connectionStatus.textContent = text;
    }

    setBackend(text) {
        els.backendStatus.textContent = `Backend: ${text}`;
    }

    _syncDesktopUpdateUi() {
        if (!els.checkUpdate) return;

        const available = isTauriRuntime();
        els.checkUpdate.hidden = !available;
        if (els.updateStatus) {
            els.updateStatus.hidden = !available || !this.desktopUpdateStatus;
            els.updateStatus.textContent = available ? this.desktopUpdateStatus : '';
        }
        if (!available) return;

        els.checkUpdate.disabled = this.desktopUpdateBusy;
        if (this.desktopUpdateBusy) {
            els.checkUpdate.textContent = this.desktopUpdate ? 'Install' : 'Check';
        } else {
            els.checkUpdate.textContent = this.desktopUpdate ? 'Install' : 'Update';
        }
        els.checkUpdate.classList.toggle('active', Boolean(this.desktopUpdate));
    }

    async _checkOrInstallDesktopUpdate() {
        if (!isTauriRuntime() || this.desktopUpdateBusy) return;
        if (this.desktopUpdate) {
            await this._installDesktopUpdate();
            return;
        }
        await this._checkDesktopUpdate();
    }

    async _checkDesktopUpdate() {
        this.desktopUpdateBusy = true;
        this.desktopUpdateStatus = 'Checking...';
        this._syncDesktopUpdateUi();

        try {
            const update = await checkTauriUpdate({ timeout: 15000 });
            this.desktopUpdate = update;
            this.desktopUpdateStatus = update ? `v${update.version} available` : 'Up to date';
        } catch (error) {
            console.warn('[Updater] Update check failed:', error);
            this.desktopUpdate = null;
            this.desktopUpdateStatus = 'Check failed';
        } finally {
            this.desktopUpdateBusy = false;
            this._syncDesktopUpdateUi();
        }
    }

    async _installDesktopUpdate() {
        if (!this.desktopUpdate || this.desktopUpdateBusy) return;

        this.desktopUpdateBusy = true;
        this.desktopUpdateStatus = 'Downloading...';
        this._syncDesktopUpdateUi();

        let received = 0;
        let total = 0;
        const updateProgress = (event) => {
            if (!event) return;
            if (event.event === 'Started') {
                received = 0;
                total = Number(event.data?.contentLength || 0);
                this.desktopUpdateStatus = total > 0 ? 'Downloading 0%' : 'Downloading...';
            } else if (event.event === 'Progress') {
                received += Number(event.data?.chunkLength || 0);
                if (total > 0) {
                    const percent = Math.min(100, Math.floor((received / total) * 100));
                    this.desktopUpdateStatus = `Downloading ${percent}%`;
                }
            } else if (event.event === 'Finished') {
                this.desktopUpdateStatus = 'Installing...';
            }
            this._syncDesktopUpdateUi();
        };

        try {
            await installTauriUpdate(this.desktopUpdate, updateProgress, { timeout: 300000 });
            this.desktopUpdateStatus = 'Relaunching...';
        } catch (error) {
            console.warn('[Updater] Update install failed:', error);
            this.desktopUpdateStatus = 'Install failed';
            this.desktopUpdateBusy = false;
        } finally {
            this._syncDesktopUpdateUi();
        }
    }

    _syncSourceControls() {
        els.sourceMode.value = this.params.sourceMode;
        els.backend.value = this.params.backend;
        els.backend.disabled = this.params.sourceMode === 'stream';
        els.sourceLabel.textContent = this._currentSourceName();
        this._renderSourceList();
    }

    _currentSourceName() {
        if (isCameraParams(this.params)) return cameraSourceName(this.params);
        if (this.params.sourceMode === 'stream' && this.customTauriFile?.id && this.customSourceStatus === 'present') {
            return this.customSourceMeta?.name || this.customTauriFile.name || 'Native stream';
        }
        const matched = findSourcePreset(this.params.mediaUrl, this.params.mediaType);
        return matched?.name || this.params.sourceName || sourceNameFromUrl(this.params.mediaUrl);
    }

    _applyVisualState() {
        const params = this.renderParams();
        this._syncSourceControls();
        this._updateControlVisibility();
        els.statsOverlay.classList.toggle('hidden', !this.params.statsOverlay);
        els.container.style.backgroundColor = `rgba(3, 4, 5, ${clamp(1 - params.bgBlend * 0.35, 0.65, 1)})`;
        this.updateMeters();
    }

    _controlContext() {
        return {
            app: this,
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
            if (entry.config.type === 'device-list') {
                entry.input.querySelectorAll('input').forEach((item) => {
                    item.disabled = !visible;
                });
            }
            sections.add(entry.section);
        }
        for (const section of sections) {
            const visibleRows = [...section.querySelectorAll('.control-row')].some((row) => !row.classList.contains('control-hidden'));
            section.classList.toggle('control-hidden', !visibleRows);
        }
    }

    updateMeters() {
        const renderParams = this.renderParams();
        const streamStats = this.streamRuntime.getStats();
        const staticStats = this.staticRuntime.getStats();
        const stats = this.params.sourceMode === 'stream' ? streamStats : staticStats;
        const fps = stats?.currentFps ?? 0;
        const target = stats?.fps ?? renderParams.fps;
        els.fpsMeter.textContent = `FPS ${Math.round(fps)}/${Math.round(target)}`;
        els.bufferMeter.textContent = this.params.sourceMode === 'stream'
            ? `BUF ${stats?.buffer ?? this.streamRuntime.frameBuffer.length ?? 0}`
            : 'BUF n/a';
        const rows = stats?.rows || (renderParams.autoRows ? 'auto' : renderParams.rows);
        els.gridMeter.textContent = `${stats?.cols || renderParams.cols} x ${rows}`;
        const overlay = [
            `preset=${this._currentPresetName()}`,
            `source=${this._currentSourceName()}`,
            `backend=${stats?.backend || this.params.backend}`,
            `grid=${stats?.cols || renderParams.cols}x${rows}`,
            `fps=${Math.round(fps)}/${Math.round(target)}`,
            `transition=${this.params.transitionSeconds.toFixed(1)}s`,
            `audio=${this.audioReactiveRuntime.active ? this.audioReactive.preset : 'off'}`
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
            else if (config.type === 'device-list') this._syncControlValue(key);
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
        } else if (config.type === 'device-list') {
            value.textContent = this._cameraSelectionLabel(this.params);
        } else if (key === 'cameraDeviceId') {
            value.textContent = this._cameraDeviceLabel(current);
        } else if (typeof current === 'number') {
            value.textContent = `${Number.isInteger(current) ? current : current.toFixed(2)}${config.unit || ''}`;
        } else {
            value.textContent = String(current);
        }
    }

    _allPresets() {
        return [...BUILTIN_PRESETS_DISPLAY, ...this.userPresets];
    }

    _currentPresetName() {
        if (this.wtfActive) return 'WTF';
        const active = this._allPresets().find((p) => p.id === this.activePresetId);
        return active?.name || 'Custom';
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
        els.activePresetLabel.textContent = this._currentPresetName();
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
            ...this._currentSourceParams(),
            statsOverlay: this.params.statsOverlay
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
        this._syncNativeOutputWindow(this.renderParams());
        this._runWtfLoop(this.wtfToken);
    }

    _stopWtf() {
        if (!this.wtfActive) return;
        this.wtfActive = false;
        this.wtfToken++;
        this._syncWtfButton();
        this._renderPresets();
        this._syncNativeOutputWindow(this.renderParams());
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
                const completed = await this._transitionTo(target, seconds);
                if (!completed || !this.wtfActive || token !== this.wtfToken) break;
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
            fps: randomInt(WTF_MIN_SMOOTH_FPS, WTF_MAX_SMOOTH_FPS),
            fpsCap: randomInt(WTF_MIN_SMOOTH_FPS, WTF_MAX_SMOOTH_FPS),
            cols: randomInt(180, 560),
            autoRows: true
        }, { preserveBlob: true });
    }

    _randomWtfTarget(seconds) {
        const target = { ...this.params, transitionSeconds: seconds };
        const anchor = randomBool(0.48) ? randomChoice(WTF_ANCHOR_PRESETS) : null;
        const asciiAnchor = anchor ? ASCII_WTF_PRESET_ID_SET.has(anchor.id) : false;
        const anchorParams = anchor ? stripPresetExcludedParams(anchor.params || {}) : null;
        if (anchorParams) Object.assign(target, anchorParams);
        const staticMode = target.sourceMode === 'static';

        if (staticMode) {
            target.backend = 'auto';
        }

        target.volume = snapToStep(randomBetween(0, 1), 0.01);
        target.loop = true;
        target.muted = randomBool(0.72);

        const lowColumnBias = asciiAnchor || Boolean(anchorParams) || randomBool(0.38);
        target.cols = lowColumnBias ? randomInt(80, 280) : randomInt(280, 780);
        target.autoRows = true;
        target.rows = 0;
        const cellScale = lowColumnBias ? randomInt(5, 12) : randomInt(1, 6);
        target.cellWidth = cellScale;
        target.cellHeight = Math.max(2, Math.min(16, Math.round(cellScale * randomBetween(1.35, 1.65))));
        target.aspectCorrection = 1;

        target.saturationBoost = snapToStep(randomBool(0.54)
            ? randomChoice([randomBetween(0, 0.22), randomBetween(2.55, 3)])
            : randomBetween(0.22, 2.65), 0.01);
        target.contrastBoost = snapToStep(randomBool(0.62)
            ? randomBetween(2.2, 3)
            : randomBetween(0.75, 2.35), 0.01);
        target.brightness = snapToStep(randomBetween(0.72, 1.48), 0.01);
        target.gamma = snapToStep(randomBool(0.58)
            ? randomChoice([randomBetween(0.28, 0.68), randomBetween(2.25, 3)])
            : randomBetween(0.68, 2.25), 0.01);
        target.bgBlend = snapToStep(randomBool(0.66)
            ? randomBetween(0, 0.12)
            : randomBetween(0.12, 0.5), 0.01);
        target.quantizeBits = randomBool(0.64) ? randomInt(5, 6) : randomInt(0, 5);

        if (target.sourceMode === 'stream') {
            target.mode = randomInt(1, 5);
            target.pixel = randomBool(0.4);
        } else {
            target.pixel = Boolean(anchorParams?.pixel) && randomBool(0.72);
        }

        target.fps = randomInt(WTF_MIN_SMOOTH_FPS, WTF_MAX_SMOOTH_FPS);
        target.jitterAmount = snapToStep(randomBool(0.72) ? randomBetween(0.72, 1) : randomBetween(0, 0.72), 0.01);
        target.jitterSpeed = snapToStep(randomBool(0.72) ? randomBetween(2.7, 4) : randomBetween(0, 2.7), 0.01);
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
        target.fpsCap = randomInt(WTF_MIN_SMOOTH_FPS, WTF_MAX_SMOOTH_FPS);

        const canvasBackend = backendKind(target) === 'canvas';
        target.solidMode = Boolean(anchorParams?.solidMode) || (canvasBackend ? randomBool(0.34) : randomBool(0.2));
        target.glyphMode = target.solidMode ? false : (anchorParams?.glyphMode ?? randomBool(0.66));
        target.charset = randomChoice(CHARACTER_SET_IDS);
        target.fontFamily = randomChoice(FONT_FAMILY_IDS);
        target.minGlyphIntensity = randomInt(70, 230);
        if (asciiAnchor && anchorParams) {
            const reusableStaticBackend = staticMode &&
                this.running &&
                this.staticRuntime?.canReuseSource?.({ ...target, backend: this.params.backend });
            this._applyAsciiWtfAnchor(target, anchorParams, {
                preserveBackend: reusableStaticBackend ? this.params.backend : null
            });
        }

        return normalizeParams(target, { preserveBlob: true });
    }

    _applyAsciiWtfAnchor(target, anchorParams, options = {}) {
        const around = (key, spread, min, max) => {
            const base = Number(anchorParams[key] ?? target[key]);
            const value = Number.isFinite(base) ? base : Number(DEFAULT_PARAMS[key] || 0);
            return snapToStep(clamp(value + randomBetween(-spread, spread), min, max), 0.01);
        };
        const nudgeInt = (key, spread, min, max) => {
            const base = Number(anchorParams[key] ?? target[key]);
            const value = Number.isFinite(base) ? base : Number(DEFAULT_PARAMS[key] || min);
            return Math.round(clamp(value + randomInt(-spread, spread), min, max));
        };

        target.backend = options.preserveBackend || anchorParams.backend || 'canvas2d';
        target.cols = Math.round(clamp(Number(anchorParams.cols || target.cols) * randomBetween(0.9, 1.12), 80, 320));
        target.cellWidth = nudgeInt('cellWidth', 1, 2, 9);
        target.cellHeight = nudgeInt('cellHeight', 1, 3, 13);
        target.saturationBoost = around('saturationBoost', 0.12, 0, 3);
        target.contrastBoost = around('contrastBoost', 0.28, 0, 3);
        target.brightness = around('brightness', 0.12, 0.4, 2);
        target.gamma = around('gamma', 0.16, 0.2, 3);
        target.bgBlend = around('bgBlend', 0.06, 0, 1);
        target.quantizeBits = nudgeInt('quantizeBits', 1, 0, 6);
        target.jitterAmount = around('jitterAmount', 0.08, 0, 0.22);
        target.jitterSpeed = around('jitterSpeed', 0.18, 0, 0.5);
        target.sampleX = Number(anchorParams.sampleX ?? 0.5);
        target.sampleY = Number(anchorParams.sampleY ?? 0.5);
        target.smoothing = Boolean(anchorParams.smoothing);
        target.solidMode = false;
        target.glyphMode = true;
        target.charset = anchorParams.charset || target.charset;
        target.fontFamily = anchorParams.fontFamily || target.fontFamily;
        target.pixel = false;
        target.mode = Number(anchorParams.mode ?? target.mode);
        target.codecQuality = anchorParams.codecQuality || target.codecQuality;
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
                scheduleResponsiveFrame(check);
            };
            scheduleResponsiveFrame(check);
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
                scheduleResponsiveFrame(check);
            };
            scheduleResponsiveFrame(check);
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
        const presetParams = stripPresetExcludedParams(preset.params);
        const target = normalizeParams(
            { ...this._baseForPreset(preset), ...presetParams },
            { preserveBlob: true }
        );
        target.statsOverlay = this.params.statsOverlay;
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
        const token = ++this.transitionToken;
        const before = { ...this.params };
        const changed = Object.keys(target).filter((key) => target[key] !== before[key]);
        const needsRebuild = changed.some((key) => STRUCTURAL_KEYS.has(key));
        if (seconds <= 0) {
            if (token !== this.transitionToken) return false;
            const mediaState = this._captureStaticMediaState(target);
            this.params = target;
            this._syncInputs();
            this._persist();
            if (this.running) await this.restart({ mediaState });
            else this._applyVisualState();
            return token === this.transitionToken;
        }
        if (needsRebuild) {
            return this._crossfadeRebuild(target, seconds, token);
        }
        return this._tweenParams(before, target, seconds, {}, token);
    }

    _tweenParams(from, to, seconds, options = {}, token = this.transitionToken) {
        this.transitioning = true;
        return new Promise((resolve) => {
            const start = performance.now();
            const duration = Math.max(1, seconds * 1000);
            const cancel = () => {
                if (!options.keepTransitioning) this.transitioning = false;
                resolve(false);
            };
            const step = (now) => {
                if (token !== this.transitionToken) {
                    cancel();
                    return;
                }
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
                    this._applyEffectiveRendererParams(this.renderParams(), 'transition');
                }
                if (t < 1) {
                    scheduleResponsiveFrame(step);
                } else {
                    if (token !== this.transitionToken) {
                        cancel();
                        return;
                    }
                    this.params = to;
                    this._syncInputs();
                    this._persist();
                    this._applyEffectiveRendererParams(this.renderParams(), 'transition');
                    if (!options.keepTransitioning) this.transitioning = false;
                    resolve(true);
                }
            };
            scheduleResponsiveFrame(step);
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
            await new Promise((resolve) => scheduleResponsiveFrame(resolve));
            if (advanced && i + 1 >= minPaintedFrames) break;
        }
        await new Promise((resolve) => scheduleResponsiveFrame(resolve));
        return advanced;
    }

    _crossfadeLiveRenderer(target, seconds, token = this.transitionToken) {
        this.transitioning = true;
        return new Promise((resolve, reject) => {
            const duration = Math.max(80, seconds * 1000);
            const runtime = this.staticRuntime;
            let prepared = null;
            let finished = false;
            const active = () => token === this.transitionToken;

            const cancel = () => {
                if (finished) return;
                finished = true;
                runtime.cancelCrossfadeRenderer(prepared);
                if (active()) this.transitioning = false;
                resolve(false);
            };

            const finish = () => {
                if (finished) return;
                finished = true;
                if (!active()) {
                    runtime.cancelCrossfadeRenderer(prepared);
                    resolve(false);
                    return;
                }
                runtime.finishCrossfadeRenderer(prepared);
                this.transitioning = false;
                resolve(true);
            };

            const run = async () => {
                if (!active()) {
                    cancel();
                    return;
                }
                this.params = target;
                this._syncInputs();
                this._persist();
                this._applyVisualState();

                prepared = await runtime.prepareCrossfadeRenderer(target);
                if (!active()) {
                    cancel();
                    return;
                }
                if (!prepared) {
                    await this.restart({ mediaState: this._captureStaticMediaState(target) });
                    if (!active()) {
                        cancel();
                        return;
                    }
                    finish();
                    return;
                }

                await this._ensureStaticVideoPlayback();
                this.setConnection(this._staticConnectionLabel());
                this.setBackend(prepared.stats?.backend || 'static');
                this._applyEffectiveRendererParams(this.renderParams(), 'transition');
                this.updateMeters();
                if (this.popout && !this.popout.closed) {
                    this._restartPopoutOutput().catch((error) => console.warn('[Popout] Restart failed:', error));
                }

                await this._paintCurrentFrame(3, 1);

                const start = performance.now();
                const step = (now) => {
                    if (!active()) {
                        cancel();
                        return;
                    }
                    const t = clamp((now - start) / duration, 0, 1);
                    if (prepared?.oldLayer) prepared.oldLayer.style.opacity = String(crossfadeOut(t));
                    if (t < 1) scheduleResponsiveFrame(step);
                    else finish();
                };
                scheduleResponsiveFrame(step);
            };

            run().catch((error) => {
                runtime.cancelCrossfadeRenderer(prepared);
                if (active()) this.transitioning = false;
                reject(error);
            });
        });
    }

    _crossfadeRebuild(target, seconds, token = this.transitionToken) {
        if (
            this.running &&
            this.params.sourceMode === 'static' &&
            target.sourceMode === 'static' &&
            this.staticRuntime.canReuseSource(target)
        ) {
            return this._crossfadeLiveRenderer(target, seconds, token);
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
            const active = () => token === this.transitionToken;

            const cancel = () => {
                if (finished) return;
                finished = true;
                if (active()) {
                    this._hideTransitionLayer();
                    this.transitioning = false;
                }
                resolve(false);
            };

            const finish = () => {
                if (finished || !fadeDone || !rebuildDone) return;
                finished = true;
                if (!active()) {
                    resolve(false);
                    return;
                }
                this._hideTransitionLayer();
                this.transitioning = false;
                resolve(true);
            };

            const startFade = () => {
                if (!captured || fadeStarted) return;
                fadeStarted = true;
                const start = performance.now();
                const step = (now) => {
                    if (!active()) {
                        cancel();
                        return;
                    }
                    const t = clamp((now - start) / duration, 0, 1);
                    const opacity = String(crossfadeOut(t));
                    if (this.transitionFadeCanvas) this.transitionFadeCanvas.style.opacity = opacity;
                    else els.transitionLayer.style.opacity = opacity;
                    if (t < 1) {
                        scheduleResponsiveFrame(step);
                    } else {
                        fadeDone = true;
                        finish();
                    }
                };
                scheduleResponsiveFrame(step);
            };

            const prepareUnderlayThenFade = () => {
                if (!captured) return;
                const width = this.transitionFadeCanvas?.width || 0;
                const height = this.transitionFadeCanvas?.height || 0;
                const fallbackTimer = window.setTimeout(startFade, 90);
                scheduleResponsiveFrame(() => {
                    window.setTimeout(() => {
                        if (!active()) {
                            window.clearTimeout(fallbackTimer);
                            cancel();
                            return;
                        }
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
                if (!active()) {
                    cancel();
                    return;
                }
                this.params = target;
                this._syncInputs();
                this._persist();
                if (this.running) {
                    await this.restart({ mediaState });
                    if (!active()) {
                        cancel();
                        return;
                    }
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
            params: stripPresetExcludedParams(source.params)
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
            const fallbackParams = stripPresetExcludedParams(fallback.params);
            const target = normalizeParams(
                { ...this._baseForPreset(fallback), ...fallbackParams },
                { preserveBlob: true }
            );
            target.transitionSeconds = this.params.transitionSeconds;
            target.statsOverlay = this.params.statsOverlay;
            try {
                await this._transitionTo(target, fallback.transitionSeconds ?? this.params.transitionSeconds);
            } catch (error) {
                console.error(error);
            }
        }
        this._renderPresets();
    }

    _sanitizedUserPresets() {
        const usedIds = new Set(BUILTIN_PRESETS.map((preset) => preset.id));
        return (Array.isArray(this.userPresets) ? this.userPresets : [])
            .slice(0, MAX_USER_PRESETS)
            .map((preset, idx) => sanitizeUserPreset(
                preset,
                idx,
                this.params.transitionSeconds,
                { usedIds }
            ));
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
            if (incoming.length > MAX_USER_PRESETS) {
                throw new Error(`Import is limited to ${MAX_USER_PRESETS} presets`);
            }
            const usedIds = new Set(BUILTIN_PRESETS.map((preset) => preset.id));
            this.userPresets = incoming.map((preset, idx) => sanitizeUserPreset(
                preset,
                idx,
                this.params.transitionSeconds,
                { strict: true, usedIds }
            ));
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
