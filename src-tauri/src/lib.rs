pub mod commands;
pub mod db;
pub mod dedup;
pub mod diagnostics;
pub mod errors;
pub mod executors;
pub mod migrations;
pub mod models;
pub mod paths;
pub mod queue;
pub mod render_planner;
pub mod secret_store;
pub mod state;

use commands::*;
use state::AppState;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Chào mừng bạn đến với Xitrum AI Studio!", name)
}

#[tauri::command]
async fn test_ffmpeg_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar: {e}"))?
        .args(["-version"]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Failed to execute sidecar: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let first_line = stdout.lines().next().unwrap_or("ffmpeg unknown version");
        Ok(first_line.to_string())
    } else {
        Err("ffmpeg exited with failure status".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let temp_dir = std::env::temp_dir();
    let log_path = temp_dir.join("xitrum_debug.log");
    let file_appender = tracing_appender::rolling::never(&temp_dir, "xitrum_debug.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new("info,xitrum_ai_studio=debug"))
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stdout))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .try_init();

    tracing::info!("=== Xitrum AI Studio starting (Log: {:?}) ===", log_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .setup(move |app| {
            // R3: Chuyển DB sang thư mục dữ liệu app bền vững (AppLocalData/AppData) thay vì Temp
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| temp_dir.join("XitrumAI"));
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("xitrum_ai.db");
            let db_path_str = db_path.to_string_lossy().to_string();
            tracing::info!("Persistent Database path: {}", db_path_str);

            let app_state = AppState::new(&db_path_str, app.handle().clone());
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            test_ffmpeg_sidecar,
            check_muse_session,
            check_muse_session_by_cookie,
            analyze_image,
            get_lane_status,
            enqueue_task,
            cancel_task,
            retry_task,
            duplicate_task,
            edit_task_prompt,
            open_output_folder,
            save_template,
            list_templates,
            delete_template,
            list_audio_jobs,
            list_audio_segments,
            update_audio_segment,
            add_segment_to_queue,
            regenerate_segment,
            export_script,
            render_audio_job,
            list_tasks,
            get_settings,
            save_settings,
            save_script_project,
            get_script_project,
            list_script_projects,
            update_script_scene,
            update_character_ref_image,
            delete_script_project,
            list_tts_voices,
            generate_scene_tts,
            preview_tts_voice,
            generate_whiteboard_srt_tts,
            retime_whiteboard_annotation,
            add_proxies,
            list_proxies,
            test_proxy,
            delete_proxy,
            delete_dead_proxies,
            dispatch_script_to_queue,
            render_script_postproduction,
            analyze_whiteboard_image,
            parse_whiteboard_srt,
            inspect_whiteboard_wb_import,
            generate_whiteboard_annotation,
            render_whiteboard_scene,
            render_whiteboard_preview,
            merge_whiteboard_scenes,
            read_whiteboard_cover_image,
            scan_whiteboard_folder_images,
            import_whiteboard_complete_thumbnail,
            save_whiteboard_project,
            save_whiteboard_annotation,
            load_whiteboard_project,
            render_whiteboard_project,
            validate_whiteboard_project_v1,
            export_whiteboard_project,
            save_whiteboard_project_v1,
            load_whiteboard_project_v1,
            cancel_whiteboard,
            check_whiteboard_env,
            install_whiteboard_env,
            check_file_exists,
            check_system_dependencies,
            save_os_secret,
            delete_os_secret,
            has_os_secret,
            list_provider_descriptors,
            list_accounts,
            save_account,
            delete_account,
            check_account_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
