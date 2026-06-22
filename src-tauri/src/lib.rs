pub mod ci_smoke;
pub mod desktop_bridge;
pub mod media_engine;
pub mod media_permissions;
pub mod native_output;
pub mod system_audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(desktop_bridge::MediaRegistry::default())
        .manage(desktop_bridge::MediaSessions::default())
        .manage(desktop_bridge::RawVideoSessions::default())
        .manage(native_output::NativeOutputState::default())
        .manage(system_audio::SystemAudioCaptureState::default())
        .manage(system_audio::InputAudioCaptureState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            ci_smoke::maybe_spawn(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_bridge::select_media_file,
            desktop_bridge::list_media_files,
            desktop_bridge::forget_media_file,
            desktop_bridge::probe_registered_media,
            desktop_bridge::preview_registered_media,
            desktop_bridge::start_registered_media_session,
            desktop_bridge::read_media_session_frame,
            desktop_bridge::read_media_session_frames,
            desktop_bridge::stop_media_session,
            desktop_bridge::list_media_sessions,
            desktop_bridge::start_raw_video_session,
            desktop_bridge::read_raw_video_frames,
            desktop_bridge::stop_raw_video_session,
            media_permissions::request_media_permission,
            media_permissions::record_media_diagnostic,
            native_output::open_native_output_window,
            native_output::update_native_output_window,
            native_output::update_native_output_frame,
            native_output::update_native_output_pixels,
            system_audio::start_system_audio_capture,
            system_audio::read_system_audio_features,
            system_audio::stop_system_audio_capture,
            system_audio::start_input_audio_capture,
            system_audio::read_input_audio_features,
            system_audio::stop_input_audio_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ASCII VJ Remix");
}
