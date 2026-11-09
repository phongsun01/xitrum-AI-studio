# Kế hoạch triển khai Tính năng Hardsub (In phụ đề lên video) & Subtitle Tool

> **Tài liệu tham chiếu:** Kahi AI Studio (Whisper STT), Muse AI Studio (FFmpeg post-production), Sesame Studio (Subtitle Toolkit), Cinecode (`sarpstar/cinecode` typography & safe-area rules).  
> **Dự án áp dụng:** `xitrum-AI-studio` (Tauri v2 + Rust + React 19 + FFmpeg Sidecar).  
> **Khởi tạo:** Ngày 09/11/2026.

---

## I. MỤC TIÊU & TỔNG QUAN

Người xem trên các nền tảng video ngắn (TikTok, Facebook Reels, YouTube Shorts) thường lướt qua video trong trạng thái tắt tiếng hoặc xem nhanh. Phụ đề mềm (Softsub track) sẽ bị TikTok nén bỏ và YouTube không tự động hiển thị nếu người dùng không bật [CC].

**Mục tiêu:**
1. Cung cấp engine đóng dấu phụ đề chết lên video (**Hardsub / Burn-in**) 100% Offline, hiển thị sắc nét, viền đen chống lóa, hỗ trợ tiếng Việt không lỗi font trên mọi kích thước màn hình.
2. Xây dựng công cụ độc lập **`Công Cụ Phụ Đề (Subtitle Tool)`** trên thanh Sidebar giúp xử lý phụ đề cho video lẻ trong 1–2 giây.
3. Tích hợp tùy chọn bật/tắt Hardsub vào **Whiteboard Studio** và **Ý Tưởng → Video**.
4. Áp dụng các quy tắc typography điện ảnh & vùng an toàn (Safe Area) 16:9 và 9:16 học từ Cinecode.

---

## II. CHECKLIST TIẾN ĐỘ THỰC HIỆN

### Giai đoạn 1: Nền tảng Backend Rust & FFmpeg Engine (Đang thực hiện)
- [ ] **1.1. Khởi tạo Preset Style ASS/SRT**: Xây dựng cấu trúc dữ liệu `SubtitleStyleConfig` và 4 bộ preset:
  - *TikTok/Shorts Neon*: Chữ vàng chanh viền đen, hộp nền mờ, font dày.
  - *Classic Cinema/YouTube*: Chữ trắng viền đen đổ bóng thanh lịch.
  - *Notion/Whiteboard*: Chữ đen than viền trắng/hộp kem hợp nền giấy be.
  - *Tùy chỉnh (Custom)*: Font, cỡ chữ, màu sắc, vị trí (Top/Middle/Bottom), margin an toàn.
- [ ] **1.2. Trình xử lý đường dẫn an toàn trên Windows/macOS**: Thoát ký tự đặc biệt (`\`, `:`, `'`) khi đưa file `.srt` vào filter complex `subtitles=` của FFmpeg.
- [ ] **1.3. Lệnh IPC Tauri `burn_video_subtitles`**:
  - Nhận `video_path`, `srt_path`, `output_path`, `style_preset`, `custom_style`.
  - Tự động kiểm tra file tồn tại và gọi FFmpeg sidecar xử lý.
  - Hỗ trợ stream copy track âm thanh (`-c:a copy`) để giữ nguyên chất lượng gốc và tối ưu tốc độ render.
- [ ] **1.4. Lệnh IPC Tauri `extract_audio_for_subtitles`**: Trích xuất nhanh WAV 16 kHz từ file video bất kỳ để sẵn sàng chuyển qua Whisper STT bóc tách câu chữ.
- [ ] **1.5. Đăng ký Command trong `lib.rs` & Expose API TypeScript trong `src/api.ts`**.
- [ ] **1.6. Kiểm thử kỹ thuật (Cargo check & Unit test)**: Đảm bảo biên dịch không lỗi, không warning.

---

### Giai đoạn 2: Giao diện Người dùng Subtitle Tool & Tích hợp Whiteboard
- [ ] **2.1. Thiết kế Component `src/components/SubtitleTool.tsx`**:
  - Nạp video đầu vào + nạp file phụ đề SRT (kèm nút bóc Whisper nếu chưa có SRT).
  - Trình phát video Preview trước kiểu chữ và vị trí.
  - Bộ chọn nhanh 4 Presets + tùy biến MarginV theo chuẩn safe-area (16:9 hoặc 9:16).
  - Nút bấm *"In Phụ Đề Ngay"* với thanh tiến trình và thông báo kết quả.
- [ ] **2.2. Gắn Tab mới vào Sidebar Navigation `src/App.tsx`**:
  - Đặt vị trí: Sau tab *Audio Timeline Editor* và trước tab *Tách Nền Ảnh (Rembg)*.
  - Icon: `Captions` từ thư viện `lucide-react`.
- [ ] **2.3. Tích hợp tùy chọn Hardsub vào Whiteboard Studio**:
  - Thêm checkbox `[x] Đóng dấu phụ đề tiếng Việt` khi xuất phân cảnh MP4 hoặc ghép cả kịch bản.

---

### Giai đoạn 3: Nâng cấp Kinetic Typography (Học hỏi từ Cinecode)
- [ ] **3.1. Gom nhóm từ theo khoảng lặng giọng nói**: Ngắt cụm 3–5 từ dựa trên pause gap > 0.25s từ Whisper.
- [ ] **3.2. Hiệu ứng Kinetic Highlight**: Làm nổi bật các từ khóa cảm xúc, số liệu, tên riêng theo nhịp đọc.

---

## III. THÔNG SỐ KỸ THUẬT GIAI ĐOẠN 1

### Cấu hình `force_style` chuẩn FFmpeg cho tiếng Việt:
```text
FontSize=20,FontName=Arial,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=30
```
- Định dạng màu ASS: `&HAABBGGRR` (Alpha, Blue, Green, Red).
- `BorderStyle=3`: Hộp viền đen mờ tự động bọc quanh chữ giúp đọc rõ 100% trên nền video phức tạp.
- Hỗ trợ safe area: Tự động tính toán `MarginV` theo tỉ lệ video:
  - 16:9 ngang: `MarginV=25` (cách mép dưới 25-30px).
  - 9:16 dọc: `MarginV=120` (vượt qua dải 20% chân trang bị che bởi giao diện TikTok/Reels).

