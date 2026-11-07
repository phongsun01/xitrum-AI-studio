use sha2::{Digest, Sha256};
use std::path::Path;

/// Tạo generation key xác định duy nhất cho một tác vụ sinh media
/// để chống gửi trùng lặp (idempotency key)
pub fn compute_generation_key(
    provider: &str,
    requested_model: Option<&str>,
    prompt: &str,
    ratio: Option<&str>,
    scene_revision: Option<i64>,
    input_path: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(provider.as_bytes());
    hasher.update(b"|");
    hasher.update(requested_model.unwrap_or("default").as_bytes());
    hasher.update(b"|");
    hasher.update(prompt.trim().as_bytes());
    hasher.update(b"|");
    hasher.update(ratio.unwrap_or("16:9").as_bytes());
    hasher.update(b"|");
    hasher.update(scene_revision.unwrap_or(1).to_string().as_bytes());
    hasher.update(b"|");

    // Nếu có file ảnh input, hash nội dung hoặc metadata của file
    if let Some(path_str) = input_path {
        let p = Path::new(path_str);
        if p.is_file() {
            if let Ok(meta) = std::fs::metadata(p) {
                hasher.update(meta.len().to_string().as_bytes());
                hasher.update(b":");
                if let Ok(modified) = meta.modified() {
                    let dur = modified.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                    hasher.update(dur.as_millis().to_string().as_bytes());
                }
            } else {
                hasher.update(path_str.as_bytes());
            }
        } else {
            hasher.update(path_str.as_bytes());
        }
    }

    let result = hasher.finalize();
    format!("{:x}", result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generation_key_consistency() {
        let k1 = compute_generation_key("muse", Some("veo"), "a cinematic dog", Some("16:9"), Some(1), None);
        let k2 = compute_generation_key("muse", Some("veo"), "a cinematic dog", Some("16:9"), Some(1), None);
        assert_eq!(k1, k2);

        let k3 = compute_generation_key("muse", Some("veo"), "a cinematic dog", Some("16:9"), Some(2), None);
        assert_ne!(k1, k3);

        let k4 = compute_generation_key("dola", Some("veo"), "a cinematic dog", Some("16:9"), Some(1), None);
        assert_ne!(k1, k4);
    }
}
