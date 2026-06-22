fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("native/native_camera.m")
            .file("native/native_output_view.m")
            .flag("-fobjc-arc")
            .flag("-Wno-deprecated-declarations")
            .compile("asciline_native_camera");
        println!("cargo:rerun-if-changed=native/native_camera.m");
        println!("cargo:rerun-if-changed=native/native_output_view.m");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreVideo");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "select_media_file",
            "list_media_files",
            "forget_media_file",
            "probe_registered_media",
            "preview_registered_media",
            "start_registered_media_session",
            "read_media_session_frame",
            "read_media_session_frames",
            "stop_media_session",
            "list_media_sessions",
            "request_media_permission",
            "record_media_diagnostic",
            "start_system_audio_capture",
            "read_system_audio_features",
            "stop_system_audio_capture",
        ]),
    ))
    .expect("failed to run Tauri build script")
}
