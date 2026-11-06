# BÁO CÁO NGHIÊN CỨU & ĐÁNH GIÁ KHẢ NĂNG TÍCH HỢP
## `srt-whiteboard-animation` VÀO `xitrum-AI-studio`

> **Tài liệu tham chiếu:** PhongSun01 / [srt-whiteboard-animation](https://github.com/phongsun01/srt-whiteboard-animation) (Fork & i18n từ [geeklee/srt-whiteboard-animation](https://github.com/geeklee/srt-whiteboard-animation))  
> **Dự án đích:** `xitrum-AI-studio` (Tauri v2 + Rust + React 19 + Python Sidecar)  
> **Ngày thực hiện:** Tháng 11/2026

---

## I. TỔNG QUAN VỀ `srt-whiteboard-animation`

### 1. Bản chất & Cơ chế cốt lõi
`srt-whiteboard-animation` là một **AI Agent Skill & Engine kết hợp** cho phép biến phụ đề SRT thành video hoạt hình bảng trắng vẽ tay chân thực trên nền giấy vàng be ấm (`#F5EBD7`), với hai kỹ thuật kết hợp:
1. **Mask Partition Orchestration (Dàn dựng phân vùng theo mặt nạ):**
   - Không hé lộ ảnh theo kiểu quét chữ nhật vô hồn.
   - Quản lý cảnh qua tệp `annotation.json` phân định các `elements` theo thời gian (`startMs`, `durationMs`), thứ tự kể chuyện (`sequence`), vai trò câu chuyện (`narrativeRole`), phụ đề đồng bộ (`subtitle`), và vùng che chở chống đè nét (`protectedRegions`).
2. **Stream Continuous Drawing (Nét vẽ dòng chảy liên tục):**
   - **Giai đoạn Ink:** Vẽ khung xương nét mực phác thảo đơn sắc trước (`skeleton` hoặc `grid`).
   - **Giai đoạn Color:** Tô màu khôi phục hình gốc (`contour-wipe` hoặc `brush`) theo tỷ lệ chuẩn `ink:color = 2:1`.
   - Bàn tay vẽ thực tế trượt theo quỹ đạo (`drawing-hand.png`).
3. **Interactive Visual Preview Tool:**
   - Bộ công cụ HTML/JS chạy trình duyệt (`preview.html` / `preview.en.html`) hỗ trợ kéo thả chỉnh sửa bounding boxes, timeline và xuất ngược về `annotation.json`.

---

## II. ĐÁNH GIÁ ĐỘ TƯƠNG THÍCH VỚI `xitrum-AI-studio`

`xitrum-AI-studio` hiện tại (v0.6.1) đã có kiến trúc hoàn chỉnh cho chuỗi:  
`Ý Tưởng / Kịch bản` ➜ `Offline VieNeu-TTS` ➜ `Video Cloud / RPA Runner` ➜ `Hậu kỳ FFmpeg (Hardsub + BGM ducking)`.

### 1. Bảng so sánh năng lực và độ tương thích

| Thành phần / Yêu cầu | `xitrum-AI-studio` hiện tại | Cơ chế `whiteboard-animation` | Mức độ phù hợp |
| :--- | :--- | :--- | :---: |
| **Pipeline âm thanh & phụ đề** | Đã có TTS tiếng Việt sinh WAV + đo đạc miligiây tự động + xuất SRT | Nhận đầu vào là `.srt` để chia phân cảnh (25-35s) và tính `sceneDurationMs` | **100% Hoàn hảo** |
| **Kiến trúc Sidecar Runner** | Đã có mẫu chuẩn `sidecar-tts` (Python JSON-RPC giao tiếp qua `stdin`/`stdout`) | Render engine viết bằng Python (`OpenCV`, `NumPy`, `Pillow`, `PyAV`) | **95% Rất cao** |
| **Visual Style** | Hiện tập trung sinh video nhân vật 3D / Realistic qua RPA Cloud | Vẽ tay tối giản kiểu Notion / Doodling / Explainer video 2D | **Bổ sung dạng nội dung mới** |
| **Chi phí & Độ phụ thuộc** | Cần tài khoản/credit video generation cloud qua browser | **100% Offline Local**, không tốn chi phí GPU Cloud để render video chuyển động | **Ưu thế vượt trội** |

---

## III. GIÁ TRỊ GIA TĂNG NẾU TÍCH HỢP VÀO XITRUM STUDIO

1. **Thêm luồng sản xuất "Chế độ Video Bảng Trắng (Whiteboard Explainer Mode)":**
   - Hiện nay các kênh YouTube/TikTok về tóm tắt sách, kiến thức lịch sử, triết học, bài giảng giáo dục, tài chính ưa chuộng phong cách Whiteboard Animation vì tỉ lệ giữ chân người xem (retention rate) rất cao.
   - Thay vì phải render video chuyển động tốn kém hoặc chờ đợi cloud RPA, Xitrum Studio có thể tạo video hoạt hình giải thích hoàn toàn tự động ngay trên máy local.

2. **Khép kín vòng lặp Tự Động:**
   - **Bước 1:** Nhập chủ đề ➜ AI tạo kịch bản tóm tắt nội dung.
   - **Bước 2:** VieNeu-TTS sinh giọng đọc tiếng Việt + mốc thời gian phụ đề chuẩn từng mili-giây.
   - **Bước 3:** AI sinh Line-art (qua SD/FLUX/DALL-E) hoặc người dùng nạp ảnh minh họa.
   - **Bước 4:** Xitrum Engine tự động sinh layout `annotation.json` và gọi Python Whiteboard Render tạo video vẽ tay.
   - **Bước 5:** Ghép audio tiếng Việt + BGM Ducking ➜ Xuất MP4 hoàn chỉnh.

---

## IV. ĐỀ XUẤT LỘ TRÌNH TÍCH HỢP KỸ THUẬT (3 PHA)

### Pha 1: Tích hợp Python Engine thành Sidecar thứ hai (`sidecar-whiteboard`)
- Tương tự như `sidecar-tts`, đóng gói các script trong `scripts/` (`render_stream_whiteboard.py`, `stream_render.py`, `parse_srt.py`, `merge_scenes.py`).
- Cung cấp giao thức JSON-RPC nhẹ qua `stdin/stdout`:
  - `whiteboard.parse_srt` -> Nhận SRT, trả về scenes đề xuất.
  - `whiteboard.auto_annotate` -> Nhận ảnh line-art, tự động tách contour và sinh vùng `annotation.json`.
  - `whiteboard.render_scene` -> Nhận ảnh + `annotation.json`, xuất mp4 với progress callback % về giao diện Rust/React.

### Pha 2: Nhúng giao diện Preview & Căn chỉnh vào React Frontend
- Chuyển logic từ `assets/preview.html` thành một Tab/Modal React bên trong giao diện Xitrum Studio (`src/components/WhiteboardEditor.tsx`).
- Người dùng có thể xem trước đường đi của bàn tay vẽ, nới rộng bounding box, hoặc đổi thứ tự xuất hiện của các đối tượng khớp với từng câu thoại tiếng Việt.

### Pha 3: Tự động hóa sinh Annotation bằng AI Vision
- Kết hợp multimodal LLM (GPT-4o / Gemini Flash) để tự động nhận diện các đối tượng trong ảnh line-art và gán nhãn + mốc thời gian khớp với câu thoại SRT mà người dùng không cần căn chỉnh thủ công.

---

## V. KẾT LUẬN

`srt-whiteboard-animation` là một công cụ mã nguồn mở rất giá trị, bổ sung hoàn hảo mảnh ghép **Explainer Video 2D Local** cho hệ sinh thái `xitrum-AI-studio`. Việc tích hợp hoàn toàn khả thi về mặt kỹ thuật, chi phí 0 đồng tiền API video chuyển động, và tận dụng được 100% hạ tầng TTS tiếng Việt + Hậu kỳ FFmpeg sẵn có của Xitrum Studio.

