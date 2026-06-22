use crate::media_engine::ffmpeg::{
    probe_video, spawn_rgb_reader, spawn_rgb_reader_with_options, DecodeConfig, FfmpegBinaries,
    FfmpegRgbFrameReader, RgbReaderOptions, VideoProbe,
};
use crate::media_engine::frame_prep::RenderMode;
use crate::media_engine::pipeline::{
    checksum_hex, run_stream_pipeline, EncodedStreamFrame, StreamPipelineConfig,
    StreamPipelineReader, StreamPipelineSummary,
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MEDIA_EXTENSIONS: &[&str] = &["mp4", "webm", "mkv", "jpg", "jpeg", "png", "gif", "svg"];
const MAX_PREVIEW_FRAMES: usize = 240;
const MAX_SESSION_FRAMES: usize = 100_000;
const MAX_SESSION_FRAME_BATCH: usize = 12;
const MAX_PREVIEW_CELLS: u64 = 1_000_000;
const MAX_RAW_VIDEO_FRAMES: usize = 1_000_000;
const MAX_RAW_VIDEO_FRAME_BATCH: usize = 4;
const MAX_RAW_VIDEO_PIXELS: u64 = 1_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMediaFile {
    pub id: String,
    pub provider: String,
    pub path: PathBuf,
    pub name: String,
    pub size: Option<u64>,
    pub last_modified: Option<u128>,
    pub media_type: String,
    #[serde(rename = "type")]
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelinePreviewRequest {
    pub width: u32,
    pub height: u32,
    pub max_frames: usize,
    pub mode: u8,
    pub pixel: bool,
    pub codec_tolerance: Option<u8>,
    pub verify_decode: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaSessionInit {
    pub session_id: String,
    pub source_id: String,
    pub fps: f64,
    pub mode: u8,
    pub pixel: bool,
    pub cols: u32,
    pub rows: u32,
    pub cell_bytes: usize,
    pub probe: VideoProbe,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaFrame {
    pub session_id: String,
    pub index: usize,
    pub time_seconds: f64,
    pub raw_bytes: usize,
    pub adaptive_bytes: usize,
    pub tag: u8,
    pub prepared_checksum: String,
    pub message_checksum: String,
    pub message: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaFrameBatch {
    pub session_id: String,
    pub frames: Vec<NativeMediaFrame>,
    pub ended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaSessionStatus {
    pub session_id: String,
    pub source_id: String,
    pub fps: f64,
    pub mode: u8,
    pub pixel: bool,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawVideoSessionRequest {
    pub width: u32,
    pub height: u32,
    pub max_frames: usize,
    pub fps: Option<f64>,
    pub start_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawVideoSessionInit {
    pub session_id: String,
    pub source_id: String,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub probe: VideoProbe,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawVideoFrame {
    pub session_id: String,
    pub index: usize,
    pub time_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub rgb_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawVideoFrameBatch {
    pub session_id: String,
    pub frames: Vec<RawVideoFrame>,
    pub ended: bool,
}

#[derive(Debug, Default)]
pub struct MediaRegistry {
    inner: Mutex<MediaRegistryInner>,
}

#[derive(Debug, Default)]
pub struct MediaSessions {
    inner: Mutex<MediaSessionsInner>,
}

#[derive(Debug, Default)]
pub struct RawVideoSessions {
    inner: Mutex<RawVideoSessionsInner>,
}

#[derive(Debug, Default)]
struct MediaRegistryInner {
    next_id: u64,
    files: HashMap<String, RegisteredMediaFile>,
}

#[derive(Debug, Default)]
struct MediaSessionsInner {
    next_id: u64,
    sessions: HashMap<String, NativeMediaSession>,
}

#[derive(Debug, Default)]
struct RawVideoSessionsInner {
    next_id: u64,
    sessions: HashMap<String, RawVideoSession>,
}

#[derive(Debug)]
struct NativeMediaSession {
    source_id: String,
    fps: f64,
    mode: RenderMode,
    pixel: bool,
    cols: u32,
    rows: u32,
    pipeline: StreamPipelineReader,
}

#[derive(Debug)]
struct RawVideoSession {
    fps: f64,
    width: u32,
    height: u32,
    reader: FfmpegRgbFrameReader,
}

impl MediaRegistry {
    fn register(&self, app: &AppHandle, path: PathBuf) -> Result<RegisteredMediaFile, String> {
        let path = std::fs::canonicalize(path)
            .map_err(|error| format!("selected media path could not be resolved: {error}"))?;
        let metadata = std::fs::metadata(&path)
            .map_err(|error| format!("selected media metadata is unavailable: {error}"))?;
        if !metadata.is_file() {
            return Err("selected media path is not a file".to_string());
        }

        let extension = extension_for_path(&path);
        if !MEDIA_EXTENSIONS.contains(&extension.as_str()) {
            return Err(format!("unsupported media extension: {extension}"));
        }

        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|error| {
                format!("failed to allow selected media for asset playback: {error}")
            })?;

        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media registry lock poisoned".to_string())?;
        inner.next_id = inner.next_id.saturating_add(1);
        let id = format!("media-{}", inner.next_id);
        let file = RegisteredMediaFile {
            id: id.clone(),
            provider: "tauri".to_string(),
            path: path.clone(),
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Custom media")
                .to_string(),
            size: Some(metadata.len()),
            last_modified: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis()),
            media_type: media_type_for_extension(&extension).to_string(),
            mime_type: mime_type_for_extension(&extension).to_string(),
        };
        inner.files.insert(id, file.clone());
        Ok(file)
    }

    fn list(&self) -> Result<Vec<RegisteredMediaFile>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "media registry lock poisoned".to_string())?;
        let mut files = inner.files.values().cloned().collect::<Vec<_>>();
        files.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(files)
    }

    fn forget(&self, id: &str) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media registry lock poisoned".to_string())?;
        Ok(inner.files.remove(id).is_some())
    }

    pub(crate) fn path_for(&self, id: &str) -> Result<PathBuf, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "media registry lock poisoned".to_string())?;
        inner
            .files
            .get(id)
            .map(|file| file.path.clone())
            .ok_or_else(|| "registered media source is unavailable".to_string())
    }
}

impl MediaSessions {
    fn insert(
        &self,
        source_id: String,
        fps: f64,
        mode: RenderMode,
        pixel: bool,
        cols: u32,
        rows: u32,
        pipeline: StreamPipelineReader,
    ) -> Result<String, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        inner.next_id = inner.next_id.saturating_add(1);
        let session_id = format!("session-{}", inner.next_id);
        inner.sessions.insert(
            session_id.clone(),
            NativeMediaSession {
                source_id,
                fps,
                mode,
                pixel,
                cols,
                rows,
                pipeline,
            },
        );
        Ok(session_id)
    }

    fn list(&self) -> Result<Vec<NativeMediaSessionStatus>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        let mut sessions = inner
            .sessions
            .iter()
            .map(|(session_id, session)| NativeMediaSessionStatus {
                session_id: session_id.clone(),
                source_id: session.source_id.clone(),
                fps: session.fps,
                mode: session.mode as u8,
                pixel: session.pixel,
                cols: session.cols,
                rows: session.rows,
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        Ok(sessions)
    }

    fn read_frame(&self, session_id: &str) -> Result<Option<NativeMediaFrame>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        let Some(session) = inner.sessions.get_mut(session_id) else {
            return Err("media session is unavailable".to_string());
        };
        let Some(frame) = session
            .pipeline
            .read_next_encoded_frame()
            .map_err(|error| error.to_string())?
        else {
            inner.sessions.remove(session_id);
            return Ok(None);
        };

        Ok(Some(native_frame_from_encoded(
            session_id,
            session.fps,
            frame,
        )))
    }

    fn read_frames(
        &self,
        session_id: &str,
        max_frames: usize,
    ) -> Result<NativeMediaFrameBatch, String> {
        let limit = max_frames.clamp(1, MAX_SESSION_FRAME_BATCH);
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        let mut frames = Vec::with_capacity(limit);
        let mut ended = false;

        for _ in 0..limit {
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return Err("media session is unavailable".to_string());
            };
            let next = session
                .pipeline
                .read_next_encoded_frame()
                .map_err(|error| error.to_string())?;
            let Some(frame) = next else {
                ended = true;
                break;
            };
            frames.push(native_frame_from_encoded(session_id, session.fps, frame));
        }

        if ended {
            inner.sessions.remove(session_id);
        }

        Ok(NativeMediaFrameBatch {
            session_id: session_id.to_string(),
            frames,
            ended,
        })
    }

    fn stop(&self, session_id: &str) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        Ok(inner.sessions.remove(session_id).is_some())
    }
}

impl RawVideoSessions {
    fn insert(
        &self,
        _source_id: String,
        fps: f64,
        width: u32,
        height: u32,
        reader: FfmpegRgbFrameReader,
    ) -> Result<String, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "raw video session lock poisoned".to_string())?;
        inner.next_id = inner.next_id.saturating_add(1);
        let session_id = format!("raw-session-{}", inner.next_id);
        inner.sessions.insert(
            session_id.clone(),
            RawVideoSession {
                fps,
                width,
                height,
                reader,
            },
        );
        Ok(session_id)
    }

    fn read_frames(
        &self,
        session_id: &str,
        max_frames: usize,
    ) -> Result<RawVideoFrameBatch, String> {
        let limit = max_frames.clamp(1, MAX_RAW_VIDEO_FRAME_BATCH);
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "raw video session lock poisoned".to_string())?;
        let mut frames = Vec::with_capacity(limit);
        let mut ended = false;

        for _ in 0..limit {
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return Err("raw video session is unavailable".to_string());
            };
            let next = session
                .reader
                .read_next_frame()
                .map_err(|error| error.to_string())?;
            let Some(frame) = next else {
                ended = true;
                break;
            };
            frames.push(RawVideoFrame {
                session_id: session_id.to_string(),
                index: frame.index,
                time_seconds: frame.index as f64 / session.fps.max(0.001),
                width: session.width,
                height: session.height,
                rgb_base64: general_purpose::STANDARD.encode(frame.data),
            });
        }

        if ended {
            inner.sessions.remove(session_id);
        }

        Ok(RawVideoFrameBatch {
            session_id: session_id.to_string(),
            frames,
            ended,
        })
    }

    fn stop(&self, session_id: &str) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "raw video session lock poisoned".to_string())?;
        Ok(inner.sessions.remove(session_id).is_some())
    }
}

fn native_frame_from_encoded(
    session_id: &str,
    fps: f64,
    frame: EncodedStreamFrame,
) -> NativeMediaFrame {
    NativeMediaFrame {
        session_id: session_id.to_string(),
        index: frame.index,
        time_seconds: frame.index as f64 / fps.max(0.001),
        raw_bytes: frame.raw_bytes,
        adaptive_bytes: frame.message.len(),
        tag: frame.tag,
        prepared_checksum: frame.prepared_checksum,
        message_checksum: checksum_hex(&frame.message),
        message: frame.message,
    }
}

pub(crate) fn media_binaries_for_app(app: &AppHandle) -> FfmpegBinaries {
    FfmpegBinaries::with_paths(
        resolve_media_binary(app, "ASCILINE_FFMPEG", "ffmpeg"),
        resolve_media_binary(app, "ASCILINE_FFPROBE", "ffprobe"),
    )
}

fn resolve_media_binary(app: &AppHandle, env_name: &str, binary_name: &str) -> PathBuf {
    if let Some(path) = std::env::var_os(env_name) {
        return PathBuf::from(path);
    }

    let executable = if cfg!(windows) {
        format!("{binary_name}.exe")
    } else {
        binary_name.to_string()
    };

    for dir in packaged_media_binary_dirs(app) {
        let candidate = dir.join(&executable);
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from(executable)
}

fn packaged_media_binary_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(resource_dir) = app.path().resource_dir() else {
        return Vec::new();
    };

    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    [
        resource_dir.join("ffmpeg").join(&platform).join("bin"),
        resource_dir.join("ffmpeg").join(&platform),
        resource_dir.join("ffmpeg").join("bin"),
        resource_dir.join("ffmpeg"),
        resource_dir
            .join("resources")
            .join("ffmpeg")
            .join(&platform)
            .join("bin"),
        resource_dir
            .join("resources")
            .join("ffmpeg")
            .join(&platform),
        resource_dir.join("resources").join("ffmpeg").join("bin"),
        resource_dir.join("resources").join("ffmpeg"),
        resource_dir.join("bin"),
    ]
    .into()
}

#[tauri::command]
pub async fn select_media_file(
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
) -> Result<Option<RegisteredMediaFile>, String> {
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("Media files", MEDIA_EXTENSIONS)
            .blocking_pick_file()
    })
    .await
    .map_err(|error| format!("media picker task failed: {error}"))?;

    let Some(file_path) = selected else {
        return Ok(None);
    };
    let path = file_path
        .simplified()
        .into_path()
        .map_err(|error| format!("selected media path is not readable: {error}"))?;
    registry.register(&app, path).map(Some)
}

#[tauri::command]
pub fn list_media_files(
    registry: State<'_, MediaRegistry>,
) -> Result<Vec<RegisteredMediaFile>, String> {
    registry.list()
}

#[tauri::command]
pub fn forget_media_file(id: String, registry: State<'_, MediaRegistry>) -> Result<bool, String> {
    registry.forget(&id)
}

#[tauri::command]
pub async fn probe_registered_media(
    id: String,
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
) -> Result<VideoProbe, String> {
    let path = registry.path_for(&id)?;
    let binaries = media_binaries_for_app(&app);
    tauri::async_runtime::spawn_blocking(move || probe_video(&binaries, &path))
        .await
        .map_err(|error| format!("media probe task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_registered_media(
    id: String,
    request: PipelinePreviewRequest,
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
) -> Result<StreamPipelineSummary, String> {
    validate_pipeline_request(&request, MAX_PREVIEW_FRAMES)?;
    let path = registry.path_for(&id)?;
    let binaries = media_binaries_for_app(&app);

    tauri::async_runtime::spawn_blocking(move || {
        let mode = RenderMode::from_u8(request.mode)?;
        let decode = DecodeConfig::new(request.width, request.height, request.max_frames)?;
        let mut config = StreamPipelineConfig::new(path, decode, mode, request.pixel)?;
        if let Some(tolerance) = request.codec_tolerance {
            config.codec_tolerance = tolerance;
        }
        if let Some(verify_decode) = request.verify_decode {
            config.verify_decode = verify_decode;
        }
        run_stream_pipeline(&binaries, &config)
    })
    .await
    .map_err(|error| format!("media preview task failed: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_registered_media_session(
    id: String,
    request: PipelinePreviewRequest,
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    sessions: State<'_, MediaSessions>,
) -> Result<NativeMediaSessionInit, String> {
    validate_pipeline_request(&request, MAX_SESSION_FRAMES)?;
    let path = registry.path_for(&id)?;

    let source_id = id.clone();
    let mode = RenderMode::from_u8(request.mode).map_err(|error| error.to_string())?;
    let decode = DecodeConfig::new(request.width, request.height, request.max_frames)
        .map_err(|error| error.to_string())?;
    let mut config = StreamPipelineConfig::new(path.clone(), decode, mode, request.pixel)
        .map_err(|error| error.to_string())?;
    if let Some(tolerance) = request.codec_tolerance {
        config.codec_tolerance = tolerance;
    }
    if let Some(verify_decode) = request.verify_decode {
        config.verify_decode = verify_decode;
    }

    let binaries = media_binaries_for_app(&app);
    let probe = probe_video(&binaries, &path).map_err(|error| error.to_string())?;
    let reader =
        spawn_rgb_reader(&binaries, &path, &config.decode).map_err(|error| error.to_string())?;
    let pipeline =
        StreamPipelineReader::new(config.clone(), reader).map_err(|error| error.to_string())?;
    let fps = probe.fps.unwrap_or(24.0).max(0.001);
    let session_id = sessions.insert(
        source_id.clone(),
        fps,
        mode,
        request.pixel,
        request.width,
        request.height,
        pipeline,
    )?;

    Ok(NativeMediaSessionInit {
        session_id,
        source_id,
        fps,
        mode: mode as u8,
        pixel: request.pixel,
        cols: request.width,
        rows: request.height,
        cell_bytes: config.cell_bytes(),
        probe,
    })
}

#[tauri::command]
pub fn read_media_session_frame(
    session_id: String,
    sessions: State<'_, MediaSessions>,
) -> Result<Option<NativeMediaFrame>, String> {
    sessions.read_frame(&session_id)
}

#[tauri::command]
pub fn read_media_session_frames(
    session_id: String,
    max_frames: usize,
    sessions: State<'_, MediaSessions>,
) -> Result<NativeMediaFrameBatch, String> {
    sessions.read_frames(&session_id, max_frames)
}

#[tauri::command]
pub fn stop_media_session(
    session_id: String,
    sessions: State<'_, MediaSessions>,
) -> Result<bool, String> {
    sessions.stop(&session_id)
}

#[tauri::command]
pub async fn start_raw_video_session(
    id: String,
    request: RawVideoSessionRequest,
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    sessions: State<'_, RawVideoSessions>,
) -> Result<RawVideoSessionInit, String> {
    validate_raw_video_request(&request)?;
    let path = registry.path_for(&id)?;
    let binaries = media_binaries_for_app(&app);
    let probe = probe_video(&binaries, &path).map_err(|error| error.to_string())?;
    let fps = request
        .fps
        .or(probe.fps)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(24.0)
        .clamp(1.0, 60.0);
    let decode = DecodeConfig::new(request.width, request.height, request.max_frames)
        .map_err(|error| error.to_string())?;
    let options = RgbReaderOptions {
        start_seconds: request.start_seconds,
        output_fps: Some(fps),
    };
    let reader = spawn_rgb_reader_with_options(&binaries, &path, &decode, &options)
        .map_err(|error| error.to_string())?;
    let session_id = sessions.insert(id.clone(), fps, request.width, request.height, reader)?;

    Ok(RawVideoSessionInit {
        session_id,
        source_id: id,
        fps,
        width: request.width,
        height: request.height,
        probe,
    })
}

#[tauri::command]
pub fn read_raw_video_frames(
    session_id: String,
    max_frames: usize,
    sessions: State<'_, RawVideoSessions>,
) -> Result<RawVideoFrameBatch, String> {
    sessions.read_frames(&session_id, max_frames)
}

#[tauri::command]
pub fn stop_raw_video_session(
    session_id: String,
    sessions: State<'_, RawVideoSessions>,
) -> Result<bool, String> {
    sessions.stop(&session_id)
}

#[tauri::command]
pub fn list_media_sessions(
    sessions: State<'_, MediaSessions>,
) -> Result<Vec<NativeMediaSessionStatus>, String> {
    sessions.list()
}

fn validate_pipeline_request(
    request: &PipelinePreviewRequest,
    max_frames: usize,
) -> Result<(), String> {
    if request.max_frames == 0 || request.max_frames > max_frames {
        return Err(format!("maxFrames must be between 1 and {max_frames}"));
    }
    if u64::from(request.width) * u64::from(request.height) > MAX_PREVIEW_CELLS {
        return Err(format!(
            "preview dimensions must contain at most {MAX_PREVIEW_CELLS} cells"
        ));
    }
    Ok(())
}

fn validate_raw_video_request(request: &RawVideoSessionRequest) -> Result<(), String> {
    if request.max_frames == 0 || request.max_frames > MAX_RAW_VIDEO_FRAMES {
        return Err(format!(
            "maxFrames must be between 1 and {MAX_RAW_VIDEO_FRAMES}"
        ));
    }
    if u64::from(request.width) * u64::from(request.height) > MAX_RAW_VIDEO_PIXELS {
        return Err(format!(
            "raw video dimensions must contain at most {MAX_RAW_VIDEO_PIXELS} pixels"
        ));
    }
    DecodeConfig::new(request.width, request.height, request.max_frames)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn extension_for_path(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn media_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" | "png" | "gif" | "svg" => "image",
        _ => "video",
    }
}

fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "",
    }
}
