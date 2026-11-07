// ============================================================================
// Render Planner & Media Normalization Engine (G2 - Sesame Architecture)
// ============================================================================
// Đảm bảo:
// 1. Mốc thời gian nguyên millisecond (ms) chính xác, chống trôi sync audio/video/subtitles.
// 2. Chuẩn hóa video/audio trước khi concat:
//    - SAR 1:1, scale & pad fit canvas (16:9, 9:16, 1:1)
//    - Đưa về chuẩn fps=30, yuv420p
//    - Audio resample 44100Hz, stereo
// 3. Xử lý video ngắn/dài:
//    - Video ngắn hơn audio: freeze last frame (tpad/clone) hoặc loop, tuyệt đối không cắt lời.
//    - Video dài hơn audio: trim chính xác theo ms.
// 4. Sinh file SRT chuẩn từ chính RenderPlan (timeline trùng khớp 100%).
// 5. Phân định rõ Preview (cho phép placeholder) vs Final (chặn xuất nếu thiếu clip thực tế).
// 6. Manifest Provenance & dọn dẹp file tạm.
// ============================================================================

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneProvenance {
    pub scene_index: usize,
    pub scene_id: String,
    pub is_placeholder: bool,
    pub source_video_path: Option<String>,
    pub source_audio_path: Option<String>,
    pub video_duration_ms: u64,
    pub audio_duration_ms: u64,
    pub target_duration_ms: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub narration: String,
    pub policy_applied: String, // "freeze_frame", "trim", "placeholder"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderManifest {
    pub project_id: String,
    pub mode: String, // "preview" | "final"
    pub canvas_ratio: String, // "16:9" | "9:16" | "1:1"
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub total_duration_ms: u64,
    pub scene_count: usize,
    pub placeholder_count: usize,
    pub scenes: Vec<SceneProvenance>,
    pub warnings: Vec<String>,
    pub output_mp4: Option<String>,
    pub output_srt: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct RenderPlanItem {
    pub scene_index: usize,
    pub scene_id: String,
    pub video_path: Option<PathBuf>,
    pub audio_path: Option<PathBuf>,
    pub configured_duration_ms: u64,
    pub narration: String,
}

pub struct RenderPlanner;

impl RenderPlanner {
    /// Tính toán kích thước canvas chuẩn từ tỷ lệ khung hình
    pub fn resolve_canvas_dimensions(ratio: &str) -> (u32, u32) {
        match ratio {
            "9:16" => (720, 1280),
            "1:1" => (1080, 1080),
            _ => (1280, 720), // 16:9 mặc định
        }
    }

    /// Đọc thông tin thời lượng (duration) của file media qua FFmpeg
    pub async fn probe_media_duration_ms(app: &AppHandle, media_path: &Path) -> Result<u64, String> {
        if !media_path.exists() {
            return Err(format!("File không tồn tại: {}", media_path.display()));
        }

        let path_str = media_path.to_string_lossy().to_string();
        let output = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg sidecar error: {e}"))?
            .args(["-i", &path_str])
            .output()
            .await
            .map_err(|e| format!("Lỗi probe media {}: {e}", media_path.display()))?;

        // FFmpeg in thông tin media ra stderr kể cả khi exit code 1
        let stderr = String::from_utf8_lossy(&output.stderr);
        Self::parse_duration_from_ffmpeg_output(&stderr)
            .ok_or_else(|| format!("Không tìm thấy Duration trong media: {}", media_path.display()))
    }

    /// Phân tích cú pháp Duration: HH:MM:SS.ms từ output ffmpeg
    pub fn parse_duration_from_ffmpeg_output(output: &str) -> Option<u64> {
        let dur_idx = output.find("Duration: ")?;
        let after_dur = &output[dur_idx + 10..];
        let comma_idx = after_dur.find(',')?;
        let dur_str = after_dur[..comma_idx].trim(); // ví dụ "00:00:02.50"

        let parts: Vec<&str> = dur_str.split(':').collect();
        if parts.len() != 3 {
            return None;
        }

        let hours: u64 = parts[0].parse().ok()?;
        let minutes: u64 = parts[1].parse().ok()?;
        let sec_parts: Vec<&str> = parts[2].split('.').collect();
        let seconds: u64 = sec_parts[0].parse().ok()?;
        let millis: u64 = if sec_parts.len() > 1 {
            let frac = sec_parts[1];
            let parsed: u64 = frac.parse().ok()?;
            match frac.len() {
                1 => parsed * 100,
                2 => parsed * 10,
                3 => parsed,
                _ => frac[..3].parse().unwrap_or(0),
            }
        } else {
            0
        };

        Some((hours * 3600 + minutes * 60 + seconds) * 1000 + millis)
    }

    /// Lập kế hoạch RenderPlan với mốc thời gian integer millisecond chính xác
    pub async fn create_render_plan(
        app: &AppHandle,
        project_id: &str,
        mode: &str, // "preview" | "final"
        ratio: &str,
        items: &[RenderPlanItem],
    ) -> Result<RenderManifest, String> {
        let (canvas_w, canvas_h) = Self::resolve_canvas_dimensions(ratio);
        let mut scenes_provenance = Vec::new();
        let mut warnings = Vec::new();
        let mut current_timeline_ms: u64 = 0;
        let mut missing_scenes = Vec::new();

        for (idx, item) in items.iter().enumerate() {
            // 1. Kiểm tra audio & lấy duration thật
            let mut audio_dur_ms: u64 = 0;
            if let Some(ref a_path) = item.audio_path {
                if a_path.exists() {
                    match Self::probe_media_duration_ms(app, a_path).await {
                        Ok(d) => audio_dur_ms = d,
                        Err(e) => warnings.push(format!("Cảnh {}: Không đọc được audio ({})", idx + 1, e)),
                    }
                }
            }

            // 2. Kiểm tra video
            let mut video_dur_ms: u64 = 0;
            let mut has_real_video = false;
            if let Some(ref v_path) = item.video_path {
                if v_path.exists() {
                    match Self::probe_media_duration_ms(app, v_path).await {
                        Ok(d) => {
                            video_dur_ms = d;
                            has_real_video = true;
                        }
                        Err(e) => warnings.push(format!("Cảnh {}: Lỗi video clip ({})", idx + 1, e)),
                    }
                }
            }

            if !has_real_video {
                missing_scenes.push(idx + 1);
            }

            // 3. Tính toán target duration (ms)
            // Chính sách: Audio là chuẩn, không bao giờ được âm thầm cắt lời audio!
            let configured_ms = item.configured_duration_ms.max(2000);
            let target_dur_ms = if audio_dur_ms > 0 {
                // Thêm 300ms đệm đuôi để câu thoại không bị dứt cụt
                audio_dur_ms + 300
            } else if video_dur_ms > 0 {
                video_dur_ms
            } else {
                configured_ms
            };

            let start_ms = current_timeline_ms;
            let end_ms = start_ms + target_dur_ms;
            current_timeline_ms = end_ms;

            let policy = if !has_real_video {
                "placeholder".to_string()
            } else if video_dur_ms < target_dur_ms {
                "freeze_frame".to_string() // Video ngắn hơn audio: freeze last frame, giữ trọn vẹn giọng
            } else {
                "trim".to_string() // Video dài hơn audio: trim khớp audio
            };

            scenes_provenance.push(SceneProvenance {
                scene_index: idx,
                scene_id: item.scene_id.clone(),
                is_placeholder: !has_real_video,
                source_video_path: item.video_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                source_audio_path: item.audio_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                video_duration_ms: video_dur_ms,
                audio_duration_ms: audio_dur_ms,
                target_duration_ms: target_dur_ms,
                start_ms,
                end_ms,
                narration: item.narration.clone(),
                policy_applied: policy,
            });
        }

        // 4. Kiểm tra điều kiện chế độ Final
        let is_final = mode.eq_ignore_ascii_case("final");
        if is_final && !missing_scenes.is_empty() {
            return Err(format!(
                "Chế độ Final yêu cầu đầy đủ video cho mọi cảnh! Cảnh còn thiếu video: {:?}",
                missing_scenes
            ));
        }

        let placeholder_count = missing_scenes.len();
        if placeholder_count > 0 {
            warnings.push(format!(
                "Chế độ Preview: Có {} cảnh chưa có video và sẽ dùng slide màu tạm.",
                placeholder_count
            ));
        }

        Ok(RenderManifest {
            project_id: project_id.to_string(),
            mode: if is_final { "final".into() } else { "preview".into() },
            canvas_ratio: ratio.to_string(),
            canvas_width: canvas_w,
            canvas_height: canvas_h,
            total_duration_ms: current_timeline_ms,
            scene_count: items.len(),
            placeholder_count,
            scenes: scenes_provenance,
            warnings,
            output_mp4: None,
            output_srt: None,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        })
    }

    /// Xuất SRT chuẩn xác 100% từ RenderManifest timeline
    pub fn generate_srt_from_manifest(manifest: &RenderManifest) -> String {
        let mut srt = String::new();
        for (i, sc) in manifest.scenes.iter().enumerate() {
            let start_str = Self::format_srt_timestamp_ms(sc.start_ms);
            let end_str = Self::format_srt_timestamp_ms(sc.end_ms);
            let text = sc.narration.trim();

            srt.push_str(&format!("{}\n", i + 1));
            srt.push_str(&format!("{} --> {}\n", start_str, end_str));
            srt.push_str(&format!("{}\n\n", text));
        }
        srt
    }

    /// Định dạng timestamp SRT từ millisecond
    pub fn format_srt_timestamp_ms(total_ms: u64) -> String {
        let ms = total_ms % 1000;
        let total_s = total_ms / 1000;
        let s = total_s % 60;
        let total_m = total_s / 60;
        let m = total_m % 60;
        let h = total_m / 60;
        format!("{:02}:{:02}:{:02},{:03}", h, m, s, ms)
    }

    /// Tạo câu lệnh chuẩn hóa video clip sang định dạng thống nhất:
    /// Scale & pad về đúng canvas width/height, SAR 1:1, fps=30, yuv420p,
    /// Freeze frame nếu video ngắn hơn thời lượng yêu cầu.
    pub fn build_video_normalization_args(
        input_path: Option<&str>,
        target_dur_ms: u64,
        video_dur_ms: u64,
        canvas_w: u32,
        canvas_h: u32,
        scene_idx: usize,
        out_clip_path: &str,
    ) -> Vec<String> {
        let dur_sec = target_dur_ms as f64 / 1000.0;

        match input_path {
            Some(v_path) if !v_path.is_empty() => {
                let mut filter_complex = format!(
                    "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p",
                    canvas_w, canvas_h, canvas_w, canvas_h
                );

                // Nếu video ngắn hơn audio/thời lượng mục tiêu, đóng băng frame cuối
                if video_dur_ms < target_dur_ms {
                    let diff_sec = (target_dur_ms - video_dur_ms) as f64 / 1000.0;
                    filter_complex.push_str(&format!(",tpad=stop_mode=clone:stop_duration={:.3}", diff_sec));
                }

                vec![
                    "-y".into(),
                    "-i".into(),
                    v_path.to_string(),
                    "-t".into(),
                    format!("{:.3}", dur_sec),
                    "-vf".into(),
                    filter_complex,
                    "-c:v".into(),
                    "libx264".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    out_clip_path.to_string(),
                ]
            }
            _ => {
                // Placeholder slide màu chuẩn
                let colors = ["#1e293b", "#0f172a", "#1e1b4b", "#172554", "#064e3b", "#312e81"];
                let color = colors[scene_idx % colors.len()];

                vec![
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!("color=c={}:s={}x{}:d={:.3}:r=30", color, canvas_w, canvas_h, dur_sec),
                    "-c:v".into(),
                    "libx264".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    out_clip_path.to_string(),
                ]
            }
        }
    }

    /// Tạo câu lệnh chuẩn hóa audio sang chuẩn pcm_s16le, 44100Hz, stereo
    pub fn build_audio_normalization_args(
        input_path: Option<&str>,
        target_dur_ms: u64,
        out_wav_path: &str,
    ) -> Vec<String> {
        let dur_sec = target_dur_ms as f64 / 1000.0;

        match input_path {
            Some(a_path) if !a_path.is_empty() => {
                // Chuẩn hóa samplerate 44100, stereo, pad thêm im lặng ở đuôi nếu audio ngắn hơn
                let filter = format!("aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,apad=whole_dur={:.3}", dur_sec);
                vec![
                    "-y".into(),
                    "-i".into(),
                    a_path.to_string(),
                    "-t".into(),
                    format!("{:.3}", dur_sec),
                    "-af".into(),
                    filter,
                    "-c:a".into(),
                    "pcm_s16le".into(),
                    out_wav_path.to_string(),
                ]
            }
            _ => {
                // Tạo đoạn audio im lặng (anullsrc) đúng thời lượng
                vec![
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!("anullsrc=r=44100:cl=stereo:d={:.3}", dur_sec),
                    "-c:a".into(),
                    "pcm_s16le".into(),
                    out_wav_path.to_string(),
                ]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration_ffmpeg() {
        let sample = "Input #0, mov,mp4, from 'test.mp4':\n  Duration: 00:01:23.45, start: 0.000000, bitrate: 1200 kb/s";
        let ms = RenderPlanner::parse_duration_from_ffmpeg_output(sample);
        assert_eq!(ms, Some(83450));
    }

    #[test]
    fn test_srt_generation_timing() {
        let manifest = RenderManifest {
            project_id: "test".into(),
            mode: "preview".into(),
            canvas_ratio: "16:9".into(),
            canvas_width: 1280,
            canvas_height: 720,
            total_duration_ms: 10000,
            scene_count: 2,
            placeholder_count: 0,
            scenes: vec![
                SceneProvenance {
                    scene_index: 0,
                    scene_id: "s1".into(),
                    is_placeholder: false,
                    source_video_path: None,
                    source_audio_path: None,
                    video_duration_ms: 5000,
                    audio_duration_ms: 4500,
                    target_duration_ms: 5000,
                    start_ms: 0,
                    end_ms: 5000,
                    narration: "Xin chào thế giới".into(),
                    policy_applied: "freeze_frame".into(),
                },
                SceneProvenance {
                    scene_index: 1,
                    scene_id: "s2".into(),
                    is_placeholder: false,
                    source_video_path: None,
                    source_audio_path: None,
                    video_duration_ms: 5000,
                    audio_duration_ms: 5000,
                    target_duration_ms: 5000,
                    start_ms: 5000,
                    end_ms: 10000,
                    narration: "Hẹn gặp lại bạn".into(),
                    policy_applied: "trim".into(),
                },
            ],
            warnings: vec![],
            output_mp4: None,
            output_srt: None,
            created_at: 0,
        };

        let srt = RenderPlanner::generate_srt_from_manifest(&manifest);
        assert!(srt.contains("00:00:00,000 --> 00:00:05,000"));
        assert!(srt.contains("Xin chào thế giới"));
        assert!(srt.contains("00:00:05,000 --> 00:00:10,000"));
        assert!(srt.contains("Hẹn gặp lại bạn"));
    }

    #[test]
    fn test_normalization_args_generation() {
        let args = RenderPlanner::build_video_normalization_args(
            Some("/path/to/clip.mp4"),
            5000,
            3000,
            1280,
            720,
            0,
            "/tmp/out.mp4",
        );
        // Do video ngắn hơn target (3000 < 5000) nên phải có tpad stop_mode=clone
        let combined = args.join(" ");
        assert!(combined.contains("tpad=stop_mode=clone:stop_duration=2.000"));
        assert!(combined.contains("scale=1280:720:force_original_aspect_ratio=decrease"));
        assert!(combined.contains("fps=30"));
    }
}
