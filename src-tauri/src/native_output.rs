use crate::desktop_bridge::{media_binaries_for_app, MediaRegistry};
use crate::media_engine::ffmpeg::{
    probe_video, spawn_macos_camera_rgb_reader, spawn_rgb_reader_with_options, CameraReaderOptions,
    DecodeConfig, DecodedRgbFrame, FfmpegBinaries, FfmpegRgbFrameReader, RgbReaderOptions,
    VideoProbe,
};
use crate::system_audio::{InputAudioCaptureState, SystemAudioCaptureState, SystemAudioFeatures};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::ffi::OsStr;
use std::fs;
#[cfg(target_os = "macos")]
use std::io::Write;
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, Window,
    WindowBuilder, WindowEvent,
};

mod gpu;
mod native_camera;

const NATIVE_OUTPUT_LABEL: &str = "native-output";
const NATIVE_OUTPUT_CLOSED_EVENT: &str = "asciline-native-output-closed";
const DEFAULT_OUTPUT_WIDTH: u32 = 1280;
const DEFAULT_OUTPUT_HEIGHT: u32 = 720;
const MAX_SAMPLE_DIMENSION: u32 = 1280;
const MAX_MIRROR_DIMENSION: u32 = 1280;
const MAX_MIRROR_PIXELS: u32 = 1_500_000;
const MAX_MIRROR_DATA_URL_BYTES: usize = 8 * 1024 * 1024;
const MAX_NATIVE_CELLS: f64 = 500_000.0;
const MAX_READER_FRAMES: usize = 1_000_000_000;
const MAX_NATIVE_SOURCE_FPS: f64 = 60.0;
const DEFAULT_NATIVE_SOURCE_FPS: f64 = 24.0;
const MIRROR_SOURCE_KEY: &str = "mirror";
const NATIVE_CAMERA_SOURCE_KEY: &str = "native-camera";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputWindowRequest {
    pub payload: NativeOutputPayload,
    pub display_preference: Option<String>,
    pub visible: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputPayload {
    pub output_mode: Option<String>,
    pub label: Option<String>,
    pub native_source_id: Option<String>,
    pub params: NativeOutputParams,
    pub media_state: Option<NativeOutputMediaState>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputMediaState {
    pub current_time: Option<f64>,
    pub paused: Option<bool>,
    pub ended: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputParams {
    pub source_mode: Option<String>,
    pub media_url: Option<String>,
    pub media_type: Option<String>,
    pub source_name: Option<String>,
    #[serde(rename = "loop")]
    pub loop_: Option<bool>,
    pub cols: Option<f64>,
    pub rows: Option<f64>,
    pub auto_rows: Option<bool>,
    pub fps: Option<f64>,
    pub saturation_boost: Option<f64>,
    pub contrast_boost: Option<f64>,
    pub brightness: Option<f64>,
    pub gamma: Option<f64>,
    pub bg_blend: Option<f64>,
    pub quantize_bits: Option<f64>,
    pub jitter_amount: Option<f64>,
    pub jitter_speed: Option<f64>,
    pub sample_x: Option<f64>,
    pub sample_y: Option<f64>,
    pub smoothing: Option<bool>,
    pub cell_width: Option<f64>,
    pub cell_height: Option<f64>,
    pub aspect_correction: Option<f64>,
    pub mirror_x: Option<bool>,
    pub pixel: Option<bool>,
    pub solid_mode: Option<bool>,
    pub camera_device_label: Option<String>,
    pub camera_selected_device_labels: Option<Vec<String>>,
    pub camera_resolution: Option<String>,
    pub camera_capture_width: Option<f64>,
    pub camera_capture_height: Option<f64>,
    pub camera_fps: Option<f64>,
    pub camera_mirror: Option<bool>,
    pub native_wtf_active: Option<bool>,
    pub audio_reactive_active: Option<bool>,
    pub audio_reactive_source: Option<String>,
    pub audio_reactive_preset: Option<String>,
    pub audio_reactive_sensitivity: Option<f64>,
    pub audio_reactive_beat_amount: Option<f64>,
    pub audio_reactive_bass_amount: Option<f64>,
    pub audio_reactive_mid_amount: Option<f64>,
    pub audio_reactive_treble_amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputWindowResult {
    pub opened: bool,
    pub backend: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputFrame {
    pub seq: u64,
    pub data_url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub smoothing: Option<bool>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputPixels {
    pub seq: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub smoothing: Option<bool>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOutputFrameResult {
    pub accepted: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct NativeOutputState {
    inner: Arc<Mutex<NativeOutputInner>>,
    next_generation: Arc<AtomicU64>,
}

#[derive(Debug, Default)]
struct NativeOutputInner {
    handle: Option<NativeOutputHandle>,
}

#[derive(Debug)]
struct NativeOutputHandle {
    generation: u64,
    source_key: String,
    stop: Arc<AtomicBool>,
    params: Arc<Mutex<NativeRenderParams>>,
    param_version: Arc<AtomicU64>,
    mirror_slot: Option<Arc<NativeMirrorFrameSlot>>,
    #[cfg(target_os = "macos")]
    display_link: Option<NativeMacDisplayLinkPresenter>,
    window: Window,
}

#[derive(Debug, Clone)]
struct NativeOutputSource {
    path: PathBuf,
    source_key: String,
    media_type: String,
    start_seconds: Option<f64>,
}

#[derive(Debug, Clone)]
struct NativeCameraSource {
    source_key: String,
    device_label: Option<String>,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
    output_width: u32,
    output_height: u32,
    capture_fps: f64,
}

#[derive(Debug)]
enum CameraFrameReader {
    Native(native_camera::NativeCameraFrameReader),
    Ffmpeg(FfmpegRgbFrameReader),
}

#[derive(Debug)]
enum CameraFrameRead {
    Frame(DecodedRgbFrame),
    Pending,
    Ended,
}

impl CameraFrameReader {
    fn read_frame(&mut self) -> Result<CameraFrameRead, String> {
        match self {
            Self::Native(reader) => reader.read_latest_frame().map(|frame| {
                frame
                    .map(CameraFrameRead::Frame)
                    .unwrap_or(CameraFrameRead::Pending)
            }),
            Self::Ffmpeg(reader) => reader
                .read_next_frame()
                .map(|frame| {
                    frame
                        .map(CameraFrameRead::Frame)
                        .unwrap_or(CameraFrameRead::Ended)
                })
                .map_err(|error| error.to_string()),
        }
    }
}

#[derive(Debug, Default)]
struct NativeMirrorFrameSlot {
    frame: Mutex<Option<NativeMirrorFrame>>,
    version: AtomicU64,
}

#[derive(Debug, Default)]
struct NativeRenderFrameSlot {
    frame: Mutex<Option<Arc<DecodedRgbFrame>>>,
    version: AtomicU64,
}

impl NativeRenderFrameSlot {
    fn set(&self, frame: DecodedRgbFrame) -> Result<(), String> {
        *self
            .frame
            .lock()
            .map_err(|_| "native render frame lock poisoned".to_string())? = Some(Arc::new(frame));
        self.version.fetch_add(1, Ordering::Release);
        Ok(())
    }

    fn latest(&self) -> Option<(u64, Arc<DecodedRgbFrame>)> {
        let version = self.version.load(Ordering::Acquire);
        let frame = self.frame.lock().ok()?.clone()?;
        Some((version, frame))
    }
}

#[derive(Debug, Clone)]
struct NativeMirrorFrame {
    width: u32,
    height: u32,
    data: Vec<u8>,
    smoothing: bool,
}

#[derive(Debug, Clone)]
struct NativeRenderParams {
    loop_media: bool,
    cols: u32,
    rows: u32,
    auto_rows: bool,
    fps: f64,
    saturation_boost: f64,
    contrast_boost: f64,
    brightness: f64,
    gamma: f64,
    bg_blend: f64,
    quantize_bits: u32,
    jitter_amount: f64,
    jitter_speed: f64,
    sample_x: f64,
    sample_y: f64,
    cell_width: u32,
    cell_height: u32,
    aspect_correction: f64,
    mirror_x: bool,
    pixel: bool,
    solid_mode: bool,
    native_wtf_active: bool,
    audio_reactive_active: bool,
    audio_reactive_source: String,
    audio_reactive_preset: String,
    audio_reactive_sensitivity: f64,
    audio_reactive_beat_amount: f64,
    audio_reactive_bass_amount: f64,
    audio_reactive_mid_amount: f64,
    audio_reactive_treble_amount: f64,
}

#[tauri::command]
pub async fn open_native_output_window(
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    state: State<'_, NativeOutputState>,
    request: NativeOutputWindowRequest,
) -> Result<NativeOutputWindowResult, String> {
    if request.payload.output_mode.as_deref() == Some(NATIVE_CAMERA_SOURCE_KEY) {
        let Some(source) = resolve_native_camera_source(&request.payload) else {
            return Ok(unavailable(
                "native camera output requires one local camera source",
            ));
        };
        let params = NativeRenderParams::from_payload(&request.payload);
        return start_or_update_native_camera_output(&app, &state, source, params, &request).await;
    }

    if request.payload.output_mode.as_deref() == Some(MIRROR_SOURCE_KEY) {
        let params = NativeRenderParams::from_payload(&request.payload);
        return start_or_update_native_mirror_output(&app, &state, params, &request).await;
    }

    let Some(source) = resolve_output_source(&app, &registry, &request.payload)? else {
        return Ok(unavailable("native output requires a static file source"));
    };
    let params = NativeRenderParams::from_payload(&request.payload);
    start_or_update_native_static_output(&app, &state, source, params, &request).await
}

#[tauri::command]
pub async fn update_native_output_window(
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    state: State<'_, NativeOutputState>,
    payload: NativeOutputPayload,
) -> Result<NativeOutputWindowResult, String> {
    if payload.output_mode.as_deref() == Some(NATIVE_CAMERA_SOURCE_KEY) {
        let Some(source) = resolve_native_camera_source(&payload) else {
            state.stop_and_destroy();
            return Ok(unavailable(
                "native camera output source is no longer supported",
            ));
        };
        let params = NativeRenderParams::from_payload(&payload);
        let request = NativeOutputWindowRequest {
            payload,
            display_preference: None,
            visible: Some(false),
        };
        return start_or_update_native_camera_output(&app, &state, source, params, &request).await;
    }

    if payload.output_mode.as_deref() == Some(MIRROR_SOURCE_KEY) {
        let params = NativeRenderParams::from_payload(&payload);
        let request = NativeOutputWindowRequest {
            payload,
            display_preference: None,
            visible: Some(false),
        };
        return start_or_update_native_mirror_output(&app, &state, params, &request).await;
    }

    let Some(source) = resolve_output_source(&app, &registry, &payload)? else {
        state.stop_and_destroy();
        return Ok(unavailable("native output source is no longer supported"));
    };
    let params = NativeRenderParams::from_payload(&payload);
    let request = NativeOutputWindowRequest {
        payload,
        display_preference: None,
        visible: Some(false),
    };
    start_or_update_native_static_output(&app, &state, source, params, &request).await
}

#[tauri::command]
pub async fn update_native_output_frame(
    state: State<'_, NativeOutputState>,
    frame: NativeOutputFrame,
) -> Result<NativeOutputFrameResult, String> {
    state.update_mirror_frame(frame)
}

#[tauri::command]
pub async fn update_native_output_pixels(
    state: State<'_, NativeOutputState>,
    frame: NativeOutputPixels,
) -> Result<NativeOutputFrameResult, String> {
    state.update_mirror_pixels(frame)
}

pub async fn open_native_output_smoke(
    app: AppHandle,
    state: &NativeOutputState,
    media_url: &str,
) -> Result<NativeOutputWindowResult, String> {
    let payload = native_output_smoke_payload(media_url, 0);
    let source = native_output_smoke_source(&app, media_url)?;
    let params = NativeRenderParams::from_payload(&payload);
    let request = NativeOutputWindowRequest {
        payload,
        display_preference: None,
        visible: Some(true),
    };
    start_or_update_native_static_output(&app, state, source, params, &request).await
}

pub async fn update_native_output_smoke_params(
    app: AppHandle,
    state: &NativeOutputState,
    media_url: &str,
    step: u64,
) -> Result<NativeOutputWindowResult, String> {
    let payload = native_output_smoke_payload(media_url, step);
    let source = native_output_smoke_source(&app, media_url)?;
    let params = NativeRenderParams::from_payload(&payload);
    let request = NativeOutputWindowRequest {
        payload,
        display_preference: None,
        visible: Some(false),
    };
    start_or_update_native_static_output(&app, state, source, params, &request).await
}

fn native_output_smoke_source(
    app: &AppHandle,
    media_url: &str,
) -> Result<NativeOutputSource, String> {
    if !is_safe_bundled_media_path(media_url) {
        return Err("native output smoke requires bundled media".to_string());
    }
    let path = resolve_bundled_media_path(app, media_url)
        .ok_or_else(|| format!("bundled media is unavailable: {media_url}"))?;
    Ok(NativeOutputSource {
        path,
        source_key: format!("smoke:{media_url}"),
        media_type: "video".to_string(),
        start_seconds: None,
    })
}

fn native_output_smoke_payload(media_url: &str, step: u64) -> NativeOutputPayload {
    let phase = step as f64 * 0.11;
    NativeOutputPayload {
        output_mode: Some("static".to_string()),
        label: Some("Native Output Smoke".to_string()),
        native_source_id: None,
        params: NativeOutputParams {
            source_mode: Some("static".to_string()),
            media_url: Some(media_url.to_string()),
            media_type: Some("video".to_string()),
            source_name: Some("Native Output Smoke".to_string()),
            loop_: Some(true),
            cols: Some(420.0 + phase.sin() * 120.0),
            rows: Some(0.0),
            auto_rows: Some(true),
            fps: Some(8.0),
            saturation_boost: Some(1.0 + phase.sin().abs() * 2.2),
            contrast_boost: Some(1.0 + (phase * 0.7).cos().abs() * 2.0),
            brightness: Some(0.86 + (phase * 0.37).sin().abs() * 0.42),
            gamma: Some(0.72 + (phase * 0.41).cos().abs() * 1.2),
            bg_blend: Some(0.04 + (phase * 0.31).sin().abs() * 0.46),
            quantize_bits: Some(((step / 24) % 5) as f64),
            jitter_amount: Some((phase * 0.9).sin().abs()),
            jitter_speed: Some(0.8 + (phase * 0.3).cos().abs() * 3.2),
            sample_x: Some(0.2 + (phase * 0.17).sin().abs() * 0.6),
            sample_y: Some(0.2 + (phase * 0.19).cos().abs() * 0.6),
            smoothing: Some(true),
            cell_width: Some(2.0),
            cell_height: Some(3.0),
            aspect_correction: Some(1.0),
            mirror_x: Some(false),
            pixel: Some(false),
            solid_mode: Some(false),
            camera_device_label: None,
            camera_selected_device_labels: None,
            camera_resolution: None,
            camera_capture_width: None,
            camera_capture_height: None,
            camera_fps: None,
            camera_mirror: None,
            native_wtf_active: Some(true),
            audio_reactive_active: Some(false),
            audio_reactive_source: None,
            audio_reactive_preset: None,
            audio_reactive_sensitivity: None,
            audio_reactive_beat_amount: None,
            audio_reactive_bass_amount: None,
            audio_reactive_mid_amount: None,
            audio_reactive_treble_amount: None,
        },
        media_state: Some(NativeOutputMediaState {
            current_time: Some(0.0),
            paused: Some(false),
            ended: Some(false),
        }),
    }
}

fn unavailable(reason: impl Into<String>) -> NativeOutputWindowResult {
    NativeOutputWindowResult {
        opened: false,
        backend: "fallback".to_string(),
        reason: Some(reason.into()),
    }
}

fn native_static_backend() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "native-wgpu-displaylink"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "native-softbuffer"
    }
}

fn native_camera_backend() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "native-wgpu-displaylink-camera"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "native-softbuffer-camera"
    }
}

async fn start_or_update_native_static_output(
    app: &AppHandle,
    state: &NativeOutputState,
    source: NativeOutputSource,
    params: NativeRenderParams,
    request: &NativeOutputWindowRequest,
) -> Result<NativeOutputWindowResult, String> {
    clear_stopped_native_output(state)?;
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native output state lock poisoned".to_string())?;
        if let Some(handle) = inner.handle.as_mut() {
            if handle.source_key == source.source_key {
                *handle
                    .params
                    .lock()
                    .map_err(|_| "native output params lock poisoned".to_string())? =
                    params.clone();
                handle.param_version.fetch_add(1, Ordering::Release);
                show_native_output_window_if_requested(app, handle, request);
                invalidate_native_output_view(&handle.window);
                return Ok(NativeOutputWindowResult {
                    opened: true,
                    backend: native_static_backend().to_string(),
                    reason: None,
                });
            }

            handle.stop.store(true, Ordering::Relaxed);
            inner.handle = None;
        }
    }

    let window = ensure_native_window(app, request)?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let params_arc = Arc::new(Mutex::new(params));
    let param_version = Arc::new(AtomicU64::new(1));

    install_close_watcher(app, state, &window, generation, stop.clone());

    #[cfg(target_os = "macos")]
    let display_link = {
        let frame_slot = Arc::new(NativeRenderFrameSlot::default());
        let display_link = NativeMacDisplayLinkPresenter::start(
            app.clone(),
            window.clone(),
            frame_slot.clone(),
            params_arc.clone(),
            param_version.clone(),
            stop.clone(),
        )?;
        spawn_render_producer_thread(
            app.clone(),
            source.clone(),
            params_arc.clone(),
            stop.clone(),
            frame_slot,
        );
        Some(display_link)
    };

    #[cfg(not(target_os = "macos"))]
    spawn_render_thread(
        app.clone(),
        window.clone(),
        source.clone(),
        params_arc.clone(),
        stop.clone(),
    );

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "native output state lock poisoned".to_string())?;
    inner.handle = Some(NativeOutputHandle {
        generation,
        source_key: source.source_key,
        stop,
        params: params_arc,
        param_version,
        mirror_slot: None,
        #[cfg(target_os = "macos")]
        display_link,
        window,
    });

    Ok(NativeOutputWindowResult {
        opened: true,
        backend: native_static_backend().to_string(),
        reason: None,
    })
}

async fn start_or_update_native_camera_output(
    app: &AppHandle,
    state: &NativeOutputState,
    source: NativeCameraSource,
    params: NativeRenderParams,
    request: &NativeOutputWindowRequest,
) -> Result<NativeOutputWindowResult, String> {
    clear_stopped_native_output(state)?;
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native output state lock poisoned".to_string())?;
        if let Some(handle) = inner.handle.as_mut() {
            if handle.source_key == source.source_key {
                *handle
                    .params
                    .lock()
                    .map_err(|_| "native output params lock poisoned".to_string())? =
                    params.clone();
                handle.param_version.fetch_add(1, Ordering::Release);
                show_native_output_window_if_requested(app, handle, request);
                invalidate_native_output_view(&handle.window);
                return Ok(NativeOutputWindowResult {
                    opened: true,
                    backend: native_camera_backend().to_string(),
                    reason: None,
                });
            }

            handle.stop.store(true, Ordering::Relaxed);
            inner.handle = None;
        }
    }

    let window = ensure_native_window(app, request)?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let params_arc = Arc::new(Mutex::new(params));
    let param_version = Arc::new(AtomicU64::new(1));

    install_close_watcher(app, state, &window, generation, stop.clone());

    #[cfg(target_os = "macos")]
    let display_link = {
        let frame_slot = Arc::new(NativeRenderFrameSlot::default());
        let display_link = NativeMacDisplayLinkPresenter::start(
            app.clone(),
            window.clone(),
            frame_slot.clone(),
            params_arc.clone(),
            param_version.clone(),
            stop.clone(),
        )?;
        spawn_camera_frame_producer_thread(
            app.clone(),
            source.clone(),
            params_arc.clone(),
            stop.clone(),
            frame_slot,
        );
        Some(display_link)
    };

    #[cfg(not(target_os = "macos"))]
    spawn_camera_render_thread(
        app.clone(),
        window.clone(),
        source.clone(),
        params_arc.clone(),
        stop.clone(),
    );

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "native output state lock poisoned".to_string())?;
    inner.handle = Some(NativeOutputHandle {
        generation,
        source_key: source.source_key,
        stop,
        params: params_arc,
        param_version,
        mirror_slot: None,
        #[cfg(target_os = "macos")]
        display_link,
        window,
    });

    Ok(NativeOutputWindowResult {
        opened: true,
        backend: native_camera_backend().to_string(),
        reason: None,
    })
}

async fn start_or_update_native_mirror_output(
    app: &AppHandle,
    state: &NativeOutputState,
    params: NativeRenderParams,
    request: &NativeOutputWindowRequest,
) -> Result<NativeOutputWindowResult, String> {
    clear_stopped_native_output(state)?;
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native output state lock poisoned".to_string())?;
        if let Some(handle) = inner.handle.as_mut() {
            if handle.source_key == MIRROR_SOURCE_KEY {
                *handle
                    .params
                    .lock()
                    .map_err(|_| "native output params lock poisoned".to_string())? =
                    params.clone();
                handle.param_version.fetch_add(1, Ordering::Release);
                show_native_output_window_if_requested(app, handle, request);
                invalidate_native_output_view(&handle.window);
                return Ok(NativeOutputWindowResult {
                    opened: true,
                    backend: "native-softbuffer-mirror".to_string(),
                    reason: None,
                });
            }

            handle.stop.store(true, Ordering::Relaxed);
            inner.handle = None;
        }
    }

    let window = ensure_native_window(app, request)?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let params_arc = Arc::new(Mutex::new(params));
    let param_version = Arc::new(AtomicU64::new(1));
    let mirror_slot = Arc::new(NativeMirrorFrameSlot::default());

    install_close_watcher(app, state, &window, generation, stop.clone());
    spawn_mirror_render_thread(window.clone(), mirror_slot.clone(), stop.clone());

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "native output state lock poisoned".to_string())?;
    inner.handle = Some(NativeOutputHandle {
        generation,
        source_key: MIRROR_SOURCE_KEY.to_string(),
        stop,
        params: params_arc,
        param_version,
        mirror_slot: Some(mirror_slot),
        #[cfg(target_os = "macos")]
        display_link: None,
        window,
    });

    Ok(NativeOutputWindowResult {
        opened: true,
        backend: "native-softbuffer-mirror".to_string(),
        reason: None,
    })
}

impl NativeOutputState {
    fn stop_and_destroy(&self) {
        let handle = self
            .inner
            .lock()
            .ok()
            .and_then(|mut inner| inner.handle.take());
        if let Some(handle) = handle {
            handle.stop.store(true, Ordering::Relaxed);
            let _ = handle.window.destroy();
        }
    }

    fn update_mirror_frame(
        &self,
        frame: NativeOutputFrame,
    ) -> Result<NativeOutputFrameResult, String> {
        let decoded = decode_mirror_frame(frame)?;
        self.set_mirror_frame(decoded)
    }

    fn update_mirror_pixels(
        &self,
        frame: NativeOutputPixels,
    ) -> Result<NativeOutputFrameResult, String> {
        let decoded = decode_mirror_pixels(frame)?;
        self.set_mirror_frame(decoded)
    }

    fn set_mirror_frame(
        &self,
        decoded: NativeMirrorFrame,
    ) -> Result<NativeOutputFrameResult, String> {
        let slot = self
            .inner
            .lock()
            .map_err(|_| "native output state lock poisoned".to_string())?
            .handle
            .as_ref()
            .filter(|handle| handle.source_key == MIRROR_SOURCE_KEY)
            .and_then(|handle| handle.mirror_slot.clone());

        let Some(slot) = slot else {
            return Ok(NativeOutputFrameResult {
                accepted: false,
                reason: Some("native mirror output is not active".to_string()),
            });
        };

        *slot
            .frame
            .lock()
            .map_err(|_| "native mirror frame lock poisoned".to_string())? = Some(decoded);
        slot.version.fetch_add(1, Ordering::Release);
        Ok(NativeOutputFrameResult {
            accepted: true,
            reason: None,
        })
    }
}

fn show_native_output_window_if_requested(
    app: &AppHandle,
    handle: &NativeOutputHandle,
    request: &NativeOutputWindowRequest,
) {
    if !matches!(request.visible, Some(true)) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        configure_native_output_window_level(app, &handle.window);
    }
    if handle.window.show().is_ok() {
        bring_native_output_window_forward(app, &handle.window);
    }
}

fn clear_stopped_native_output(state: &NativeOutputState) -> Result<(), String> {
    let handle = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "native output state lock poisoned".to_string())?;
        let stopped = inner
            .handle
            .as_ref()
            .map(|handle| handle.stop.load(Ordering::Relaxed))
            .unwrap_or(false);
        if stopped {
            inner.handle.take()
        } else {
            None
        }
    };
    if let Some(handle) = handle {
        let _ = handle.window.destroy();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn invalidate_native_output_view(window: &Window) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        let Ok(view) = window.ns_view() else {
            return;
        };
        if view.is_null() {
            return;
        }
        unsafe {
            use objc2::msg_send;
            use objc2::runtime::{AnyObject, Bool};

            let view = view.cast::<AnyObject>();
            let _: () = msg_send![view, setNeedsDisplay: Bool::YES];
            let layer: *mut AnyObject = msg_send![view, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setNeedsDisplay];
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn invalidate_native_output_view(_window: &Window) {}

#[cfg(target_os = "macos")]
type CVDisplayLinkRef = *mut c_void;

#[cfg(target_os = "macos")]
type CVReturn = i32;

#[cfg(target_os = "macos")]
type CVOptionFlags = u64;

#[cfg(target_os = "macos")]
type CVDisplayLinkOutputCallback = Option<
    unsafe extern "C" fn(
        CVDisplayLinkRef,
        *const c_void,
        *const c_void,
        CVOptionFlags,
        *mut CVOptionFlags,
        *mut c_void,
    ) -> CVReturn,
>;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn CVDisplayLinkCreateWithActiveCGDisplays(display_link: *mut CVDisplayLinkRef) -> CVReturn;
    fn CVDisplayLinkSetOutputCallback(
        display_link: CVDisplayLinkRef,
        callback: CVDisplayLinkOutputCallback,
        user_info: *mut c_void,
    ) -> CVReturn;
    fn CVDisplayLinkStart(display_link: CVDisplayLinkRef) -> CVReturn;
    fn CVDisplayLinkStop(display_link: CVDisplayLinkRef) -> CVReturn;
    fn CVDisplayLinkRelease(display_link: CVDisplayLinkRef);
}

#[cfg(target_os = "macos")]
struct NativeMacDisplayLinkContext {
    app: AppHandle,
    window: Window,
    frame_slot: Arc<NativeRenderFrameSlot>,
    params: Arc<Mutex<NativeRenderParams>>,
    param_version: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    pending_tick: AtomicBool,
    frame_index: AtomicU64,
    last_render_at: Mutex<Option<Instant>>,
    gpu_presenter: Mutex<Option<gpu::NativeGpuPresenter>>,
    ticks: AtomicU64,
    pending_skips: AtomicU64,
    no_frame_skips: AtomicU64,
    fps_skips: AtomicU64,
    render_attempts: AtomicU64,
    frames_presented: AtomicU64,
    modulated_frames: AtomicU64,
    no_surface_frames: AtomicU64,
    gpu_failures: AtomicU64,
    main_dispatch_count: AtomicU64,
    main_dispatch_total_ns: AtomicU64,
    last_main_dispatch_ns: AtomicU64,
    render_total_ns: AtomicU64,
    render_max_ns: AtomicU64,
    last_render_ns: AtomicU64,
    gpu_timing: Mutex<NativeGpuTimingStats>,
    last_param_version_seen: AtomicU64,
    last_frame_version_seen: AtomicU64,
    last_present_fps_x1000: AtomicU64,
    last_surface_status: Mutex<&'static str>,
    started_at: Instant,
    last_log_at: Mutex<Instant>,
}

#[cfg(target_os = "macos")]
impl NativeMacDisplayLinkContext {
    fn new(
        app: AppHandle,
        window: Window,
        frame_slot: Arc<NativeRenderFrameSlot>,
        params: Arc<Mutex<NativeRenderParams>>,
        param_version: Arc<AtomicU64>,
        stop: Arc<AtomicBool>,
    ) -> Self {
        let now = Instant::now();
        Self {
            app,
            window,
            frame_slot,
            params,
            param_version,
            stop,
            pending_tick: AtomicBool::new(false),
            frame_index: AtomicU64::new(0),
            last_render_at: Mutex::new(None),
            gpu_presenter: Mutex::new(None),
            ticks: AtomicU64::new(0),
            pending_skips: AtomicU64::new(0),
            no_frame_skips: AtomicU64::new(0),
            fps_skips: AtomicU64::new(0),
            render_attempts: AtomicU64::new(0),
            frames_presented: AtomicU64::new(0),
            modulated_frames: AtomicU64::new(0),
            no_surface_frames: AtomicU64::new(0),
            gpu_failures: AtomicU64::new(0),
            main_dispatch_count: AtomicU64::new(0),
            main_dispatch_total_ns: AtomicU64::new(0),
            last_main_dispatch_ns: AtomicU64::new(0),
            render_total_ns: AtomicU64::new(0),
            render_max_ns: AtomicU64::new(0),
            last_render_ns: AtomicU64::new(0),
            gpu_timing: Mutex::new(NativeGpuTimingStats::default()),
            last_param_version_seen: AtomicU64::new(0),
            last_frame_version_seen: AtomicU64::new(0),
            last_present_fps_x1000: AtomicU64::new(0),
            last_surface_status: Mutex::new("init"),
            started_at: now,
            last_log_at: Mutex::new(now),
        }
    }

    fn request_tick(self: Arc<Self>) {
        self.ticks.fetch_add(1, Ordering::Relaxed);
        if self.stop.load(Ordering::Relaxed) {
            return;
        }
        let current_params = params_snapshot(&self.params);
        let present_fps = native_output_present_fps(&current_params);
        self.last_present_fps_x1000
            .store((present_fps * 1000.0).round() as u64, Ordering::Relaxed);
        if !self.should_render_now(present_fps) {
            self.fps_skips.fetch_add(1, Ordering::Relaxed);
            self.maybe_log_diagnostics();
            return;
        }
        if self.pending_tick.swap(true, Ordering::AcqRel) {
            self.pending_skips.fetch_add(1, Ordering::Relaxed);
            self.maybe_log_diagnostics();
            return;
        }

        if self
            .gpu_presenter
            .lock()
            .map(|presenter| presenter.is_some())
            .unwrap_or(false)
        {
            self.main_dispatch_count.fetch_add(1, Ordering::Relaxed);
            self.last_main_dispatch_ns.store(0, Ordering::Relaxed);
            let render_started_at = Instant::now();
            self.render_tick(current_params);
            let render_ns = duration_ns_u64(render_started_at.elapsed());
            self.render_total_ns.fetch_add(render_ns, Ordering::Relaxed);
            self.render_max_ns.fetch_max(render_ns, Ordering::Relaxed);
            self.last_render_ns.store(render_ns, Ordering::Relaxed);
            self.pending_tick.store(false, Ordering::Release);
            return;
        }

        let window = self.window.clone();
        let context = self.clone();
        let scheduled_at = Instant::now();
        if let Err(error) = window.run_on_main_thread(move || {
            let dispatch_ns = duration_ns_u64(scheduled_at.elapsed());
            context.main_dispatch_count.fetch_add(1, Ordering::Relaxed);
            context
                .main_dispatch_total_ns
                .fetch_add(dispatch_ns, Ordering::Relaxed);
            context
                .last_main_dispatch_ns
                .store(dispatch_ns, Ordering::Relaxed);
            let render_started_at = Instant::now();
            context.render_tick(current_params);
            let render_ns = duration_ns_u64(render_started_at.elapsed());
            context
                .render_total_ns
                .fetch_add(render_ns, Ordering::Relaxed);
            context
                .render_max_ns
                .fetch_max(render_ns, Ordering::Relaxed);
            context.last_render_ns.store(render_ns, Ordering::Relaxed);
            context.pending_tick.store(false, Ordering::Release);
        }) {
            self.pending_tick.store(false, Ordering::Release);
            append_native_output_diagnostic(&format!(
                "[NativeOutputDisplayLinkError] main-thread render dispatch failed: {error}"
            ));
            self.maybe_log_diagnostics();
        }
    }

    fn render_tick(&self, current_params: NativeRenderParams) {
        if self.stop.load(Ordering::Relaxed) {
            return;
        }
        let current_params = self.modulated_params(current_params);

        let Some((frame_version, frame)) = self.frame_slot.latest() else {
            self.no_frame_skips.fetch_add(1, Ordering::Relaxed);
            self.maybe_log_diagnostics();
            return;
        };
        self.last_frame_version_seen
            .store(frame_version, Ordering::Relaxed);
        self.last_param_version_seen.store(
            self.param_version.load(Ordering::Acquire),
            Ordering::Relaxed,
        );

        let mut presenter = match self.gpu_presenter.lock() {
            Ok(presenter) => presenter,
            Err(_) => {
                append_native_output_diagnostic(
                    "[NativeOutputDisplayLinkError] GPU presenter lock poisoned",
                );
                return;
            }
        };
        if presenter.is_none() {
            match gpu::NativeGpuPresenter::new_with_metal_view_on_current_thread(&self.window) {
                Ok(next_presenter) => *presenter = Some(next_presenter),
                Err(error) => {
                    append_native_output_diagnostic(&format!(
                        "[NativeOutputDisplayLinkError] GPU presenter unavailable: {error}"
                    ));
                    let failures = self.gpu_failures.fetch_add(1, Ordering::Relaxed) + 1;
                    if failures >= 8 && native_output_window_handle_unavailable(&error) {
                        self.stop.store(true, Ordering::Relaxed);
                        append_native_output_diagnostic(
                            "[NativeOutputDisplayLinkError] stopping stale native output after repeated unavailable window handles",
                        );
                    }
                    self.maybe_log_diagnostics();
                    return;
                }
            }
        }

        let frame_index = self.frame_index.fetch_add(1, Ordering::Relaxed) as usize;
        self.render_attempts.fetch_add(1, Ordering::Relaxed);
        let result = presenter
            .as_mut()
            .expect("display-link GPU presenter initialized")
            .render_frame_with_outcome(&self.window, &frame, &current_params, frame_index);
        match result {
            Ok(outcome) => {
                self.record_gpu_timing(outcome.timing);
                if let Ok(mut status) = self.last_surface_status.lock() {
                    *status = outcome.surface_status;
                }
                if outcome.presented {
                    self.frames_presented.fetch_add(1, Ordering::Relaxed);
                } else {
                    self.no_surface_frames.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(error) => {
                append_native_output_diagnostic(&format!(
                    "[NativeOutputDisplayLinkError] GPU frame failed, recreating surface: {error}"
                ));
                self.gpu_failures.fetch_add(1, Ordering::Relaxed);
                *presenter = None;
            }
        }
        self.maybe_log_diagnostics();
    }

    fn modulated_params(&self, params: NativeRenderParams) -> NativeRenderParams {
        let audio_features = if params.audio_reactive_active {
            match params.audio_reactive_source.as_str() {
                "display" => self
                    .app
                    .state::<SystemAudioCaptureState>()
                    .features_snapshot()
                    .ok(),
                "input" => self
                    .app
                    .state::<InputAudioCaptureState>()
                    .features_snapshot()
                    .ok(),
                _ => None,
            }
        } else {
            None
        };
        let elapsed = self.started_at.elapsed().as_secs_f64();
        let (modulated, changed) =
            native_modulated_params(params, elapsed, audio_features.as_ref());
        if changed {
            self.modulated_frames.fetch_add(1, Ordering::Relaxed);
        }
        modulated
    }

    fn should_render_now(&self, fps: f64) -> bool {
        let interval = Duration::from_secs_f64(1.0 / fps.max(1.0));
        let tolerance = Duration::from_micros(1_000);
        let now = Instant::now();
        let Ok(mut last_render_at) = self.last_render_at.lock() else {
            return true;
        };
        if let Some(last) = *last_render_at {
            let next_render_at = last + interval;
            if now + tolerance < next_render_at {
                return false;
            }
            *last_render_at = Some(
                if now > next_render_at && now.duration_since(next_render_at) > interval {
                    now
                } else {
                    next_render_at
                },
            );
            return true;
        }
        *last_render_at = Some(now);
        true
    }

    fn maybe_log_diagnostics(&self) {
        let now = Instant::now();
        let Ok(mut last_log_at) = self.last_log_at.lock() else {
            return;
        };
        if now.duration_since(*last_log_at) < Duration::from_secs(2) {
            return;
        }
        *last_log_at = now;

        let surface_status = self
            .last_surface_status
            .lock()
            .map(|status| *status)
            .unwrap_or("unknown");
        let dispatch_count = self.main_dispatch_count.load(Ordering::Relaxed).max(1);
        let avg_dispatch_ms =
            ns_to_ms(self.main_dispatch_total_ns.load(Ordering::Relaxed) / dispatch_count);
        let avg_render_ms = ns_to_ms(self.render_total_ns.load(Ordering::Relaxed) / dispatch_count);
        let gpu_timing = self
            .gpu_timing
            .lock()
            .map(|timing| timing.summary())
            .unwrap_or_default();
        let elapsed_ms = now.duration_since(self.started_at).as_secs_f64() * 1000.0;
        let line = format!(
            "[NativeOutputDisplayLinkStats] elapsedMs={:.3} ticks={} pendingSkips={} noFrame={} fpsSkips={} attempts={} presented={} modulated={} noSurface={} gpuFailures={} surface={} paramVersion={} frameVersion={} presentFps={:.3} dispatchMs={:.3}/{:.3} renderMs={:.3}/{:.3}/{:.3} gpuLastMs=prep:{:.3},acq:{:.3},enc:{:.3},submit:{:.3},present:{:.3},total:{:.3} gpuAvgMs=prep:{:.3},acq:{:.3},enc:{:.3},submit:{:.3},present:{:.3},total:{:.3} gpuMaxMs=prep:{:.3},acq:{:.3},enc:{:.3},submit:{:.3},present:{:.3},total:{:.3}",
            elapsed_ms,
            self.ticks.load(Ordering::Relaxed),
            self.pending_skips.load(Ordering::Relaxed),
            self.no_frame_skips.load(Ordering::Relaxed),
            self.fps_skips.load(Ordering::Relaxed),
            self.render_attempts.load(Ordering::Relaxed),
            self.frames_presented.load(Ordering::Relaxed),
            self.modulated_frames.load(Ordering::Relaxed),
            self.no_surface_frames.load(Ordering::Relaxed),
            self.gpu_failures.load(Ordering::Relaxed),
            surface_status,
            self.last_param_version_seen.load(Ordering::Relaxed),
            self.last_frame_version_seen.load(Ordering::Relaxed),
            self.last_present_fps_x1000.load(Ordering::Relaxed) as f64 / 1000.0,
            ns_to_ms(self.last_main_dispatch_ns.load(Ordering::Relaxed)),
            avg_dispatch_ms,
            ns_to_ms(self.last_render_ns.load(Ordering::Relaxed)),
            avg_render_ms,
            ns_to_ms(self.render_max_ns.load(Ordering::Relaxed)),
            ns_to_ms(gpu_timing.last.prep_ns),
            ns_to_ms(gpu_timing.last.acquire_ns),
            ns_to_ms(gpu_timing.last.encode_ns),
            ns_to_ms(gpu_timing.last.submit_ns),
            ns_to_ms(gpu_timing.last.present_ns),
            ns_to_ms(gpu_timing.last.total_ns),
            ns_to_ms(gpu_timing.avg.prep_ns),
            ns_to_ms(gpu_timing.avg.acquire_ns),
            ns_to_ms(gpu_timing.avg.encode_ns),
            ns_to_ms(gpu_timing.avg.submit_ns),
            ns_to_ms(gpu_timing.avg.present_ns),
            ns_to_ms(gpu_timing.avg.total_ns),
            ns_to_ms(gpu_timing.max.prep_ns),
            ns_to_ms(gpu_timing.max.acquire_ns),
            ns_to_ms(gpu_timing.max.encode_ns),
            ns_to_ms(gpu_timing.max.submit_ns),
            ns_to_ms(gpu_timing.max.present_ns),
            ns_to_ms(gpu_timing.max.total_ns),
        );
        append_native_output_diagnostic(&line);
    }

    fn record_gpu_timing(&self, timing: gpu::NativeGpuFrameTiming) {
        if let Ok(mut stats) = self.gpu_timing.lock() {
            stats.record(timing);
        }
    }
}

#[cfg(target_os = "macos")]
fn native_output_present_fps(params: &NativeRenderParams) -> f64 {
    params.fps.max(60.0).min(120.0)
}

fn native_video_source_fps(probe: &VideoProbe, params: &NativeRenderParams) -> f64 {
    probe
        .fps
        .filter(|fps| fps.is_finite() && *fps > 0.0)
        .unwrap_or(params.fps.max(DEFAULT_NATIVE_SOURCE_FPS))
        .clamp(1.0, MAX_NATIVE_SOURCE_FPS)
}

fn native_modulated_params(
    params: NativeRenderParams,
    elapsed: f64,
    audio_features: Option<&SystemAudioFeatures>,
) -> (NativeRenderParams, bool) {
    let base = params.clone();
    let mut out = params;
    let mut changed = false;

    if out.native_wtf_active {
        apply_native_wtf_modulation(&mut out, elapsed);
        changed = true;
    }

    if out.audio_reactive_active {
        if let Some(features) =
            audio_features.filter(|features| features.available && features.active)
        {
            let audio_base = out.clone();
            apply_native_audio_modulation(&mut out, &audio_base, features, elapsed);
            changed = true;
        }
    }

    if changed {
        clamp_native_visual_safety(&mut out, &base);
    }
    (out, changed)
}

fn apply_native_wtf_modulation(params: &mut NativeRenderParams, elapsed: f64) {
    let base = params.clone();
    let (previous_index, next_index, progress) = native_wtf_transition(elapsed);
    let previous = if previous_index == 0 {
        base.clone()
    } else {
        native_wtf_target(&base, previous_index)
    };
    let next = native_wtf_target(&base, next_index);
    interpolate_native_wtf_params(params, &previous, &next, ease_in_out(progress));

    let slow = smooth_noise(elapsed, 3.2, 1.0);
    let medium = smooth_noise(elapsed, 1.7, 2.0);
    let fast = smooth_noise(elapsed, 0.72, 3.0);
    let pulse = 0.5 + 0.5 * (elapsed * std::f64::consts::TAU * 0.9).sin();
    let snap = smooth_noise(elapsed, 2.35, 4.0);

    params.cols = ((params.cols as f64) * lerp(0.92, 1.08, slow))
        .round()
        .clamp(160.0, 920.0) as u32;
    params.cell_width = ((params.cell_width as f64) * lerp(0.9, 1.14, medium))
        .round()
        .clamp(1.0, 8.0) as u32;
    params.cell_height = ((params.cell_height as f64) * lerp(0.9, 1.16, 1.0 - medium))
        .round()
        .clamp(1.0, 10.0) as u32;
    params.saturation_boost = params.saturation_boost * lerp(0.9, 1.18, fast) + pulse * 0.08;
    params.contrast_boost = params.contrast_boost * lerp(0.88, 1.16, snap) + fast * 0.08;
    params.brightness = params.brightness * lerp(0.94, 1.06, smooth_noise(elapsed, 2.1, 5.0));
    params.gamma = params.gamma * lerp(0.94, 1.08, smooth_noise(elapsed, 2.6, 6.0));
    params.bg_blend += lerp(-0.05, 0.08, medium);
    params.jitter_amount += lerp(0.02, 0.18, fast) * (0.45 + pulse * 0.55);
    params.jitter_speed += lerp(0.08, 0.85, smooth_noise(elapsed, 1.15, 8.0));
    params.sample_x += signed_smooth_noise(elapsed, 1.85, 9.0) * lerp(0.01, 0.05, fast);
    params.sample_y += signed_smooth_noise(elapsed, 2.05, 10.0) * lerp(0.01, 0.05, medium);
}

fn native_wtf_transition(elapsed: f64) -> (u64, u64, f64) {
    let mut cursor = 0.0;
    let mut index = 0_u64;
    let mut elapsed = elapsed.max(0.0);
    for _ in 0..256 {
        let duration = native_wtf_duration(index);
        if elapsed <= cursor + duration {
            let progress = ((elapsed - cursor) / duration).clamp(0.0, 1.0);
            return (index, index + 1, progress);
        }
        cursor += duration;
        index += 1;
    }
    if cursor > 0.0 {
        elapsed %= cursor;
    }
    native_wtf_transition(elapsed)
}

fn native_wtf_duration(index: u64) -> f64 {
    lerp(1.0, 5.0, hash01(index as f64 * 1.37 + 17.0))
}

fn native_wtf_target(base: &NativeRenderParams, index: u64) -> NativeRenderParams {
    let mut target = base.clone();
    target.cols = native_wtf_random_int(index, 1.0, 220, 920);
    target.cell_width = native_wtf_random_int(index, 2.0, 1, 6);
    target.cell_height = native_wtf_random_int(index, 3.0, 2, 9);
    target.saturation_boost = native_wtf_random(index, 4.0, 0.24, 3.0);
    target.contrast_boost = native_wtf_random(index, 5.0, 0.52, 2.85);
    target.brightness = native_wtf_random(index, 6.0, 0.58, 1.62);
    target.gamma = native_wtf_random(index, 7.0, 0.58, 2.55);
    target.bg_blend = native_wtf_random(index, 8.0, 0.0, 0.72);
    target.quantize_bits = native_wtf_random_int(index, 9.0, 0, 5);
    target.jitter_amount = native_wtf_random(index, 10.0, 0.0, 1.0);
    target.jitter_speed = native_wtf_random(index, 11.0, 0.0, 4.0);
    target.sample_x = native_wtf_random(index, 12.0, 0.08, 0.92);
    target.sample_y = native_wtf_random(index, 13.0, 0.08, 0.92);
    target.pixel = false;
    target.solid_mode = false;
    clamp_native_visual_safety(&mut target, base);
    target
}

fn native_wtf_random(index: u64, salt: f64, min: f64, max: f64) -> f64 {
    lerp(min, max, hash01(index as f64 * 19.19 + salt * 101.7))
}

fn native_wtf_random_int(index: u64, salt: f64, min: u32, max: u32) -> u32 {
    native_wtf_random(index, salt, min as f64, max as f64)
        .round()
        .clamp(min as f64, max as f64) as u32
}

fn interpolate_native_wtf_params(
    out: &mut NativeRenderParams,
    from: &NativeRenderParams,
    to: &NativeRenderParams,
    t: f64,
) {
    out.cols = lerp(from.cols as f64, to.cols as f64, t).round().max(1.0) as u32;
    out.cell_width = lerp(from.cell_width as f64, to.cell_width as f64, t)
        .round()
        .max(1.0) as u32;
    out.cell_height = lerp(from.cell_height as f64, to.cell_height as f64, t)
        .round()
        .max(1.0) as u32;
    out.saturation_boost = lerp(from.saturation_boost, to.saturation_boost, t);
    out.contrast_boost = lerp(from.contrast_boost, to.contrast_boost, t);
    out.brightness = lerp(from.brightness, to.brightness, t);
    out.gamma = lerp(from.gamma, to.gamma, t);
    out.bg_blend = lerp(from.bg_blend, to.bg_blend, t);
    out.quantize_bits = lerp(from.quantize_bits as f64, to.quantize_bits as f64, t).round() as u32;
    out.jitter_amount = lerp(from.jitter_amount, to.jitter_amount, t);
    out.jitter_speed = lerp(from.jitter_speed, to.jitter_speed, t);
    out.sample_x = lerp(from.sample_x, to.sample_x, t);
    out.sample_y = lerp(from.sample_y, to.sample_y, t);
}

fn apply_native_audio_modulation(
    params: &mut NativeRenderParams,
    base: &NativeRenderParams,
    features: &SystemAudioFeatures,
    elapsed: f64,
) {
    let routes = native_audio_routes(&params.audio_reactive_preset);
    let sensitivity = params.audio_reactive_sensitivity;
    for &(key, feature, scale) in routes.0 {
        let raw = native_audio_feature(features, feature);
        let amount = raw * sensitivity * native_audio_feature_amount(params, feature);
        add_native_audio_param(params, base, key, amount * scale);
    }

    let sway_amount = sensitivity * routes.1;
    if sway_amount > 0.0 {
        let motion = native_audio_feature(features, "flux")
            .max(native_audio_feature(features, "beatPulse"))
            .max(native_audio_feature(features, "treble") * 0.65);
        let phase = if features.phase.is_finite() {
            f64::from(features.phase)
        } else {
            elapsed * 0.012
        };
        params.sample_x = base.sample_x + phase.sin() * motion * sway_amount;
        params.sample_y = base.sample_y + (phase * 0.73).cos() * motion * sway_amount;
    }
}

fn native_audio_routes(preset: &str) -> (&'static [(&'static str, &'static str, f64)], f64) {
    match preset {
        "bass-tremor" => (
            &[
                ("bgBlend", "bass", 0.32),
                ("brightness", "bass", 0.18),
                ("contrastBoost", "bass", 0.34),
                ("jitterAmount", "bass", 0.38),
                ("jitterSpeed", "beatPulse", 0.55),
                ("gamma", "bass", -0.18),
            ],
            0.035,
        ),
        "snare-shatter" => (
            &[
                ("jitterAmount", "flux", 0.58),
                ("jitterSpeed", "flux", 1.3),
                ("contrastBoost", "beatPulse", 0.26),
                ("brightness", "treble", 0.12),
                ("saturationBoost", "treble", 0.25),
            ],
            0.09,
        ),
        "spectral-bloom" => (
            &[
                ("saturationBoost", "treble", 0.72),
                ("brightness", "mid", 0.18),
                ("contrastBoost", "rms", 0.24),
                ("bgBlend", "rms", -0.12),
                ("gamma", "treble", -0.16),
            ],
            0.045,
        ),
        "chromatic-surge" => (
            &[
                ("saturationBoost", "beatPulse", 0.95),
                ("contrastBoost", "bass", 0.3),
                ("brightness", "beatPulse", 0.18),
                ("gamma", "mid", -0.22),
                ("jitterAmount", "treble", 0.22),
                ("jitterSpeed", "beatPulse", 1.1),
            ],
            0.07,
        ),
        _ => (
            &[
                ("brightness", "beatPulse", 0.24),
                ("contrastBoost", "beatPulse", 0.42),
                ("bgBlend", "bass", 0.16),
                ("jitterAmount", "flux", 0.28),
                ("jitterSpeed", "treble", 0.85),
                ("saturationBoost", "mid", 0.36),
                ("gamma", "beatPulse", -0.12),
            ],
            0.055,
        ),
    }
}

fn native_audio_feature(features: &SystemAudioFeatures, feature: &str) -> f64 {
    let value = match feature {
        "rms" => features.rms,
        "bass" => features.bass,
        "mid" => features.mid,
        "treble" => features.treble,
        "flux" => features.flux,
        "beatPulse" => features.beat_pulse,
        _ => 0.0,
    };
    f64::from(value).clamp(0.0, 1.0)
}

fn native_audio_feature_amount(params: &NativeRenderParams, feature: &str) -> f64 {
    match feature {
        "beatPulse" => params.audio_reactive_beat_amount,
        "bass" => params.audio_reactive_bass_amount,
        "mid" | "rms" | "flux" => params.audio_reactive_mid_amount,
        "treble" => params.audio_reactive_treble_amount,
        _ => 1.0,
    }
}

fn add_native_audio_param(
    params: &mut NativeRenderParams,
    base: &NativeRenderParams,
    key: &str,
    delta: f64,
) {
    match key {
        "saturationBoost" => params.saturation_boost = base.saturation_boost + delta,
        "contrastBoost" => params.contrast_boost = base.contrast_boost + delta,
        "brightness" => params.brightness = base.brightness + delta,
        "gamma" => params.gamma = base.gamma + delta,
        "bgBlend" => params.bg_blend = base.bg_blend + delta,
        "jitterAmount" => params.jitter_amount = base.jitter_amount + delta,
        "jitterSpeed" => params.jitter_speed = base.jitter_speed + delta,
        _ => {}
    }
}

fn clamp_native_visual_safety(params: &mut NativeRenderParams, base: &NativeRenderParams) {
    params.saturation_boost =
        clamp_with_base(params.saturation_boost, base.saturation_boost, 0.0, 3.0);
    params.contrast_boost = clamp_with_base(params.contrast_boost, base.contrast_boost, 0.45, 2.85);
    params.brightness = clamp_with_base(params.brightness, base.brightness, 0.55, 1.85);
    params.gamma = clamp_with_base(params.gamma, base.gamma, 0.55, 2.65);
    params.bg_blend = clamp_with_base(params.bg_blend, base.bg_blend, 0.0, 0.72);
    params.jitter_amount = clamp_with_base(params.jitter_amount, base.jitter_amount, 0.0, 1.0);
    params.jitter_speed = clamp_with_base(params.jitter_speed, base.jitter_speed, 0.0, 4.0);
    params.sample_x = clamp_with_base(params.sample_x, base.sample_x, 0.04, 0.96);
    params.sample_y = clamp_with_base(params.sample_y, base.sample_y, 0.04, 0.96);

    let brightness_floor = base.brightness.clamp(0.72, 1.0);
    if params.bg_blend > 0.62 && params.brightness < brightness_floor {
        params.brightness = brightness_floor;
    }
    if params.gamma < 0.7 && params.brightness < brightness_floor.max(0.82) {
        params.brightness = brightness_floor.max(0.82);
    }
}

fn clamp_with_base(value: f64, base: f64, min: f64, max: f64) -> f64 {
    value.clamp(min.min(base), max.max(base))
}

fn smooth_noise(elapsed: f64, period: f64, seed: f64) -> f64 {
    let x = elapsed / period.max(0.001);
    let i = x.floor();
    let t = x - i;
    let eased = t * t * (3.0 - 2.0 * t);
    lerp(
        hash01(i + seed * 101.7),
        hash01(i + 1.0 + seed * 101.7),
        eased,
    )
}

fn signed_smooth_noise(elapsed: f64, period: f64, seed: f64) -> f64 {
    smooth_noise(elapsed, period, seed) * 2.0 - 1.0
}

fn ease_in_out(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}

fn hash01(value: f64) -> f64 {
    let raw = (value * 12.9898 + 78.233).sin() * 43_758.545_312_3;
    raw - raw.floor()
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

fn native_camera_source_fps(source: &NativeCameraSource) -> f64 {
    source
        .capture_fps
        .max(DEFAULT_NATIVE_SOURCE_FPS)
        .clamp(1.0, MAX_NATIVE_SOURCE_FPS)
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Default)]
struct NativeGpuTimingStats {
    count: u64,
    total: gpu::NativeGpuFrameTiming,
    max: gpu::NativeGpuFrameTiming,
    last: gpu::NativeGpuFrameTiming,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Default)]
struct NativeGpuTimingSummary {
    avg: gpu::NativeGpuFrameTiming,
    max: gpu::NativeGpuFrameTiming,
    last: gpu::NativeGpuFrameTiming,
}

#[cfg(target_os = "macos")]
impl NativeGpuTimingStats {
    fn record(&mut self, timing: gpu::NativeGpuFrameTiming) {
        self.count = self.count.saturating_add(1);
        self.total.prep_ns = self.total.prep_ns.saturating_add(timing.prep_ns);
        self.total.acquire_ns = self.total.acquire_ns.saturating_add(timing.acquire_ns);
        self.total.encode_ns = self.total.encode_ns.saturating_add(timing.encode_ns);
        self.total.submit_ns = self.total.submit_ns.saturating_add(timing.submit_ns);
        self.total.present_ns = self.total.present_ns.saturating_add(timing.present_ns);
        self.total.total_ns = self.total.total_ns.saturating_add(timing.total_ns);
        self.max.prep_ns = self.max.prep_ns.max(timing.prep_ns);
        self.max.acquire_ns = self.max.acquire_ns.max(timing.acquire_ns);
        self.max.encode_ns = self.max.encode_ns.max(timing.encode_ns);
        self.max.submit_ns = self.max.submit_ns.max(timing.submit_ns);
        self.max.present_ns = self.max.present_ns.max(timing.present_ns);
        self.max.total_ns = self.max.total_ns.max(timing.total_ns);
        self.last = timing;
    }

    fn summary(&self) -> NativeGpuTimingSummary {
        let count = self.count.max(1);
        NativeGpuTimingSummary {
            avg: gpu::NativeGpuFrameTiming {
                prep_ns: self.total.prep_ns / count,
                acquire_ns: self.total.acquire_ns / count,
                encode_ns: self.total.encode_ns / count,
                submit_ns: self.total.submit_ns / count,
                present_ns: self.total.present_ns / count,
                total_ns: self.total.total_ns / count,
            },
            max: self.max,
            last: self.last,
        }
    }
}

#[cfg(target_os = "macos")]
fn duration_ns_u64(duration: Duration) -> u64 {
    duration.as_nanos().min(u128::from(u64::MAX)) as u64
}

#[cfg(target_os = "macos")]
fn ns_to_ms(ns: u64) -> f64 {
    ns as f64 / 1_000_000.0
}

#[cfg(target_os = "macos")]
fn native_output_window_handle_unavailable(error: &str) -> bool {
    error.contains("native Metal host window unavailable")
        || error.contains("underlying handle is not available")
        || error.contains("host window is null")
}

#[cfg(target_os = "macos")]
struct NativeMacDisplayLinkPresenter {
    display_link: CVDisplayLinkRef,
    context_raw: *const NativeMacDisplayLinkContext,
    _context: Arc<NativeMacDisplayLinkContext>,
}

#[cfg(target_os = "macos")]
impl std::fmt::Debug for NativeMacDisplayLinkPresenter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NativeMacDisplayLinkPresenter")
            .field("display_link", &self.display_link)
            .finish_non_exhaustive()
    }
}

#[cfg(target_os = "macos")]
unsafe impl Send for NativeMacDisplayLinkPresenter {}

#[cfg(target_os = "macos")]
impl NativeMacDisplayLinkPresenter {
    fn start(
        app: AppHandle,
        window: Window,
        frame_slot: Arc<NativeRenderFrameSlot>,
        params: Arc<Mutex<NativeRenderParams>>,
        param_version: Arc<AtomicU64>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let context = Arc::new(NativeMacDisplayLinkContext::new(
            app,
            window,
            frame_slot,
            params,
            param_version,
            stop,
        ));
        let context_raw = Arc::into_raw(context.clone());
        let mut display_link = std::ptr::null_mut();
        let create_status = unsafe { CVDisplayLinkCreateWithActiveCGDisplays(&mut display_link) };
        if create_status != 0 || display_link.is_null() {
            unsafe {
                drop(Arc::from_raw(context_raw));
            }
            return Err(format!(
                "native macOS display link unavailable: CVDisplayLinkCreateWithActiveCGDisplays returned {create_status}"
            ));
        }

        let callback_status = unsafe {
            CVDisplayLinkSetOutputCallback(
                display_link,
                Some(native_display_link_callback),
                context_raw as *mut c_void,
            )
        };
        if callback_status != 0 {
            unsafe {
                CVDisplayLinkRelease(display_link);
                drop(Arc::from_raw(context_raw));
            }
            return Err(format!(
                "native macOS display link callback failed: CVDisplayLinkSetOutputCallback returned {callback_status}"
            ));
        }

        let start_status = unsafe { CVDisplayLinkStart(display_link) };
        if start_status != 0 {
            unsafe {
                CVDisplayLinkRelease(display_link);
                drop(Arc::from_raw(context_raw));
            }
            return Err(format!(
                "native macOS display link start failed: CVDisplayLinkStart returned {start_status}"
            ));
        }

        Ok(Self {
            display_link,
            context_raw,
            _context: context,
        })
    }
}

#[cfg(target_os = "macos")]
impl Drop for NativeMacDisplayLinkPresenter {
    fn drop(&mut self) {
        self._context.stop.store(true, Ordering::Relaxed);
        unsafe {
            if !self.display_link.is_null() {
                let _ = CVDisplayLinkStop(self.display_link);
                CVDisplayLinkRelease(self.display_link);
            }
            drop(Arc::from_raw(self.context_raw));
        }
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn native_display_link_callback(
    _display_link: CVDisplayLinkRef,
    _in_now: *const c_void,
    _in_output_time: *const c_void,
    _flags_in: CVOptionFlags,
    _flags_out: *mut CVOptionFlags,
    context: *mut c_void,
) -> CVReturn {
    if context.is_null() {
        return 0;
    }

    let context = unsafe { Arc::from_raw(context as *const NativeMacDisplayLinkContext) };
    let tick_context = context.clone();
    std::mem::forget(context);
    tick_context.request_tick();
    0
}

#[cfg(target_os = "macos")]
fn append_native_output_diagnostic(line: &str) {
    eprintln!("{line}");
    let path = std::env::temp_dir().join("asciline-native-output.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn install_close_watcher(
    app: &AppHandle,
    state: &NativeOutputState,
    window: &Window,
    generation: u64,
    stop: Arc<AtomicBool>,
) {
    let app = app.clone();
    let state_inner = state.inner.clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            return;
        }
        stop.store(true, Ordering::Relaxed);
        if let Ok(mut inner) = state_inner.lock() {
            let should_clear = inner
                .handle
                .as_ref()
                .map(|handle| handle.generation == generation)
                .unwrap_or(false);
            if should_clear {
                inner.handle = None;
            }
        }
        let _ = app.emit_to("main", NATIVE_OUTPUT_CLOSED_EVENT, ());
    });
}

fn ensure_native_window(
    app: &AppHandle,
    request: &NativeOutputWindowRequest,
) -> Result<Window, String> {
    if let Some(window) = app.get_window(NATIVE_OUTPUT_LABEL) {
        place_native_window(&window, app, request.display_preference.as_deref())?;
        if request.visible.unwrap_or(true) {
            #[cfg(target_os = "macos")]
            {
                configure_native_output_window_level(app, &window);
            }
            window.show().map_err(|error| error.to_string())?;
            #[cfg(target_os = "macos")]
            bring_native_output_window_forward(app, &window);
        }
        return Ok(window);
    }

    let placement = native_window_placement(app, request.display_preference.as_deref());
    let mut builder = WindowBuilder::new(app, NATIVE_OUTPUT_LABEL)
        .title("ASCII VJ Remix Output")
        .inner_size(
            placement
                .as_ref()
                .map(|placement| placement.logical_width)
                .unwrap_or(DEFAULT_OUTPUT_WIDTH as f64),
            placement
                .as_ref()
                .map(|placement| placement.logical_height)
                .unwrap_or(DEFAULT_OUTPUT_HEIGHT as f64),
        )
        .min_inner_size(320.0, 240.0)
        .decorations(true)
        .resizable(true)
        .visible(request.visible.unwrap_or(true));

    #[cfg(target_os = "macos")]
    {
        builder = builder.focused(false);
    }

    if let Some(placement) = placement.as_ref() {
        builder = builder.position(placement.logical_x, placement.logical_y);
    } else {
        builder = builder.center();
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    if request.visible.unwrap_or(true) {
        #[cfg(target_os = "macos")]
        {
            configure_native_output_window_level(app, &window);
        }
        window.show().map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        bring_native_output_window_forward(app, &window);
    }
    Ok(window)
}

#[cfg(target_os = "macos")]
fn configure_native_output_window_level(app: &AppHandle, window: &Window) {
    let _ = app;
    let _ = window.set_focusable(true);
    let _ = window.set_always_on_top(false);
}

#[cfg(target_os = "macos")]
fn bring_native_output_window_forward(app: &AppHandle, window: &Window) {
    let _ = window.set_focus();
    if let Some(main_window) = app.get_window("main") {
        let _ = main_window.set_focus();
    }
}

fn place_native_window(
    window: &Window,
    app: &AppHandle,
    preference: Option<&str>,
) -> Result<(), String> {
    let Some(placement) = native_window_placement(app, preference) else {
        return Ok(());
    };
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            placement.physical_x,
            placement.physical_y,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Physical(PhysicalSize::new(
            placement.physical_width,
            placement.physical_height,
        )))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Clone)]
struct NativeWindowPlacement {
    physical_x: i32,
    physical_y: i32,
    physical_width: u32,
    physical_height: u32,
    logical_x: f64,
    logical_y: f64,
    logical_width: f64,
    logical_height: f64,
}

fn native_window_placement(
    app: &AppHandle,
    preference: Option<&str>,
) -> Option<NativeWindowPlacement> {
    let monitors = app.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let index = display_preference_index(preference)
        .filter(|index| *index < monitors.len())
        .unwrap_or_else(|| if monitors.len() > 1 { 1 } else { 0 });
    let monitor = &monitors[index];
    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor().max(0.01);
    Some(NativeWindowPlacement {
        physical_x: work_area.position.x,
        physical_y: work_area.position.y,
        physical_width: work_area.size.width.max(1),
        physical_height: work_area.size.height.max(1),
        logical_x: work_area.position.x as f64 / scale_factor,
        logical_y: work_area.position.y as f64 / scale_factor,
        logical_width: work_area.size.width as f64 / scale_factor,
        logical_height: work_area.size.height as f64 / scale_factor,
    })
}

fn display_preference_index(preference: Option<&str>) -> Option<usize> {
    let preference = preference?;
    let rest = preference.strip_prefix("display:")?;
    let index = rest.split(':').next()?.parse::<usize>().ok()?;
    Some(index)
}

fn resolve_output_source(
    app: &AppHandle,
    registry: &MediaRegistry,
    payload: &NativeOutputPayload,
) -> Result<Option<NativeOutputSource>, String> {
    if payload.output_mode.as_deref() != Some("static") {
        return Ok(None);
    }
    if payload.params.source_mode.as_deref() != Some("static") {
        return Ok(None);
    }
    if payload.params.media_type.as_deref() == Some("camera") {
        return Ok(None);
    }

    let media_url = payload
        .params
        .media_url
        .as_deref()
        .unwrap_or_default()
        .trim();
    if media_url.is_empty() || media_url.starts_with("blob:") || media_url.starts_with("camera:") {
        return Ok(None);
    }

    let (path, source_key) = if let Some(source_id) = payload.native_source_id.as_deref() {
        let path = registry.path_for(source_id)?;
        (path, format!("registered:{source_id}"))
    } else if is_safe_bundled_media_path(media_url) {
        let path = resolve_bundled_media_path(app, media_url)
            .ok_or_else(|| format!("bundled media is unavailable: {media_url}"))?;
        (path, format!("bundled:{media_url}"))
    } else {
        return Ok(None);
    };

    let media_type = payload
        .params
        .media_type
        .clone()
        .unwrap_or_else(|| media_type_for_path(&path).to_string());
    let start_seconds = payload.media_state.as_ref().and_then(|state| {
        if state.paused.unwrap_or(false) || state.ended.unwrap_or(false) {
            return None;
        }
        state
            .current_time
            .filter(|value| value.is_finite() && *value > 0.0)
    });

    Ok(Some(NativeOutputSource {
        path,
        source_key,
        media_type,
        start_seconds,
    }))
}

fn resolve_native_camera_source(payload: &NativeOutputPayload) -> Option<NativeCameraSource> {
    if payload.output_mode.as_deref() != Some(NATIVE_CAMERA_SOURCE_KEY) {
        return None;
    }
    if payload.params.source_mode.as_deref() != Some("static") {
        return None;
    }
    if payload.params.media_type.as_deref() != Some("camera") {
        return None;
    }

    let labels = payload
        .params
        .camera_selected_device_labels
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    if labels.len() > 1 {
        return None;
    }

    let device_label = labels
        .first()
        .cloned()
        .or_else(|| payload.params.camera_device_label.clone())
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty() && label != "Selected camera" && label != "Camera 1");

    let capture_fps = f64_param(payload.params.camera_fps, 30.0).clamp(1.0, 60.0);
    let requested = parse_camera_resolution(payload.params.camera_resolution.as_deref());
    let capture_width = requested
        .map(|(width, _)| width)
        .or_else(|| u32_param_option(payload.params.camera_capture_width));
    let capture_height = requested
        .map(|(_, height)| height)
        .or_else(|| u32_param_option(payload.params.camera_capture_height));
    let (output_width, output_height) = camera_output_dimensions(capture_width, capture_height);
    let source_key = format!(
        "native-camera:{}:{}x{}:{:.3}",
        device_label.as_deref().unwrap_or("0"),
        output_width,
        output_height,
        capture_fps
    );

    Some(NativeCameraSource {
        source_key,
        device_label,
        capture_width,
        capture_height,
        output_width,
        output_height,
        capture_fps,
    })
}

fn parse_camera_resolution(value: Option<&str>) -> Option<(u32, u32)> {
    let value = value?;
    let (width, height) = value.split_once('x')?;
    let width = width.parse::<u32>().ok()?.max(1);
    let height = height.parse::<u32>().ok()?.max(1);
    Some((width, height))
}

fn camera_output_dimensions(width: Option<u32>, height: Option<u32>) -> (u32, u32) {
    let width = width.unwrap_or(1280).max(1);
    let height = height.unwrap_or(720).max(1);
    let max_dimension = width.max(height);
    if max_dimension <= MAX_SAMPLE_DIMENSION {
        return (width, height);
    }
    let scale = MAX_SAMPLE_DIMENSION as f64 / max_dimension as f64;
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn is_safe_bundled_media_path(media_url: &str) -> bool {
    let path = Path::new(media_url);
    if path.is_absolute() {
        return false;
    }
    let mut components = path.components();
    if components.next() != Some(Component::Normal(OsStr::new("media"))) {
        return false;
    }
    components.all(|component| matches!(component, Component::Normal(_)))
}

fn resolve_bundled_media_path(app: &AppHandle, media_url: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(media_url));
        candidates.push(resource_dir.join("resources").join(media_url));
        candidates.push(resource_dir.join("_up_").join(media_url));
        candidates.push(resource_dir.join("_up_").join("dist").join(media_url));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(media_url));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(media_url));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn media_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" | "png" | "gif" | "svg" => "image",
        _ => "video",
    }
}

impl NativeRenderParams {
    fn from_payload(payload: &NativeOutputPayload) -> Self {
        let params = &payload.params;
        let is_camera = payload.output_mode.as_deref() == Some(NATIVE_CAMERA_SOURCE_KEY)
            || params.media_type.as_deref() == Some("camera");
        Self {
            loop_media: params.loop_.unwrap_or(true),
            cols: u32_param(params.cols, 480).clamp(1, 4096),
            rows: u32_param(params.rows, 0).min(4096),
            auto_rows: params.auto_rows.unwrap_or(true),
            fps: f64_param(params.fps, 24.0).clamp(1.0, 120.0),
            saturation_boost: f64_param(params.saturation_boost, 1.4).clamp(0.0, 8.0),
            contrast_boost: f64_param(params.contrast_boost, 1.0).clamp(0.0, 8.0),
            brightness: f64_param(params.brightness, 1.0).clamp(0.0, 8.0),
            gamma: f64_param(params.gamma, 1.0).clamp(0.01, 8.0),
            bg_blend: f64_param(params.bg_blend, 0.0).clamp(0.0, 1.0),
            quantize_bits: u32_param(params.quantize_bits, 0).min(8),
            jitter_amount: f64_param(params.jitter_amount, 0.0).clamp(0.0, 8.0),
            jitter_speed: f64_param(params.jitter_speed, 1.0).clamp(0.0, 16.0),
            sample_x: f64_param(params.sample_x, 0.5).clamp(0.0, 1.0),
            sample_y: f64_param(params.sample_y, 0.5).clamp(0.0, 1.0),
            cell_width: u32_param(params.cell_width, 2).clamp(1, 128),
            cell_height: u32_param(params.cell_height, 3).clamp(1, 128),
            aspect_correction: f64_param(params.aspect_correction, 1.0).clamp(0.1, 8.0),
            mirror_x: params
                .mirror_x
                .or(if is_camera {
                    params.camera_mirror
                } else {
                    None
                })
                .unwrap_or(false),
            pixel: params.pixel.unwrap_or(false),
            solid_mode: params.solid_mode.unwrap_or(false),
            native_wtf_active: params.native_wtf_active.unwrap_or(false),
            audio_reactive_active: params.audio_reactive_active.unwrap_or(false),
            audio_reactive_source: params.audio_reactive_source.clone().unwrap_or_default(),
            audio_reactive_preset: params
                .audio_reactive_preset
                .clone()
                .unwrap_or_else(|| "pulse-reactor".to_string()),
            audio_reactive_sensitivity: f64_param(params.audio_reactive_sensitivity, 7.5)
                .clamp(0.0, 8.0),
            audio_reactive_beat_amount: f64_param(params.audio_reactive_beat_amount, 1.68)
                .clamp(0.0, 2.0),
            audio_reactive_bass_amount: f64_param(params.audio_reactive_bass_amount, 1.25)
                .clamp(0.0, 2.0),
            audio_reactive_mid_amount: f64_param(params.audio_reactive_mid_amount, 1.14)
                .clamp(0.0, 2.0),
            audio_reactive_treble_amount: f64_param(params.audio_reactive_treble_amount, 1.16)
                .clamp(0.0, 2.0),
        }
    }
}

fn f64_param(value: Option<f64>, fallback: f64) -> f64 {
    value.filter(|value| value.is_finite()).unwrap_or(fallback)
}

fn u32_param(value: Option<f64>, fallback: u32) -> u32 {
    f64_param(value, fallback as f64).round().max(0.0) as u32
}

fn u32_param_option(value: Option<f64>) -> Option<u32> {
    value
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.round() as u32)
}

#[cfg(target_os = "macos")]
fn spawn_render_producer_thread(
    app: AppHandle,
    source: NativeOutputSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
    frame_slot: Arc<NativeRenderFrameSlot>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_render_producer_loop(app, source, params, stop.clone(), frame_slot)
        {
            eprintln!("[NativeOutputProducer] {error}");
            stop.store(true, Ordering::Relaxed);
        }
    });
}

#[cfg(target_os = "macos")]
fn run_render_producer_loop(
    app: AppHandle,
    source: NativeOutputSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
    frame_slot: Arc<NativeRenderFrameSlot>,
) -> Result<(), String> {
    let binaries = media_binaries_for_app(&app);
    let static_image = if source.media_type == "image" {
        Some(decode_static_image_frame(&source.path)?)
    } else {
        None
    };
    let (sample_width, sample_height) = if let Some(frame) = static_image.as_ref() {
        (frame.width, frame.height)
    } else {
        let probe = probe_video(&binaries, &source.path).map_err(|error| error.to_string())?;
        sample_dimensions(&probe)
    };
    let source_fps = if source.media_type == "image" {
        DEFAULT_NATIVE_SOURCE_FPS
    } else {
        let probe = probe_video(&binaries, &source.path).map_err(|error| error.to_string())?;
        native_video_source_fps(&probe, &params_snapshot(&params))
    };
    let mut reader = if source.media_type == "image" {
        None
    } else {
        Some(open_native_reader(
            &binaries,
            &source,
            sample_width,
            sample_height,
            source_fps,
        )?)
    };

    if let Some(frame) = static_image {
        frame_slot.set(frame)?;
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
        }
        return Ok(());
    }

    let mut next_frame_at = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        let current_params = params_snapshot(&params);
        let interval = Duration::from_secs_f64(1.0 / source_fps.max(1.0));
        let now = Instant::now();
        if now < next_frame_at {
            std::thread::sleep((next_frame_at - now).min(Duration::from_millis(4)));
            continue;
        }
        next_frame_at = now + interval;

        let Some(active_reader) = reader.as_mut() else {
            std::thread::sleep(Duration::from_millis(30));
            continue;
        };
        match active_reader
            .read_next_frame()
            .map_err(|error| error.to_string())?
        {
            Some(frame) => frame_slot.set(frame)?,
            None if current_params.loop_media => {
                let mut next_reader = open_native_reader(
                    &binaries,
                    &NativeOutputSource {
                        start_seconds: None,
                        ..source.clone()
                    },
                    sample_width,
                    sample_height,
                    source_fps,
                )?;
                if let Some(frame) = next_reader
                    .read_next_frame()
                    .map_err(|error| error.to_string())?
                {
                    frame_slot.set(frame)?;
                }
                *active_reader = next_reader;
            }
            None => {}
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn spawn_render_thread(
    app: AppHandle,
    window: Window,
    source: NativeOutputSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_render_loop(app, window, source, params, stop.clone()) {
            eprintln!("[NativeOutput] {error}");
            stop.store(true, Ordering::Relaxed);
        }
    });
}

struct NativeSoftbufferPresenter {
    _context: softbuffer::Context<Window>,
    surface: softbuffer::Surface<Window, Window>,
    last_size: (u32, u32),
}

impl NativeSoftbufferPresenter {
    fn new(window: &Window) -> Result<Self, String> {
        let (context, surface) = create_softbuffer_surface(window)?;
        Ok(Self {
            _context: context,
            surface,
            last_size: (0, 0),
        })
    }

    fn render_frame(
        &mut self,
        window: &Window,
        frame: &DecodedRgbFrame,
        params: &NativeRenderParams,
        frame_index: usize,
    ) -> Result<(), String> {
        let size = window
            .inner_size()
            .unwrap_or_else(|_| PhysicalSize::new(DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT));
        let width = size.width.max(1);
        let height = size.height.max(1);
        if self.last_size != (width, height) {
            self.surface
                .resize(nonzero(width), nonzero(height))
                .map_err(|error| error.to_string())?;
            self.last_size = (width, height);
        }

        let mut buffer = self
            .surface
            .buffer_mut()
            .map_err(|error| error.to_string())?;
        render_native_frame_to_buffer(frame, params, &mut buffer, width, height, frame_index);
        buffer.present().map_err(|error| error.to_string())
    }
}

fn run_render_loop(
    app: AppHandle,
    window: Window,
    source: NativeOutputSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let binaries = media_binaries_for_app(&app);
    let static_image = if source.media_type == "image" {
        Some(decode_static_image_frame(&source.path)?)
    } else {
        None
    };
    let (sample_width, sample_height) = if let Some(frame) = static_image.as_ref() {
        (frame.width, frame.height)
    } else {
        let probe = probe_video(&binaries, &source.path).map_err(|error| error.to_string())?;
        sample_dimensions(&probe)
    };
    let source_fps = if source.media_type == "image" {
        DEFAULT_NATIVE_SOURCE_FPS
    } else {
        let probe = probe_video(&binaries, &source.path).map_err(|error| error.to_string())?;
        native_video_source_fps(&probe, &params_snapshot(&params))
    };
    let mut reader = if source.media_type == "image" {
        None
    } else {
        Some(open_native_reader(
            &binaries,
            &source,
            sample_width,
            sample_height,
            source_fps,
        )?)
    };

    let mut gpu_presenter = match gpu::NativeGpuPresenter::new(&window) {
        Ok(presenter) => Some(presenter),
        Err(error) => {
            eprintln!("[NativeOutputGpu] unavailable, using softbuffer: {error}");
            None
        }
    };
    let mut softbuffer_presenter = None;
    let mut last_frame = static_image;
    let mut frame_index = 0usize;
    let mut next_frame_at = Instant::now();

    while !stop.load(Ordering::Relaxed) {
        let current_params = params_snapshot(&params);
        let interval = Duration::from_secs_f64(1.0 / source_fps.max(1.0));
        let now = Instant::now();
        if now < next_frame_at {
            std::thread::sleep((next_frame_at - now).min(Duration::from_millis(8)));
            continue;
        }
        next_frame_at = now + interval;

        if let Some(reader) = reader.as_mut() {
            match reader
                .read_next_frame()
                .map_err(|error| error.to_string())?
            {
                Some(frame) => last_frame = Some(frame),
                None if current_params.loop_media => {
                    let mut next_reader = open_native_reader(
                        &binaries,
                        &NativeOutputSource {
                            start_seconds: None,
                            ..source.clone()
                        },
                        sample_width,
                        sample_height,
                        source_fps,
                    )?;
                    last_frame = next_reader
                        .read_next_frame()
                        .map_err(|error| error.to_string())?;
                    *reader = next_reader;
                }
                None => {}
            }
        }

        let Some(frame) = last_frame.as_ref() else {
            std::thread::sleep(Duration::from_millis(30));
            continue;
        };

        if let Some(presenter) = gpu_presenter.as_mut() {
            match presenter.render_frame(&window, frame, &current_params, frame_index) {
                Ok(()) => {
                    invalidate_native_output_view(&window);
                    frame_index = frame_index.wrapping_add(1);
                    continue;
                }
                Err(error) => {
                    eprintln!(
                        "[NativeOutputGpu] frame failed, falling back to softbuffer: {error}"
                    );
                    gpu_presenter = None;
                }
            }
        }

        if softbuffer_presenter.is_none() {
            softbuffer_presenter = Some(NativeSoftbufferPresenter::new(&window)?);
        }
        softbuffer_presenter
            .as_mut()
            .expect("softbuffer presenter initialized")
            .render_frame(&window, frame, &current_params, frame_index)?;
        invalidate_native_output_view(&window);
        frame_index = frame_index.wrapping_add(1);
    }

    Ok(())
}

fn decode_static_image_frame(path: &Path) -> Result<DecodedRgbFrame, String> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("svg"))
        .unwrap_or(false)
    {
        return decode_svg_frame(path);
    }

    let mut rgb = image::open(path)
        .map_err(|error| format!("native output image decode failed: {error}"))?
        .to_rgb8();
    let (mut width, mut height) = rgb.dimensions();
    if width == 0 || height == 0 {
        return Err("native output image has empty dimensions".to_string());
    }

    let (target_width, target_height) = static_image_output_dimensions(width, height);
    if (target_width, target_height) != (width, height) {
        rgb = image::imageops::resize(
            &rgb,
            target_width,
            target_height,
            image::imageops::FilterType::Triangle,
        );
        width = target_width;
        height = target_height;
    }

    Ok(DecodedRgbFrame {
        index: 0,
        width,
        height,
        data: rgb.into_raw(),
    })
}

fn decode_svg_frame(path: &Path) -> Result<DecodedRgbFrame, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("native output SVG read failed: {error}"))?;
    let mut options = resvg::usvg::Options {
        resources_dir: path
            .canonicalize()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf)),
        ..resvg::usvg::Options::default()
    };
    options.fontdb_mut().load_system_fonts();

    let tree = resvg::usvg::Tree::from_data(&bytes, &options)
        .map_err(|error| format!("native output SVG parse failed: {error}"))?;
    let source_size = tree.size().to_int_size();
    let source_width = source_size.width();
    let source_height = source_size.height();
    if source_width == 0 || source_height == 0 {
        return Err("native output SVG has empty dimensions".to_string());
    }

    let (width, height) = static_image_output_dimensions(source_width, source_height);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "native output SVG pixmap allocation failed".to_string())?;
    let transform = resvg::tiny_skia::Transform::from_scale(
        width as f32 / source_width as f32,
        height as f32 / source_height as f32,
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    Ok(DecodedRgbFrame {
        index: 0,
        width,
        height,
        data: premultiplied_rgba_to_rgb(pixmap.data()),
    })
}

fn static_image_output_dimensions(width: u32, height: u32) -> (u32, u32) {
    let max_dimension = width.max(height);
    if max_dimension <= MAX_SAMPLE_DIMENSION {
        return (width, height);
    }
    let scale = MAX_SAMPLE_DIMENSION as f64 / max_dimension as f64;
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn premultiplied_rgba_to_rgb(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.chunks_exact(4) {
        let alpha = u32::from(pixel[3]);
        let inv_alpha = 255 - alpha;
        rgb.push((u32::from(pixel[0]) + (3 * inv_alpha / 255)).min(255) as u8);
        rgb.push((u32::from(pixel[1]) + (4 * inv_alpha / 255)).min(255) as u8);
        rgb.push((u32::from(pixel[2]) + (5 * inv_alpha / 255)).min(255) as u8);
    }
    rgb
}

#[cfg(target_os = "macos")]
fn spawn_camera_frame_producer_thread(
    app: AppHandle,
    source: NativeCameraSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
    frame_slot: Arc<NativeRenderFrameSlot>,
) {
    std::thread::spawn(move || {
        if let Err(error) =
            run_camera_frame_producer_loop(app, source, params, stop.clone(), frame_slot)
        {
            eprintln!("[NativeOutputCameraProducer] {error}");
            stop.store(true, Ordering::Relaxed);
        }
    });
}

#[cfg(target_os = "macos")]
fn run_camera_frame_producer_loop(
    app: AppHandle,
    source: NativeCameraSource,
    _params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
    frame_slot: Arc<NativeRenderFrameSlot>,
) -> Result<(), String> {
    let binaries = media_binaries_for_app(&app);
    let source_fps = native_camera_source_fps(&source);
    let mut reader = open_camera_frame_reader(&binaries, &source, source_fps)?;
    let mut next_frame_at = Instant::now();

    while !stop.load(Ordering::Relaxed) {
        let interval = Duration::from_secs_f64(1.0 / source_fps.max(1.0));
        let now = Instant::now();
        if now < next_frame_at {
            std::thread::sleep((next_frame_at - now).min(Duration::from_millis(4)));
            continue;
        }
        next_frame_at = now + interval;

        match reader.read_frame()? {
            CameraFrameRead::Frame(frame) => frame_slot.set(frame)?,
            CameraFrameRead::Pending => {}
            CameraFrameRead::Ended => {
                reader = open_camera_frame_reader(&binaries, &source, source_fps)?;
            }
        };
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn spawn_camera_render_thread(
    app: AppHandle,
    window: Window,
    source: NativeCameraSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_camera_render_loop(app, window, source, params, stop.clone()) {
            eprintln!("[NativeOutputCamera] {error}");
            stop.store(true, Ordering::Relaxed);
        }
    });
}

fn run_camera_render_loop(
    app: AppHandle,
    window: Window,
    source: NativeCameraSource,
    params: Arc<Mutex<NativeRenderParams>>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let binaries = media_binaries_for_app(&app);
    let source_fps = native_camera_source_fps(&source);
    let mut reader = open_camera_frame_reader(&binaries, &source, source_fps)?;
    let mut gpu_presenter = match gpu::NativeGpuPresenter::new(&window) {
        Ok(presenter) => Some(presenter),
        Err(error) => {
            eprintln!("[NativeOutputCameraGpu] unavailable, using softbuffer: {error}");
            None
        }
    };
    let mut softbuffer_presenter = None;
    let mut last_frame = None;
    let mut frame_index = 0usize;
    let mut next_frame_at = Instant::now();

    while !stop.load(Ordering::Relaxed) {
        let current_params = params_snapshot(&params);
        let interval = Duration::from_secs_f64(1.0 / source_fps.max(1.0));
        let now = Instant::now();
        if now < next_frame_at {
            std::thread::sleep((next_frame_at - now).min(Duration::from_millis(8)));
            continue;
        }
        next_frame_at = now + interval;

        match reader.read_frame()? {
            CameraFrameRead::Frame(frame) => last_frame = Some(frame),
            CameraFrameRead::Pending => {}
            CameraFrameRead::Ended => {
                reader = open_camera_frame_reader(&binaries, &source, source_fps)?;
            }
        };
        let Some(frame) = last_frame.as_ref() else {
            std::thread::sleep(Duration::from_millis(16));
            continue;
        };

        if let Some(presenter) = gpu_presenter.as_mut() {
            match presenter.render_frame(&window, frame, &current_params, frame_index) {
                Ok(()) => {
                    invalidate_native_output_view(&window);
                    frame_index = frame_index.wrapping_add(1);
                    continue;
                }
                Err(error) => {
                    eprintln!(
                        "[NativeOutputCameraGpu] frame failed, falling back to softbuffer: {error}"
                    );
                    gpu_presenter = None;
                }
            }
        }

        if softbuffer_presenter.is_none() {
            softbuffer_presenter = Some(NativeSoftbufferPresenter::new(&window)?);
        }
        softbuffer_presenter
            .as_mut()
            .expect("softbuffer presenter initialized")
            .render_frame(&window, frame, &current_params, frame_index)?;
        invalidate_native_output_view(&window);
        frame_index = frame_index.wrapping_add(1);
    }

    Ok(())
}

fn spawn_mirror_render_thread(
    window: Window,
    slot: Arc<NativeMirrorFrameSlot>,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_mirror_render_loop(window, slot, stop.clone()) {
            eprintln!("[NativeOutputMirror] {error}");
            stop.store(true, Ordering::Relaxed);
        }
    });
}

fn run_mirror_render_loop(
    window: Window,
    slot: Arc<NativeMirrorFrameSlot>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let (context, mut surface) = create_softbuffer_surface(&window)?;
    let _context = context;
    let mut last_size = (0u32, 0u32);
    let mut last_version = 0u64;
    let mut last_frame: Option<NativeMirrorFrame> = None;

    while !stop.load(Ordering::Relaxed) {
        let size = window
            .inner_size()
            .unwrap_or_else(|_| PhysicalSize::new(DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT));
        let width = size.width.max(1);
        let height = size.height.max(1);
        let size_changed = last_size != (width, height);
        let version = slot.version.load(Ordering::Acquire);

        if version == last_version && !size_changed {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        }

        if version != last_version {
            last_frame = slot
                .frame
                .lock()
                .map_err(|_| "native mirror frame lock poisoned".to_string())?
                .clone();
            last_version = version;
        }

        if size_changed {
            surface
                .resize(nonzero(width), nonzero(height))
                .map_err(|error| error.to_string())?;
            last_size = (width, height);
        }

        let mut buffer = surface.buffer_mut().map_err(|error| error.to_string())?;
        if let Some(frame) = last_frame.as_ref() {
            render_native_mirror_frame_to_buffer(frame, &mut buffer, width, height);
        } else {
            buffer.fill(rgb_u32(3, 4, 5));
        }
        buffer.present().map_err(|error| error.to_string())?;
        invalidate_native_output_view(&window);
    }

    Ok(())
}

fn decode_mirror_frame(frame: NativeOutputFrame) -> Result<NativeMirrorFrame, String> {
    if frame.data_url.len() > MAX_MIRROR_DATA_URL_BYTES {
        return Err("native mirror frame is too large".to_string());
    }

    let (header, encoded) = frame
        .data_url
        .split_once(',')
        .ok_or_else(|| "native mirror frame must be a data URL".to_string())?;
    if !header.starts_with("data:image/") || !header.contains(";base64") {
        return Err("native mirror frame must be a base64 image data URL".to_string());
    }

    let bytes = general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("native mirror frame base64 decode failed: {error}"))?;
    let mut rgb = image::load_from_memory(&bytes)
        .map_err(|error| format!("native mirror frame image decode failed: {error}"))?
        .to_rgb8();
    let (mut width, mut height) = rgb.dimensions();
    if width == 0 || height == 0 {
        return Err("native mirror frame has empty dimensions".to_string());
    }

    let max_dimension_scale = MAX_MIRROR_DIMENSION as f64 / width.max(height) as f64;
    let max_pixel_scale =
        (MAX_MIRROR_PIXELS as f64 / (u64::from(width) * u64::from(height)) as f64).sqrt();
    let scale = max_dimension_scale.min(max_pixel_scale).min(1.0);
    if scale < 1.0 {
        width = ((width as f64 * scale).round() as u32).max(1);
        height = ((height as f64 * scale).round() as u32).max(1);
        rgb = image::imageops::resize(&rgb, width, height, image::imageops::FilterType::Triangle);
    }

    Ok(NativeMirrorFrame {
        width,
        height,
        data: rgb.into_raw(),
        smoothing: frame.smoothing.unwrap_or(true),
    })
}

fn decode_mirror_pixels(frame: NativeOutputPixels) -> Result<NativeMirrorFrame, String> {
    validate_mirror_dimensions(frame.width, frame.height)?;
    let expected_bytes = (frame.width as usize)
        .saturating_mul(frame.height as usize)
        .saturating_mul(4);
    if frame.rgba.len() < expected_bytes {
        return Err(format!(
            "native mirror pixel frame is short: expected {expected_bytes} bytes, got {}",
            frame.rgba.len()
        ));
    }

    let mut data = Vec::with_capacity((frame.width as usize) * (frame.height as usize) * 3);
    for px in frame.rgba[..expected_bytes].chunks_exact(4) {
        let alpha = px[3] as f64 / 255.0;
        if alpha >= 0.999 {
            data.extend_from_slice(&px[..3]);
        } else {
            data.push((px[0] as f64 * alpha + 3.0 * (1.0 - alpha)).round() as u8);
            data.push((px[1] as f64 * alpha + 4.0 * (1.0 - alpha)).round() as u8);
            data.push((px[2] as f64 * alpha + 5.0 * (1.0 - alpha)).round() as u8);
        }
    }

    Ok(NativeMirrorFrame {
        width: frame.width,
        height: frame.height,
        data,
        smoothing: frame.smoothing.unwrap_or(true),
    })
}

fn validate_mirror_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("native mirror frame has empty dimensions".to_string());
    }
    if width.max(height) > MAX_MIRROR_DIMENSION {
        return Err(format!(
            "native mirror frame exceeds max dimension {MAX_MIRROR_DIMENSION}: {width}x{height}"
        ));
    }
    if width.saturating_mul(height) > MAX_MIRROR_PIXELS {
        return Err(format!(
            "native mirror frame exceeds max pixel count {MAX_MIRROR_PIXELS}: {width}x{height}"
        ));
    }
    Ok(())
}

fn render_native_mirror_frame_to_buffer(
    frame: &NativeMirrorFrame,
    buffer: &mut [u32],
    width: u32,
    height: u32,
) {
    let width_usize = width as usize;
    let height_usize = height as usize;
    if buffer.len() < width_usize.saturating_mul(height_usize) {
        return;
    }
    buffer.fill(rgb_u32(3, 4, 5));

    let scale =
        (width as f64 / frame.width.max(1) as f64).max(height as f64 / frame.height.max(1) as f64);
    let draw_width = (frame.width as f64 * scale).ceil().max(1.0);
    let draw_height = (frame.height as f64 * scale).ceil().max(1.0);
    let offset_x = (width as f64 - draw_width) * 0.5;
    let offset_y = (height as f64 - draw_height) * 0.5;

    for y in 0..height_usize {
        let src_y = ((y as f64 - offset_y) / scale).clamp(0.0, (frame.height - 1) as f64);
        let dst_row = y * width_usize;
        for x in 0..width_usize {
            let src_x = ((x as f64 - offset_x) / scale).clamp(0.0, (frame.width - 1) as f64);
            buffer[dst_row + x] = if frame.smoothing {
                sample_rgb_linear(frame, src_x, src_y)
            } else {
                sample_rgb_nearest(frame, src_x, src_y)
            };
        }
    }
}

fn sample_rgb_nearest(frame: &NativeMirrorFrame, x: f64, y: f64) -> u32 {
    let sx = x.round().clamp(0.0, (frame.width - 1) as f64) as u32;
    let sy = y.round().clamp(0.0, (frame.height - 1) as f64) as u32;
    let index = ((sy as usize * frame.width as usize + sx as usize) * 3)
        .min(frame.data.len().saturating_sub(3));
    rgb_u32(
        frame.data[index],
        frame.data[index + 1],
        frame.data[index + 2],
    )
}

fn sample_rgb_linear(frame: &NativeMirrorFrame, x: f64, y: f64) -> u32 {
    let x0 = x.floor().clamp(0.0, (frame.width - 1) as f64) as u32;
    let y0 = y.floor().clamp(0.0, (frame.height - 1) as f64) as u32;
    let x1 = (x0 + 1).min(frame.width - 1);
    let y1 = (y0 + 1).min(frame.height - 1);
    let tx = x - x0 as f64;
    let ty = y - y0 as f64;
    let c00 = rgb_at(frame, x0, y0);
    let c10 = rgb_at(frame, x1, y0);
    let c01 = rgb_at(frame, x0, y1);
    let c11 = rgb_at(frame, x1, y1);
    let r = bilerp(c00.0, c10.0, c01.0, c11.0, tx, ty);
    let g = bilerp(c00.1, c10.1, c01.1, c11.1, tx, ty);
    let b = bilerp(c00.2, c10.2, c01.2, c11.2, tx, ty);
    rgb_u32(r, g, b)
}

fn rgb_at(frame: &NativeMirrorFrame, x: u32, y: u32) -> (u8, u8, u8) {
    let index = ((y as usize * frame.width as usize + x as usize) * 3)
        .min(frame.data.len().saturating_sub(3));
    (
        frame.data[index],
        frame.data[index + 1],
        frame.data[index + 2],
    )
}

fn bilerp(c00: u8, c10: u8, c01: u8, c11: u8, tx: f64, ty: f64) -> u8 {
    let c00 = c00 as f64;
    let c10 = c10 as f64;
    let c01 = c01 as f64;
    let c11 = c11 as f64;
    let top = c00 + (c10 - c00) * tx;
    let bottom = c01 + (c11 - c01) * tx;
    (top + (bottom - top) * ty).round().clamp(0.0, 255.0) as u8
}

fn create_softbuffer_surface(
    window: &Window,
) -> Result<
    (
        softbuffer::Context<Window>,
        softbuffer::Surface<Window, Window>,
    ),
    String,
> {
    let (tx, rx) = mpsc::sync_channel(1);
    let window_for_main = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let context = softbuffer::Context::new(window_for_main.clone())
                    .map_err(|error| error.to_string())?;
                let surface = softbuffer::Surface::new(&context, window_for_main)
                    .map_err(|error| error.to_string())?;
                Ok((context, surface))
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|error| format!("native output surface init timed out: {error}"))?
}

fn open_native_reader(
    binaries: &FfmpegBinaries,
    source: &NativeOutputSource,
    width: u32,
    height: u32,
    fps: f64,
) -> Result<FfmpegRgbFrameReader, String> {
    let decode =
        DecodeConfig::new(width, height, MAX_READER_FRAMES).map_err(|error| error.to_string())?;
    let options = RgbReaderOptions {
        start_seconds: source.start_seconds,
        output_fps: Some(fps),
    };
    spawn_rgb_reader_with_options(binaries, &source.path, &decode, &options)
        .map_err(|error| error.to_string())
}

fn open_camera_frame_reader(
    binaries: &FfmpegBinaries,
    source: &NativeCameraSource,
    output_fps: f64,
) -> Result<CameraFrameReader, String> {
    match native_camera::NativeCameraFrameReader::start(source) {
        Ok(reader) => {
            eprintln!("[NativeOutputCamera] using native platform camera capture");
            return Ok(CameraFrameReader::Native(reader));
        }
        Err(error) => {
            eprintln!("[NativeOutputCamera] native capture unavailable, using FFmpeg: {error}");
        }
    }

    let decode = DecodeConfig::new(source.output_width, source.output_height, MAX_READER_FRAMES)
        .map_err(|error| error.to_string())?;
    let options = CameraReaderOptions {
        device_label: source.device_label.clone(),
        capture_width: source.capture_width,
        capture_height: source.capture_height,
        capture_fps: Some(source.capture_fps),
        output_fps: None,
    };
    spawn_macos_camera_rgb_reader(binaries, &decode, &options)
        .map(CameraFrameReader::Ffmpeg)
        .map_err(|error| {
            format!(
                "Native camera capture and FFmpeg camera fallback both failed; requested output fps {output_fps:.3}: {error}"
            )
        })
}

fn params_snapshot(params: &Arc<Mutex<NativeRenderParams>>) -> NativeRenderParams {
    params
        .lock()
        .map(|params| params.clone())
        .unwrap_or_else(|_| {
            NativeRenderParams::from_payload(&NativeOutputPayload {
                output_mode: Some("static".to_string()),
                label: None,
                native_source_id: None,
                params: NativeOutputParams {
                    source_mode: Some("static".to_string()),
                    media_url: None,
                    media_type: None,
                    source_name: None,
                    loop_: Some(true),
                    cols: Some(480.0),
                    rows: Some(0.0),
                    auto_rows: Some(true),
                    fps: Some(24.0),
                    saturation_boost: Some(1.4),
                    contrast_boost: Some(1.2),
                    brightness: Some(1.0),
                    gamma: Some(1.0),
                    bg_blend: Some(0.3),
                    quantize_bits: Some(0.0),
                    jitter_amount: Some(0.6),
                    jitter_speed: Some(1.0),
                    sample_x: Some(0.5),
                    sample_y: Some(0.5),
                    smoothing: Some(true),
                    cell_width: Some(2.0),
                    cell_height: Some(3.0),
                    aspect_correction: Some(1.0),
                    mirror_x: Some(false),
                    pixel: Some(false),
                    solid_mode: Some(false),
                    camera_device_label: None,
                    camera_selected_device_labels: None,
                    camera_resolution: None,
                    camera_capture_width: None,
                    camera_capture_height: None,
                    camera_fps: None,
                    camera_mirror: None,
                    native_wtf_active: Some(false),
                    audio_reactive_active: Some(false),
                    audio_reactive_source: None,
                    audio_reactive_preset: None,
                    audio_reactive_sensitivity: None,
                    audio_reactive_beat_amount: None,
                    audio_reactive_bass_amount: None,
                    audio_reactive_mid_amount: None,
                    audio_reactive_treble_amount: None,
                },
                media_state: None,
            })
        })
}

fn nonzero(value: u32) -> NonZeroU32 {
    NonZeroU32::new(value.max(1)).unwrap()
}

fn sample_dimensions(probe: &VideoProbe) -> (u32, u32) {
    let width = probe.width.max(1);
    let height = probe.height.max(1);
    let max_dimension = width.max(height);
    if max_dimension <= MAX_SAMPLE_DIMENSION {
        return (width, height);
    }
    let scale = MAX_SAMPLE_DIMENSION as f64 / max_dimension as f64;
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn render_native_frame_to_buffer(
    frame: &DecodedRgbFrame,
    params: &NativeRenderParams,
    buffer: &mut [u32],
    width: u32,
    height: u32,
    frame_index: usize,
) {
    let width_usize = width as usize;
    let height_usize = height as usize;
    if buffer.len() < width_usize.saturating_mul(height_usize) {
        return;
    }
    buffer.fill(rgb_u32(3, 4, 5));

    let (cols, rows) = native_grid_dimensions(params, frame.width, frame.height);
    let cell_width = params.cell_width.max(1);
    let cell_height = params.cell_height.max(1);
    let render_width = cols.saturating_mul(cell_width).max(1);
    let render_height = rows.saturating_mul(cell_height).max(1);
    let scale = (width as f64 / render_width as f64).max(height as f64 / render_height as f64);
    let draw_width = (render_width as f64 * scale).ceil().max(1.0);
    let draw_height = (render_height as f64 * scale).ceil().max(1.0);
    let offset_x = (width as f64 - draw_width) * 0.5;
    let offset_y = (height as f64 - draw_height) * 0.5;

    let cell_colors = native_cell_colors(frame, params, cols, rows, frame_index);
    if cell_colors.is_empty() {
        return;
    }

    let x_spans = native_axis_spans(cols, cell_width, scale, offset_x, width_usize);
    let y_spans = native_axis_spans(rows, cell_height, scale, offset_y, height_usize);
    if x_spans.is_empty() || y_spans.is_empty() {
        return;
    }

    if !native_axis_spans_cover(&x_spans, width_usize)
        || !native_axis_spans_cover(&y_spans, height_usize)
    {
        buffer.fill(rgb_u32(3, 4, 5));
    }

    let cols_usize = cols as usize;
    for span_y in y_spans {
        let src_row = span_y.index * cols_usize;
        for y in span_y.start..span_y.end {
            let dst_row = y * width_usize;
            let dst = &mut buffer[dst_row..dst_row + width_usize];
            for span_x in &x_spans {
                dst[span_x.start..span_x.end].fill(cell_colors[src_row + span_x.index]);
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NativeAxisSpan {
    index: usize,
    start: usize,
    end: usize,
}

fn native_axis_spans(
    cells: u32,
    cell_size: u32,
    scale: f64,
    offset: f64,
    limit: usize,
) -> Vec<NativeAxisSpan> {
    if cells == 0 || cell_size == 0 || !scale.is_finite() || scale <= 0.0 || limit == 0 {
        return Vec::new();
    }

    let limit_f = limit as f64;
    let mut spans = Vec::with_capacity(cells as usize);
    for index in 0..cells {
        let start_f = offset + (index.saturating_mul(cell_size)) as f64 * scale;
        let end_f = offset + ((index + 1).saturating_mul(cell_size)) as f64 * scale;
        let start = start_f.floor().clamp(0.0, limit_f) as usize;
        let end = end_f.ceil().clamp(0.0, limit_f) as usize;
        if end > start {
            spans.push(NativeAxisSpan {
                index: index as usize,
                start,
                end,
            });
        }
    }
    spans
}

fn native_axis_spans_cover(spans: &[NativeAxisSpan], limit: usize) -> bool {
    if limit == 0 {
        return true;
    }
    let Some(first) = spans.first() else {
        return false;
    };
    let mut covered_until = first.end;
    if first.start > 0 {
        return false;
    }
    for span in spans.iter().skip(1) {
        if span.start > covered_until {
            return false;
        }
        covered_until = covered_until.max(span.end);
        if covered_until >= limit {
            return true;
        }
    }
    covered_until >= limit
}

fn native_grid_dimensions(
    params: &NativeRenderParams,
    source_width: u32,
    source_height: u32,
) -> (u32, u32) {
    let mut cols = params.cols.max(1);
    let mut rows = if !params.auto_rows && params.rows > 0 {
        params.rows
    } else {
        let ratio = source_width as f64 / source_height.max(1) as f64;
        let mut rows = cols as f64 / ratio * params.aspect_correction;
        if !params.pixel && !params.solid_mode {
            rows *= params.cell_width as f64 / params.cell_height as f64;
        }
        rows.round().max(1.0) as u32
    };

    let cells = cols as f64 * rows as f64;
    if cells > MAX_NATIVE_CELLS {
        let scale = (MAX_NATIVE_CELLS / cells).sqrt();
        cols = ((cols as f64 * scale).round() as u32).max(1);
        rows = ((rows as f64 * scale).round() as u32).max(1);
    }

    (cols, rows)
}

fn native_cell_colors(
    frame: &DecodedRgbFrame,
    params: &NativeRenderParams,
    cols: u32,
    rows: u32,
    frame_index: usize,
) -> Vec<u32> {
    let width = frame.width.max(1);
    let height = frame.height.max(1);
    let source_cell_width = width as f64 / cols as f64;
    let source_cell_height = height as f64 / rows as f64;
    let time = frame_index as f64 / params.fps.max(1.0);
    let mut out = Vec::with_capacity(cols as usize * rows as usize);

    for row in 0..rows {
        for col in 0..cols {
            let seed_x = col as f64 + time * params.jitter_speed * 7.13;
            let seed_y = row as f64 + time * params.jitter_speed * 11.71;
            let jitter_x =
                (shader_hash(seed_x, seed_y) - 0.5) * source_cell_width * params.jitter_amount;
            let jitter_y = (shader_hash(seed_x + 37.0, seed_y + 91.0) - 0.5)
                * source_cell_height
                * params.jitter_amount;
            let mut sample_x = ((col as f64 + params.sample_x) * width as f64 / cols as f64
                + jitter_x)
                .trunc()
                .clamp(0.0, (width - 1) as f64) as u32;
            if params.mirror_x {
                sample_x = width - 1 - sample_x;
            }
            let sample_y = ((row as f64 + params.sample_y) * height as f64 / rows as f64 + jitter_y)
                .trunc()
                .clamp(0.0, (height - 1) as f64) as u32;
            let index = ((sample_y as usize * width as usize + sample_x as usize) * 3)
                .min(frame.data.len().saturating_sub(3));
            let (r, g, b) = process_gpu_cell_color(
                frame.data[index],
                frame.data[index + 1],
                frame.data[index + 2],
                params,
            );
            out.push(rgb_u32(r, g, b));
        }
    }

    out
}

fn process_gpu_cell_color(r: u8, g: u8, b: u8, params: &NativeRenderParams) -> (u8, u8, u8) {
    let mut rr = r as f64 / 255.0;
    let mut gg = g as f64 / 255.0;
    let mut bb = b as f64 / 255.0;
    let avg = (rr + gg + bb) / 3.0;
    rr = clamp01(avg + (rr - avg) * params.saturation_boost);
    gg = clamp01(avg + (gg - avg) * params.saturation_boost);
    bb = clamp01(avg + (bb - avg) * params.saturation_boost);
    rr = clamp01((rr - 0.5) * params.contrast_boost + 0.5);
    gg = clamp01((gg - 0.5) * params.contrast_boost + 0.5);
    bb = clamp01((bb - 0.5) * params.contrast_boost + 0.5);
    let gamma = params.gamma.max(0.01);
    rr = clamp01((rr * params.brightness).powf(1.0 / gamma));
    gg = clamp01((gg * params.brightness).powf(1.0 / gamma));
    bb = clamp01((bb * params.brightness).powf(1.0 / gamma));

    if params.quantize_bits > 0 {
        let quantum = 2.0_f64.powi(params.quantize_bits as i32);
        rr = (rr * 255.0 / quantum).floor() * quantum / 255.0;
        gg = (gg * 255.0 / quantum).floor() * quantum / 255.0;
        bb = (bb * 255.0 / quantum).floor() * quantum / 255.0;
    }

    let bg_blend = params.bg_blend.clamp(0.0, 1.0);
    rr = rr * (1.0 - bg_blend) + (3.0 / 255.0) * bg_blend;
    gg = gg * (1.0 - bg_blend) + (4.0 / 255.0) * bg_blend;
    bb = bb * (1.0 - bg_blend) + (5.0 / 255.0) * bg_blend;

    (
        (clamp01(rr) * 255.0).round() as u8,
        (clamp01(gg) * 255.0).round() as u8,
        (clamp01(bb) * 255.0).round() as u8,
    )
}

fn rgb_u32(r: u8, g: u8, b: u8) -> u32 {
    (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn shader_hash(x: f64, y: f64) -> f64 {
    let mut p3x = fract(x * 0.1031);
    let mut p3y = fract(y * 0.1031);
    let mut p3z = fract(x * 0.1031);
    let dot = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += dot;
    p3y += dot;
    p3z += dot;
    fract((p3x + p3y) * p3z)
}

fn fract(value: f64) -> f64 {
    value - value.floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_payload() -> NativeOutputPayload {
        NativeOutputPayload {
            output_mode: Some("static".to_string()),
            label: Some("Test".to_string()),
            native_source_id: None,
            params: NativeOutputParams {
                source_mode: Some("static".to_string()),
                media_url: Some("media/test.mp4".to_string()),
                media_type: Some("video".to_string()),
                source_name: Some("Test".to_string()),
                loop_: Some(true),
                cols: Some(2.0),
                rows: Some(0.0),
                auto_rows: Some(true),
                fps: Some(24.0),
                saturation_boost: Some(1.0),
                contrast_boost: Some(1.0),
                brightness: Some(1.0),
                gamma: Some(1.0),
                bg_blend: Some(0.0),
                quantize_bits: Some(0.0),
                jitter_amount: Some(0.0),
                jitter_speed: Some(1.0),
                sample_x: Some(0.5),
                sample_y: Some(0.5),
                smoothing: Some(true),
                cell_width: Some(2.0),
                cell_height: Some(2.0),
                aspect_correction: Some(1.0),
                mirror_x: Some(false),
                pixel: Some(false),
                solid_mode: Some(false),
                camera_device_label: None,
                camera_selected_device_labels: None,
                camera_resolution: None,
                camera_capture_width: None,
                camera_capture_height: None,
                camera_fps: None,
                camera_mirror: None,
                native_wtf_active: Some(false),
                audio_reactive_active: Some(false),
                audio_reactive_source: None,
                audio_reactive_preset: None,
                audio_reactive_sensitivity: None,
                audio_reactive_beat_amount: None,
                audio_reactive_bass_amount: None,
                audio_reactive_mid_amount: None,
                audio_reactive_treble_amount: None,
            },
            media_state: None,
        }
    }

    fn params() -> NativeRenderParams {
        NativeRenderParams::from_payload(&base_payload())
    }

    #[test]
    fn static_output_ignores_camera_mirror_fallback() {
        let mut payload = base_payload();
        payload.params.mirror_x = None;
        payload.params.camera_mirror = Some(true);

        let params = NativeRenderParams::from_payload(&payload);

        assert!(!params.mirror_x);
    }

    #[test]
    fn camera_output_uses_camera_mirror_fallback() {
        let mut payload = base_payload();
        payload.output_mode = Some(NATIVE_CAMERA_SOURCE_KEY.to_string());
        payload.params.media_type = Some("camera".to_string());
        payload.params.mirror_x = None;
        payload.params.camera_mirror = Some(true);

        let params = NativeRenderParams::from_payload(&payload);

        assert!(params.mirror_x);
    }

    #[test]
    fn native_video_source_fps_uses_media_rate_over_visual_rate() {
        let mut params = params();
        params.fps = 8.0;
        let probe = VideoProbe {
            path: PathBuf::from("demo.mp4"),
            width: 1920,
            height: 1080,
            fps: Some(24.0),
            duration_seconds: Some(30.0),
            codec_name: Some("h264".to_string()),
            pixel_format: Some("yuv420p".to_string()),
        };

        assert_eq!(native_video_source_fps(&probe, &params), 24.0);
    }

    #[test]
    fn native_video_source_fps_falls_back_to_smooth_default() {
        let mut params = params();
        params.fps = 8.0;
        let probe = VideoProbe {
            path: PathBuf::from("unknown-rate.mp4"),
            width: 1920,
            height: 1080,
            fps: None,
            duration_seconds: None,
            codec_name: None,
            pixel_format: None,
        };

        assert_eq!(
            native_video_source_fps(&probe, &params),
            DEFAULT_NATIVE_SOURCE_FPS
        );
    }

    #[test]
    fn native_camera_source_fps_keeps_camera_polling_fresh() {
        let source = NativeCameraSource {
            source_key: NATIVE_CAMERA_SOURCE_KEY.to_string(),
            device_label: None,
            capture_width: Some(1280),
            capture_height: Some(720),
            output_width: 1280,
            output_height: 720,
            capture_fps: 30.0,
        };

        assert_eq!(native_camera_source_fps(&source), 30.0);
    }

    #[test]
    fn bundled_media_paths_reject_traversal() {
        assert!(is_safe_bundled_media_path("media/demo-video-2.mp4"));
        assert!(!is_safe_bundled_media_path("../media/demo-video-2.mp4"));
        assert!(!is_safe_bundled_media_path("media/../secret.mp4"));
        assert!(!is_safe_bundled_media_path("/tmp/demo.mp4"));
    }

    #[test]
    fn static_svg_image_decodes_to_rgb_frame() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .join("media/demo.svg");
        let frame = decode_static_image_frame(&path).expect("demo SVG should decode");

        assert_eq!(frame.width, 1280);
        assert_eq!(frame.height, 720);
        assert_eq!(frame.data.len(), 1280 * 720 * 3);
        assert!(frame.data.iter().any(|value| *value > 16));
    }

    #[test]
    fn color_processing_matches_shader_defaults() {
        let params = params();
        assert_eq!(process_gpu_cell_color(0, 128, 255, &params), (0, 128, 255));
    }

    #[test]
    fn color_processing_quantizes_and_blends_background() {
        let mut params = params();
        params.quantize_bits = 2;
        params.bg_blend = 0.5;
        assert_eq!(process_gpu_cell_color(255, 129, 3, &params), (128, 66, 3));
    }

    #[test]
    fn native_render_expands_cells_to_output_buffer() {
        let mut params = params();
        params.auto_rows = false;
        params.rows = 1;
        params.cell_width = 2;
        params.cell_height = 2;
        let frame = DecodedRgbFrame {
            index: 0,
            width: 2,
            height: 1,
            data: vec![255, 0, 0, 0, 0, 255],
        };
        let mut buffer = vec![0; 16];
        render_native_frame_to_buffer(&frame, &params, &mut buffer, 4, 4, 0);

        assert_eq!(buffer[0], rgb_u32(255, 0, 0));
        assert_eq!(buffer[1], rgb_u32(255, 0, 0));
        assert_eq!(buffer[2], rgb_u32(0, 0, 255));
        assert_eq!(buffer[3], rgb_u32(0, 0, 255));
    }

    #[test]
    fn native_axis_spans_cover_cropped_output() {
        let spans = native_axis_spans(2, 2, 2.0, -2.0, 4);

        assert_eq!(
            spans,
            vec![
                NativeAxisSpan {
                    index: 0,
                    start: 0,
                    end: 2
                },
                NativeAxisSpan {
                    index: 1,
                    start: 2,
                    end: 4
                }
            ]
        );
        assert!(native_axis_spans_cover(&spans, 4));
    }

    #[test]
    fn mirror_pixels_decode_rgba_to_rgb_and_blend_alpha() {
        let frame = decode_mirror_pixels(NativeOutputPixels {
            seq: 1,
            width: 2,
            height: 1,
            rgba: vec![255, 0, 0, 255, 0, 255, 0, 128],
            smoothing: Some(false),
            label: Some("pixels".to_string()),
        })
        .expect("raw mirror pixels should decode");

        assert_eq!(frame.width, 2);
        assert_eq!(frame.height, 1);
        assert_eq!(&frame.data[..3], &[255, 0, 0]);
        assert_eq!(&frame.data[3..6], &[1, 130, 2]);
        assert!(!frame.smoothing);
    }
}
