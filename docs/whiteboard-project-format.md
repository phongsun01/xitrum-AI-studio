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
