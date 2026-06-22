use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPermissionResponse {
    pub available: bool,
    pub kind: String,
    pub status: String,
}

impl MediaPermissionResponse {
    fn unavailable(kind: &str) -> Self {
        Self {
            available: false,
            kind: kind.to_string(),
            status: "unsupported".to_string(),
        }
    }
}

#[tauri::command]
pub async fn request_media_permission<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
) -> Result<MediaPermissionResponse, String> {
    eprintln!("[ASCILINE media] request_media_permission({kind})");
    request_platform_media_permission(app, kind).await
}

#[tauri::command]
pub fn record_media_diagnostic(message: String) -> Result<(), String> {
    let line = format!("[ASCILINE media] {message}\n");
    eprint!("{line}");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/asciline-media-diagnostics.log")
        .map_err(|error| format!("Could not open media diagnostics log: {error}"))?;
    file.write_all(line.as_bytes())
        .map_err(|error| format!("Could not write media diagnostics log: {error}"))
}

#[cfg(target_os = "macos")]
async fn request_platform_media_permission<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
) -> Result<MediaPermissionResponse, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || macos::request_media_permission(kind, tx))
        .map_err(|error| format!("Could not schedule macOS media permission request: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(65))
            .map_err(|_| "Timed out waiting for macOS media permission".to_string())?
    })
    .await
    .map_err(|error| format!("Media permission task failed: {error}"))?
}

#[cfg(not(target_os = "macos"))]
async fn request_platform_media_permission<R: Runtime>(
    _app: AppHandle<R>,
    kind: String,
) -> Result<MediaPermissionResponse, String> {
    Ok(MediaPermissionResponse::unavailable(kind))
}

#[cfg(target_os = "macos")]
mod macos {
    use super::MediaPermissionResponse;
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use std::sync::mpsc::Sender;

    const AV_AUTHORIZATION_STATUS_NOT_DETERMINED: isize = 0;
    const AV_AUTHORIZATION_STATUS_RESTRICTED: isize = 1;
    const AV_AUTHORIZATION_STATUS_DENIED: isize = 2;
    const AV_AUTHORIZATION_STATUS_AUTHORIZED: isize = 3;

    pub fn request_media_permission(
        kind: String,
        tx: Sender<Result<MediaPermissionResponse, String>>,
    ) {
        let Some((normalized_kind, media_type_value)) = media_type_for_kind(kind.as_str()) else {
            let _ = tx.send(Ok(MediaPermissionResponse::unavailable(kind.as_str())));
            return;
        };

        let media_type = NSString::from_str(media_type_value);
        let status = authorization_status(&media_type);
        eprintln!(
            "[ASCILINE media] {normalized_kind} authorization status before request: {}",
            status_label(status)
        );
        if status != AV_AUTHORIZATION_STATUS_NOT_DETERMINED {
            let _ = tx.send(Ok(response(normalized_kind, status)));
            return;
        }

        request_access(&media_type, normalized_kind, tx);
    }

    fn media_type_for_kind(kind: &str) -> Option<(&'static str, &'static str)> {
        match kind {
            "microphone" | "audio" | "mic" => Some(("microphone", "soun")),
            "camera" | "video" => Some(("camera", "vide")),
            _ => None,
        }
    }

    fn authorization_status(media_type: &NSString) -> isize {
        let status: i32 = unsafe {
            msg_send![
                class!(AVCaptureDevice),
                authorizationStatusForMediaType: media_type
            ]
        };
        status as isize
    }

    fn request_access(
        media_type: &NSString,
        normalized_kind: &'static str,
        tx: Sender<Result<MediaPermissionResponse, String>>,
    ) {
        let completion = RcBlock::new(move |granted: Bool| {
            eprintln!(
                "[ASCILINE media] {normalized_kind} request completed: {}",
                if granted.as_bool() {
                    "granted"
                } else {
                    "denied"
                }
            );
            let _ = tx.send(Ok(MediaPermissionResponse {
                available: true,
                kind: normalized_kind.to_string(),
                status: if granted.as_bool() {
                    "granted"
                } else {
                    "denied"
                }
                .to_string(),
            }));
        });
        let _: () = unsafe {
            msg_send![
                class!(AVCaptureDevice),
                requestAccessForMediaType: media_type,
                completionHandler: &*completion
            ]
        };
    }

    fn response(kind: &str, status: isize) -> MediaPermissionResponse {
        MediaPermissionResponse {
            available: true,
            kind: kind.to_string(),
            status: status_label(status).to_string(),
        }
    }

    fn status_label(status: isize) -> &'static str {
        match status {
            AV_AUTHORIZATION_STATUS_AUTHORIZED => "granted",
            AV_AUTHORIZATION_STATUS_DENIED => "denied",
            AV_AUTHORIZATION_STATUS_RESTRICTED => "restricted",
            AV_AUTHORIZATION_STATUS_NOT_DETERMINED => "prompt",
            _ => "unknown",
        }
    }
}
