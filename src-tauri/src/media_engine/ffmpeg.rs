use serde::{Deserialize, Serialize};
use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};

#[derive(Debug)]
pub enum FfmpegError {
    InvalidDecodeConfig(String),
    Io {
        program: PathBuf,
        source: std::io::Error,
    },
    ProcessFailed {
        program: PathBuf,
        code: Option<i32>,
        stderr: String,
    },
    Json(serde_json::Error),
    NoVideoStream,
    MissingDimension,
    InvalidRawVideo {
        expected_multiple: usize,
        actual: usize,
    },
}

impl fmt::Display for FfmpegError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDecodeConfig(message) => write!(f, "invalid decode config: {message}"),
            Self::Io { program, source } => {
                write!(f, "failed to run {}: {source}", program.display())
            }
            Self::ProcessFailed {
                program,
                code,
                stderr,
            } => write!(
                f,
                "{} exited with status {}{}",
                program.display(),
                code.map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                if stderr.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", stderr.trim())
                }
            ),
            Self::Json(error) => write!(f, "failed to parse ffprobe JSON: {error}"),
            Self::NoVideoStream => write!(f, "media file does not contain a video stream"),
            Self::MissingDimension => write!(f, "video stream did not report width/height"),
            Self::InvalidRawVideo {
                expected_multiple,
                actual,
            } => write!(
                f,
                "raw video output length {actual} is not a multiple of frame size {expected_multiple}"
            ),
        }
    }
}

impl std::error::Error for FfmpegError {}

impl From<serde_json::Error> for FfmpegError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FfmpegBinaries {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl FfmpegBinaries {
    pub fn from_env() -> Self {
        Self {
            ffmpeg: std::env::var_os("ASCILINE_FFMPEG")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("ffmpeg")),
            ffprobe: std::env::var_os("ASCILINE_FFPROBE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("ffprobe")),
        }
    }

    pub fn with_paths(ffmpeg: impl Into<PathBuf>, ffprobe: impl Into<PathBuf>) -> Self {
        Self {
            ffmpeg: ffmpeg.into(),
            ffprobe: ffprobe.into(),
        }
    }
}

impl Default for FfmpegBinaries {
    fn default() -> Self {
        Self::from_env()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub codec_name: Option<String>,
    pub pixel_format: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeConfig {
    pub width: u32,
    pub height: u32,
    pub max_frames: usize,
}

impl DecodeConfig {
    pub fn new(width: u32, height: u32, max_frames: usize) -> Result<Self, FfmpegError> {
        if width == 0 || height == 0 {
            return Err(FfmpegError::InvalidDecodeConfig(
                "width and height must be greater than zero".to_string(),
            ));
        }
        if max_frames == 0 {
            return Err(FfmpegError::InvalidDecodeConfig(
                "max_frames must be greater than zero".to_string(),
            ));
        }
        checked_rgb_frame_bytes(width, height)?;
        Ok(Self {
            width,
            height,
            max_frames,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RgbReaderOptions {
    pub start_seconds: Option<f64>,
    pub output_fps: Option<f64>,
}

impl Default for RgbReaderOptions {
    fn default() -> Self {
        Self {
            start_seconds: None,
            output_fps: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CameraReaderOptions {
    pub device_label: Option<String>,
    pub capture_width: Option<u32>,
    pub capture_height: Option<u32>,
    pub capture_fps: Option<f64>,
    pub output_fps: Option<f64>,
}

impl Default for CameraReaderOptions {
    fn default() -> Self {
        Self {
            device_label: None,
            capture_width: None,
            capture_height: None,
            capture_fps: None,
            output_fps: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedRgbFrame {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Debug)]
pub struct FfmpegRgbFrameReader {
    child: Child,
    stdout: ChildStdout,
    program: PathBuf,
    width: u32,
    height: u32,
    frame_bytes: usize,
    index: usize,
    finished: bool,
}

impl FfmpegRgbFrameReader {
    pub fn read_next_frame(&mut self) -> Result<Option<DecodedRgbFrame>, FfmpegError> {
        let mut data = vec![0; self.frame_bytes];
        let mut filled = 0usize;

        while filled < self.frame_bytes {
            let read = self
                .stdout
                .read(&mut data[filled..])
                .map_err(|source| FfmpegError::Io {
                    program: self.program.clone(),
                    source,
                })?;

            if read == 0 {
                if filled == 0 {
                    self.finished = true;
                    return self.wait_for_success().map(|_| None);
                }
                return Err(FfmpegError::InvalidRawVideo {
                    expected_multiple: self.frame_bytes,
                    actual: filled,
                });
            }

            filled += read;
        }

        let frame = DecodedRgbFrame {
            index: self.index,
            width: self.width,
            height: self.height,
            data,
        };
        self.index += 1;
        Ok(Some(frame))
    }

    pub fn wait_for_success(&mut self) -> Result<(), FfmpegError> {
        let status = self.child.wait().map_err(|source| FfmpegError::Io {
            program: self.program.clone(),
            source,
        })?;
        self.finished = true;

        if status.success() {
            Ok(())
        } else {
            let mut stderr = String::new();
            if let Some(mut stderr_pipe) = self.child.stderr.take() {
                let _ = stderr_pipe.read_to_string(&mut stderr);
            }
            Err(FfmpegError::ProcessFailed {
                program: self.program.clone(),
                code: status.code(),
                stderr,
            })
        }
    }
}

impl Drop for FfmpegRgbFrameReader {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
    codec_name: Option<String>,
    pix_fmt: Option<String>,
}

pub fn probe_video(binaries: &FfmpegBinaries, source: &Path) -> Result<VideoProbe, FfmpegError> {
    let output = Command::new(&binaries.ffprobe)
        .args(ffprobe_args(source))
        .output()
        .map_err(|source| FfmpegError::Io {
            program: binaries.ffprobe.clone(),
            source,
        })?;

    if !output.status.success() {
        return Err(FfmpegError::ProcessFailed {
            program: binaries.ffprobe.clone(),
            code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        });
    }

    parse_probe_output(source, &output.stdout)
}

pub fn decode_rgb_preview(
    binaries: &FfmpegBinaries,
    source: &Path,
    config: &DecodeConfig,
) -> Result<Vec<DecodedRgbFrame>, FfmpegError> {
    let mut reader = spawn_rgb_reader(binaries, source, config)?;
    let mut frames = Vec::with_capacity(config.max_frames);

    while let Some(frame) = reader.read_next_frame()? {
        frames.push(frame);
    }

    Ok(frames)
}

pub fn spawn_rgb_reader(
    binaries: &FfmpegBinaries,
    source: &Path,
    config: &DecodeConfig,
) -> Result<FfmpegRgbFrameReader, FfmpegError> {
    spawn_rgb_reader_with_options(binaries, source, config, &RgbReaderOptions::default())
}

pub fn spawn_rgb_reader_with_options(
    binaries: &FfmpegBinaries,
    source: &Path,
    config: &DecodeConfig,
    options: &RgbReaderOptions,
) -> Result<FfmpegRgbFrameReader, FfmpegError> {
    let mut child = Command::new(&binaries.ffmpeg)
        .args(ffmpeg_decode_args(source, config, options))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|source| FfmpegError::Io {
            program: binaries.ffmpeg.clone(),
            source,
        })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        FfmpegError::InvalidDecodeConfig("ffmpeg stdout pipe was not available".to_string())
    })?;

    Ok(FfmpegRgbFrameReader {
        child,
        stdout,
        program: binaries.ffmpeg.clone(),
        width: config.width,
        height: config.height,
        frame_bytes: checked_rgb_frame_bytes(config.width, config.height)?,
        index: 0,
        finished: false,
    })
}

pub fn spawn_macos_camera_rgb_reader(
    binaries: &FfmpegBinaries,
    config: &DecodeConfig,
    options: &CameraReaderOptions,
) -> Result<FfmpegRgbFrameReader, FfmpegError> {
    #[cfg(target_os = "macos")]
    {
        let mut child = Command::new(&binaries.ffmpeg)
            .args(ffmpeg_macos_camera_decode_args(config, options))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| FfmpegError::Io {
                program: binaries.ffmpeg.clone(),
                source,
            })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            FfmpegError::InvalidDecodeConfig("ffmpeg stdout pipe was not available".to_string())
        })?;

        Ok(FfmpegRgbFrameReader {
            child,
            stdout,
            program: binaries.ffmpeg.clone(),
            width: config.width,
            height: config.height,
            frame_bytes: checked_rgb_frame_bytes(config.width, config.height)?,
            index: 0,
            finished: false,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (binaries, config, options);
        Err(FfmpegError::InvalidDecodeConfig(
            "native camera output is currently implemented for macOS only".to_string(),
        ))
    }
}

fn ffprobe_args(source: &Path) -> Vec<String> {
    vec![
        "-v".to_string(),
        "error".to_string(),
        "-select_streams".to_string(),
        "v:0".to_string(),
        "-show_entries".to_string(),
        "stream=width,height,avg_frame_rate,r_frame_rate,duration,codec_name,pix_fmt".to_string(),
        "-of".to_string(),
        "json".to_string(),
        source.to_string_lossy().into_owned(),
    ]
}

fn ffmpeg_decode_args(
    source: &Path,
    config: &DecodeConfig,
    options: &RgbReaderOptions,
) -> Vec<String> {
    let mut args = vec![
        "-nostdin".to_string(),
        "-v".to_string(),
        "error".to_string(),
    ];

    if let Some(start_seconds) = options.start_seconds {
        if start_seconds.is_finite() && start_seconds > 0.0 {
            args.push("-ss".to_string());
            args.push(format!("{start_seconds:.3}"));
        }
    }

    args.extend([
        "-i".to_string(),
        source.to_string_lossy().into_owned(),
        "-an".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
        "-frames:v".to_string(),
        config.max_frames.to_string(),
        "-vf".to_string(),
        ffmpeg_video_filter(config, options),
        "-pix_fmt".to_string(),
        "rgb24".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "pipe:1".to_string(),
    ]);

    args
}

fn ffmpeg_macos_camera_decode_args(
    config: &DecodeConfig,
    options: &CameraReaderOptions,
) -> Vec<String> {
    let mut args = vec![
        "-nostdin".to_string(),
        "-v".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "avfoundation".to_string(),
    ];

    if let Some(fps) = options
        .capture_fps
        .filter(|fps| fps.is_finite() && *fps > 0.0)
    {
        args.push("-framerate".to_string());
        args.push(format!("{fps:.3}"));
    }

    if let (Some(width), Some(height)) = (options.capture_width, options.capture_height) {
        if width > 0 && height > 0 {
            args.push("-video_size".to_string());
            args.push(format!("{width}x{height}"));
        }
    }

    args.extend([
        "-i".to_string(),
        macos_camera_input_name(options.device_label.as_deref()),
        "-an".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
        "-vf".to_string(),
        ffmpeg_video_filter(
            config,
            &RgbReaderOptions {
                start_seconds: None,
                output_fps: None,
            },
        ),
        "-pix_fmt".to_string(),
        "rgb24".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "pipe:1".to_string(),
    ]);

    args
}

fn macos_camera_input_name(device_label: Option<&str>) -> String {
    let label = device_label
        .map(|label| {
            label
                .trim()
                .chars()
                .filter(|ch| !ch.is_control() && *ch != ':')
                .collect::<String>()
        })
        .filter(|label| !label.is_empty() && label != "Selected camera" && label != "Camera 1");

    match label {
        Some(label) => format!("{label}:none"),
        None => "0:none".to_string(),
    }
}

fn ffmpeg_video_filter(config: &DecodeConfig, options: &RgbReaderOptions) -> String {
    let scale = format!("scale={}:{}:flags=bilinear", config.width, config.height);
    match options.output_fps {
        Some(fps) if fps.is_finite() && fps > 0.0 => format!("fps=fps={fps:.3},{scale}"),
        _ => scale,
    }
}

fn parse_probe_output(source: &Path, bytes: &[u8]) -> Result<VideoProbe, FfmpegError> {
    let output: FfprobeOutput = serde_json::from_slice(bytes)?;
    let stream = output
        .streams
        .into_iter()
        .next()
        .ok_or(FfmpegError::NoVideoStream)?;
    let width = stream
        .width
        .filter(|width| *width > 0)
        .ok_or(FfmpegError::MissingDimension)?;
    let height = stream
        .height
        .filter(|height| *height > 0)
        .ok_or(FfmpegError::MissingDimension)?;

    Ok(VideoProbe {
        path: source.to_path_buf(),
        width,
        height,
        fps: parse_rate(stream.avg_frame_rate.as_deref())
            .or_else(|| parse_rate(stream.r_frame_rate.as_deref())),
        duration_seconds: stream.duration.as_deref().and_then(parse_positive_f64),
        codec_name: stream.codec_name,
        pixel_format: stream.pix_fmt,
    })
}

#[cfg(test)]
fn frames_from_rgb24(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<DecodedRgbFrame>, FfmpegError> {
    let frame_bytes = checked_rgb_frame_bytes(width, height)?;
    if bytes.len() % frame_bytes != 0 {
        return Err(FfmpegError::InvalidRawVideo {
            expected_multiple: frame_bytes,
            actual: bytes.len(),
        });
    }

    Ok(bytes
        .chunks_exact(frame_bytes)
        .enumerate()
        .map(|(index, data)| DecodedRgbFrame {
            index,
            width,
            height,
            data: data.to_vec(),
        })
        .collect())
}

fn checked_rgb_frame_bytes(width: u32, height: u32) -> Result<usize, FfmpegError> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| {
            FfmpegError::InvalidDecodeConfig("width * height * 3 overflowed usize".to_string())
        })
}

fn parse_rate(rate: Option<&str>) -> Option<f64> {
    let rate = rate?.trim();
    if rate.is_empty() || rate == "0/0" {
        return None;
    }

    if let Some((numerator, denominator)) = rate.split_once('/') {
        let numerator = parse_positive_f64(numerator)?;
        let denominator = parse_positive_f64(denominator)?;
        return Some(numerator / denominator);
    }

    parse_positive_f64(rate)
}

fn parse_positive_f64(value: &str) -> Option<f64> {
    let parsed = value.trim().parse::<f64>().ok()?;
    (parsed.is_finite() && parsed > 0.0).then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_probe_json() {
        let probe = parse_probe_output(
            Path::new("demo.mp4"),
            br#"{
              "streams": [{
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30000/1001",
                "r_frame_rate": "30/1",
                "duration": "12.345000",
                "codec_name": "h264",
                "pix_fmt": "yuv420p"
              }]
            }"#,
        )
        .unwrap();

        assert_eq!(probe.path, PathBuf::from("demo.mp4"));
        assert_eq!(probe.width, 1920);
        assert_eq!(probe.height, 1080);
        assert!((probe.fps.unwrap() - 29.970_029).abs() < 0.000_01);
        assert_eq!(probe.duration_seconds, Some(12.345));
        assert_eq!(probe.codec_name.as_deref(), Some("h264"));
        assert_eq!(probe.pixel_format.as_deref(), Some("yuv420p"));
    }

    #[test]
    fn ignores_zero_frame_rate() {
        assert_eq!(parse_rate(Some("0/0")), None);
        assert_eq!(parse_rate(Some("0")), None);
        assert_eq!(parse_rate(Some("-24/1")), None);
        assert_eq!(parse_rate(Some("24/1")), Some(24.0));
    }

    #[test]
    fn builds_ffmpeg_rawvideo_args_without_shell() {
        let config = DecodeConfig::new(160, 90, 3).unwrap();
        let args = ffmpeg_decode_args(
            Path::new("a b/demo.mp4"),
            &config,
            &RgbReaderOptions::default(),
        );

        assert_eq!(args[0], "-nostdin");
        assert!(args.contains(&"a b/demo.mp4".to_string()));
        assert!(args.contains(&"scale=160:90:flags=bilinear".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
    }

    #[test]
    fn builds_macos_camera_rawvideo_args_without_shell() {
        let config = DecodeConfig::new(640, 360, 3).unwrap();
        let args = ffmpeg_macos_camera_decode_args(
            &config,
            &CameraReaderOptions {
                device_label: Some("FaceTime HD Camera".to_string()),
                capture_width: Some(1280),
                capture_height: Some(720),
                capture_fps: Some(30.0),
                output_fps: Some(24.0),
            },
        );

        assert_eq!(args[0], "-nostdin");
        assert!(args.contains(&"avfoundation".to_string()));
        assert!(args.contains(&"FaceTime HD Camera:none".to_string()));
        assert!(args.contains(&"1280x720".to_string()));
        assert!(args.contains(&"scale=640:360:flags=bilinear".to_string()));
        assert!(!args.contains(&"fps=fps=24.000,scale=640:360:flags=bilinear".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
    }

    #[test]
    fn macos_camera_input_defaults_to_first_video_device() {
        assert_eq!(macos_camera_input_name(None), "0:none");
        assert_eq!(macos_camera_input_name(Some("Camera 1")), "0:none");
        assert_eq!(
            macos_camera_input_name(Some("USB: Camera")),
            "USB Camera:none"
        );
    }

    #[test]
    fn chunks_rgb24_frames() {
        let bytes: Vec<u8> = (0..18).collect();
        let frames = frames_from_rgb24(&bytes, 2, 1).unwrap();

        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].data, vec![0, 1, 2, 3, 4, 5]);
        assert_eq!(frames[2].index, 2);
    }

    #[test]
    fn rejects_partial_rgb24_frame() {
        let err = frames_from_rgb24(&[0, 1, 2, 3], 2, 1).unwrap_err();
        assert!(matches!(err, FfmpegError::InvalidRawVideo { .. }));
    }
}
