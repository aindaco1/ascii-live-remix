use super::{DecodedRgbFrame, NativeCameraSource};

#[derive(Debug)]
pub(super) struct NativeCameraFrameReader {
    inner: platform::NativeCameraFrameReader,
}

impl NativeCameraFrameReader {
    pub(super) fn start(source: &NativeCameraSource) -> Result<Self, String> {
        platform::NativeCameraFrameReader::start(source).map(|inner| Self { inner })
    }

    pub(super) fn read_latest_frame(&mut self) -> Result<Option<DecodedRgbFrame>, String> {
        self.inner.read_latest_frame()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{DecodedRgbFrame, NativeCameraSource};
    use std::ffi::{c_char, c_void, CString};
    use std::ptr::NonNull;

    const ERROR_BUFFER_LEN: usize = 1024;

    #[link(name = "asciline_native_camera", kind = "static")]
    extern "C" {
        fn asciline_native_camera_start(
            device_label: *const c_char,
            capture_width: u32,
            capture_height: u32,
            capture_fps: f64,
            error: *mut c_char,
            error_len: usize,
        ) -> *mut c_void;
        fn asciline_native_camera_latest_metadata(
            handle: *mut c_void,
            width: *mut u32,
            height: *mut u32,
            sequence: *mut u64,
            age_ms: *mut f64,
        ) -> bool;
        fn asciline_native_camera_copy_latest(
            handle: *mut c_void,
            dst: *mut u8,
            dst_len: usize,
            width: *mut u32,
            height: *mut u32,
            sequence: *mut u64,
            age_ms: *mut f64,
        ) -> bool;
        fn asciline_native_camera_stop(handle: *mut c_void);
    }

    #[derive(Debug)]
    pub(super) struct NativeCameraFrameReader {
        handle: NonNull<c_void>,
        buffer: Vec<u8>,
        last_sequence: u64,
    }

    impl NativeCameraFrameReader {
        pub(super) fn start(source: &NativeCameraSource) -> Result<Self, String> {
            let label = source
                .device_label
                .as_ref()
                .map(|label| CString::new(label.as_str()))
                .transpose()
                .map_err(|_| "Native camera device label contains a NUL byte".to_string())?;
            let mut error = vec![0 as c_char; ERROR_BUFFER_LEN];
            let handle = unsafe {
                asciline_native_camera_start(
                    label
                        .as_ref()
                        .map_or(std::ptr::null(), |label| label.as_ptr()),
                    source.output_width,
                    source.output_height,
                    source.capture_fps,
                    error.as_mut_ptr(),
                    error.len(),
                )
            };
            let handle = NonNull::new(handle).ok_or_else(|| {
                let message = c_error_message(&error);
                if message.is_empty() {
                    "Native camera capture did not start".to_string()
                } else {
                    message
                }
            })?;
            Ok(Self {
                handle,
                buffer: Vec::new(),
                last_sequence: 0,
            })
        }

        pub(super) fn read_latest_frame(&mut self) -> Result<Option<DecodedRgbFrame>, String> {
            let mut width = 0u32;
            let mut height = 0u32;
            let mut sequence = 0u64;
            let mut age_ms = 0f64;
            let has_frame = unsafe {
                asciline_native_camera_latest_metadata(
                    self.handle.as_ptr(),
                    &mut width,
                    &mut height,
                    &mut sequence,
                    &mut age_ms,
                )
            };
            if !has_frame || sequence == self.last_sequence {
                return Ok(None);
            }
            let len = checked_rgb_len(width, height)?;
            if self.buffer.len() != len {
                self.buffer.resize(len, 0);
            }

            let copied = unsafe {
                asciline_native_camera_copy_latest(
                    self.handle.as_ptr(),
                    self.buffer.as_mut_ptr(),
                    self.buffer.len(),
                    &mut width,
                    &mut height,
                    &mut sequence,
                    &mut age_ms,
                )
            };
            if !copied {
                return Ok(None);
            }
            let len = checked_rgb_len(width, height)?;
            if self.buffer.len() < len {
                return Err("Native camera frame grew during copy".to_string());
            }
            self.last_sequence = sequence;
            Ok(Some(DecodedRgbFrame {
                index: sequence as usize,
                width,
                height,
                data: self.buffer[..len].to_vec(),
            }))
        }
    }

    impl Drop for NativeCameraFrameReader {
        fn drop(&mut self) {
            unsafe { asciline_native_camera_stop(self.handle.as_ptr()) };
        }
    }

    fn checked_rgb_len(width: u32, height: u32) -> Result<usize, String> {
        width
            .max(1)
            .checked_mul(height.max(1))
            .and_then(|pixels| pixels.checked_mul(3))
            .map(|len| len as usize)
            .ok_or_else(|| "Native camera frame is too large".to_string())
    }

    fn c_error_message(error: &[c_char]) -> String {
        let bytes = error
            .iter()
            .map(|value| *value as u8)
            .take_while(|value| *value != 0)
            .collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).trim().to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{DecodedRgbFrame, NativeCameraSource};

    #[derive(Debug)]
    pub(super) struct NativeCameraFrameReader;

    impl NativeCameraFrameReader {
        pub(super) fn start(_source: &NativeCameraSource) -> Result<Self, String> {
            Err("Native camera capture is only implemented on macOS".to_string())
        }

        pub(super) fn read_latest_frame(&mut self) -> Result<Option<DecodedRgbFrame>, String> {
            Ok(None)
        }
    }
}
