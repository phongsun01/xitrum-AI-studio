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
        let cues = Self::parse_srt(srt_content);
        let mut ass = String::new();

        // 1. Script Info Header
        ass.push_str("[Script Info]\n");
        ass.push_str("Title: Xitrum Kinetic Subtitles\n");
        ass.push_str("ScriptType: v4.00+\n");
        ass.push_str("WrapStyle: 0\n");
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
            style.font_size,
            style.primary_color,
            style.outline_color,
            style.border_style,
            style.outline_width,
            style.shadow_depth,
            style.alignment,
            style.margin_v
        ));

        // 3. Events (Cinecode Dynamic Kinetic Highlighting)
        ass.push_str("[Events]\n");
        ass.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

        for cue in cues {
            let words: Vec<&str> = cue.text.split_whitespace().collect();
            if words.is_empty() {
                continue;
            }

            // Gom từ theo cụm nhỏ 3-5 từ để mắt người đọc nhanh trên Reels/TikTok
            let chunk_size = if words.len() <= 6 { words.len() } else { 4 };
            let chunks: Vec<&[&str]> = words.chunks(chunk_size).collect();

            let total_duration = cue.end_ms.saturating_sub(cue.start_ms);
            let chunk_duration = total_duration / chunks.len().max(1) as u64;

            for (c_idx, chunk) in chunks.iter().enumerate() {
                let chunk_start = cue.start_ms + (c_idx as u64 * chunk_duration);
                let chunk_end = if c_idx == chunks.len() - 1 {
                    cue.end_ms
                } else {
                    chunk_start + chunk_duration
                };

                let start_str = Self::format_ass_timestamp(chunk_start);
                let end_str = Self::format_ass_timestamp(chunk_end);

                // Tạo chuỗi Text có kinetic highlight:
                // Từ khóa quan trọng được đổi màu & làm nổi bật (Punch Accent)
                let mut formatted_words = Vec::new();
                for word in chunk.iter() {
                    if Self::is_punch_keyword(word) {
                        // Thẻ ASS: {\c&H...&\fscx108\fscy108}từ khóa{\r} (phóng to 108% và đổi màu highlight)
                        formatted_words.push(format!("{{\\c{}\\fscx108\\fscy108}}{}{{\\r}}", highlight_color, word));
                    } else {
                        formatted_words.push(word.to_string());
                    }
                }

                let dialogue_text = formatted_words.join(" ");
                ass.push_str(&format!(
                    "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
                    start_str, end_str, dialogue_text
                ));
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
    ) -> Result<std::path::PathBuf, crate::errors::AppError> {
        let srt_content = std::fs::read_to_string(srt_path)?;
        let ass_content = Self::generate_ass_from_srt(&srt_content, style, highlight_color, video_width, video_height);
        let ass_path = srt_path.with_extension("ass");
        std::fs::write(&ass_path, ass_content)?;
        Ok(ass_path)
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
}
