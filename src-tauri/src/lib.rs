pub mod commands;
pub mod db;
pub mod errors;
pub mod executors;
pub mod models;
pub mod queue;
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
            // Lưu database file vào temp_dir hoặc app_data để tránh kích hoạt file watcher của Tauri dev
            let db_path = temp_dir.join("xitrum_ai.db");
            let db_path_str = db_path.to_string_lossy().to_string();
            tracing::info!("Database path: {}", db_path_str);

            let app_state = AppState::new(&db_path_str, app.handle().clone());
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            test_ffmpeg_sidecar,
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
            export_script,
            list_tasks,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
