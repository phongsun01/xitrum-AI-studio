//! Read-only import of the old name/hand/masterAudio project format.
//! Keep its exporter until every legacy feature has an editor equivalent.
use crate::commands::WhiteboardProject;
use anyhow::{anyhow, bail, ensure, Context, Result};
use serde_json::{json, Value};

pub fn decode_project(content: &str) -> Result<WhiteboardProject> {
    let mut value: Value = serde_json::from_str(content).context("JSON dự án không hợp lệ")?;
    ensure!(value.is_object(), "Dự án phải là một đối tượng JSON");
    let version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("Thiếu schemaVersion hợp lệ; bộ .wb.json phải nhập cùng SRT"))?;
    ensure!(
        version == 1,
        "schemaVersion {} chưa được hỗ trợ (editor hỗ trợ 1)",
        version
    );
    let legacy = value.get("name").is_some() && value.get("title").is_none();
    if legacy {
        migrate_legacy(&mut value)?;
    }
    let mut project: WhiteboardProject =
        serde_json::from_value(value).context("Cấu trúc dự án Whiteboard không hợp lệ")?;
    // Ignore markers persisted or supplied by an unrelated JSON file.
    project.imported_legacy_v1 = legacy.then_some(true);
    Ok(project)
}

fn unsupported(field: &str) -> anyhow::Error {
    anyhow!("LEGACY_PROJECT_UNSUPPORTED: {} chưa chuyển được sang editor; giữ file gốc và dùng backend V1 để xuất", field)
}

fn migrate_legacy(value: &mut Value) -> Result<()> {
    let root = value.as_object_mut().unwrap();
    if root.get("outputSize").is_some_and(|v| !v.is_null()) {
        return Err(unsupported("outputSize"));
    }
    let master = match root.get("masterAudio").filter(|v| !v.is_null()) {
        None => None,
        Some(v) => Some(
            v.get("path")
                .and_then(Value::as_str)
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| anyhow!("masterAudio.path không hợp lệ"))?
                .to_owned(),
        ),
    };
    let hand = match root.get("hand") {
        None | Some(Value::Null) => "default",
        Some(v) => v.as_str().ok_or_else(|| anyhow!("hand phải là chuỗi"))?,
    };
    let hand = match hand {
        "" | "pen" | "default" | "drawing-hand.png" => "drawing-hand.png",
        "brush" | "calligraphy" | "calligraphy-brush" | "calligraphy-brush.png" => {
            "calligraphy-brush.png"
        }
        _ => return Err(unsupported("hand tùy chỉnh")),
    };
    let hand = hand.to_owned();
    let fps = match root.get("fps") {
        None => 30,
        Some(v) => v
            .as_u64()
            .ok_or_else(|| anyhow!("FPS phải là số nguyên dương"))?,
    };
    ensure!((1..=120).contains(&fps), "FPS phải nằm trong khoảng 1–120");
    let paper = match root.get("paperColor") {
        None | Some(Value::Null) => "#F5EBD7",
        Some(v) => v
            .as_str()
            .ok_or_else(|| anyhow!("paperColor phải là chuỗi"))?,
    };
    let paper = paper.strip_prefix('#').unwrap_or(paper);
    ensure!(
        paper.len() == 6 && paper.bytes().all(|c| c.is_ascii_hexdigit()),
        "Màu giấy không hợp lệ"
    );
    let paper = format!("#{}", paper.to_uppercase());
    let scenes = root
        .get_mut("scenes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| anyhow!("scenes phải là một mảng"))?;
    let mut cursor = 0i64;
    let mut ids = std::collections::HashSet::new();
    for (idx, scene) in scenes.iter_mut().enumerate() {
        let sc = scene
            .as_object_mut()
            .ok_or_else(|| anyhow!("Cảnh {} không hợp lệ", idx + 1))?;
        if let Some(enabled) = sc.get("enabled") {
            ensure!(enabled.is_boolean(), "enabled phải là boolean");
            if enabled == &Value::Bool(false) {
                return Err(unsupported("cảnh bị tắt (enabled=false)"));
            }
        }
        let id = sc
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("scene-{:02}", idx + 1));
        ensure!(ids.insert(id.clone()), "ID cảnh bị trùng: {}", id);
        let duration = sc
            .get("durationMs")
            .and_then(Value::as_i64)
            .filter(|d| *d > 0)
            .ok_or_else(|| anyhow!("Cảnh {}: durationMs phải là số nguyên dương", id))?;
        let start = match sc.get("timelineStartMs") {
            None | Some(Value::Null) => cursor,
            Some(v) => v
                .as_i64()
                .filter(|s| *s >= 0)
                .ok_or_else(|| anyhow!("Cảnh {}: timelineStartMs không hợp lệ", id))?,
        };
        if master.is_some() && start != cursor {
            return Err(unsupported("timeline master audio không liền nhau từ 0"));
        }
        let end = start
            .checked_add(duration)
            .ok_or_else(|| anyhow!("Timeline vượt giới hạn"))?;
        let audio = sc.get("audio").filter(|v| !v.is_null());
        if let Some(audio) = audio {
            ensure!(audio.is_object(), "audio phải là object");
        }
        let mode = match audio.and_then(|v| v.get("mode")) {
            None => "auto",
            Some(v) => v
                .as_str()
                .ok_or_else(|| anyhow!("audio.mode phải là chuỗi"))?,
        };
        let audio_path = match mode {
            "auto" | "master" if master.is_some() => None,
            "auto" | "none" if master.is_none() => None,
            "file" if master.is_none() => Some(
                audio
                    .and_then(|v| v.get("path"))
                    .and_then(Value::as_str)
                    .filter(|p| !p.trim().is_empty())
                    .ok_or_else(|| anyhow!("Cảnh {}: thiếu audio.path", id))?
                    .to_owned(),
            ),
            _ => return Err(unsupported(&format!("audio.mode={} ở cảnh {}", mode, id))),
        };
        sc.insert("id".into(), json!(id));
        sc.insert("order".into(), json!(idx + 1));
        sc.insert("revision".into(), json!(1));
        sc.insert("status".into(), json!("idle"));
        sc.insert("timelineStartMs".into(), json!(start));
        sc.insert("timelineEndMs".into(), json!(end));
        sc.insert("audioPath".into(), json!(audio_path));
        // Never reuse an old video whose cache belongs to a different export engine.
        sc.remove("outputPath");
        sc.remove("audio");
        sc.remove("enabled");
        cursor = end;
    }
    let title = root.remove("name").ok_or_else(|| anyhow!("Thiếu name"))?;
    ensure!(title.is_string(), "name phải là chuỗi");
    root.insert("title".into(), title);
    root.insert("revision".into(), json!(1));
    root.insert("fps".into(), json!(fps));
    root.insert("paperColor".into(), json!(paper));
    root.insert("handPath".into(), json!(hand));
    root.insert("masterAudioPath".into(), json!(master));
    root.remove("hand");
    root.remove("masterAudio");
    root.remove("outputSize");
    if !root.contains_key("id") {
        bail!("Thiếu ID dự án");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn legacy() -> Value {
        json!({"schemaVersion":1,"id":"old","name":"Bài giảng","fps":24,"paperColor":"f5ebd7","hand":"brush",
            "scenes":[{"id":"a","imagePath":"a.png","annotationPath":"a.json","durationMs":1000},
                      {"id":"b","imagePath":"b.png","annotationPath":"b.json","durationMs":2000}]})
    }
    #[test]
    fn imports_legacy_in_memory_and_reopens_as_native() {
        let before = legacy().to_string();
        let p = decode_project(&before).unwrap();
        assert_eq!(p.imported_legacy_v1, Some(true));
        assert_eq!(p.title, "Bài giảng");
        assert_eq!(p.hand_path.as_deref(), Some("calligraphy-brush.png"));
        assert_eq!(p.paper_color, "#F5EBD7");
        assert_eq!(
            (p.scenes[1].timeline_start_ms, p.scenes[1].timeline_end_ms),
            (1000, 3000)
        );
        let mut native = serde_json::to_value(p).unwrap();
        native["pageTurnMs"] = json!(800);
        native["speechConfig"] =
            json!({"mode":"characters","defaultVoiceId":"A","timingMode":"auto","speakers":[]});
        let reopened = decode_project(&native.to_string()).unwrap();
        assert!(reopened.imported_legacy_v1.is_none());
        assert_eq!(reopened.page_turn_ms, Some(800));
        assert_eq!(reopened.speech_config.unwrap().mode, "characters");
        assert_eq!(before, legacy().to_string());
    }
    #[test]
    fn maps_master_and_per_scene_audio_without_mixing() {
        let mut v = legacy();
        v["masterAudio"] = json!({"path":"master.wav"});
        let p = decode_project(&v.to_string()).unwrap();
        assert_eq!(p.master_audio_path.as_deref(), Some("master.wav"));
        assert!(p.scenes.iter().all(|s| s.audio_path.is_none()));
        v.as_object_mut().unwrap().remove("masterAudio");
        v["scenes"][0]["audio"] = json!({"mode":"file","path":"a.wav"});
        v["scenes"][1]["audio"] = json!({"mode":"none"});
        assert_eq!(
            decode_project(&v.to_string()).unwrap().scenes[0]
                .audio_path
                .as_deref(),
            Some("a.wav")
        );
    }
    #[test]
    fn unsupported_options_fail_instead_of_silently_changing_the_export() {
        for (field, val) in [
            ("outputSize", json!({"width":1920,"height":1080})),
            ("hand", json!("/custom/hand.png")),
        ] {
            let mut v = legacy();
            v[field] = val;
            assert!(decode_project(&v.to_string())
                .unwrap_err()
                .to_string()
                .contains("LEGACY_PROJECT_UNSUPPORTED"));
        }
        let mut v = legacy();
        v["scenes"][0]["enabled"] = json!(false);
        assert!(decode_project(&v.to_string()).is_err());
        let mut v = legacy();
        v["masterAudio"] = json!({"path":"master.wav"});
        v["scenes"][0]["audio"] = json!({"mode":"none"});
        assert!(decode_project(&v.to_string()).is_err());
        v["scenes"][0]["audio"] = json!({"mode":"auto"});
        v["scenes"][1]["timelineStartMs"] = json!(2000);
        assert!(decode_project(&v.to_string()).is_err());
    }
    #[test]
    fn rejects_future_schema_malformed_timeline_and_metadata_imports() {
        for content in [
            "{}",
            "[]",
            r#"{"schemaVersion":99}"#,
            r#"{"schema_version":3}"#,
        ] {
            assert!(decode_project(content).is_err());
        }
        for (key, bad) in [
            ("fps", json!("24")),
            ("hand", json!(123)),
            ("paperColor", json!(true)),
        ] {
            let mut v = legacy();
            v[key] = bad;
            assert!(decode_project(&v.to_string()).is_err());
        }
        let mut v = legacy();
        v["scenes"][0]["durationMs"] = json!(-1);
        assert!(decode_project(&v.to_string()).is_err());
        v["scenes"][0]["durationMs"] = json!(i64::MAX);
        assert!(decode_project(&v.to_string()).is_err());
    }
}
