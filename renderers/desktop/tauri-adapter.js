import { convertFileSrc, invoke as tauriInvoke, isTauri as tauriApiIsTauri } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkForTauriUpdate } from '@tauri-apps/plugin-updater';
import {
    monitorLogicalRect,
    outputDisplaysFromMonitors,
    selectMonitor
} from './output-display.js';

const OUTPUT_WINDOW_LABEL = 'output';
const NATIVE_OUTPUT_CLOSED_EVENT = 'asciline-native-output-closed';
let outputDestroyedUnlisten = null;
let nativeOutputClosedUnlisten = null;
let outputBackend = null;
let crashReportHandler = null;

const MEDIA_EXTENSIONS = {
    video: ['mp4', 'webm', 'mkv'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'svg']
};

function isTauriRuntime() {
    try {
        const internals = globalThis.__TAURI_INTERNALS__;
        return Boolean(
            tauriApiIsTauri?.() ||
            internals?.invoke ||
            internals?.metadata ||
            globalThis.__TAURI__ ||
            globalThis.isTauri
        );
    } catch {
        return false;
    }
}

function setTauriCrashReportHandler(handler) {
    crashReportHandler = typeof handler === 'function' ? handler : null;
}

function crashContextForError(error) {
    if (!error || typeof error !== 'object') return {};
    const out = {};
    if (error.name) out.name = String(error.name);
    const code = error.errorCode ?? error.code;
    if (code !== undefined && code !== null && code !== '') out.code = String(code);
    const statusCode = error.statusCode ?? error.status;
    if (statusCode !== undefined && statusCode !== null && statusCode !== '') out.statusCode = String(statusCode);
    return out;
}

function reportTauriCommandFailure(command, error) {
    if (!crashReportHandler || String(command || '').includes('crash_report')) return;
    crashReportHandler({
        kind: 'tauri-command',
        surface: 'tauri-command',
        message: error?.message || String(error || 'Tauri command failed'),
        stack: error?.stack || '',
        context: { command, ...crashContextForError(error) }
    });
}

async function invokeTauri(command, args) {
    try {
        return await tauriInvoke(command, args);
    } catch (error) {
        reportTauriCommandFailure(command, error);
        throw error;
    }
}

function baseName(filePath) {
    return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || 'Custom media';
}

function extensionForName(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
    return match ? match[1] : '';
}

function mediaTypeFromName(name) {
    const ext = extensionForName(name);
    if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
    if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
    return 'video';
}

function redactDiagnosticText(value) {
    return String(value ?? '')
        .replace(/\b(?:asset|file):\/\/[^\s"']+/gi, '[redacted-url]')
        .replace(/\bhttps?:\/\/asset\.localhost[^\s"']*/gi, '[redacted-asset-url]')
        .replace(/\/Users\/[^\s"']+/g, '[redacted-path]')
        .replace(/[A-Za-z]:\\[^\s"']+/g, '[redacted-path]')
        .slice(0, 1000);
}

async function openTauriMediaFile() {
    if (!isTauriRuntime()) return { available: false, file: null };

    const selected = await invokeTauri('select_media_file');
    if (!selected) return { available: true, file: null };

    const selectedPath = selected.path || '';
    const name = selected.name || baseName(selectedPath);
    const url = selected.assetUrl || (selectedPath ? convertFileSrc(selectedPath) : '');
    return {
        available: true,
        file: {
            id: selected.id,
            provider: 'tauri',
            url,
            name,
            size: selected.size ?? null,
            lastModified: selected.lastModified ?? null,
            type: selected.type || '',
            mediaType: selected.mediaType || mediaTypeFromName(name)
        }
    };
}

async function probeTauriMediaFile(file) {
    if (!isTauriRuntime() || !file?.id) return null;
    return invokeTauri('probe_registered_media', { id: file.id });
}

async function startTauriMediaSession(file, request) {
    if (!isTauriRuntime() || !file?.id) return null;
    return invokeTauri('start_registered_media_session', { id: file.id, request });
}

async function readTauriMediaSessionFrame(sessionId) {
    if (!isTauriRuntime() || !sessionId) return null;
    return invokeTauri('read_media_session_frame', { sessionId });
}

async function readTauriMediaSessionFrames(sessionId, maxFrames) {
    if (!isTauriRuntime() || !sessionId) return null;
    return invokeTauri('read_media_session_frames', { sessionId, maxFrames });
}

async function stopTauriMediaSession(sessionId) {
    if (!isTauriRuntime() || !sessionId) return false;
    return invokeTauri('stop_media_session', { sessionId });
}

async function startTauriRawVideoSession(file, request) {
    if (!isTauriRuntime() || !file?.id) return null;
    return invokeTauri('start_raw_video_session', { id: file.id, request });
}

async function readTauriRawVideoFrames(sessionId, maxFrames = 1) {
    if (!isTauriRuntime() || !sessionId) return null;
    return invokeTauri('read_raw_video_frames', { sessionId, maxFrames });
}

async function stopTauriRawVideoSession(sessionId) {
    if (!isTauriRuntime() || !sessionId) return false;
    return invokeTauri('stop_raw_video_session', { sessionId });
}

async function startTauriSystemAudioCapture() {
    if (!isTauriRuntime()) return { available: false, active: false };
    return invokeTauri('start_system_audio_capture');
}

async function readTauriSystemAudioFeatures() {
    if (!isTauriRuntime()) return { available: false, active: false };
    return invokeTauri('read_system_audio_features');
}

async function stopTauriSystemAudioCapture() {
    if (!isTauriRuntime()) return false;
    return invokeTauri('stop_system_audio_capture');
}

async function startTauriInputAudioCapture(deviceLabel = '') {
    if (!isTauriRuntime()) return { available: false, active: false };
    const label = String(deviceLabel || '').trim();
    return invokeTauri('start_input_audio_capture', {
        request: label ? { deviceLabel: label } : null
    });
}

async function readTauriInputAudioFeatures() {
    if (!isTauriRuntime()) return { available: false, active: false };
    return invokeTauri('read_input_audio_features');
}

async function stopTauriInputAudioCapture() {
    if (!isTauriRuntime()) return false;
    return invokeTauri('stop_input_audio_capture');
}

async function requestTauriMediaPermission(kind) {
    if (!isTauriRuntime()) return { available: false, kind, status: 'unsupported' };
    return invokeTauri('request_media_permission', { kind });
}

async function recordTauriMediaDiagnostic(message) {
    if (!isTauriRuntime()) return false;
    await invokeTauri('record_media_diagnostic', { message: redactDiagnosticText(message) });
    return true;
}

async function getTauriCrashReportState() {
    if (!isTauriRuntime()) return { available: false, pendingCount: 0, reports: [] };
    return invokeTauri('get_crash_report_state');
}

async function captureTauriCrashReport(report) {
    if (!isTauriRuntime()) return { available: false, pendingCount: 0, reports: [] };
    return invokeTauri('capture_crash_report', { report });
}

async function submitTauriCrashReports() {
    if (!isTauriRuntime()) return { available: false, pendingCount: 0, reports: [] };
    return invokeTauri('submit_crash_reports');
}

async function discardTauriCrashReports() {
    if (!isTauriRuntime()) return { available: false, pendingCount: 0, reports: [] };
    return invokeTauri('discard_crash_reports');
}

async function setTauriCrashReportPreference(preference) {
    if (!isTauriRuntime()) return { available: false, pendingCount: 0, reports: [] };
    return invokeTauri('set_crash_report_preference', { preference });
}

async function clearTauriBrowsingData() {
    if (!isTauriRuntime()) return false;
    const current = WebviewWindow.getCurrent();
    if (typeof current?.clearAllBrowsingData !== 'function') return false;
    await current.clearAllBrowsingData();
    return true;
}

async function listenTauriEvent(eventName, handler) {
    if (!isTauriRuntime()) return () => {};
    return listen(eventName, handler);
}

async function listTauriOutputDisplays() {
    if (!isTauriRuntime()) return [];
    const monitors = await availableMonitors();
    if (!Array.isArray(monitors)) return [];
    return outputDisplaysFromMonitors(monitors);
}

async function checkTauriUpdate(options = {}) {
    if (!isTauriRuntime()) return null;
    return checkForTauriUpdate(options);
}

async function installTauriUpdate(update, onEvent, options = {}) {
    if (!isTauriRuntime() || !update) return false;
    await update.downloadAndInstall(onEvent, options);
    await relaunch();
    return true;
}

async function placeOutputWindow(windowRef, displayPreference = 'auto') {
    try {
        const monitors = await availableMonitors();
        const target = selectMonitor(monitors, displayPreference);
        if (!target) return;

        const { position, size } = monitorLogicalRect(target);

        if (position) await windowRef.setPosition(position);
        if (size) await windowRef.setSize(size);
    } catch (error) {
        console.info('[TauriOutput] External display placement unavailable:', error);
    }
}

async function sendTauriOutputState(payload) {
    if (!isTauriRuntime()) return false;
    if (outputBackend === 'native') {
        try {
            const result = await invokeTauri('update_native_output_window', { payload });
            if (result?.opened) return true;
            outputBackend = null;
            return false;
        } catch (error) {
            console.info('[TauriOutput] Native output state sync failed:', error);
            outputBackend = null;
            return false;
        }
    }
    try {
        await emitTo(OUTPUT_WINDOW_LABEL, 'asciline-output-state', payload);
        return true;
    } catch (error) {
        console.info('[TauriOutput] State sync failed:', error);
        return false;
    }
}

async function sendTauriOutputFrame(frame) {
    if (!isTauriRuntime()) return false;
    if (outputBackend === 'native') {
        try {
            const result = await invokeTauri('update_native_output_frame', { frame });
            if (result?.accepted) return true;
            outputBackend = null;
            return false;
        } catch (error) {
            console.info('[TauriOutput] Native frame sync failed:', error);
            outputBackend = null;
            return false;
        }
    }
    try {
        await emitTo(OUTPUT_WINDOW_LABEL, 'asciline-output-frame', frame);
        return true;
    } catch (error) {
        console.info('[TauriOutput] Frame sync failed:', error);
        return false;
    }
}

async function sendTauriOutputPixels(frame) {
    if (!isTauriRuntime() || outputBackend !== 'native') return false;
    try {
        const result = await invokeTauri('update_native_output_pixels', { frame });
        if (result?.accepted) return true;
        outputBackend = null;
        return false;
    } catch (error) {
        console.info('[TauriOutput] Native pixel sync unavailable, falling back to encoded frames:', error);
        return null;
    }
}

function scheduleOutputStateResend(payload) {
    if (!isTauriRuntime()) return;
    const resend = () => sendTauriOutputState(payload).catch(() => false);
    for (const delay of [80, 180, 360, 720, 1400, 2500, 4000]) {
        window.setTimeout(resend, delay);
    }
}

async function watchOutputWindowDestroyed(windowRef, onClosed) {
    if (!isTauriRuntime() || !windowRef || !onClosed || outputDestroyedUnlisten) return;
    try {
        outputDestroyedUnlisten = await windowRef.once('tauri://destroyed', () => {
            outputDestroyedUnlisten = null;
            if (outputBackend === 'webview') outputBackend = null;
            onClosed?.();
        });
    } catch (error) {
        console.info('[TauriOutput] Close watcher unavailable:', error);
    }
}

async function watchNativeOutputClosed(onClosed) {
    if (!isTauriRuntime() || nativeOutputClosedUnlisten) return;
    try {
        nativeOutputClosedUnlisten = await listen(NATIVE_OUTPUT_CLOSED_EVENT, () => {
            nativeOutputClosedUnlisten?.();
            nativeOutputClosedUnlisten = null;
            outputBackend = null;
            onClosed?.();
        });
    } catch (error) {
        console.info('[TauriOutput] Native close watcher unavailable:', error);
    }
}

async function openNativeSurfaceOutput(payload, options = {}) {
    if (!isTauriRuntime() || options.show === false) return false;
    try {
        const params = payload?.params || {};
        await recordTauriMediaDiagnostic(
            `[TauriOutput] native-open start mode=${payload?.outputMode || 'unknown'} sourceMode=${params.sourceMode || 'unknown'} mediaType=${params.mediaType || 'unknown'}`
        ).catch(() => {});
        const result = await invokeTauri('open_native_output_window', {
            request: {
                payload,
                displayPreference: options.outputDisplay || 'auto',
                visible: options.show !== false
            }
        });
        await recordTauriMediaDiagnostic(
            `[TauriOutput] native-open result opened=${Boolean(result?.opened)} backend=${result?.backend || 'unknown'} reason=${result?.reason || ''}`
        ).catch(() => {});
        if (!result?.opened) return false;
        outputBackend = 'native';
        await watchNativeOutputClosed(options.onClosed);
        const existing = await WebviewWindow.getByLabel(OUTPUT_WINDOW_LABEL).catch(() => null);
        await existing?.close?.().catch(() => {});
        return true;
    } catch (error) {
        await recordTauriMediaDiagnostic(`[TauriOutput] native-open error ${error?.message || error}`).catch(() => {});
        console.info('[TauriOutput] Native surface unavailable:', error);
        outputBackend = null;
        return false;
    }
}

async function openTauriOutputWindow(payload, options = {}) {
    if (!isTauriRuntime()) return false;
    const shouldShow = options.show !== false;

    if (await openNativeSurfaceOutput(payload, options)) return true;

    const existing = await WebviewWindow.getByLabel(OUTPUT_WINDOW_LABEL).catch(() => null);
    if (existing) {
        outputBackend = 'webview';
        await watchOutputWindowDestroyed(existing, options.onClosed);
        if (shouldShow) {
            await existing.show().catch(() => {});
            await placeOutputWindow(existing, options.outputDisplay).catch(() => {});
            await existing.setFocus().catch(() => {});
        }
        await sendTauriOutputState(payload);
        scheduleOutputStateResend(payload);
        return true;
    }

    const outputWindow = new WebviewWindow(OUTPUT_WINDOW_LABEL, {
        url: 'output.html',
        title: 'ASCII VJ Remix Output',
        width: 1280,
        height: 720,
        minWidth: 320,
        minHeight: 240,
        resizable: true,
        decorations: true,
        visible: shouldShow,
        backgroundColor: '#030405'
    });

    await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Output window creation timed out')), 5000);
        outputWindow.once('tauri://created', () => {
            window.clearTimeout(timeout);
            resolve();
        });
        outputWindow.once('tauri://error', (event) => {
            window.clearTimeout(timeout);
            reject(new Error(String(event?.payload || 'Output window creation failed')));
        });
    });

    await watchOutputWindowDestroyed(outputWindow, options.onClosed);
    outputBackend = 'webview';
    if (shouldShow) {
        await placeOutputWindow(outputWindow, options.outputDisplay);
        await outputWindow.show().catch(() => {});
        await outputWindow.setFocus().catch(() => {});
    }
    await sendTauriOutputState(payload);
    scheduleOutputStateResend(payload);
    return true;
}

export {
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
    readTauriMediaSessionFrame,
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
};
