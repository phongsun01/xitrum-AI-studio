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

        // Bước 2: Xác định model Whisper (F9)
        let model_file = match model_name.unwrap_or("ggml-tiny") {
            "ggml-base" => "ggml-base.bin",
            "ggml-medium" => "ggml-medium.bin",
            _ => "ggml-tiny.bin",
        };
        let model_dir = "D:\\Antigravity\\REA\\REA-project\\poc-phase0\\tools\\whisper\\models";
        let target_model_path = Path::new(model_dir).join(model_file);
        let final_model_path = if target_model_path.exists() {
            target_model_path
        } else {
            tracing::warn!("Model {:?} không tồn tại, fallback về ggml-tiny.bin", target_model_path);
            Path::new(model_dir).join("ggml-tiny.bin")
        };
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
}
