use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::panic;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const CRASH_RELAY_ENDPOINT: &str = "https://crash.dustwave.xyz/v1/reports";
const APP_IDENTIFIER: &str = "com.asciline.remix";
const MAX_REPORTS: usize = 10;
const MAX_TEXT_CHARS: usize = 1000;
const MAX_STACK_CHARS: usize = 6000;
const MAX_CONTEXT_KEYS: usize = 40;
const MAX_CONTEXT_DEPTH: usize = 4;
const MAX_QUEUE_BYTES: usize = 256 * 1024;
const REPORT_DIR: &str = "crash-reports";
const QUEUE_FILE: &str = "queue.json";
const PREF_FILE: &str = "preference.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportInput {
    pub kind: Option<String>,
    pub surface: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCrashReport {
    pub id: String,
    pub kind: String,
    pub surface: String,
    pub message: String,
    pub stack: String,
    pub captured_at: String,
    pub context: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashPreference {
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportState {
    pub available: bool,
    pub production: bool,
    pub endpoint: String,
    pub preference: String,
    pub pending_count: usize,
    pub reports: Vec<StoredCrashReport>,
    pub last_result: Option<CrashSubmitSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashSubmitSummary {
    pub attempted: usize,
    pub submitted: usize,
    pub failed: usize,
    pub results: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayPayload {
    app: RelayApp,
    report: StoredCrashReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayApp {
    name: String,
    version: String,
    identifier: String,
    channel: String,
    build_profile: String,
    os: String,
    arch: String,
}

pub fn install_panic_hook(data_dir: PathBuf) {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let report = panic_report(info);
        let _ = write_panic_report(&data_dir, &report);
        previous(info);
    }));
}

#[tauri::command]
pub fn get_crash_report_state<R: Runtime>(app: AppHandle<R>) -> Result<CrashReportState, String> {
    import_panic_reports(&app)?;
    state(&app, None)
}

#[tauri::command]
pub fn set_crash_report_preference<R: Runtime>(
    app: AppHandle<R>,
    preference: String,
) -> Result<CrashReportState, String> {
    let mode = normalize_preference(&preference);
    write_json(&pref_path(&app)?, &CrashPreference { mode })?;
    state(&app, None)
}

#[tauri::command]
pub fn capture_crash_report<R: Runtime>(
    app: AppHandle<R>,
    report: CrashReportInput,
) -> Result<CrashReportState, String> {
    import_panic_reports(&app)?;
    let stored = sanitize_report(report);
    let mut queue = read_queue(&app)?;
    if !queue.iter().any(|item| item.id == stored.id) {
        queue.push(stored);
    }
    queue = bounded_queue(queue);
    write_queue(&app, &queue)?;
    state(&app, None)
}

#[tauri::command]
pub fn discard_crash_reports<R: Runtime>(app: AppHandle<R>) -> Result<CrashReportState, String> {
    write_queue(&app, &[])?;
    state(&app, None)
}

#[tauri::command]
pub async fn submit_crash_reports<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CrashReportState, String> {
    import_panic_reports(&app)?;
    let production = production_submission_enabled();
    let mut queue = read_queue(&app)?;
    if !production {
        return state(
            &app,
            Some(CrashSubmitSummary {
                attempted: queue.len(),
                submitted: 0,
                failed: queue.len(),
                results: vec![json!({
                    "ok": false,
                    "error": "Crash report submission is disabled for non-production builds"
                })],
            }),
        );
    }
    if queue.is_empty() {
        return state(
            &app,
            Some(CrashSubmitSummary {
                attempted: 0,
                submitted: 0,
                failed: 0,
                results: Vec::new(),
            }),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(format!(
            "ASCII VJ Remix/{}",
            app.package_info().version
        ))
        .build()
        .map_err(|error| format!("Could not build crash reporter client: {error}"))?;
    let app_info = relay_app(&app);
    let mut remaining = Vec::new();
    let mut results = Vec::new();
    let mut submitted = 0usize;

    for report in queue.drain(..) {
        let payload = RelayPayload {
            app: app_info.clone(),
            report: report.clone(),
        };
        let result = client
            .post(CRASH_RELAY_ENDPOINT)
            .json(&payload)
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                submitted += 1;
                let body = response.json::<Value>().await.unwrap_or_else(|_| json!({ "ok": true }));
                results.push(body);
            }
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                remaining.push(report);
                results.push(json!({
                    "ok": false,
                    "status": status,
                    "error": sanitize_text(&body, MAX_TEXT_CHARS)
                }));
            }
            Err(error) => {
                remaining.push(report);
                results.push(json!({
                    "ok": false,
                    "error": sanitize_text(&error.to_string(), MAX_TEXT_CHARS)
                }));
            }
        }
    }

    let failed = remaining.len();
    write_queue(&app, &bounded_queue(remaining))?;
    state(
        &app,
        Some(CrashSubmitSummary {
            attempted: submitted + failed,
            submitted,
            failed,
            results,
        }),
    )
}

fn production_submission_enabled() -> bool {
    !cfg!(debug_assertions)
}

fn state<R: Runtime>(
    app: &AppHandle<R>,
    last_result: Option<CrashSubmitSummary>,
) -> Result<CrashReportState, String> {
    let reports = read_queue(app)?;
    Ok(CrashReportState {
        available: true,
        production: production_submission_enabled(),
        endpoint: CRASH_RELAY_ENDPOINT.to_string(),
        preference: read_preference(app)?.mode,
        pending_count: reports.len(),
        reports,
        last_result,
    })
}

fn relay_app<R: Runtime>(app: &AppHandle<R>) -> RelayApp {
    RelayApp {
        name: app.package_info().name.to_string(),
        version: app.package_info().version.to_string(),
        identifier: APP_IDENTIFIER.to_string(),
        channel: "production".to_string(),
        build_profile: if production_submission_enabled() {
            "release"
        } else {
            "debug"
        }
        .to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

fn panic_report(info: &panic::PanicHookInfo<'_>) -> StoredCrashReport {
    let message = if let Some(value) = info.payload().downcast_ref::<&str>() {
        *value
    } else if let Some(value) = info.payload().downcast_ref::<String>() {
        value.as_str()
    } else {
        "Rust panic"
    };
    let location = info
        .location()
        .map(|location| format!("{}:{}:{}", location.file(), location.line(), location.column()))
        .unwrap_or_else(|| "unknown".to_string());
    StoredCrashReport {
        id: format!("panic-{}", now_millis()),
        kind: "rust-panic".to_string(),
        surface: "panic-hook".to_string(),
        message: sanitize_text(message, MAX_TEXT_CHARS),
        stack: sanitize_text(&location, MAX_STACK_CHARS),
        captured_at: now_isoish(),
        context: json!({ "location": sanitize_text(&location, 240) }),
    }
}

fn sanitize_report(input: CrashReportInput) -> StoredCrashReport {
    let kind = normalize_kind(input.kind.as_deref().unwrap_or("frontend-error"));
    let surface = normalize_surface(input.surface.as_deref().unwrap_or("frontend"));
    StoredCrashReport {
        id: format!("crash-{}", now_millis()),
        kind,
        surface,
        message: sanitize_text(
            input.message.as_deref().unwrap_or("Crash report"),
            MAX_TEXT_CHARS,
        ),
        stack: sanitize_text(input.stack.as_deref().unwrap_or(""), MAX_STACK_CHARS),
        captured_at: now_isoish(),
        context: sanitize_value(input.context.unwrap_or_else(|| json!({})), 0),
    }
}

fn normalize_kind(value: &str) -> String {
    match sanitize_text(value, 80).to_lowercase().as_str() {
        "frontend-error" => "frontend-error",
        "unhandled-rejection" => "unhandled-rejection",
        "tauri-command" => "tauri-command",
        "rust-panic" => "rust-panic",
        "renderer-error" => "renderer-error",
        "native-output-error" => "native-output-error",
        _ => "frontend-error",
    }
    .to_string()
}

fn normalize_surface(value: &str) -> String {
    match sanitize_text(value, 80).to_lowercase().as_str() {
        "frontend" => "frontend",
        "tauri-command" => "tauri-command",
        "renderer" => "renderer",
        "native-output" => "native-output",
        "startup" => "startup",
        "panic-hook" => "panic-hook",
        _ => "unknown",
    }
    .to_string()
}

fn normalize_preference(value: &str) -> String {
    match value {
        "always" => "always",
        "off" => "off",
        _ => "ask",
    }
    .to_string()
}

fn sanitize_text(value: &str, max_chars: usize) -> String {
    let mut sanitized = value
        .split_whitespace()
        .take(120)
        .map(|part| {
            if sensitive_part(part) {
                "[redacted]".to_string()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if sanitized.chars().count() > max_chars {
        sanitized = sanitized.chars().take(max_chars).collect::<String>();
        sanitized.push_str(" [truncated]");
    }
    sanitized
}

fn sensitive_part(part: &str) -> bool {
    let lower = part.to_lowercase();
    lower.contains("://")
        || lower.starts_with('/')
        || lower.starts_with('~')
        || lower.contains(":\\")
        || lower.contains("\"/")
        || lower.contains("'/")
        || lower.contains("=/")
        || lower.contains("file:")
        || lower.contains("/users/")
        || lower.contains("/volumes/")
        || lower.contains("/private/")
        || lower.contains("/tmp/")
        || lower.contains("\\users\\")
        || lower.contains('@')
}

fn sanitize_value(value: Value, depth: usize) -> Value {
    if depth > MAX_CONTEXT_DEPTH {
        return Value::String("[truncated]".to_string());
    }
    match value {
        Value::Null | Value::Bool(_) => value,
        Value::Number(number) => {
            if number.as_f64().is_some_and(f64::is_finite) {
                Value::Number(number)
            } else {
                Value::Null
            }
        }
        Value::String(text) => Value::String(sanitize_text(&text, 500)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(20)
                .map(|item| sanitize_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, raw_value) in map.into_iter().take(MAX_CONTEXT_KEYS) {
                let clean_key = sanitize_key(&key);
                if clean_key.is_empty() {
                    continue;
                }
                if key.to_lowercase().contains("token")
                    || key.to_lowercase().contains("secret")
                    || key.to_lowercase().contains("password")
                    || key.to_lowercase().contains("cookie")
                    || key.to_lowercase().contains("auth")
                {
                    out.insert(clean_key, Value::String("[redacted]".to_string()));
                } else {
                    out.insert(clean_key, sanitize_value(raw_value, depth + 1));
                }
            }
            Value::Object(out)
        }
    }
}

fn sanitize_key(key: &str) -> String {
    key.chars()
        .take(80)
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn bounded_queue(mut queue: Vec<StoredCrashReport>) -> Vec<StoredCrashReport> {
    if queue.len() > MAX_REPORTS {
        queue = queue.split_off(queue.len() - MAX_REPORTS);
    }
    while serde_json::to_vec(&queue).map_or(0, |bytes| bytes.len()) > MAX_QUEUE_BYTES && !queue.is_empty() {
        queue.remove(0);
    }
    queue
}

fn app_report_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data dir: {error}"))?
        .join(REPORT_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create crash report dir: {error}"))?;
    Ok(dir)
}

fn queue_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app_report_dir(app)?.join(QUEUE_FILE))
}

fn pref_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app_report_dir(app)?.join(PREF_FILE))
}

fn read_queue<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<StoredCrashReport>, String> {
    read_json(&queue_path(app)?).map(|queue| bounded_queue(queue.unwrap_or_default()))
}

fn write_queue<R: Runtime>(app: &AppHandle<R>, queue: &[StoredCrashReport]) -> Result<(), String> {
    write_json(&queue_path(app)?, &bounded_queue(queue.to_vec()))
}

fn read_preference<R: Runtime>(app: &AppHandle<R>) -> Result<CrashPreference, String> {
    Ok(read_json(&pref_path(app)?)?.unwrap_or_else(|| CrashPreference {
        mode: "ask".to_string(),
    }))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| format!("Could not encode JSON: {error}"))?;
    fs::write(path, bytes).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn write_panic_report(data_dir: &Path, report: &StoredCrashReport) -> Result<(), String> {
    let dir = data_dir.join(REPORT_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create panic dir: {error}"))?;
    write_json(&dir.join(format!("{}.json", report.id)), report)
}

fn import_panic_reports<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = app_report_dir(app)?;
    let mut queue = read_queue(app)?;
    let entries = fs::read_dir(&dir).map_err(|error| format!("Could not scan crash report dir: {error}"))?;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("panic-") || !name.ends_with(".json") {
            continue;
        }
        if let Ok(Some(report)) = read_json::<StoredCrashReport>(&path) {
            if !queue.iter().any(|item| item.id == report.id) {
                queue.push(report);
            }
        }
        let _ = fs::remove_file(path);
    }
    write_queue(app, &bounded_queue(queue))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

fn now_isoish() -> String {
    format!("{}ms", now_millis())
}

#[cfg(test)]
mod tests {
    use super::{sanitize_report, sanitize_text, CrashReportInput};
    use serde_json::json;

    #[test]
    fn sanitizer_redacts_paths_urls_and_secret_context() {
        let report = sanitize_report(CrashReportInput {
            kind: Some("tauri-command".to_string()),
            surface: Some("tauri-command".to_string()),
            message: Some("failed file:///Users/alice/private.mov alice@example.com".to_string()),
            stack: Some("/Users/alice/app.js:1:2".to_string()),
            context: Some(json!({
                "command": "start_registered_media_session",
                "token": "secret",
                "mediaUrl": "asset://localhost/private.mov"
            })),
        });

        assert_eq!(report.kind, "tauri-command");
        assert!(report.message.contains("[redacted]"));
        assert!(report.stack.contains("[redacted]"));
        assert_eq!(report.context["token"], "[redacted]");
        assert_eq!(report.context["mediaUrl"], "[redacted]");
    }

    #[test]
    fn sanitizer_bounds_long_text() {
        let sanitized = sanitize_text(&"a".repeat(2000), 100);
        assert!(sanitized.ends_with("[truncated]"));
    }
}
