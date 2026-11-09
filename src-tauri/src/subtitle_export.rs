//! Isolated subtitle inputs and same-filesystem publication of completed exports.
use crate::errors::AppError;
use std::path::PathBuf;

pub(crate) struct SubtitleExport {
    pub video_path: PathBuf,
    pub srt_path: PathBuf,
    pub output_path: PathBuf,
    pub work_dir: PathBuf,
    pub staged_video: PathBuf,
}

impl SubtitleExport {
    pub fn new(video: &str, srt: &str, output: &str) -> Result<Self, AppError> {
        if output.trim().is_empty() {
            return Err(AppError::Validation(
                "Chưa chọn đường dẫn video xuất".into(),
            ));
        }
        let video_path = std::fs::canonicalize(video)?;
        let srt_path = std::fs::canonicalize(srt)?;
        if !video_path.is_file() || !srt_path.is_file() {
            return Err(AppError::Validation("Video và phụ đề phải là tệp".into()));
        }
        let absolute = std::path::absolute(output)?;
        let name = absolute
            .file_name()
            .ok_or_else(|| AppError::Validation("Tên video xuất không hợp lệ".into()))?;
        let parent = absolute
            .parent()
            .ok_or_else(|| AppError::Validation("Thư mục xuất không hợp lệ".into()))?;
        std::fs::create_dir_all(parent)?;
        let output_path = std::fs::canonicalize(parent)?.join(name);
        if output_path.is_dir() {
            return Err(AppError::Validation(
                "Đường dẫn video xuất là thư mục".into(),
            ));
        }
        let resolved = if output_path.exists() {
            std::fs::canonicalize(&output_path)?
        } else {
            output_path.clone()
        };
        if resolved == video_path || resolved == srt_path {
            return Err(AppError::Validation(
                "Tệp xuất trùng với video hoặc phụ đề đầu vào; hãy chọn tệp khác".into(),
            ));
        }
        // Stage beside the destination: rename never needs to cross a filesystem boundary.
        let work_dir = output_path
            .parent()
            .unwrap()
            .join(format!(".xitrum-hardsub-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir(&work_dir)?;
        let extension = output_path
            .extension()
            .unwrap_or_else(|| std::ffi::OsStr::new("mp4"));
        let staged_video = work_dir.join("render").with_extension(extension);
        Ok(Self {
            video_path,
            srt_path,
            output_path,
            work_dir,
            staged_video,
        })
    }

    pub fn srt_filter(&self, force_style: &str, offset_ms: u64) -> Result<String, AppError> {
        std::fs::copy(&self.srt_path, self.work_dir.join("sub.srt"))?;
        let filter = format!("subtitles=sub.srt:force_style='{}'", force_style);
        if offset_ms == 0 {
            Ok(filter)
        } else {
            Ok(format!(
                "setpts=PTS-{0}/TB,{1},setpts=PTS+{0}/TB",
                offset_ms as f64 / 1000.0,
                filter
            ))
        }
    }

    pub fn publish(&self) -> Result<u64, AppError> {
        let size = std::fs::metadata(&self.staged_video)?.len();
        if size == 0 {
            return Err(AppError::Other("FFmpeg trả về video rỗng".into()));
        }
        // Never remove the destination on failure. A failed rename preserves the old file.
        std::fs::rename(&self.staged_video, &self.output_path)?;
        Ok(size)
    }
}

impl Drop for SubtitleExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.work_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wb O'Brien [test] {}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("input.mp4"), b"original-video").unwrap();
        std::fs::write(dir.join("tiếng Việt.srt"), b"original-subtitles").unwrap();
        dir
    }
    fn export(dir: &Path, name: &str) -> SubtitleExport {
        SubtitleExport::new(
            dir.join("input.mp4").to_str().unwrap(),
            dir.join("tiếng Việt.srt").to_str().unwrap(),
            dir.join(name).to_str().unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn failure_and_empty_video_preserve_existing_destination_and_clean_workdir() {
        let dir = fixture();
        std::fs::write(dir.join("output.mp4"), b"previous-good-output").unwrap();
        let work;
        {
            let job = export(&dir, "output.mp4");
            work = job.work_dir.clone();
            // Invalid Kinetic input must return an error, not silently fall back to full sentences.
            let style = crate::models::SubtitleStyleConfig::default();
            assert!(
                crate::kinetic_subtitles::KineticGenerator::convert_srt_to_kinetic_ass_to(
                    &job.srt_path,
                    &job.work_dir.join("sub.ass"),
                    &style,
                    "&H0000FFFF",
                    320,
                    180,
                    2000,
                )
                .is_err()
            );
            assert!(!job.work_dir.join("sub.ass").exists());
            assert!(job.publish().is_err());
            std::fs::write(&job.staged_video, b"").unwrap();
            assert!(job.publish().is_err());
            std::fs::write(&job.staged_video, b"partial-video").unwrap();
            assert_eq!(
                std::fs::read(dir.join("output.mp4")).unwrap(),
                b"previous-good-output"
            );
        }
        assert!(!work.exists());
        assert_eq!(
            std::fs::read(dir.join("output.mp4")).unwrap(),
            b"previous-good-output"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn successful_publication_replaces_only_destination() {
        let dir = fixture();
        std::fs::write(dir.join("output.mp4"), b"old").unwrap();
        let job = export(&dir, "output.mp4");
        std::fs::write(&job.staged_video, b"complete-video").unwrap();
        assert_eq!(job.publish().unwrap(), 14);
        assert_eq!(
            std::fs::read(dir.join("output.mp4")).unwrap(),
            b"complete-video"
        );
        assert_eq!(
            std::fs::read(dir.join("input.mp4")).unwrap(),
            b"original-video"
        );
        assert_eq!(
            std::fs::read(dir.join("tiếng Việt.srt")).unwrap(),
            b"original-subtitles"
        );
        drop(job);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn input_and_subtitle_cannot_be_the_output_including_symlink_aliases() {
        let dir = fixture();
        for name in ["input.mp4", "tiếng Việt.srt"] {
            assert!(SubtitleExport::new(
                dir.join("input.mp4").to_str().unwrap(),
                dir.join("tiếng Việt.srt").to_str().unwrap(),
                dir.join(name).to_str().unwrap()
            )
            .is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("input.mp4"), dir.join("alias.mp4")).unwrap();
            assert!(SubtitleExport::new(
                dir.join("input.mp4").to_str().unwrap(),
                dir.join("tiếng Việt.srt").to_str().unwrap(),
                dir.join("alias.mp4").to_str().unwrap()
            )
            .is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn run(command: &mut Command) -> std::process::Output {
        let out = command.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        out
    }
    fn yellow_pixels(ff: &str, video: &Path, time: &str) -> usize {
        let raw = run(Command::new(ff)
            .args(["-v", "error", "-ss", time, "-i"])
            .arg(video)
            .args(["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]));
        raw.stdout
            .chunks_exact(3)
            .filter(|p| p[0] > 160 && p[1] > 160 && p[2] < 120)
            .count()
    }

    #[test]
    fn real_ffmpeg_handles_quoted_paths_offsets_and_failed_rerenders() {
        let Ok(ff) = std::env::var("XITRUM_TEST_FFMPEG") else {
            eprintln!("Set XITRUM_TEST_FFMPEG to run the real FFmpeg/libass integration test");
            return;
        };
        let dir = fixture();
        run(Command::new(&ff)
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=blue:s=320x180:r=30:d=3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(dir.join("input.mp4")));
        let srt = "1\n00:00:00,000 --> 00:00:02,000\nXin chào bạn AI\n";
        std::fs::write(dir.join("tiếng Việt.srt"), srt).unwrap();
        std::fs::write(dir.join("tiếng Việt.ass"), b"hand-authored-ass").unwrap();
        for kinetic in [false, true] {
            let name = if kinetic { "kinetic.mp4" } else { "static.mp4" };
            let job = export(&dir, name);
            let style = crate::models::SubtitleStyleConfig::from_preset(
                crate::models::SubtitlePreset::TiktokNeon,
                false,
            );
            let filter = if kinetic {
                crate::kinetic_subtitles::KineticGenerator::convert_srt_to_kinetic_ass_to(
                    &job.srt_path,
                    &job.work_dir.join("sub.ass"),
                    &style,
                    "&H0000FFFF",
                    320,
                    180,
                    1000,
                )
                .unwrap();
                "ass=sub.ass".into()
            } else {
                job.srt_filter(&style.to_force_style_string(), 1000)
                    .unwrap()
            };
            run(Command::new(&ff)
                .current_dir(&job.work_dir)
                .args(["-y", "-v", "error", "-i"])
                .arg(&job.video_path)
                .args(["-vf", &filter, "-c:v", "libx264", "-pix_fmt", "yuv420p"])
                .arg(&job.staged_video));
            job.publish().unwrap();
            assert_eq!(yellow_pixels(&ff, &job.output_path, "0.5"), 0);
            assert!(yellow_pixels(&ff, &job.output_path, "1.2") > 0);
            let before = std::fs::read(&job.output_path).unwrap();
            drop(job);
            let failed = export(&dir, name);
            let result = Command::new(&ff)
                .current_dir(&failed.work_dir)
                .args(["-y", "-v", "error", "-i"])
                .arg(&failed.video_path)
                .args(["-vf", "subtitles=missing.srt"])
                .arg(&failed.staged_video)
                .output()
                .unwrap();
            assert!(!result.status.success());
            let work = failed.work_dir.clone();
            drop(failed);
            assert!(!work.exists());
            assert_eq!(std::fs::read(dir.join(name)).unwrap(), before);
        }
        assert_eq!(
            std::fs::read_to_string(dir.join("tiếng Việt.srt")).unwrap(),
            srt
        );
        assert_eq!(
            std::fs::read(dir.join("tiếng Việt.ass")).unwrap(),
            b"hand-authored-ass"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
