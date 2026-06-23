use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEFAULT_AUDIO_SAMPLE_RATE: f32 = 48_000.0;
const BEAT_HISTORY: usize = 36;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioFeatures {
    pub available: bool,
    pub active: bool,
    pub source_label: String,
    pub rms: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub flux: f32,
    pub beat_pulse: f32,
    pub phase: f32,
    pub frames: u64,
    pub last_error: Option<String>,
}

impl SystemAudioFeatures {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            available: false,
            active: false,
            source_label: "Native system audio".to_string(),
            rms: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            flux: 0.0,
            beat_pulse: 0.0,
            phase: 0.0,
            frames: 0,
            last_error: Some(message.into()),
        }
    }

    #[cfg(target_os = "macos")]
    fn inactive() -> Self {
        Self::inactive_with_label("Native system audio")
    }

    fn inactive_with_label(source_label: impl Into<String>) -> Self {
        Self {
            available: true,
            active: false,
            source_label: source_label.into(),
            rms: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            flux: 0.0,
            beat_pulse: 0.0,
            phase: 0.0,
            frames: 0,
            last_error: None,
        }
    }
}

struct AudioFeatureAnalyzer {
    source_label: String,
    low_160: f32,
    low_250: f32,
    low_2200: f32,
    low_2400: f32,
    previous_sample: f32,
    energy_history: VecDeque<f32>,
    beat_pulse: f32,
    beat_cooldown_until: Instant,
    phase: f32,
    frames: u64,
    features: SystemAudioFeatures,
}

impl AudioFeatureAnalyzer {
    fn new(source_label: String) -> Self {
        Self {
            features: SystemAudioFeatures {
                available: true,
                active: true,
                source_label: source_label.clone(),
                rms: 0.0,
                bass: 0.0,
                mid: 0.0,
                treble: 0.0,
                flux: 0.0,
                beat_pulse: 0.0,
                phase: 0.0,
                frames: 0,
                last_error: None,
            },
            source_label,
            low_160: 0.0,
            low_250: 0.0,
            low_2200: 0.0,
            low_2400: 0.0,
            previous_sample: 0.0,
            energy_history: VecDeque::with_capacity(BEAT_HISTORY),
            beat_pulse: 0.0,
            beat_cooldown_until: Instant::now(),
            phase: 0.0,
            frames: 0,
        }
    }

    fn process(&mut self, samples: &[f32], sample_rate: f32) {
        let sample_rate = sample_rate.max(1.0);
        let alpha_160 = filter_alpha(160.0, sample_rate);
        let alpha_250 = filter_alpha(250.0, sample_rate);
        let alpha_2200 = filter_alpha(2_200.0, sample_rate);
        let alpha_2400 = filter_alpha(2_400.0, sample_rate);

        let mut rms_sum = 0.0;
        let mut bass_sum = 0.0;
        let mut mid_sum = 0.0;
        let mut treble_sum = 0.0;
        let mut flux_sum = 0.0;

        for &sample in samples {
            let x = sample.clamp(-1.0, 1.0);
            self.low_160 += alpha_160 * (x - self.low_160);
            self.low_250 += alpha_250 * (x - self.low_250);
            self.low_2200 += alpha_2200 * (x - self.low_2200);
            self.low_2400 += alpha_2400 * (x - self.low_2400);

            let bass = self.low_160;
            let mid = self.low_2200 - self.low_250;
            let treble = x - self.low_2400;
            rms_sum += x * x;
            bass_sum += bass * bass;
            mid_sum += mid * mid;
            treble_sum += treble * treble;
            flux_sum += (x - self.previous_sample).abs();
            self.previous_sample = x;
        }

        let n = samples.len().max(1) as f32;
        let rms = ((rms_sum / n).sqrt() * 2.4).clamp(0.0, 1.0);
        let bass = ((bass_sum / n).sqrt() * 5.0).clamp(0.0, 1.0);
        let mid = ((mid_sum / n).sqrt() * 3.1).clamp(0.0, 1.0);
        let treble = ((treble_sum / n).sqrt() * 2.4).clamp(0.0, 1.0);
        let flux = ((flux_sum / n) * 7.5).clamp(0.0, 1.0);
        let beat_pulse = self.detect_beat(rms, flux);

        self.phase += (samples.len() as f32 / sample_rate) * 14.0;
        self.frames = self.frames.saturating_add(1);
        self.features = SystemAudioFeatures {
            available: true,
            active: true,
            source_label: self.source_label.clone(),
            rms,
            bass,
            mid,
            treble,
            flux,
            beat_pulse,
            phase: self.phase,
            frames: self.frames,
            last_error: None,
        };
    }

    fn detect_beat(&mut self, rms: f32, flux: f32) -> f32 {
        self.energy_history.push_back(rms);
        if self.energy_history.len() > BEAT_HISTORY {
            self.energy_history.pop_front();
        }
        let avg = self.energy_history.iter().copied().sum::<f32>()
            / self.energy_history.len().max(1) as f32;
        let threshold = avg.mul_add(1.22, 0.0).max(0.035);
        let now = Instant::now();
        let beat =
            now > self.beat_cooldown_until && rms > threshold && (flux > 0.08 || rms > avg * 1.55);
        if beat {
            self.beat_pulse = 1.0;
            self.beat_cooldown_until = now + Duration::from_millis(135);
        } else {
            self.beat_pulse *= 0.82;
        }
        self.beat_pulse.clamp(0.0, 1.0)
    }

    fn features(&self) -> SystemAudioFeatures {
        self.features.clone()
    }
}

fn filter_alpha(cutoff_hz: f32, sample_rate: f32) -> f32 {
    1.0 - (-2.0 * std::f32::consts::PI * cutoff_hz / sample_rate.max(1.0)).exp()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioStartResponse {
    pub available: bool,
    pub active: bool,
    pub source_label: String,
    pub display_id: Option<u32>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputAudioStartRequest {
    pub device_label: Option<String>,
}

#[derive(Default)]
pub struct SystemAudioCaptureState {
    #[cfg(target_os = "macos")]
    session: Mutex<Option<macos::SystemAudioSession>>,
}

impl SystemAudioCaptureState {
    pub fn features_snapshot(&self) -> Result<SystemAudioFeatures, String> {
        read_platform_system_audio_features(self)
    }
}

#[derive(Default)]
pub struct InputAudioCaptureState {
    session: Mutex<Option<input::InputAudioSession>>,
}

impl InputAudioCaptureState {
    pub fn features_snapshot(&self) -> Result<SystemAudioFeatures, String> {
        read_platform_input_audio_features(self)
    }
}

#[tauri::command]
pub fn start_system_audio_capture(
    state: tauri::State<'_, SystemAudioCaptureState>,
) -> Result<SystemAudioStartResponse, String> {
    start_platform_system_audio_capture(&state)
}

#[tauri::command]
pub fn read_system_audio_features(
    state: tauri::State<'_, SystemAudioCaptureState>,
) -> Result<SystemAudioFeatures, String> {
    read_platform_system_audio_features(&state)
}

#[tauri::command]
pub fn stop_system_audio_capture(
    state: tauri::State<'_, SystemAudioCaptureState>,
) -> Result<bool, String> {
    stop_platform_system_audio_capture(&state)
}

#[tauri::command]
pub fn start_input_audio_capture(
    state: tauri::State<'_, InputAudioCaptureState>,
    request: Option<InputAudioStartRequest>,
) -> Result<SystemAudioStartResponse, String> {
    start_platform_input_audio_capture(&state, request)
}

#[tauri::command]
pub fn read_input_audio_features(
    state: tauri::State<'_, InputAudioCaptureState>,
) -> Result<SystemAudioFeatures, String> {
    read_platform_input_audio_features(&state)
}

#[tauri::command]
pub fn stop_input_audio_capture(
    state: tauri::State<'_, InputAudioCaptureState>,
) -> Result<bool, String> {
    stop_platform_input_audio_capture(&state)
}

fn start_platform_input_audio_capture(
    state: &InputAudioCaptureState,
    request: Option<InputAudioStartRequest>,
) -> Result<SystemAudioStartResponse, String> {
    {
        let previous = state
            .session
            .lock()
            .map_err(|_| "Input audio state lock poisoned".to_string())?
            .take();
        drop(previous);
    }

    let session = input::InputAudioSession::start(request.and_then(|item| item.device_label))?;
    let response = session.response();
    *state
        .session
        .lock()
        .map_err(|_| "Input audio state lock poisoned".to_string())? = Some(session);
    Ok(response)
}

fn read_platform_input_audio_features(
    state: &InputAudioCaptureState,
) -> Result<SystemAudioFeatures, String> {
    let guard = state
        .session
        .lock()
        .map_err(|_| "Input audio state lock poisoned".to_string())?;
    Ok(guard
        .as_ref()
        .map(input::InputAudioSession::features)
        .unwrap_or_else(|| SystemAudioFeatures::inactive_with_label("Native microphone")))
}

fn stop_platform_input_audio_capture(state: &InputAudioCaptureState) -> Result<bool, String> {
    let previous = state
        .session
        .lock()
        .map_err(|_| "Input audio state lock poisoned".to_string())?
        .take();
    Ok(previous.is_some())
}

#[cfg(target_os = "macos")]
fn start_platform_system_audio_capture(
    state: &SystemAudioCaptureState,
) -> Result<SystemAudioStartResponse, String> {
    {
        let previous = state
            .session
            .lock()
            .map_err(|_| "System audio state lock poisoned".to_string())?
            .take();
        drop(previous);
    }

    let session = macos::SystemAudioSession::start()?;
    let response = session.response();
    *state
        .session
        .lock()
        .map_err(|_| "System audio state lock poisoned".to_string())? = Some(session);
    Ok(response)
}

#[cfg(not(target_os = "macos"))]
fn start_platform_system_audio_capture(
    _state: &SystemAudioCaptureState,
) -> Result<SystemAudioStartResponse, String> {
    Ok(SystemAudioStartResponse {
        available: false,
        active: false,
        source_label: "Native system audio".to_string(),
        display_id: None,
        message: Some("Native system audio capture is only implemented on macOS".to_string()),
    })
}

#[cfg(target_os = "macos")]
fn read_platform_system_audio_features(
    state: &SystemAudioCaptureState,
) -> Result<SystemAudioFeatures, String> {
    let guard = state
        .session
        .lock()
        .map_err(|_| "System audio state lock poisoned".to_string())?;
    Ok(guard
        .as_ref()
        .map(macos::SystemAudioSession::features)
        .unwrap_or_else(SystemAudioFeatures::inactive))
}

#[cfg(not(target_os = "macos"))]
fn read_platform_system_audio_features(
    _state: &SystemAudioCaptureState,
) -> Result<SystemAudioFeatures, String> {
    Ok(SystemAudioFeatures::unavailable(
        "Native system audio capture is only implemented on macOS",
    ))
}

#[cfg(target_os = "macos")]
fn stop_platform_system_audio_capture(state: &SystemAudioCaptureState) -> Result<bool, String> {
    let previous = state
        .session
        .lock()
        .map_err(|_| "System audio state lock poisoned".to_string())?
        .take();
    Ok(previous.is_some())
}

#[cfg(not(target_os = "macos"))]
fn stop_platform_system_audio_capture(_state: &SystemAudioCaptureState) -> Result<bool, String> {
    Ok(false)
}

mod input {
    use super::{
        AudioFeatureAnalyzer, SystemAudioFeatures, SystemAudioStartResponse,
        DEFAULT_AUDIO_SAMPLE_RATE,
    };
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::{Arc, Mutex};

    pub struct InputAudioSession {
        stream: cpal::Stream,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
        source_label: String,
    }

    impl InputAudioSession {
        pub fn start(device_label: Option<String>) -> Result<Self, String> {
            let host = cpal::default_host();
            let device = select_input_device(&host, device_label.as_deref())?;
            let source_label = cpal_device_label(&device);
            let config = device.default_input_config().map_err(|error| {
                format!("Could not read microphone input configuration for {source_label}: {error}")
            })?;
            let sample_rate = config.sample_rate() as f32;
            let channels = usize::from(config.channels().max(1));
            let analyzer = Arc::new(Mutex::new(AudioFeatureAnalyzer::new(source_label.clone())));
            let stream_config: cpal::StreamConfig = config.clone().into();

            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => build_input_stream_f32(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                cpal::SampleFormat::F64 => build_input_stream_f64(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                cpal::SampleFormat::I16 => build_input_stream_i16(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                cpal::SampleFormat::I32 => build_input_stream_i32(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                cpal::SampleFormat::U16 => build_input_stream_u16(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                cpal::SampleFormat::U32 => build_input_stream_u32(
                    &device,
                    &stream_config,
                    channels,
                    sample_rate,
                    analyzer.clone(),
                ),
                format => Err(format!("Unsupported microphone sample format: {format:?}")),
            }?;

            stream
                .play()
                .map_err(|error| format!("Could not start microphone capture: {error}"))?;

            Ok(Self {
                stream,
                analyzer,
                source_label,
            })
        }

        pub fn response(&self) -> SystemAudioStartResponse {
            let _ = &self.stream;
            SystemAudioStartResponse {
                available: true,
                active: true,
                source_label: self.source_label.clone(),
                display_id: None,
                message: None,
            }
        }

        pub fn features(&self) -> SystemAudioFeatures {
            let _ = &self.stream;
            self.analyzer
                .lock()
                .map(|analyzer| analyzer.features())
                .unwrap_or_else(|_| {
                    SystemAudioFeatures::unavailable("Microphone analyzer lock poisoned")
                })
        }
    }

    fn select_input_device(
        host: &cpal::Host,
        requested_label: Option<&str>,
    ) -> Result<cpal::Device, String> {
        let requested_label = requested_label
            .map(str::trim)
            .filter(|label| !label.is_empty());
        if let Some(label) = requested_label {
            let label_lower = label.to_lowercase();
            let devices = host
                .input_devices()
                .map_err(|error| format!("Could not enumerate microphone devices: {error}"))?;
            for device in devices {
                let name = cpal_device_label(&device);
                let name_lower = name.to_lowercase();
                if name_lower == label_lower
                    || name_lower.contains(&label_lower)
                    || label_lower.contains(&name_lower)
                {
                    return Ok(device);
                }
            }
        }

        host.default_input_device()
            .ok_or_else(|| "No default microphone input device found".to_string())
    }

    fn cpal_device_label(device: &cpal::Device) -> String {
        device
            .description()
            .map(|description| description.name().to_string())
            .unwrap_or_else(|_| device.to_string())
    }

    fn build_input_stream_f32(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[f32], _| {
                    process_interleaved_f32(data, channels, sample_rate, &analyzer)
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn build_input_stream_f64(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[f64], _| {
                    let converted: Vec<f32> = data.iter().map(|value| *value as f32).collect();
                    process_interleaved_f32(&converted, channels, sample_rate, &analyzer);
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn build_input_stream_i16(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[i16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|value| *value as f32 / i16::MAX as f32)
                        .collect();
                    process_interleaved_f32(&converted, channels, sample_rate, &analyzer);
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn build_input_stream_i32(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[i32], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|value| *value as f32 / i32::MAX as f32)
                        .collect();
                    process_interleaved_f32(&converted, channels, sample_rate, &analyzer);
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn build_input_stream_u16(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|value| (*value as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    process_interleaved_f32(&converted, channels, sample_rate, &analyzer);
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn build_input_stream_u32(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        channels: usize,
        sample_rate: f32,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_input_stream(
                config.clone(),
                move |data: &[u32], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|value| (*value as f32 / u32::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    process_interleaved_f32(&converted, channels, sample_rate, &analyzer);
                },
                input_stream_error,
                None,
            )
            .map_err(|error| format!("Could not build microphone input stream: {error}"))
    }

    fn process_interleaved_f32(
        data: &[f32],
        channels: usize,
        sample_rate: f32,
        analyzer: &Arc<Mutex<AudioFeatureAnalyzer>>,
    ) {
        if data.is_empty() {
            return;
        }
        let mono = downmix_interleaved(data, channels.max(1));
        let sample_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            DEFAULT_AUDIO_SAMPLE_RATE
        };
        if let Ok(mut analyzer) = analyzer.lock() {
            analyzer.process(&mono, sample_rate);
        }
    }

    fn downmix_interleaved(samples: &[f32], channels: usize) -> Vec<f32> {
        if channels <= 1 {
            return samples.iter().map(|value| value.clamp(-1.0, 1.0)).collect();
        }
        samples
            .chunks(channels)
            .map(|frame| {
                let sum = frame.iter().copied().sum::<f32>();
                (sum / frame.len().max(1) as f32).clamp(-1.0, 1.0)
            })
            .collect()
    }

    fn input_stream_error(error: cpal::Error) {
        eprintln!("[ASCILINE audio] microphone input stream error: {error}");
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AudioFeatureAnalyzer, SystemAudioFeatures, SystemAudioStartResponse};
    use screencapturekit::prelude::{
        CMSampleBuffer, CMSampleBufferExt, SCContentFilter, SCShareableContent, SCStream,
        SCStreamOutputType,
    };
    use screencapturekit::stream::configuration::{
        AudioChannelCount, AudioSampleRate, PixelFormat, SCStreamConfiguration,
    };
    use std::sync::{Arc, Mutex};

    const SAMPLE_RATE: f32 = 48_000.0;

    pub struct SystemAudioSession {
        stream: SCStream,
        analyzer: Arc<Mutex<AudioFeatureAnalyzer>>,
        display_id: u32,
        source_label: String,
    }

    impl SystemAudioSession {
        pub fn start() -> Result<Self, String> {
            let content = SCShareableContent::get().map_err(|error| {
                format!(
                    "Native system audio needs macOS Screen & System Audio Recording permission for ASCII VJ Remix: {error}"
                )
            })?;
            let display =
                content.displays().into_iter().next().ok_or_else(|| {
                    "No capturable display found for native system audio".to_string()
                })?;
            let display_id = display.display_id();
            let source_label = format!("System audio display {display_id}");
            let filter = SCContentFilter::create()
                .with_display(&display)
                .with_excluding_windows(&[])
                .build();
            let config = SCStreamConfiguration::new()
                .with_width(display.width())
                .with_height(display.height())
                .with_pixel_format(PixelFormat::BGRA)
                .with_captures_audio(true)
                .with_excludes_current_process_audio(true)
                .with_sample_rate(AudioSampleRate::Rate48000)
                .with_channel_count(AudioChannelCount::Stereo);

            let analyzer = Arc::new(Mutex::new(AudioFeatureAnalyzer::new(source_label.clone())));
            let handler_analyzer = analyzer.clone();
            let mut stream = SCStream::new(&filter, &config);
            let registered = stream.add_output_handler(
                move |sample: CMSampleBuffer, output_type: SCStreamOutputType| {
                    if output_type != SCStreamOutputType::Audio {
                        return;
                    }
                    let Some(audio_buffers) = sample.audio_buffer_list() else {
                        return;
                    };
                    let samples = pcm_samples_from_audio_buffers(&audio_buffers);
                    if samples.is_empty() {
                        return;
                    }
                    if let Ok(mut analyzer) = handler_analyzer.lock() {
                        analyzer.process(&samples, SAMPLE_RATE);
                    }
                },
                SCStreamOutputType::Audio,
            );
            if registered.is_none() {
                return Err(
                    "ScreenCaptureKit rejected native system audio output registration".to_string(),
                );
            }

            stream
                .start_capture()
                .map_err(|error| format!("Could not start native system audio capture: {error}"))?;

            Ok(Self {
                stream,
                analyzer,
                display_id,
                source_label,
            })
        }

        pub fn response(&self) -> SystemAudioStartResponse {
            SystemAudioStartResponse {
                available: true,
                active: true,
                source_label: self.source_label.clone(),
                display_id: Some(self.display_id),
                message: None,
            }
        }

        pub fn features(&self) -> SystemAudioFeatures {
            self.analyzer
                .lock()
                .map(|analyzer| analyzer.features())
                .unwrap_or_else(|_| {
                    SystemAudioFeatures::unavailable("System audio analyzer lock poisoned")
                })
        }
    }

    impl Drop for SystemAudioSession {
        fn drop(&mut self) {
            let _ = self.stream.stop_capture();
        }
    }

    fn pcm_samples_from_audio_buffers(buffers: &screencapturekit::AudioBufferList) -> Vec<f32> {
        if buffers.num_buffers() == 0 {
            return Vec::new();
        }

        let decoded: Vec<Vec<f32>> = buffers
            .iter()
            .map(|buffer| {
                let samples = decode_pcm_bytes(buffer.data());
                downmix_interleaved(&samples, buffer.number_channels.max(1) as usize)
            })
            .filter(|samples| !samples.is_empty())
            .collect();

        if decoded.is_empty() {
            return Vec::new();
        }
        if decoded.len() == 1 {
            return decoded.into_iter().next().unwrap_or_default();
        }

        let frames = decoded.iter().map(Vec::len).min().unwrap_or(0);
        let mut mono = Vec::with_capacity(frames);
        for index in 0..frames {
            let sum = decoded.iter().map(|channel| channel[index]).sum::<f32>();
            mono.push((sum / decoded.len() as f32).clamp(-1.0, 1.0));
        }
        mono
    }

    fn decode_pcm_bytes(bytes: &[u8]) -> Vec<f32> {
        if bytes.len() >= 4 && bytes.len() % 4 == 0 {
            let mut out = Vec::with_capacity(bytes.len() / 4);
            let mut believable = 0usize;
            for chunk in bytes.chunks_exact(4) {
                let value = f32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                if value.is_finite() && value.abs() <= 8.0 {
                    believable += 1;
                }
                out.push(value.clamp(-1.0, 1.0));
            }
            if believable.saturating_mul(10) >= out.len().saturating_mul(9) {
                return out;
            }
        }

        if bytes.len() >= 2 && bytes.len() % 2 == 0 {
            return bytes
                .chunks_exact(2)
                .map(|chunk| i16::from_ne_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
                .map(|value| value.clamp(-1.0, 1.0))
                .collect();
        }

        Vec::new()
    }

    fn downmix_interleaved(samples: &[f32], channels: usize) -> Vec<f32> {
        if channels <= 1 {
            return samples.to_vec();
        }
        samples
            .chunks(channels)
            .map(|frame| {
                let sum = frame.iter().copied().sum::<f32>();
                (sum / frame.len().max(1) as f32).clamp(-1.0, 1.0)
            })
            .collect()
    }
}
