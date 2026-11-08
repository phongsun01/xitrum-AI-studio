# Định dạng dự án Whiteboard nhiều cảnh (schemaVersion 1)

Tệp JSON do màn "Dự án nhiều cảnh" lưu/mở; runner Python (`scripts/project_export.py`) đọc đúng định dạng này.

```json
{
  "schemaVersion": 1,
  "id": "proj-abc", "name": "Bài giảng 01",
  "fps": 30, "paperColor": "#F5EBD7", "hand": null,
  "outputSize": { "width": 1920, "height": 1080 },
  "masterAudio": { "path": "D:/audio/loi-doc.wav" },
  "scenes": [
    {
      "id": "scene-01",
      "imagePath": "D:/p/scene-01.png", "annotationPath": "D:/p/scene-01.annotation.json",
      "durationMs": 30000, "timelineStartMs": 0,
      "audio": { "mode": "auto" }, "enabled": true
    }
  ]
}
```

- Thứ tự mảng `scenes` là thứ tự phát. `timelineStartMs` là vị trí đầu cảnh trong audio toàn bài (mặc định cộng dồn).
- `audio.mode`: `auto` (theo audio toàn bài nếu có), `none` (im lặng), `file` (kèm `path`), `master`.
- `durationMs` là nguồn sự thật: video mỗi cảnh có đúng `round(durationMs × fps / 1000)` khung hình. Annotation có vùng
  kết thúc sau `durationMs` bị báo lỗi (chỉ rõ cảnh) trước khi render. Muốn dừng thêm sau khi vẽ xong, tăng `durationMs`.
- Audio toàn bài dài hơn timeline thì cảnh cuối được kéo dài để giữ hết lời; ngắn hơn thì phần cuối im lặng (có cảnh báo).
- Chuẩn hóa: ảnh khác kích thước/tỉ lệ được scale + pad bằng màu giấy về `outputSize` (mặc định theo cảnh đầu).
- Audio mỗi cảnh được dựng đúng bằng thời lượng thật của video cảnh đó, nối PCM rồi mã hóa AAC một lần
  → lệch A/V không tích lũy qua các cảnh.
- Cache: cảnh đã render lưu ở `<thư mục đầu ra>/.whiteboard-cache/`, khóa theo hash ảnh/annotation/tay/fps/màu/thời lượng
  và `ENGINE_VERSION`. Hủy giữa chừng vẫn giữ các cảnh đã xong. Đầu ra được ghi tạm rồi đổi tên sau khi kiểm tra,
  kèm `<đầu ra>.manifest.json`.
- Hủy dừng cả cây tiến trình (Python + ffmpeg).

## Cấu trúc Cấu hình Giọng đọc & Phân vai (speechConfig)
Dự án hỗ trợ lưu bảng phân vai giọng đọc (`speechConfig`) theo mô hình Character Bible cho Whiteboard:
```json
{
  "speechConfig": {
    "mode": "characters",
    "defaultVoiceId": "Thùy Dung",
    "timingMode": "auto",
    "speakers": [
      {
        "id": "speaker-1",
        "name": "Thầy giáo",
        "voiceId": "Hải Đăng",
        "sourceCharacterId": "char-teacher"
      },
      {
        "id": "speaker-2",
        "name": "Học sinh",
        "voiceId": "Trúc Ly"
      }
    ]
  }
}
```
- Các trường mở rộng trong mỗi câu phụ đề `cue`:
  - `id`: Định danh ổn định của cue (`cue-1`, `cue-2`, ...).
  - `sourceText`: Toàn bộ chuỗi gốc kể cả nhãn (vd: `[Thầy giáo]: Chào các em.`).
  - `spokenText`: Lời thoại đã bóc tách nhãn đưa vào TTS (vd: `Chào các em.`).
  - `speakerName`: Tên nhân vật bóc tách từ nhãn hoặc null nếu là người dẫn chuyện.
  - `speakerId`: ID nhân vật phân vai trong `speechConfig.speakers` (hoặc null nếu dùng giọng mặc định/người dẫn chuyện).

## Định dạng Nhập bộ Whiteboard Schema 3 (`.wb.json` & `.srt`)

Hệ thống hỗ trợ nhập đồng bộ dự án từ công cụ tạo kịch bản Whiteboard (skill `/wb`), bao gồm tệp kịch bản `.wb.json` (Schema 3) và tệp phụ đề `<slug>.srt`.

### 1. Cấu trúc tệp `<slug>.wb.json` (Schema 3)
```json
{
  "schema_version": 3,
  "title": "Tiêu đề dự án",
  "srt_source": "<slug>.srt",
  "srt_sha256": "hash_sha256_chinh_xac_cua_tep_srt",
  "speech": {
    "mode": "characters",
    "speakers": [
      { "id": "teacher", "name": "Thầy giáo", "voice_id": "Hải Đăng" },
      { "id": "student", "name": "Học sinh", "voice_id": "Trúc Ly" }
    ]
  },
  "cues": [
    {
      "id": "cue-1", "index": 1, "scene_index": 1,
      "start_ms": 0, "end_ms": 1500,
      "text": "Buổi học bắt đầu.",
      "spoken_text": "Buổi học bắt đầu.",
      "speaker_id": null
    },
    {
      "id": "cue-2", "index": 2, "scene_index": 1,
      "start_ms": 1500, "end_ms": 3500,
      "text": "[Thầy giáo]: Chào các em.",
      "spoken_text": "Chào các em.",
      "speaker_id": "teacher"
    }
  ],
  "scenes": [
    {
      "index": 1,
      "start_ms": 0, "end_ms": 3500,
      "cue_ids": ["cue-1", "cue-2"],
      "text": "Buổi học bắt đầu.\nChào các em."
    }
  ]
}
```

### 2. Quy tắc Ánh xạ 1 Scene WB $\rightarrow$ 1 WhiteboardSceneItem
- **1 Scene trong `.wb.json` tương ứng đúng 1 `WhiteboardSceneItem`**: Một cảnh minh họa duy nhất (1 ảnh vẽ bảng) có thể chứa nhiều lượt lời (`cue_ids`).
- **Không chia nhỏ cảnh**: Khác với luồng chia cảnh tự động theo thuật toán DP/độ dài câu từ SRT thô, khi nhập bộ WB, cấu trúc phân cảnh được bảo tồn tuyệt đối theo `scenes` của `.wb.json`.
- **Cues của cảnh**: Mỗi `WhiteboardSceneItem.cues` được tập hợp từ mảng `cue_ids` trong cảnh tương ứng, giữ nguyên thứ tự, thời gian bắt đầu/kết thúc (`start_ms`, `end_ms`), `sourceText`, `spokenText`, và `speakerId`.
- **Phân vai nhân vật**: Danh sách `speech.speakers` được tự động chuyển thành `WhiteboardSpeechConfig.speakers`, và `speech.mode` được thiết lập tương ứng (`characters` hoặc `single`).
- **Xác thực SHA-256**: Hệ thống tính toán SHA-256 của tệp `.srt` thực tế để so khớp với `srt_sha256` trong `.wb.json`. Nếu không khớp (tệp SRT bị sửa đổi lệch ngoài), hệ thống sẽ cảnh báo hoặc từ chối để tránh sai lệch đồng bộ audio và hình ảnh.

