use anyhow::Result;
use std::path::{Path, PathBuf};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio_util::sync::CancellationToken;

pub struct AudioPipeline {
    app: tauri::AppHandle,
}

impl AudioPipeline {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }

    /// Quy trình 2 bước:
    /// 1. FFmpeg chuyển đổi bất kỳ định dạng audio đầu vào sang WAV 16kHz Mono vào thư mục tạm ASCII
    /// 2. Whisper-cli xử lý WAV tạm bóc tách ra JSON timeline
    pub async fn process_stt<F>(
        &self,
        input_audio: &str,
        output_dir: &str,
        model_name: Option<&str>,
        progress_cb: F,
        token: &CancellationToken,
    ) -> Result<PathBuf>
    where
        F: Fn(u32),
    {
        progress_cb(15);
        let temp_dir = std::env::temp_dir();
        let unique_id = uuid::Uuid::new_v4().to_string();
        let temp_wav = temp_dir.join(format!("xitrum_audio_{}.wav", unique_id));
        let temp_wav_str = temp_wav.to_string_lossy().to_string();

        let out_json_base = Path::new(output_dir).join(format!("stt_{}", unique_id));
        let out_json_path = Path::new(output_dir).join(format!("stt_{}.json", unique_id));

        tracing::info!("FFmpeg: converting {} -> {}", input_audio, temp_wav_str);

        // Bước 1: Gọi FFmpeg Sidecar
        let (mut rx, child) = self
            .app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| anyhow::anyhow!("FFmpeg sidecar error: {e}"))?
            .args([
                "-y",
                "-i",
                input_audio,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                &temp_wav_str,
            ])
            .spawn()
            .map_err(|e| anyhow::anyhow!("Spawn FFmpeg error: {e}"))?;

        let mut ffmpeg_stderr = String::new();

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    let _ = child.kill();
                    let _ = std::fs::remove_file(&temp_wav);
                    return Err(anyhow::anyhow!("FFmpeg cancelled by user"));
                }
                event = rx.recv() => {
                    match event {
                        Some(CommandEvent::Stderr(bytes)) => {
                            ffmpeg_stderr.push_str(&String::from_utf8_lossy(&bytes));
                        }
                        Some(CommandEvent::Terminated(status)) => {
                            if !status.code.map(|c| c == 0).unwrap_or(false) {
                                tracing::error!("FFmpeg failed: {}", ffmpeg_stderr);
                                let _ = std::fs::remove_file(&temp_wav);
                                return Err(anyhow::anyhow!("FFmpeg error (code {:?}): {}", status.code, ffmpeg_stderr));
                            }
                            break;
                        }
                        None => break,
                        _ => {}
                    }
                }
            }
        }

        progress_cb(50);
        tracing::info!("FFmpeg done. Starting Whisper on {}", temp_wav_str);

        // Bước 2: Xác định model Whisper (F9) linh hoạt đường dẫn tương đối (B6)
        let model_file = match model_name.unwrap_or("ggml-tiny") {
            "ggml-base" => "ggml-base.bin",
            "ggml-medium" => "ggml-medium.bin",
            _ => "ggml-tiny.bin",
        };

        let candidate_dirs = [
            PathBuf::from("resources"),
            PathBuf::from("src-tauri/resources"),
            PathBuf::from("../src-tauri/resources"),
            PathBuf::from("models"),
            PathBuf::from("D:\\Antigravity\\REA\\REA-project\\poc-phase0\\tools\\whisper\\models"),
        ];

        let mut final_model_path: Option<PathBuf> = None;
        for dir in &candidate_dirs {
            let target = dir.join(model_file);
            if target.exists() {
                final_model_path = Some(target);
                break;
            }
        }

        // Fallback sang ggml-tiny.bin nếu model được chọn chưa tải
        if final_model_path.is_none() {
            for dir in &candidate_dirs {
                let target = dir.join("ggml-tiny.bin");
                if target.exists() {
                    tracing::warn!("Model {} không tồn tại, fallback về {:?}", model_file, target);
                    final_model_path = Some(target);
                    break;
                }
            }
        }

        let final_model_path = final_model_path
            .ok_or_else(|| anyhow::anyhow!("Không tìm thấy file model Whisper ({} hoặc ggml-tiny.bin)", model_file))?;
        let final_model_str = final_model_path.to_string_lossy().to_string();

        let out_json_base_str = out_json_base.to_string_lossy().to_string();

        let (mut rx_w, child_w) = self
            .app
            .shell()
            .sidecar("whisper-cli")
            .map_err(|e| anyhow::anyhow!("Whisper sidecar error: {e}"))?
            .args([
                "-m",
                &final_model_str,
                "-f",
                &temp_wav_str,
                "-oj",
                "-of",
                &out_json_base_str,
            ])
            .spawn()
            .map_err(|e| anyhow::anyhow!("Spawn Whisper error: {e}"))?;

        let mut whisper_stderr = String::new();

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    let _ = child_w.kill();
                    let _ = std::fs::remove_file(&temp_wav);
                    return Err(anyhow::anyhow!("Whisper cancelled by user"));
                }
                event = rx_w.recv() => {
                    match event {
                        Some(CommandEvent::Stderr(bytes)) => {
                            whisper_stderr.push_str(&String::from_utf8_lossy(&bytes));
                        }
                        Some(CommandEvent::Terminated(status)) => {
                            if !status.code.map(|c| c == 0).unwrap_or(false) {
                                tracing::error!("Whisper failed: {}", whisper_stderr);
                                let _ = std::fs::remove_file(&temp_wav);
                                return Err(anyhow::anyhow!("Whisper error (code {:?}): {}", status.code, whisper_stderr));
                            }
                            break;
                        }
                        None => break,
                        _ => {}
                    }
                }
            }
        }

        // Dọn dẹp file tạm
        let _ = std::fs::remove_file(&temp_wav);
        progress_cb(100);

        Ok(out_json_path)
    }

    /// F12 & F13: Ghép các video segments + file audio giọng đọc + nhạc nền tự động (F13)
    pub async fn render_video_concat(
        &self,
        video_paths: &[String],
        audio_path: &str,
        music_path: Option<&str>,
        music_volume: Option<f32>,
        output_file: &str,
        token: &CancellationToken,
    ) -> Result<PathBuf> {
        if video_paths.is_empty() {
            return Err(anyhow::anyhow!("Không có video segment nào để ghép"));
        }

        let temp_dir = std::env::temp_dir();
        let unique_id = uuid::Uuid::new_v4().to_string();
        let list_file = temp_dir.join(format!("concat_list_{}.txt", unique_id));

        // Chuẩn bị file list.txt cho FFmpeg concat demuxer
        let mut list_content = String::new();
        for p in video_paths {
            let normalized = p.replace('\\', "/");
            list_content.push_str(&format!("file '{}'\n", normalized));
        }
        std::fs::write(&list_file, list_content)?;

        let list_file_str = list_file.to_string_lossy().to_string();
        tracing::info!("FFmpeg concat demuxer file: {}", list_file_str);

        let mut args: Vec<String> = vec![
            "-y".into(),
            "-f".into(),
            "concat".into(),
            "-safe".into(),
            "0".into(),
            "-i".into(),
            list_file_str.clone(),
            "-i".into(),
            audio_path.to_string(),
        ];

        // Nếu có file nhạc nền (F13): thêm input thứ 3 và cấu hình bộ trộn amix
        if let Some(bgm) = music_path {
            if Path::new(bgm).exists() {
                args.push("-stream_loop".into());
                args.push("-1".into()); // Lặp nhạc nền nếu audio dài hơn bài nhạc
                args.push("-i".into());
                args.push(bgm.to_string());

                let vol = music_volume.unwrap_or(0.15).clamp(0.01, 1.0);
                // Giọng đọc kênh 1:a, Nhạc nền kênh 2:a hạ âm lượng và hòa trộn
                let filter_str = format!(
                    "[2:a]volume={:.2}[bgm];[1:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]",
                    vol
                );
                args.push("-filter_complex".into());
                args.push(filter_str);
                args.push("-map".into());
                args.push("0:v:0".into());
                args.push("-map".into());
                args.push("[aout]".into());
                args.push("-c:v".into());
                args.push("copy".into());
                args.push("-c:a".into());
                args.push("aac".into());
                args.push("-b:a".into());
                args.push("192k".into());
                args.push("-shortest".into());
                args.push(output_file.to_string());
            } else {
                args.extend([
                    "-c:v".into(),
                    "copy".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-shortest".into(),
                    output_file.to_string(),
                ]);
            }
        } else {
            args.extend([
                "-c:v".into(),
                "copy".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
                "-shortest".into(),
                output_file.to_string(),
            ]);
        }

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        let (mut rx, child) = self
            .app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| anyhow::anyhow!("FFmpeg sidecar error: {e}"))?
            .args(arg_refs)
            .spawn()
            .map_err(|e| anyhow::anyhow!("Spawn FFmpeg concat error: {e}"))?;

        let mut ffmpeg_stderr = String::new();

        loop {
            tokio::select! {
                _ = token.cancelled() => {
                    let _ = child.kill();
                    let _ = std::fs::remove_file(&list_file);
                    return Err(anyhow::anyhow!("Render video cancelled by user"));
                }
                event = rx.recv() => {
                    match event {
                        Some(CommandEvent::Stderr(bytes)) => {
                            ffmpeg_stderr.push_str(&String::from_utf8_lossy(&bytes));
                        }
                        Some(CommandEvent::Terminated(status)) => {
                            let _ = std::fs::remove_file(&list_file);
                            if !status.code.map(|c| c == 0).unwrap_or(false) {
                                tracing::error!("FFmpeg concat failed: {}", ffmpeg_stderr);
                                return Err(anyhow::anyhow!("FFmpeg concat error (code {:?}): {}", status.code, ffmpeg_stderr));
                            }
                            break;
                        }
                        None => {
                            let _ = std::fs::remove_file(&list_file);
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(PathBuf::from(output_file))
    }
}
