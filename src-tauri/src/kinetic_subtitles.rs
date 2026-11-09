use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleCue {
    pub index: usize,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KineticSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub raw_text: String,
    pub ass_dialogue: String,
}

pub struct KineticGenerator;

impl KineticGenerator {
    /// Phân tích tệp SRT thành danh sách SubtitleCue
    pub fn parse_srt(srt_content: &str) -> Vec<SubtitleCue> {
        let mut cues = Vec::new();
        let normalized = srt_content.replace("\r\n", "\n").replace('\r', "\n");
        let blocks = normalized.split("\n\n");

        for block in blocks {
            let lines: Vec<&str> = block.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
            if lines.len() >= 2 {
                // Kiểm tra dòng thời gian (thường là dòng 2 hoặc dòng 1 nếu không có chỉ số)
                let time_line_idx = if lines[0].contains("-->") { 0 } else if lines.len() >= 2 && lines[1].contains("-->") { 1 } else { continue };
                let time_line = lines[time_line_idx];
                let parts: Vec<&str> = time_line.split("-->").collect();
                if parts.len() == 2 {
                    let start_ms = Self::parse_timestamp_ms(parts[0].trim());
                    let end_ms = Self::parse_timestamp_ms(parts[1].trim());

                    // Nội dung chữ
                    let text = lines[time_line_idx + 1..].join(" ");
                    if !text.is_empty() {
                        cues.push(SubtitleCue {
                            index: cues.len() + 1,
                            start_ms,
                            end_ms,
                            text,
                        });
                    }
                }
            }
        }
        cues
    }

    /// Đổi timestamp SRT "00:01:23,456" thành milliseconds
    pub fn parse_timestamp_ms(ts: &str) -> u64 {
        // Hỗ trợ cả dấu phẩy ',' và dấu chấm '.'
        let clean = ts.replace(',', ":").replace('.', ":");
        let parts: Vec<&str> = clean.split(':').collect();
        if parts.len() == 4 {
            let h: u64 = parts[0].parse().unwrap_or(0);
            let m: u64 = parts[1].parse().unwrap_or(0);
            let s: u64 = parts[2].parse().unwrap_or(0);
            let ms: u64 = parts[3].parse().unwrap_or(0);
            h * 3600_000 + m * 60_000 + s * 1000 + ms
        } else if parts.len() == 3 {
            let m: u64 = parts[0].parse().unwrap_or(0);
            let s: u64 = parts[1].parse().unwrap_or(0);
            let ms: u64 = parts[2].parse().unwrap_or(0);
            m * 60_000 + s * 1000 + ms
        } else {
            0
        }
    }

    /// Định dạng timestamp ASS "H:MM:SS.cc" (centiseconds, 2 số thập phân)
    pub fn format_ass_timestamp(ms: u64) -> String {
        let total_cs = ms / 10;
        let cs = total_cs % 100;
        let total_s = ms / 1000;
        let s = total_s % 60;
        let total_m = total_s / 60;
        let m = total_m % 60;
        let h = total_m / 60;
        format!("{}:{:02}:{:02}.{:02}", h, m, s, cs)
    }

    /// Kiểm tra từ khóa có cần tạo điểm nhấn (Punch Accent):
    /// - Chứa số hoặc ký hiệu tài chính (%, $, đ, tr, tỉ...)
    /// - Từ viết hoa toàn bộ (AI, CEO, VIP, TOP...)
    /// - Các tính từ/động từ biểu cảm mạnh trong video viral
    pub fn is_punch_keyword(word: &str) -> bool {
        let clean = word.trim_matches(|c: char| !c.is_alphanumeric());
        if clean.is_empty() {
            return false;
        }

        // Chứa số
        if clean.chars().any(|c| c.is_ascii_digit()) {
            return true;
        }

        // Viết hoa toàn bộ và độ dài >= 2
        if clean.len() >= 2 && clean.chars().all(|c| c.is_uppercase() || !c.is_alphabetic()) && clean.chars().any(|c| c.is_alphabetic()) {
            return true;
        }

        // Từ khóa kích thích cảm xúc phổ biến tiếng Việt
        let lower = clean.to_lowercase();
        let triggers = [
            "tuyệt", "đột", "phá", "kinh", "ngạc", "cực", "kỳ", "nhất", "siêu", "vip",
            "bí", "mật", "sai", "lầm", "chú", "ý", "cảnh", "báo", "nguy", "hiểm",
            "bùng", "nổ", "đặc", "biệt", "tiền", "triệu", "tỷ", "miễn", "phí", "ngay"
        ];
        triggers.contains(&lower.as_str())
    }

    /// Tạo file ASS chuẩn với Kinetic Typography từ SRT
    pub fn generate_ass_from_srt(
        srt_content: &str,
        style: &crate::models::SubtitleStyleConfig,
        highlight_color: &str, // ASS color hex: ví dụ "&H0000FFFF" (Vàng) hoặc "&H00FF00FF" (Tím hồng)
        video_width: u32,
        video_height: u32,
    ) -> String {
        Self::generate_ass_with_offset(srt_content, style, highlight_color, video_width, video_height, 0)
    }

    pub fn generate_ass_with_offset(
        srt_content: &str,
        style: &crate::models::SubtitleStyleConfig,
        highlight_color: &str,
        video_width: u32,
        video_height: u32,
        offset_ms: u64,
    ) -> String {
        let mut cues = Self::parse_srt(srt_content);
        for cue in &mut cues {
            cue.start_ms = cue.start_ms.saturating_add(offset_ms);
            cue.end_ms = cue.end_ms.saturating_add(offset_ms);
        }
        let mut ass = String::new();

        // 1. Script Info Header
        ass.push_str("[Script Info]\n");
        ass.push_str("Title: Xitrum Kinetic Subtitles\n");
        ass.push_str("ScriptType: v4.00+\n");
        ass.push_str("WrapStyle: 2\n");
        ass.push_str("ScaledBorderAndShadow: yes\n");
        ass.push_str(&format!("PlayResX: {}\n", video_width));
        ass.push_str(&format!("PlayResY: {}\n", video_height));
        ass.push_str("\n");

        // 2. V4+ Styles
        // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
        ass.push_str("[V4+ Styles]\n");
        ass.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
        ass.push_str(&format!(
            "Style: Default,{},{},{},&H000000FF,{},&H80000000,-1,0,0,0,100,100,0,0,{},{},{},{},10,10,{},1\n\n",
            style.font_name,
            (f64::from(style.font_size) * f64::from(video_width.min(video_height)) / 384.0).round().max(1.0),
            if style.primary_color == "&H0000FFFF" { "&H00FFFFFF" } else { &style.primary_color },
            style.outline_color,
            style.border_style,
            f64::from(style.outline_width) * f64::from(video_width.min(video_height)) / 384.0,
            f64::from(style.shadow_depth) * f64::from(video_width.min(video_height)) / 384.0,
            style.alignment,
            (f64::from(style.margin_v) * f64::from(video_height) / 1080.0).round()
        ));

        // 3. Events (Cinecode Dynamic Kinetic Highlighting)
        ass.push_str("[Events]\n");
        ass.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

        for cue in cues {
            if cue.end_ms <= cue.start_ms { continue; }
            // Speaker labels describe a voice; they are not spoken captions.
            let text = cue.text.trim();
            let text = if text.starts_with('[') {
                text.split_once("]:").map(|(_, spoken)| spoken.trim()).unwrap_or(text)
            } else { text };
            let words: Vec<String> = text.split_whitespace().map(|word| {
                word.replace('\\', "／").replace('{', "（").replace('}', "）")
            }).collect();
            if words.is_empty() { continue; }
            let duration = cue.end_ms - cue.start_ms;
            // SRT has cue times only. These are estimated word boundaries, not audio alignment.
            for (chunk_idx, chunk) in words.chunks(4).enumerate() {
                for active in 0..chunk.len() {
                    let word_idx = chunk_idx * 4 + active;
                    let start = cue.start_ms + duration * word_idx as u64 / words.len() as u64;
                    let end = cue.start_ms + duration * (word_idx + 1) as u64 / words.len() as u64;
                    if end / 10 <= start / 10 { continue; }
                    let formatted: Vec<String> = chunk.iter().enumerate().map(|(idx, word)| {
                        if idx == active {
                            let punch = if Self::is_punch_keyword(word) {
                                // Brief accent on the active word only, then return to normal size.
                                "\\fscx108\\fscy108\\t(0,100,\\fscx100\\fscy100)"
                            } else { "" };
                            format!("{{\\c{}\\3c&H00222222{}}}{}{{\\r}}", highlight_color, punch, word)
                        } else { word.clone() }
                    }).collect();
                    ass.push_str(&format!(
                        "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
                        Self::format_ass_timestamp(start), Self::format_ass_timestamp(end), formatted.join(" ")
                    ));
                }
            }
        }

        ass
    }

    /// Xuất và lưu tệp ASS trực tiếp cạnh tệp SRT
    pub fn convert_srt_to_kinetic_ass(
        srt_path: &Path,
        style: &crate::models::SubtitleStyleConfig,
        highlight_color: &str,
        video_width: u32,
        video_height: u32,
        offset_ms: u64,
    ) -> Result<std::path::PathBuf, crate::errors::AppError> {
        let ass_path = srt_path.with_extension("kinetic.ass");
        Self::convert_srt_to_kinetic_ass_to(
            srt_path, &ass_path, style, highlight_color, video_width, video_height, offset_ms,
        )
    }

    /// Write generated ASS to an explicit path, preserving word highlighting and cue offsets.
    pub fn convert_srt_to_kinetic_ass_to(
        srt_path: &Path,
        ass_path: &Path,
        style: &crate::models::SubtitleStyleConfig,
        highlight_color: &str,
        video_width: u32,
        video_height: u32,
        offset_ms: u64,
    ) -> Result<std::path::PathBuf, crate::errors::AppError> {
        let srt_content = std::fs::read_to_string(srt_path)?;
        if Self::parse_srt(&srt_content).iter().all(|cue| cue.end_ms <= cue.start_ms) {
            return Err(crate::errors::AppError::Other("SRT không có câu phụ đề với thời gian hợp lệ".into()));
        }
        let ass_content = Self::generate_ass_with_offset(&srt_content, style, highlight_color, video_width, video_height, offset_ms);
        std::fs::write(ass_path, ass_content)?;
        Ok(ass_path.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{SubtitlePreset, SubtitleStyleConfig};

    #[test]
    fn test_parse_srt_and_punch_keywords() {
        let srt = r#"1
00:00:01,000 --> 00:00:04,500
Xin chào thế giới AI cực kỳ đột phá với 100 bí mật thành công!
"#;
        let cues = KineticGenerator::parse_srt(srt);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].start_ms, 1000);
        assert_eq!(cues[0].end_ms, 4500);

        // Kiểm tra punch keywords
        assert!(KineticGenerator::is_punch_keyword("AI"));
        assert!(KineticGenerator::is_punch_keyword("100"));
        assert!(KineticGenerator::is_punch_keyword("đột"));
        assert!(KineticGenerator::is_punch_keyword("phá"));
        assert!(!KineticGenerator::is_punch_keyword("chào"));
    }

    #[test]
    fn test_generate_ass_kinetic() {
        let srt = r#"1
00:00:00,000 --> 00:00:02,000
Khám phá công nghệ AI đỉnh cao!
"#;
        let style = SubtitleStyleConfig::from_preset(SubtitlePreset::TiktokNeon, true);
        let ass = KineticGenerator::generate_ass_from_srt(srt, &style, "&H0000FF00", 1080, 1920);

        assert!(ass.contains("[Script Info]"));
        assert!(ass.contains("PlayResX: 1080"));
        assert!(ass.contains("PlayResY: 1920"));
        assert!(ass.contains("[Events]"));
        // AI phải có thẻ highlight màu
        assert!(ass.contains("AI"));
    }

    #[test]
    fn active_word_moves_within_short_chunks_and_resets() {
        let style = SubtitleStyleConfig::from_preset(SubtitlePreset::TiktokNeon, false);
        let ass = KineticGenerator::generate_ass_with_offset(
            "1\n00:00:00,000 --> 00:00:04,000\n[Nam]: Xin chào bạn AI hôm nay vui quá\n",
            &style, "&H0000FFFF", 1080, 600, 2000,
        );
        let events: Vec<_> = ass.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(events.len(), 8);
        assert!(events[0].contains("0:00:02.00,0:00:02.50"));
        assert!(events[7].contains("0:00:05.50,0:00:06.00"));
        assert!(events[0].ends_with("{\\c&H0000FFFF\\3c&H00222222}Xin{\\r} chào bạn AI"));
        assert!(events[1].ends_with("Xin {\\c&H0000FFFF\\3c&H00222222}chào{\\r} bạn AI"));
        assert!(events[3].contains("\\fscx108\\fscy108\\t(0,100,\\fscx100\\fscy100)"));
        assert!(!events[4].contains("Xin"));
        assert!(!ass.contains("[Nam]"));
        for event in events {
            assert_eq!(event.matches("\\c&H0000FFFF").count(), 1);
            assert_eq!(event.matches("{\\r}").count(), 1);
        }
        // Idle words must remain white so the yellow active word is visible.
        assert!(ass.contains("Style: Default,Arial,34,&H00FFFFFF"));
    }

    #[test]
    fn short_cues_are_split_and_invalid_durations_are_skipped() {
        let style = SubtitleStyleConfig::default();
        let ass = KineticGenerator::generate_ass_from_srt(
            "1\n00:00:00,000 --> 00:00:03,000\nmột hai ba bốn năm sáu\n\n2\n00:00:05,000 --> 00:00:04,000\nkhông hiện\n",
            &style, "&H0000FFFF", 1080, 1920,
        );
        assert_eq!(ass.lines().filter(|l| l.starts_with("Dialogue:")).count(), 6);
        assert!(!ass.contains("bốn năm"));
        assert!(!ass.contains("không hiện"));
    }
}
